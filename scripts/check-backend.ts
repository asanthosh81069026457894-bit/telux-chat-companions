// ============================================================================
// Telux — full backend connection check.
//
// Probes every third-party service the dev / production server needs:
//   1. Supabase URL + SERVICE_ROLE_KEY (auth + table presence)
//   2. Groq API key (LLM provider)
//   3. Razorpay test-mode API keys (Basic auth on GET /v1/plans)
//
// Prints the first 12 + last 8 chars of every secret — never the full value.
// Run via `npm run backend:check`.
//
// Why this exists: when "the dashboard broke" with no clear cause, the most
// common fix is reading five error toasts from five serverFns in a row. This
// script gathers all five probes into a single terminal view so an operator
// can see "three of these are fine, two are misconfigured" in one shot.
//
// Relies on Node 20.6+ native --env-file flag (set in package.json).
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const PLACEHOLDER_PATTERNS = [/^__.*__$/i, /^YOUR[_-].*$/i, /^replace[_-]with.*$/i];

// ANSI: works in PowerShell Core + macOS Terminal. Plain text on legacy
// terminals because readability matters more than colour.
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function mask(secret: string | undefined, prefixLen = 12): string {
  if (!secret) return "<unset>";
  const clean = secret.replace(/^[\s -]+|[\s -]+$/g, "");
  if (clean.length === 0) return "<whitespace only>";
  const tail = clean.slice(-8);
  return `${clean.slice(0, prefixLen)}…[${clean.length}]…${tail}`;
}

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  return PLACEHOLDER_PATTERNS.some((p) => p.test(value.trim()));
}

type ProbeResult = { ok: boolean; label: string; detail?: string };

async function probeSupabase(): Promise<ProbeResult> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url)
    return { ok: false, label: "Supabase URL", detail: "SUPABASE_URL / VITE_SUPABASE_URL unset" };
  if (!key || isPlaceholder(key)) {
    return {
      ok: false,
      label: "Supabase key",
      detail: "SUPABASE_SERVICE_ROLE_KEY unset or placeholder",
    };
  }
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.from("subscriptions").select("user_id").limit(1);
  if (error) {
    if (/invalid api key|invalid jwt/i.test(error.message)) {
      return {
        ok: false,
        label: "Supabase key",
        detail: `JWT rejected — ${key.slice(0, 12)}… looks malformed or wrong key pasted`,
      };
    }
    if (/permission denied|row-level security/i.test(error.message)) {
      return {
        ok: false,
        label: "Supabase RLS",
        detail:
          "Run supabase/sql/0002_subscriptions_and_onboarding.sql — grants service_role access",
      };
    }
    if (/does not exist/i.test(error.message)) {
      return {
        ok: false,
        label: "Supabase schema",
        detail: "A required table is missing — run 0001, 0002, 0003 in the Supabase SQL Editor",
      };
    }
    return { ok: false, label: "Supabase", detail: error.message };
  }
  return {
    ok: true,
    label: "Supabase",
    detail: `subscriptions reachable (${data?.length ?? 0} sample rows)`,
  };
}

async function probeGroq(): Promise<ProbeResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key || isPlaceholder(key)) {
    return { ok: false, label: "Groq key", detail: "GROQ_API_KEY unset or placeholder" };
  }
  // Lightweight model-list probe — no tokens spent.
  const res = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.status === 401) {
    return { ok: false, label: "Groq key", detail: "401 — key is wrong or revoked" };
  }
  if (!res.ok) {
    return { ok: false, label: "Groq", detail: `${res.status} on models endpoint` };
  }
  return { ok: true, label: "Groq", detail: "models endpoint reachable" };
}

async function probeRazorpay(): Promise<ProbeResult> {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const whsec = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!id || isPlaceholder(id)) {
    return { ok: false, label: "Razorpay Key ID", detail: "RAZORPAY_KEY_ID unset or placeholder" };
  }
  if (!secret || isPlaceholder(secret)) {
    return {
      ok: false,
      label: "Razorpay secret",
      detail: "RAZORPAY_KEY_SECRET unset or placeholder",
    };
  }
  if (!whsec || isPlaceholder(whsec)) {
    return {
      ok: false,
      label: "Razorpay webhook secret",
      detail: "RAZORPAY_WEBHOOK_SECRET unset or placeholder",
    };
  }

  const auth = "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");

  // 1) Auth probe — GET /v1/plans (returns [] on a fresh test account, but
  //    a 401 is the real signal).
  const plansRes = await fetch("https://api.razorpay.com/v1/plans?count=1", {
    headers: { authorization: auth },
  });
  if (plansRes.status === 401) {
    return {
      ok: false,
      label: "Razorpay auth",
      detail: `401 — key id/secret pair rejected. Key id: ${mask(id)}. Confirm Test Mode is ON if you're using an ${id.startsWith("rzp_test_") ? "rzp_test_" : "rzp_live_"} key.`,
    };
  }
  if (!plansRes.ok) {
    return { ok: false, label: "Razorpay", detail: `${plansRes.status} on /v1/plans` };
  }

  // 2) Mode check — fetch payments filtered by created_at last 24h. Test-mode
  //    accounts return data bounded by the dashboard Test Mode switch; live
  //    accounts do too but with real charges. We can detect by checking the
  //    account id (if exposed). Skipping for now — the 200 itself is the
  //    signal we care about.
  return {
    ok: true,
    label: "Razorpay",
    detail: `Key id ${mask(id, 8)} accepted by /v1/plans. Webhook secret: ${mask(whsec, 4)}`,
  };
}

async function main() {
  console.log("");
  console.log("Telux — backend connection check");
  console.log("─────────────────────────────────────────────");
  console.log("");

  // Run all probes in parallel — saves ~1s on the slow path.
  const [supabase, groq, razorpay] = await Promise.all([
    probeSupabase(),
    probeGroq(),
    probeRazorpay(),
  ]);

  const results = [supabase, groq, razorpay];

  for (const r of results) {
    const icon = r.ok ? green("✓") : red("✗");
    const label = r.label.padEnd(24, " ");
    const detail = r.detail ?? "";
    console.log(`  ${icon} ${label} ${dim(detail)}`);
  }

  console.log("");
  const failures = results.filter((r) => !r.ok);
  if (failures.length === 0) {
    console.log(green("All checks passed."));
    console.log("");
    console.log(`  Next: restart ${yellow("npm run dev")} if you just edited ${dim(".env")}.`);
    console.log("");
    process.exit(0);
  }

  console.log(red(`${failures.length} check${failures.length === 1 ? "" : "s"} failed.`));
  console.log("");
  console.log("Common fixes:");
  console.log(
    `  ${dim("•")} Re-paste the failing key directly into ${dim(".env")} (avoid copy/paste of leading space)`,
  );
  console.log(
    `  ${dim("•")} For Razorpay: confirm Test Mode matches your key prefix (rzp_test_ ↔ rzp_live_)`,
  );
  console.log(`  ${dim("•")} Re-run ${yellow("npm run backend:check")} after each fix`);
  console.log("");
  process.exit(failures.length);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(99);
});
