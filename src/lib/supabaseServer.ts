// Server-only Supabase client.
//
// Uses the **service role** key so it can read/write any row regardless of RLS.
// This file is imported exclusively from serverFn handlers (src/serverFns/**)
// and the Nitro build pipeline tree-shakes it out of the browser bundle —
// never import it from a route, component, or hook reachable from the client.
//
// Why we need a service-role client:
//   - The chat proxy (`askChat`) needs to read the user's subscription row to
//     decide whether voice requests are allowed. The browser-supplied user
//     context is not trusted, so we look it up by user_id directly.
//   - `startTrial` / `cancelTrial` / `completeOnboarding` need to mutate rows
//     for the signed-in user without round-tripping through the browser.
//
// What we do NOT do:
//   - We never expose this client to a route. There is no public method that
//     returns the raw client.
//   - We never log the service role key.
//   - We never trust browser-supplied auth headers when using this client;
//     every handler takes an explicit `userId` argument that must match the
//     Supabase session on the caller side (verified by the CSRF middleware in
//     src/start.ts and by the auth guard in <AuthGate>).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;
// Cached anon-key client for the server. Used by signup/login serverFns —
// we MUST NOT use the service-role key to authenticate a user (it bypasses
// RLS AND would mint a session with admin privileges). The anon client is
// gated by RLS just like the browser-side one.
let cachedAnon: SupabaseClient | null = null;

/**
 * Marker error thrown when the service-role client is requested but the
 * server's environment variables are not set. ServerFns catch this and
 * translate it into a "no row found" response (or a no-op write) so the
 * dashboard mounts even when the developer hasn't provisioned Supabase yet.
 *
 * The browser NEVER sees the message text — it's intercepted at the
 * serverFn layer. The operator only sees it in server logs / console.
 */
export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase server client not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment (server-only).",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

/**
 * True when the runtime hasn't been provisioned with SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY. Useful for serverFns that want to short-circuit
 * with a "no row" response instead of an exception when the dev hasn't
 * configured the backend yet.
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = readServiceRoleKey();
  return Boolean(url && key);
}

/**
 * Read + sanitize the service-role key from process.env.
 *
 * Why sanitize: editors on Windows routinely write files with trailing
 * `\r\n` per line. Vite's dotenv loader strips the trailing `\n` but
 * sometimes leaves the `\r`. Supabase's `Invalid API key` is the
 * generic error returned whenever the JWT parse fails — and a stray
 * `\r` at the end of the key is enough to fail the parse. Trimming
 * whitespace + control characters here is a one-line fix that has
 * rescued two deployments in our logs.
 */
function readServiceRoleKey(): string | undefined {
  const raw = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!raw) return undefined;
  // Strip leading/trailing whitespace and the bare CR that Windows
  // editors leave behind. Do NOT strip characters from the middle —
  // JWT sigs would break.
  // eslint-disable-next-line no-control-regex -- intentionally matching \x00-\x1F so a Windows-pasted service-role key with stray NUL/control chars still parses
  const cleaned = raw.replace(/^[\s\x00-\x1F]+|[\s\x00-\x1F]+$/g, "");
  return cleaned.length > 0 ? cleaned : undefined;
}

function getServiceClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = readServiceRoleKey();

  if (!url || !key) {
    throw new SupabaseNotConfiguredError();
  }

  cached = createClient(url, key, {
    auth: {
      // The service-role key bypasses RLS; we don't need session persistence.
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return cached;
}

/**
 * Anon-key Supabase client for use from serverFns. We use this for
 * signup / login flows because:
 *   - The service-role client would mint a session with FULL ADMIN
 *     privileges — sending that back to the browser would escalate the
 *     user's effective permissions to RLS-bypass.
 *   - The anon client is gated by RLS just like the browser-side client,
 *     so the resulting session carries the user's actual role.
 *
 * Memoised per process. Vite's `import.meta.env.VITE_SUPABASE_*` would
 * inline the URL into the build, but on the server we read from
 * `process.env` (Vercel sets it as a runtime env var). The VITE_-prefixed
 * values are present too because TanStack's build propagates them.
 */
export function getAnonClient(): SupabaseClient {
  if (cachedAnon) return cachedAnon;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new SupabaseNotConfiguredError();
  }
  cachedAnon = createClient(url, anon, {
    auth: {
      // The server is stateless — we don't persist the session to disk.
      // Callers receive the tokens and apply them on the browser side.
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return cachedAnon;
}

/**
 * Read a single row from `public.subscriptions` for the given user.
 * Returns null when the user has no subscription row yet (e.g. very first
 * signup where the trigger hasn't fired — handlers should treat null as
 * "free / no trial" rather than an error).
 *
 * Also returns null (with a console warn) when the server-side Supabase
 * client isn't configured. That keeps the dashboard usable in dev when
 * the operator hasn't provisioned Supabase yet — they get a warning banner
 * instead of an error wall.
 */
export async function readSubscriptionRow(userId: string): Promise<SubscriptionRow | null> {
  if (!isSupabaseConfigured()) {
    console.warn("[supabaseServer] readSubscriptionRow: Supabase not configured, returning null");
    return null;
  }
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "user_id, plan, trial_started_at, trial_ends_at, billing_cycle, valid_until, razorpay_payment_id, razorpay_order_id",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(humanizeSupabaseError("read subscription", error.message));
  }
  return (data as SubscriptionRow | null) ?? null;
}

/**
 * Upsert a subscription row. Used by startTrial / cancelTrial. The caller is
 * responsible for sending sane values — this helper just writes them.
 */
export async function writeSubscriptionRow(
  userId: string,
  patch: Partial<Omit<SubscriptionRow, "user_id">>,
): Promise<SubscriptionRow> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" })
    .select("user_id, plan, trial_started_at, trial_ends_at")
    .single();

  if (error) {
    throw new Error(humanizeSupabaseError("write subscription", error.message));
  }
  return data as SubscriptionRow;
}

/**
 * Cheap existence check for a user id. Used by the chat proxy as a ROI guard:
 * we don't want to spend rate-limit tokens or Groq tokens on a fabricated
 * userId. Returns false (and logs a warning) when Supabase isn't configured
 * — in that case we fall back to trusting the caller and the rate limiter
 * does its job instead.
 *
 * We do NOT throw on missing backend; the chat proxy degrades gracefully.
 */
export async function userIdExists(userId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return true; // graceful — see note above.
  const supabase = getServiceClient();
  // Use auth.admin to confirm the user exists. `subscriptions` rows are
  // upserted on signup but a row can exist for a deleted auth user (e.g.
  // an account that was removed mid-flow). The auth schema is the source
  // of truth for "is this user real".
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) {
    console.warn("[supabaseServer] userIdExists: auth lookup failed", error.message);
    return true; // fail-open: better to let a chat through than to lock everyone out on a transient blip
  }
  return data?.user != null;
}

// --- Row shapes (kept local so we don't depend on generated types) ----------

export type SubscriptionRow = {
  user_id: string;
  plan: "free" | "personal" | "pro";
  trial_started_at: string | null;
  trial_ends_at: string | null;
  billing_cycle: "monthly" | "yearly" | null;
  valid_until: string | null;
  razorpay_payment_id: string | null;
  razorpay_order_id: string | null;
};

/**
 * Row shape for the pre-trial questionnaire. The `hear_about` value is the
 * literal label of the chosen option (or the typed text when "Other" was
 * selected); see OnboardingModal for the option list.
 */
export type OnboardingRow = {
  user_id: string;
  full_name: string;
  age: number;
  hear_about: string;
  created_at: string;
  updated_at: string;
};

/**
 * Read the onboarding row for a user, or null if it doesn't exist (the user
 * hasn't completed the pre-trial questionnaire yet). Returns null (with a
 * console warn) when Supabase isn't configured so the dashboard stays usable
 * in dev — AuthGate then treats the user as "onboarding not done" and the
 * modal still renders (it just fails to submit if the backend is offline).
 */
export async function readOnboardingRow(userId: string): Promise<OnboardingRow | null> {
  if (!isSupabaseConfigured()) {
    console.warn("[supabaseServer] readOnboardingRow: Supabase not configured, returning null");
    return null;
  }
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("onboarding_responses")
    .select("user_id, full_name, age, hear_about, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(humanizeSupabaseError("read onboarding", error.message));
  }
  return (data as OnboardingRow | null) ?? null;
}

/**
 * Upsert a row into `public.onboarding_responses`. The PK is `user_id`, so
 * a second call for the same user overwrites — this matches the modal's
 * "you can correct your answers" intent and keeps the schema minimal (no
 * separate history table for what's effectively a one-shot form).
 */
export async function writeOnboardingRow(
  userId: string,
  patch: { full_name: string; age: number; hear_about: string },
): Promise<OnboardingRow> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("onboarding_responses")
    .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" })
    .select("user_id, full_name, age, hear_about, created_at, updated_at")
    .single();
  if (error) {
    throw new Error(humanizeSupabaseError("write onboarding", error.message));
  }
  return data as OnboardingRow;
}

/**
 * Translate a Supabase error message into an actionable hint for the operator.
 * The user-facing forms only show a safe generic message; the operator sees
 * this detail in the deploy / console logs.
 *
 * The cases we cover (in order of frequency we've seen):
 *   1. "Invalid API key" / "Invalid JWT" / "JWT expired"
 *        → service-role key is missing, malformed, rotated, or wrong
 *          (often the anon key was pasted by accident — they look identical).
 *   2. "permission denied" / "row-level security"
 *        → the SQL GRANTs to `service_role` haven't been run yet.
 *   3. "relation … does not exist"
 *        → the SQL migration creating that table hasn't been run yet.
 *   4. everything else → fall through with the raw message.
 *
 * The `what` argument is a short human label (e.g. "read subscription")
 * that's woven into the more specific cases so the operator can grep
 * the deploy logs.
 */
export function humanizeSupabaseError(what: string, message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid api key") || m.includes("invalid jwt") || m.includes("jwt expired")) {
    return (
      `Failed to ${what}: the Supabase service-role key in the server's environment ` +
      `is missing, malformed, or not the \`service_role\` row from Project Settings → API. ` +
      `Open .env, copy the \`service_role\` (NOT \`anon\`) key, restart the dev server.`
    );
  }
  if (m.includes("permission denied") || m.includes("row-level security")) {
    return (
      `Failed to ${what}: row-level security rejected the write. Run ` +
      `\`supabase/sql/0002_subscriptions_and_onboarding.sql\` in the Supabase SQL Editor — ` +
      `it GRANTs INSERT/UPDATE to the service role on \`subscriptions\`.`
    );
  }
  if (m.includes("does not exist") && (m.includes("relation") || m.includes("table"))) {
    return (
      `Failed to ${what}: a required table is missing from your Supabase project. Run ` +
      `\`supabase/sql/0002_subscriptions_and_onboarding.sql\` in the Supabase SQL Editor.`
    );
  }
  // Generic fallback. Also logged to console by the caller; this string is
  // what the user sees in the UI when an upstream error reaches them, so
  // we keep it short and direct.
  return `Failed to ${what}: ${message}`;
}
