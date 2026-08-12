// Pure subscription-row resolver — extracted from src/serverFns/subscription.ts
// so it can be unit-tested without booting the serverFn runtime.
//
// The DB row may carry an *expired* paid plan (the webhook is the authority
// on expiry, not the row's `plan` column) or a still-active trial. The
// effective plan is computed in priority order:
//   1. Paid plan, if `valid_until` is in the future
//   2. Active trial, if `trial_ends_at` is in the future — grants Pro-tier
//      features (voice, multi-doc chat, 30 docs / 1000 pages, unlimited Q's)
//      for the duration of the trial. The trial itself is gated behind the
//      onboarding modal in AuthGate; this resolver only cares about whether
//      the user is currently inside the trial window.
//   3. Free / starter
//
// Both `validUntil` and `trialEndsAt` are ms-since-epoch. The caller passes
// `now` so tests can pin time without monkey-patching Date.

export type RawSubscriptionRow = {
  plan: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  billing_cycle: string | null;
  valid_until: string | null;
};

export type Plan = "starter" | "personal" | "pro";

export type ResolvedSubscription = {
  plan: "free" | "personal" | "pro";
  trialStartedAt: number | null;
  trialEndsAt: number | null;
  effectivePlan: Plan;
  isOnTrial: boolean;
  trialDaysRemaining: number;
  billingCycle: "monthly" | "yearly" | null;
  validUntil: number | null;
};

const DAY_MS = 86_400_000;

export function resolveSubscription(
  row: RawSubscriptionRow | null,
  now: number = Date.now(),
): ResolvedSubscription {
  const trialEndsAtMs = row?.trial_ends_at ? Date.parse(row.trial_ends_at) : null;
  const trialStartedAtMs = row?.trial_started_at ? Date.parse(row.trial_started_at) : null;
  const validUntilMs = row?.valid_until ? Date.parse(row.valid_until) : null;
  const trialActive =
    trialEndsAtMs != null && Number.isFinite(trialEndsAtMs) && trialEndsAtMs > now;

  const dbPlan = row?.plan ?? "free";
  const plan: "free" | "personal" | "pro" =
    dbPlan === "personal" || dbPlan === "pro" ? dbPlan : "free";

  const billingCycle: "monthly" | "yearly" | null =
    row?.billing_cycle === "yearly" || row?.billing_cycle === "monthly" ? row.billing_cycle : null;

  const paidActive = plan !== "free" && (validUntilMs == null || validUntilMs > now);
  let effectivePlan: Plan;
  if (paidActive) {
    effectivePlan = plan;
  } else if (trialActive) {
    // Trial = Pro: voice + multi-doc chat + 1000 pages. 3-day window.
    effectivePlan = "pro";
  } else {
    effectivePlan = "starter";
  }

  const trialDaysRemaining =
    trialActive && trialEndsAtMs ? Math.max(0, Math.ceil((trialEndsAtMs - now) / DAY_MS)) : 0;

  return {
    plan: paidActive ? plan : "free",
    trialStartedAt: trialStartedAtMs,
    trialEndsAt: trialEndsAtMs,
    effectivePlan,
    isOnTrial: trialActive && !paidActive,
    trialDaysRemaining,
    billingCycle: paidActive ? billingCycle : null,
    validUntil: validUntilMs,
  };
}
