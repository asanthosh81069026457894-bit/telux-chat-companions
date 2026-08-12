// Startup environment validation.
//
// Why this exists: previously each serverFn checked for its own keys and
// surfaced the missing-one-at-a-time. The result was "fix one error, see
// the next" in dev, and silent partial-config deployments on Vercel where
// every serverFn happily returned 500 until you noticed the dashboard was
// broken.
//
// This module runs once per cold start, validates the environment with Zod,
// and emits a single grouped warning when anything is missing or still a
// placeholder. It does NOT throw — the serverFns still degrade gracefully
// when keys are absent, but now there's a single line in the deploy logs
// that tells the operator what's wrong:
//
//   [env] missing keys — public: []; server: [SUPABASE_SERVICE_ROLE_KEY]; ...
//
// Each requirement is documented in `.env.example` and the README.
//
// Rules:
//   - Server-only secrets are NEVER read via `import.meta.env`. That would
//     inline them into the browser bundle.
//   - The validator strips whitespace and accepts empty values as "missing"
//     so a trailing newline in a Vercel env var doesn't silently pass.
//   - Placeholder values (e.g. "__REPLACE_WITH_...__" or
//     "replace_with_...") are also flagged — they're a common source of
//     "the .env exists, the key looks right, but the server still says
//     API error" because the operator forgot to paste the real value.
//   - The result is cached: validation runs at most once per process.

import { z } from "zod";

// Common placeholder patterns seen in .env.example files. Anything that
// matches is treated as "missing" so the operator sees the warning in
// deploy logs instead of a confusing 500 from the chat proxy.
const PLACEHOLDER_PATTERNS = [
  /^__.*__$/i,
  /^YOUR[_-].*$/i,
  /^replace[_-]with.*$/i,
  /^change[_-]?me$/i,
  /^placeholder$/i,
];

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(value.trim()));
}

const trimmedString = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1));

// Public (browser) values. These are safe to expose; the anon key is gated
// by row-level security. VITE_* prefix is required for Vite to inline them
// into the client bundle.
const publicSchema = z.object({
  VITE_SUPABASE_URL: trimmedString,
  VITE_SUPABASE_ANON_KEY: trimmedString,
});

// Server-only secrets. Read from process.env at runtime by the Nitro build
// — these names are intentionally NOT prefixed with VITE_ so they never
// reach the browser bundle.
const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: trimmedString,
  GROQ_API_KEY: trimmedString,
});

// Razorpay block is optional in dev — checkout fails open with a clear
// "Razorpay not configured" error if any key is missing. The three
// credential keys are required to enable paid subscriptions; the four
// plan-amount entries are tuned via env and fall back to the launch
// defaults (₹199 / ₹1,899 / ₹499 / ₹4,799 — paise × 100, matching
// the prices in src/lib/usage.ts).
const razorpaySchema = z
  .object({
    RAZORPAY_KEY_ID: trimmedString,
    RAZORPAY_KEY_SECRET: trimmedString,
    RAZORPAY_WEBHOOK_SECRET: trimmedString,
    RAZORPAY_PLAN_PERSONAL_MONTHLY: z.coerce.number().int().positive().default(19900),
    RAZORPAY_PLAN_PERSONAL_YEARLY: z.coerce.number().int().positive().default(189900),
    RAZORPAY_PLAN_PRO_MONTHLY: z.coerce.number().int().positive().default(49900),
    RAZORPAY_PLAN_PRO_YEARLY: z.coerce.number().int().positive().default(479900),
  })
  .partial();

export type EnvReport = {
  public: z.infer<typeof publicSchema>;
  server: z.infer<typeof serverSchema>;
  razorpay: z.infer<typeof razorpaySchema>;
  // Names of keys that were missing at module-load time. Useful for the
  // /healthz endpoint and operator dashboards. Includes placeholders.
  missing: { public: string[]; server: string[]; razorpay: string[] };
};

let cached: EnvReport | null = null;

/**
 * Validate process.env + import.meta.env once per process and return a
 * structured report. Missing keys are listed under `missing`; the rest of
 * the report contains the parsed values.
 *
 * Safe to call from both server and client modules. On the client, the
 * server-side keys won't be present in `import.meta.env`; this is normal
 * and the report will list them as missing (which is correct — the browser
 * doesn't have them).
 */
export function validateEnv(): EnvReport {
  if (cached) return cached;

  // `import.meta.env` is Vite's bag. `process.env` is the Node server.
  // Reading both means the same module works in the browser bundle (where
  // it sees VITE_* values) and on the server (where it sees everything).
  const src =
    typeof process !== "undefined" && process.env
      ? process.env
      : ((import.meta as { env?: Record<string, string | undefined> }).env ?? {});

  // Custom validator that ALSO flags placeholder strings. We can't use
  // Zod's `.refine` cleanly here because we want to collect BOTH missing
  // and placeholder issues under the same `missing` bucket — that's what
  // makes the operator log line useful.
  function collectMissing(schema: z.ZodTypeAny, keys: string[]): string[] {
    const raw = src as Record<string, string | undefined>;
    const missing: string[] = [];
    for (const key of keys) {
      const value = raw[key];
      if (!value || !value.trim() || isPlaceholder(value)) {
        missing.push(key);
      }
    }
    return missing;
  }

  const publicParsed = publicSchema.safeParse(src);
  const serverParsed = serverSchema.safeParse(src);
  const razorpayParsed = razorpaySchema.safeParse(src);

  const missing = {
    public: publicParsed.success
      ? []
      : collectMissing(publicSchema, ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]),
    server: serverParsed.success
      ? []
      : collectMissing(serverSchema, ["SUPABASE_SERVICE_ROLE_KEY", "GROQ_API_KEY"]),
    razorpay: razorpayParsed.success
      ? []
      : collectMissing(razorpaySchema, [
          "RAZORPAY_KEY_ID",
          "RAZORPAY_KEY_SECRET",
          "RAZORPAY_WEBHOOK_SECRET",
        ]),
  };

  cached = {
    public: publicParsed.success ? publicParsed.data : ({} as EnvReport["public"]),
    server: serverParsed.success ? serverParsed.data : ({} as EnvReport["server"]),
    razorpay: razorpayParsed.success ? razorpayParsed.data : ({} as EnvReport["razorpay"]),
    missing,
  };

  // Log once, in a structured shape that survives log aggregation. We
  // intentionally avoid printing key values — the point is to list which
  // keys are missing, never to print them.
  if (missing.public.length || missing.server.length || missing.razorpay.length) {
    console.warn(
      `[env] missing keys — public: [${missing.public.join(", ")}]; ` +
        `server: [${missing.server.join(", ")}]; ` +
        `razorpay: [${missing.razorpay.join(", ")}]`,
    );
  }

  return cached;
}
