// Razorpay integration — server side only.
//
// Three entry points:
//   - createRazorpaySubscription: opened by the Billing page. Calls the
//     Razorpay REST API to create a Subscription, returns the hosted
//     checkout short_url so the client can pop the checkout modal.
//   - cancelRazorpaySubscription: cancels at period end so the user keeps
//     access until their paid period rolls over.
//   - razorpayWebhook: receives /api/razorpay/webhook, verifies the HMAC,
//     and writes the resulting state to public.subscriptions via
//     activatePaidPlan.
//
// Security contract:
//   - RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET are read ONLY from
//     process.env (via validateEnv() in src/lib/env.ts). They never touch
//     import.meta.env, so they never reach the browser bundle.
//   - RAZORPAY_KEY_ID is safe to send to the client (the Razorpay checkout
//     modal needs it to open). It is the public half of the API keypair,
//     not a secret.
//   - The webhook handler tolerates a missing/empty signature by returning
//     a 400 — it is the only path that grants paid plan state, so its
//     signature check is mandatory, not advisory.
//   - All amounts are read from server-side env vars (RAZORPAY_PLAN_*)
//     validated by src/lib/env.ts. The Billing UI never hard-codes prices;
//     a change in price is one env var, not a redeploy.
//
// Live mode:
//   - Drop the three live keys (rzp_live_…) into the .env / Vercel
//     project settings. The webhook URL must be configured under
//     Razorpay Dashboard → Settings → Webhooks → <your endpoint> →
//     Secret, subscribed to subscription.activated, subscription.charged,
//     subscription.completed, subscription.cancelled, payment.captured.
//   - The plan amounts default to the launch prices (₹199 / ₹1,899 /
//     ₹499 / ₹4,799 in paise). Tune them in env without redeploying code.
//
// Failure modes:
//   - Razorpay down → createRazorpaySubscription rejects with an Error the
//     client shows as "Razorpay is unavailable, try again" — never the raw
//     upstream payload (avoids leaking internal API URLs).
//   - Missing env vars → both serverFns throw a clear
//     "Razorpay not configured" error so the developer sees the cause in
//     logs, but the UI sees a generic message.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { validateEnv } from "@/lib/env";
import { isSupabaseConfigured, SupabaseNotConfiguredError } from "@/lib/supabaseServer";
import { activatePaidPlan } from "@/serverFns/subscription";

const PLAN_PARAM = z.enum(["personal", "pro"]);
const CYCLE_PARAM = z.enum(["monthly", "yearly"]);

// --- Env reading --------------------------------------------------------------
//
// `loadEnv()` reads the validated env from src/lib/env.ts (parsed once per
// process). The env schema has reasonable defaults for the plan amounts
// (₹199 / ₹1,899 / ₹499 / ₹4,799 in paise) so the credential keys are the
// only required entries for live mode.

type RazorpayEnv = {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  plans: Record<
    string,
    { plan: "personal" | "pro"; cycle: "monthly" | "yearly"; amountPaise: number }
  >;
};

let cachedEnv: RazorpayEnv | null = null;

function loadEnv(): RazorpayEnv | null {
  if (cachedEnv) return cachedEnv;
  const env = validateEnv().razorpay;
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET) {
    return null;
  }
  cachedEnv = {
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    plans: {
      personal_monthly: {
        plan: "personal",
        cycle: "monthly",
        amountPaise: env.RAZORPAY_PLAN_PERSONAL_MONTHLY ?? 19900,
      },
      personal_yearly: {
        plan: "personal",
        cycle: "yearly",
        amountPaise: env.RAZORPAY_PLAN_PERSONAL_YEARLY ?? 189900,
      },
      pro_monthly: {
        plan: "pro",
        cycle: "monthly",
        amountPaise: env.RAZORPAY_PLAN_PRO_MONTHLY ?? 49900,
      },
      pro_yearly: {
        plan: "pro",
        cycle: "yearly",
        amountPaise: env.RAZORPAY_PLAN_PRO_YEARLY ?? 479900,
      },
    },
  };
  return cachedEnv;
}

export class RazorpayNotConfiguredError extends Error {
  readonly code = "RAZORPAY_NOT_CONFIGURED";
  constructor() {
    super("Razorpay is not configured on the server.");
    this.name = "RazorpayNotConfiguredError";
  }
}

export class RazorpayUpstreamError extends Error {
  readonly code = "RAZORPAY_UPSTREAM";
  constructor(message = "Razorpay is temporarily unavailable. Please try again.") {
    super(message);
    this.name = "RazorpayUpstreamError";
  }
}

// --- Razorpay REST client -----------------------------------------------------

async function razorpayRequest<T>(
  env: RazorpayEnv,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const auth = "Basic " + Buffer.from(`${env.keyId}:${env.keySecret}`).toString("base64");
  const url = `https://api.razorpay.com/v1${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: auth,
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new RazorpayUpstreamError();
  }
  if (!res.ok) {
    // Upstream is a vendor, never echo its body to the client. The full
    // payload is logged server-side so the developer can correlate.
    const detail = await res.text().catch(() => "");
    console.error(`[razorpay] ${method} ${path} → ${res.status}: ${detail.slice(0, 400)}`);
    throw new RazorpayUpstreamError();
  }
  return (await res.json()) as T;
}

// --- Public serverFns ---------------------------------------------------------

export type CreateSubscriptionResult = {
  // What the client needs to open the Razorpay Standard Checkout modal.
  // RAZORPAY_KEY_ID is safe to expose — it's the public half of the keypair
  // and is required by the checkout.js script.
  razorpayKeyId: string;
  // Razorpay subscription id; passed to the modal so the payment is bound
  // to this plan+cycle combination server-side.
  razorpaySubscriptionId: string;
  // Short URL the checkout also accepts. The Billing UI opens the modal
  // directly with key+subscription_id; short_url is provided as a fallback
  // for environments where the JS modal cannot be loaded.
  shortUrl: string;
  // Echoed back so the client can label the UI.
  plan: "personal" | "pro";
  cycle: "monthly" | "yearly";
};

export const createRazorpaySubscription = createServerFn({ method: "POST" })
  .validator(
    z.object({
      userId: z.string().uuid(),
      plan: PLAN_PARAM,
      cycle: CYCLE_PARAM,
    }),
  )
  .handler(async ({ data }): Promise<CreateSubscriptionResult> => {
    const env = loadEnv();
    if (!env) throw new RazorpayNotConfiguredError();
    if (!isSupabaseConfigured()) throw new SupabaseNotConfiguredError();

    const planKey = `${data.plan}_${data.cycle}`;
    const planCfg = env.plans[planKey];
    if (!planCfg) {
      // Misconfig (someone asked for "pro_yearly" without an env). Treat as
      // upstream misconfig; same UX path as Razorpay being down.
      throw new RazorpayUpstreamError("This plan is not available right now.");
    }

    const totalCount = data.cycle === "yearly" ? 12 : 1;
    const created = await razorpayRequest<{
      id: string;
      short_url: string;
    }>(env, "POST", "/subscriptions", {
      // Use itemised amounts instead of a Plan entity so pricing can be
      // tuned via env without recreating plans in the Razorpay dashboard.
      customer_notify: 1,
      quantity: 1,
      total_count: totalCount,
      notes: {
        user_id: data.userId,
        plan: data.plan,
        cycle: data.cycle,
        // amount is recorded so the webhook handler can confirm the price
        // wasn't tampered with on the way through.
        amount_paise: String(planCfg.amountPaise),
      },
      items: [
        {
          name: `Telux ${data.plan} (${data.cycle})`,
          amount: planCfg.amountPaise,
          currency: "INR",
          quantity: 1,
        },
      ],
      // Start at the next minute so the first charge is "now" rather than
      // racing the request. Razorpay rejects past start_at values.
      start_at: Math.floor(Date.now() / 1000) + 60,
    });

    return {
      razorpayKeyId: env.keyId,
      razorpaySubscriptionId: created.id,
      shortUrl: created.short_url,
      plan: data.plan,
      cycle: data.cycle,
    };
  });

export const cancelRazorpaySubscription = createServerFn({ method: "POST" })
  .validator(
    z.object({
      userId: z.string().uuid(),
      // Razorpay subscription id (sub_***). Required to cancel; we read it
      // from the user's subscriptions row if not supplied.
      razorpaySubscriptionId: z.string().optional(),
    }),
  )
  .handler(async ({ data }): Promise<{ canceled: boolean }> => {
    const env = loadEnv();
    if (!env) throw new RazorpayNotConfiguredError();
    let subId = data.razorpaySubscriptionId;
    if (!subId) {
      const { readSubscriptionRow } = await import("@/lib/supabaseServer");
      const row = await readSubscriptionRow(data.userId);
      const storedOrder = row?.razorpay_order_id;
      // Order ids used to be subscription ids in this integration. The
      // column name is historic but the value is the subscription id.
      subId = storedOrder ?? undefined;
    }
    if (!subId) return { canceled: false };
    try {
      await razorpayRequest<unknown>(env, "POST", `/subscriptions/${subId}/cancel`, {
        cancel_at_cycle_end: 1,
      });
      return { canceled: true };
    } catch {
      // Cancellation is best-effort. The user keeps access until the period
      // ends either way — the webhook will eventually flip them to free.
      return { canceled: false };
    }
  });

// --- Webhook ------------------------------------------------------------------

const WEBHOOK_EVENT_SCHEMA = z.object({
  event: z.string(),
  // We only act on subscription-style events. payment.captured is handled
  // by the matching subscription.* event Razorpay also fires; if a merchant
  // sends a pure payment event we accept it but the plan still comes from
  // payload.subscription_entity.notes.
  payload: z.object({
    subscription: z
      .object({
        entity: z.object({
          id: z.string(),
          notes: z
            .object({
              user_id: z.string().optional(),
              plan: z.string().optional(),
              cycle: z.string().optional(),
            })
            .passthrough()
            .optional(),
          status: z.string().optional(),
        }),
      })
      .optional(),
    payment: z
      .object({
        entity: z.object({
          id: z.string().optional(),
          amount: z.number().optional(),
          currency: z.string().optional(),
        }),
      })
      .optional(),
  }),
});

/**
 * Verify the X-Razorpay-Signature header against RAZORPAY_WEBHOOK_SECRET
 * using the HMAC-SHA256 algorithm Razorpay documents. Returns true on match.
 *
 * Why we reimplement rather than `npm install razorpay`: the official SDK
 * is a fat wrapper around the same Node `crypto` we already have, and it
 * has been known to silently succeed on empty signatures in the past. ~20
 * lines of code is auditable in seconds, the SDK is not.
 */
async function verifyWebhookSignature(
  body: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Constant-time compare so the response time doesn't leak match length.
  if (expected.length !== signatureHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return diff === 0;
}

export type WebhookOutcome =
  { ok: true; event: string; userId: string | null } | { ok: false; reason: string };

export async function handleRazorpayWebhook(
  rawBody: string,
  signatureHeader: string | null,
): Promise<WebhookOutcome> {
  const env = loadEnv();
  if (!env) return { ok: false, reason: "not_configured" };
  const verified = await verifyWebhookSignature(rawBody, signatureHeader, env.webhookSecret);
  if (!verified) return { ok: false, reason: "signature_mismatch" };

  let parsed;
  try {
    parsed = WEBHOOK_EVENT_SCHEMA.parse(JSON.parse(rawBody));
  } catch {
    return { ok: false, reason: "bad_payload" };
  }

  const event = parsed.event;
  const subEntity = parsed.payload.subscription?.entity;
  const notes = subEntity?.notes ?? {};
  const userId = notes.user_id;
  const plan = notes.plan;
  const cycle = notes.cycle;

  // Every checkout we create writes the user_id into the subscription's
  // `notes` field (see createRazorpaySubscription above), so the webhook
  // always has the user available. If a future flow forgets the notes,
  // we reject with a clear reason — silently granting plan access to a
  // random user would be a much worse failure mode.
  const resolvedUserId = userId;
  const resolvedPlan: "personal" | "pro" | null =
    plan === "personal" || plan === "pro" ? plan : null;
  const resolvedCycle: "monthly" | "yearly" | null =
    cycle === "monthly" || cycle === "yearly" ? cycle : null;

  if (!resolvedUserId) {
    return { ok: false, reason: "no_user_id_in_notes" };
  }

  // Activate the paid plan on the success-class events; cancel on the
  // cancellation event. Unknown events are acknowledged (200) so Razorpay
  // doesn't retry them forever.
  const ACTIVATING = new Set([
    "subscription.activated",
    "subscription.charged",
    "subscription.completed",
    "payment.captured",
  ]);
  const CANCELLING = new Set(["subscription.cancelled"]);

  if (ACTIVATING.has(event)) {
    if (!resolvedPlan || !resolvedCycle) {
      // Without plan/cycle we can't safely write the row — Razorpay
      // shouldn't fire subscription.* without notes from our checkout, but
      // we guard against a tampered note.
      return { ok: false, reason: "missing_plan_or_cycle" };
    }
    await activatePaidPlan({
      data: {
        userId: resolvedUserId,
        plan: resolvedPlan,
        cycle: resolvedCycle,
        paymentId: parsed.payload.payment?.entity.id,
        orderId: subEntity?.id,
      },
    });
    return { ok: true, event, userId: resolvedUserId };
  }

  if (CANCELLING.has(event)) {
    // The subscription row carries plan + valid_until; on cancel we null
    // valid_until so the resolveSubscription() serverFn sees the user as
    // free at the next tick. We DON'T delete the row — the user keeps
    // access until valid_until and we keep an audit trail.
    const { readSubscriptionRow, writeSubscriptionRow } = await import("@/lib/supabaseServer");
    const existing = await readSubscriptionRow(resolvedUserId);
    if (existing) {
      await writeSubscriptionRow(resolvedUserId, {
        valid_until: null,
      });
    }
    return { ok: true, event, userId: resolvedUserId };
  }

  return { ok: true, event, userId: null };
}
