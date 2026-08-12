// Unit tests for the token-bucket rate limiter. Run with:
//   node --test --experimental-strip-types src/lib/rate-limit.test.ts
//
// The `node:test` runner ships with Node 20+ — no vitest/jest required.

import { test } from "node:test";
import assert from "node:assert/strict";

import { consume, __resetRateLimitStore } from "./rate-limit.ts";

test("consume allows the first N requests up to capacity", () => {
  __resetRateLimitStore();
  for (let i = 0; i < 3; i++) {
    const r = consume("k1", { capacity: 3, windowMs: 1000 });
    assert.equal(r.ok, true, `request ${i + 1} should be allowed`);
  }
});

test("consume rejects the (capacity+1)th request", () => {
  __resetRateLimitStore();
  for (let i = 0; i < 3; i++) consume("k2", { capacity: 3, windowMs: 1000 });
  const r = consume("k2", { capacity: 3, windowMs: 1000 });
  assert.equal(r.ok, false);
  assert.equal(r.remaining, 0);
  assert.ok(r.retryAfterMs > 0);
});

test("different keys have independent buckets", () => {
  __resetRateLimitStore();
  for (let i = 0; i < 3; i++) consume("kA", { capacity: 3, windowMs: 1000 });
  const rA = consume("kA", { capacity: 3, windowMs: 1000 });
  const rB = consume("kB", { capacity: 3, windowMs: 1000 });
  assert.equal(rA.ok, false, "kA should be exhausted");
  assert.equal(rB.ok, true, "kB should still have full capacity");
});

test("buckets refill over time", async () => {
  __resetRateLimitStore();
  // capacity=2, window=100ms → 1 token per 50ms.
  consume("k3", { capacity: 2, windowMs: 100 });
  consume("k3", { capacity: 2, windowMs: 100 });
  const r1 = consume("k3", { capacity: 2, windowMs: 100 });
  assert.equal(r1.ok, false);
  // Wait long enough for at least one token to refill. 120ms is comfortably
  // more than the 50ms-per-token refill rate.
  await new Promise((r) => setTimeout(r, 120));
  const r2 = consume("k3", { capacity: 2, windowMs: 100 });
  assert.equal(r2.ok, true, "bucket should have refilled after waiting");
});

test("retryAfterMs is bounded by one window", () => {
  __resetRateLimitStore();
  consume("k4", { capacity: 1, windowMs: 60_000 });
  const r = consume("k4", { capacity: 1, windowMs: 60_000 });
  assert.equal(r.ok, false);
  // Linear refill: 1 token per 60s. The deficit is just under 1, so the
  // wait time should be just under the full window. Assert it's positive
  // and within 1.5x the window.
  assert.ok(r.retryAfterMs > 0);
  assert.ok(r.retryAfterMs <= 60_000 * 1.5, `retryAfterMs was ${r.retryAfterMs}`);
});
