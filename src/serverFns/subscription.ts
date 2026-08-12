// Server-side subscription helpers — the authoritative source of "is this
// user on a paid plan / trial / free" for the whole app.
//
// These functions never trust the browser for plan claims. They read
// `public.subscriptions` directly via the service-role Supabase client and
// resolve the *effective* plan: paid if plan != 'free', trial if
// `trial_ends_at > now()`, otherwise 'free' which the client maps to
// `starter`.
//
// Used by:
//   - The chat proxy (`src/lib/chat.ts`) to gate voice mode.
//   - The client via `getEffectivePlan` serverFn so the UI can show the right
//     paywall / trial banner.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { consume } from "@/lib/rate-limit";
import type { Plan } from "@/lib/usage";
import {
  isSupabaseConfigured,
  SupabaseNotConfiguredError,
  readSubscriptionRow,
  writeSubscriptionRow,
} from "@/lib/supabaseServer";
import { resolveSubscription as resolveSubscriptionPure } from "@/lib/resolve-subscription";

// Friendly error thrown when a user repeatedly hits startTrial in a tight
// loop. The trial is server-tracked (a fresh row can't reset the
// countdown), so this is purely a defence against burning Supabase
// round-trips — five attempts per hour is enough for a legitimate retry.
export class TrialRateLimitedError extends Error {
  readonly code = "TRIAL_RATE_LIMITED";
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("Too many trial attempts. Please wait a few minutes before trying again.");
    this.name = "TrialRateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Friendly error thrown when a serverFn can't reach Supabase because the
 * server-side credentials aren't configured. The UI catches this and
 * renders a generic retry hint; the constructor message stays generic so
 * callers don't accidentally leak the env-var name through stack traces.
 *
 * The actual cause (missing SUPABASE_SERVICE_ROLE_KEY, etc.) is logged
 * server-side via `console.warn` in supabaseServer.ts — operators see it
 * in the deployment logs, end-users see only the friendly toast.
 */
export class TeluxBackendOfflineError extends Error {
  readonly code = "BACKEND_OFFLINE";
  constructor(message = "Account features are temporarily unavailable.") {
    super(message);
    this.name = "TeluxBackendOfflineError";
  }
}

/**
 * Translate raw Supabase errors into a TeluxBackendOfflineError so the UI
 * can render a friendly banner instead of an env-var leak. Re-throws the
 * original error if it's not the configuration problem.
 */
function rethrowAsOffline(err: unknown): never {
  if (err instanceof SupabaseNotConfiguredError || !isSupabaseConfigured()) {
    throw new TeluxBackendOfflineError();
  }
  throw err;
}

export type ServerSubscription = {
  plan: "free" | "personal" | "pro";
  trialStartedAt: number | null;
  trialEndsAt: number | null;
  // Computed:
  effectivePlan: Plan;
  isOnTrial: boolean;
  trialDaysRemaining: number;
  // Billing cycle for the current paid plan. Null on free / trial.
  billingCycle: "monthly" | "yearly" | null;
  // When the paid plan expires (null for free / trial).
  validUntil: number | null;
};

// 3-day trial. Mirrored in `src/lib/usage.ts:TRIAL_DAYS` (the user-facing
// constant) — keep both in sync if you ever change this.
const TRIAL_MS = 3 * 86_400_000;
const YEAR_MS = 365 * 86_400_000;

// Thin local wrapper that locks the row type to the one the rest of this
// module produces. The pure logic lives in `@/lib/resolve-subscription` so
// it can be unit-tested without booting the serverFn runtime.
function resolveSubscription(
  row: Parameters<typeof resolveSubscriptionPure>[0],
): ServerSubscription {
  return resolveSubscriptionPure(row) as ServerSubscription;
}

/**
 * Read the user's effective subscription. Cheap — single SELECT. Called by
 * the client on auth state change AND by the chat proxy on every voice
 * request, so it stays pure and side-effect free.
 */
export const getEffectivePlan = createServerFn({ method: "POST" })
  .validator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data }): Promise<ServerSubscription> => {
    // Degrade gracefully when the server-side Supabase client is not
    // configured (missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env).
    // Without this guard, readSubscriptionRow() throws SupabaseNotConfiguredError
    // and the dashboard fails to mount. Returning a free/starter snapshot
    // lets the dashboard render; AuthGate surfaces a non-fatal warning so
    // the operator knows the backend is offline.
    if (!isSupabaseConfigured()) {
      console.warn("[getEffectivePlan] Supabase not configured, returning starter snapshot");
      return resolveSubscription(null);
    }
    try {
      const row = await readSubscriptionRow(data.userId);
      return resolveSubscription(row);
    } catch (err) {
      // Supabase errors (bad key, missing table, RLS denial) are real bugs —
      // surface them as TeluxBackendOfflineError so the UI shows the retry
      // banner instead of a generic "API error". The human-readable detail
      // is logged server-side by humanizeSupabaseError().
      rethrowAsOffline(err);
    }
    // Unreachable — rethrowAsOffline always throws.
    throw new TeluxBackendOfflineError();
  });

/**
 * Apply a paid subscription (monthly or yearly) for a user. Called by the
 * Razorpay webhook after a successful payment — never trust the browser to
 * call this directly. The webhook validates the signature before invoking
 * the function, and the service-role key is what writes the row.
 *
 * Idempotent: re-running with the same inputs produces the same effective
 * state. If the user is mid-trial, the trial ends and the paid plan takes
 * over immediately.
 */
export const activatePaidPlan = createServerFn({ method: "POST" })
  .validator(
    z.object({
      userId: z.string().uuid(),
      plan: z.enum(["personal", "pro"]),
      cycle: z.enum(["monthly", "yearly"]),
      // Razorpay payment id, recorded for support. Optional in dev mode so
      // the "fake checkout" admin tool can still flip the row.
      paymentId: z.string().optional(),
      orderId: z.string().optional(),
    }),
  )
  .handler(async ({ data }): Promise<ServerSubscription> => {
    const durationMs = data.cycle === "yearly" ? YEAR_MS : 30 * 86_400_000;
    const now = Date.now();
    const updated = await writeSubscriptionRow(data.userId, {
      plan: data.plan,
      billing_cycle: data.cycle,
      valid_until: new Date(now + durationMs).toISOString(),
      // A paid upgrade clears the trial — the user is now paying.
      trial_started_at: null,
      trial_ends_at: null,
      razorpay_payment_id: data.paymentId ?? null,
      razorpay_order_id: data.orderId ?? null,
    });
    return resolveSubscription(updated);
  });

/**
 * Start a 3-day Pro trial. Idempotent — calling twice while a trial is
 * active does not extend the timer. The DB row is upserted so even users
 * with no existing row (rare, but possible if the trigger missed them) get
 * one created.
 */
export const startTrial = createServerFn({ method: "POST" })
  .validator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data }): Promise<ServerSubscription> => {
    // Rate limit: 5 attempts per user per hour. The trial is idempotent on
    // the server (no active trial = write one, active trial = return as-is)
    // so this isn't preventing a trial refresh attack — it's preventing a
    // tight-loop bot from burning DB rows / logs.
    const rl = consume(`trial:${data.userId}`, { capacity: 5, windowMs: 60 * 60 * 1000 });
    if (!rl.ok) {
      throw new TrialRateLimitedError(rl.retryAfterMs);
    }
    if (!isSupabaseConfigured()) {
      throw new TeluxBackendOfflineError();
    }
    try {
      const existing = await readSubscriptionRow(data.userId);
      const now = Date.now();
      const currentEnds = existing?.trial_ends_at ? Date.parse(existing.trial_ends_at) : null;
      const trialActive = currentEnds != null && currentEnds > now;

      if (!trialActive) {
        const updated = await writeSubscriptionRow(data.userId, {
          trial_started_at: new Date(now).toISOString(),
          trial_ends_at: new Date(now + TRIAL_MS).toISOString(),
        });
        return resolveSubscription(updated);
      }

      return resolveSubscription(existing);
    } catch (err) {
      rethrowAsOffline(err);
    }
    // Unreachable — rethrowAsOffline always throws.
    throw new TeluxBackendOfflineError();
  });

/**
 * Cancel an active trial. Sets both timestamps to null. If the user was on a
 * paid plan, that is unaffected — only the trial window is dropped.
 */
export const cancelTrial = createServerFn({ method: "POST" })
  .validator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data }): Promise<ServerSubscription> => {
    if (!isSupabaseConfigured()) {
      throw new TeluxBackendOfflineError();
    }
    try {
      const updated = await writeSubscriptionRow(data.userId, {
        trial_started_at: null,
        trial_ends_at: null,
      });
      return resolveSubscription(updated);
    } catch (err) {
      rethrowAsOffline(err);
    }
    // Unreachable — rethrowAsOffline always throws.
    throw new TeluxBackendOfflineError();
  });
