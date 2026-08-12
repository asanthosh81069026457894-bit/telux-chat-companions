import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surfaced in the browser console the first time the app loads.
  // The auth UI reads the same env vars and will refuse to call Supabase
  // without them.
  console.warn(
    "[supabase] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing. " +
      "Copy .env.example to .env and fill in your project credentials.",
  );
}

/**
 * Supabase browser client.
 *
 * When the env vars are unset (misconfigured deploy) we DO NOT call
 * createClient("","") — that succeeds but throws later on first network
 * call, taking the whole app down. Instead we lazily construct a real
 * client only when both vars are present, and export a never-resolving
 * proxy for the misconfigured case so any code path that touches
 * `supabase` (auth state subscriptions, getSession, etc.) just hangs
 * silently instead of throwing during module evaluation.
 *
 * Net effect: a deploy with missing env vars shows the marketing page
 * (no auth), the login/signup forms show a clear inline error, and the
 * rest of the UI keeps working. Without this, the same misconfig makes
 * the page blank.
 */
const configured = Boolean(url && anonKey);

const placeholder: SupabaseClient = new Proxy(
  {},
  {
    get() {
      // Return a thenable that never resolves. Components that read
      // session via `supabase.auth.getSession()` will see `loading: true`
      // forever rather than crashing — which is the right behaviour on
      // a misconfigured deploy (the auth UI shows its own message).
      return () => new Promise<never>(() => {});
    },
  },
) as unknown as SupabaseClient;

export const supabase: SupabaseClient = configured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : placeholder;

export const SUPABASE_CONFIGURED = configured;
