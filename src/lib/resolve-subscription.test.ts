// Unit tests for the subscription-row resolver.
//
// Run with:
//   node --test --experimental-strip-types src/lib/resolve-subscription.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveSubscription } from "./resolve-subscription.ts";

// Pin "now" to a known instant so expiry math is deterministic.
const NOW = Date.parse("2026-08-01T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

test("null row → free starter, no trial", () => {
  const r = resolveSubscription(null, NOW);
  assert.equal(r.effectivePlan, "starter");
  assert.equal(r.plan, "free");
  assert.equal(r.isOnTrial, false);
  assert.equal(r.trialDaysRemaining, 0);
});

test("active paid plan wins over trial", () => {
  const r = resolveSubscription(
    {
      plan: "pro",
      trial_started_at: iso(NOW - 3 * 86_400_000),
      trial_ends_at: iso(NOW + 4 * 86_400_000), // active trial
      billing_cycle: "monthly",
      valid_until: iso(NOW + 20 * 86_400_000), // active paid plan
    },
    NOW,
  );
  assert.equal(r.effectivePlan, "pro");
  assert.equal(r.plan, "pro");
  assert.equal(r.isOnTrial, false, "paid plan overrides trial");
  assert.equal(r.billingCycle, "monthly");
});

test("expired valid_until falls back to trial (trial grants Pro)", () => {
  const r = resolveSubscription(
    {
      plan: "personal",
      trial_started_at: iso(NOW - 1 * 86_400_000),
      trial_ends_at: iso(NOW + 6 * 86_400_000),
      billing_cycle: "monthly",
      valid_until: iso(NOW - 1 * 86_400_000), // expired
    },
    NOW,
  );
  // plan column says personal but valid_until is in the past — fallback to
  // trial (which is active). Trial grants Pro, so effectivePlan is "pro".
  assert.equal(r.effectivePlan, "pro", "trial unlocks Pro-tier features");
  assert.equal(r.plan, "free", "plan column reports free because paid expired");
  assert.equal(r.isOnTrial, true);
  assert.equal(r.billingCycle, null, "no active paid billing cycle");
});

test("expired trial and no paid plan → starter", () => {
  const r = resolveSubscription(
    {
      plan: "free",
      trial_started_at: iso(NOW - 10 * 86_400_000),
      trial_ends_at: iso(NOW - 3 * 86_400_000),
      billing_cycle: null,
      valid_until: null,
    },
    NOW,
  );
  assert.equal(r.effectivePlan, "starter");
  assert.equal(r.isOnTrial, false);
});

test("trialDaysRemaining rounds up so day-1 reports '1 day left'", () => {
  const r = resolveSubscription(
    {
      plan: "free",
      trial_started_at: iso(NOW - 6 * 86_400_000),
      trial_ends_at: iso(NOW + 12 * 60 * 60 * 1000), // 12h left
      billing_cycle: null,
      valid_until: null,
    },
    NOW,
  );
  assert.equal(r.trialDaysRemaining, 1);
});

test("unknown billing_cycle string is treated as null", () => {
  const r = resolveSubscription(
    {
      plan: "personal",
      trial_started_at: null,
      trial_ends_at: null,
      billing_cycle: "fortnightly", // not in the allow-list
      valid_until: iso(NOW + 10 * 86_400_000),
    },
    NOW,
  );
  assert.equal(r.effectivePlan, "personal");
  assert.equal(r.billingCycle, null);
});

test("unknown plan string is treated as free", () => {
  const r = resolveSubscription(
    {
      plan: "enterprise",
      trial_started_at: null,
      trial_ends_at: null,
      billing_cycle: null,
      valid_until: iso(NOW + 10 * 86_400_000),
    },
    NOW,
  );
  assert.equal(r.plan, "free");
  // No paid, no trial → starter.
  assert.equal(r.effectivePlan, "starter");
});
