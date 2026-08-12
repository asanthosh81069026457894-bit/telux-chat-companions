// ============================================================================
// Telux — Supabase connection check.
//
// Validates that:
//   1. The .env file has real (non-placeholder) SUPABASE_URL + SERVICE_ROLE_KEY.
//   2. The service-role JWT is well-formed and Supabase accepts it.
//   3. The required tables (subscriptions, onboarding_responses) exist.
//
// NEVER prints the key value — only its first 12 chars + length, so you can
// see "the key that ends in ...xyzU" without exposing it.
//
// Usage:
//   npm run db:check
//
// Relies on Node 20.6+ native --env-file flag (set in package.json script).
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PLACEHOLDER_PATTERNS = [/^__.*__$/i, /^YOUR[_-].*$/i, /^replace[_-]with.*$/i];

function mask(k: string | undefined): string {
  if (!k) return "<unset>";
  // eslint-disable-next-line no-control-regex -- intentionally matching \x00-\x1F so a Windows-pasted service-role key with stray NUL/control chars still parses
  const clean = k.replace(/^[\s\x00-\x1F]+|[\s\x00-\x1F]+$/g, "");
  const tail = clean.slice(-8);
  return `${clean.slice(0, 12)}…[${clean.length}]…${tail}`;
}

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.trim();
  return PLACEHOLDER_PATTERNS.some((p) => p.test(v));
}

async function main() {
  console.log("");
  console.log("Telux — Supabase connection check");
  console.log("─────────────────────────────────────────────");
  console.log("");

  let ok = true;

  if (!url) {
    console.log("✗ SUPABASE_URL / VITE_SUPABASE_URL is missing.");
    ok = false;
  } else {
    console.log(`✓ URL set:  ${url}`);
  }

  if (!key) {
    console.log("✗ SUPABASE_SERVICE_ROLE_KEY is unset.");
    ok = false;
  } else if (isPlaceholder(key)) {
    console.log(`✗ SUPABASE_SERVICE_ROLE_KEY is still a placeholder (${key}).`);
    ok = false;
  } else {
    console.log(`✓ Key set:  ${mask(key)}`);
  }

  if (!ok) {
    console.log("");
    console.log("Fix the issues above, then re-run:  npm run db:check");
    console.log("Get the service-role key from:");
    console.log("  Supabase Dashboard → Project Settings → API → service_role row");
    console.log("");
    process.exit(1);
  }

  console.log("");
  console.log("Testing connection…");

  const supabase = createClient(url!, key!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Cheap probe: list 1 row from subscriptions (service-role can read all).
  const { data, error } = await supabase.from("subscriptions").select("user_id").limit(1);

  if (error) {
    console.log(`✗ Supabase rejected the request: ${error.message}`);
    if (/invalid api key|invalid jwt/i.test(error.message)) {
      console.log("");
      console.log("  The JWT parse failed. Most common causes:");
      console.log("    - You pasted the anon key by mistake (looks identical).");
      console.log("    - Trailing whitespace / \\r in .env — already stripped in the");
      console.log("      app, but if you're running this check before restart,");
      console.log("      try restarting npm run dev after editing .env.");
      console.log("    - The key was regenerated in Supabase. Copy the new one.");
    }
    if (/permission denied|row-level security/i.test(error.message)) {
      console.log("");
      console.log("  Even the service-role key got blocked by RLS. Run the SQL");
      console.log("  migrations in supabase/sql/ in order — they grant the service");
      console.log("  role explicit access to subscriptions / onboarding_responses.");
    }
    if (/does not exist/i.test(error.message)) {
      console.log("");
      console.log("  A required table is missing. Run the SQL files in");
      console.log("  supabase/sql/ (0001, 0002, 0003) in the Supabase SQL Editor.");
    }
    process.exit(2);
  }

  console.log(`✓ Connection OK (subscriptions table has ${data?.length ?? 0} sample row).`);

  // Sanity-check that onboarding_responses exists too.
  const { error: onbErr } = await supabase.from("onboarding_responses").select("id").limit(0);
  if (onbErr && /does not exist/i.test(onbErr.message)) {
    console.log("✗ onboarding_responses table is missing — run 0002_…sql.");
    process.exit(3);
  }
  console.log("✓ onboarding_responses table present.");

  console.log("");
  console.log("All checks passed. Restart npm run dev if you just edited .env.");
  console.log("");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(99);
});
