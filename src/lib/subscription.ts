// Client-side subscription store.
//
// The DB row in `public.subscriptions` is the source of truth for plan +
// trial. This module:
//   - Caches the row in memory after the first load.
//   - Exposes a `loadSubscription(userId)` that hits `getEffectivePlan`
//     serverFn once per user per page-load.
//   - Emits a `telux:subscription-changed` window event so `useSubscription`
//     re-renders on plan / trial changes (a different tab cancels the trial,
//     or the Billing page starts a new one).
//
// We deliberately do NOT persist anything to localStorage here. Trial state
// is server-backed so clearing browser data does not give a free renewal.

import type { Plan } from "./usage";

export type SubscriptionSnapshot = {
  plan: "free" | "personal" | "pro";
  effectivePlan: Plan;
  isOnTrial: boolean;
  trialStartedAt: number | null;
  trialEndsAt: number | null;
  trialDaysRemaining: number;
  // Billing cycle of the current paid plan. Null on free / trial.
  billingCycle: "monthly" | "yearly" | null;
  // When the paid plan expires — null for free / trial.
  validUntil: number | null;
  loading: boolean;
};

const EMPTY: SubscriptionSnapshot = {
  plan: "free",
  effectivePlan: "starter",
  isOnTrial: false,
  trialStartedAt: null,
  trialEndsAt: null,
  trialDaysRemaining: 0,
  billingCycle: null,
  validUntil: null,
  // Default to false so the dashboard mounts immediately on every protected
  // route. The AuthGate kicks off `loadSubscription()` in the background
  // and the snapshot flips to the real values when the serverFn resolves.
  // Before it resolves, every gate treats the user as a Starter subscriber,
  // which is the safest default — voice / paid features stay locked.
  loading: false,
};

let cache: SubscriptionSnapshot = EMPTY;
let loadedFor: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getSubscriptionSnapshot(): SubscriptionSnapshot {
  return cache;
}

export function subscribeSubscription(callback: () => void): () => void {
  listeners.add(callback);
  // Cross-tab sync — if the user opens Billing in two tabs and starts a
  // trial in one, the other tab sees it immediately.
  if (typeof window !== "undefined") {
    window.addEventListener("storage", callback);
    return () => {
      listeners.delete(callback);
      window.removeEventListener("storage", callback);
    };
  }
  return () => {
    listeners.delete(callback);
  };
}

export function getSubscriptionServerSnapshot(): SubscriptionSnapshot {
  // Same defaults as EMPTY — server-rendered HTML should look identical to
  // the very first client paint so React doesn't hydrate-mismatch.
  return EMPTY;
}

export function setSubscriptionSnapshot(next: SubscriptionSnapshot, userId: string | null): void {
  cache = next;
  loadedFor = userId;
  emit();
}

export function resetSubscriptionCache(): void {
  cache = EMPTY;
  loadedFor = null;
  emit();
}

export function getLoadedUserId(): string | null {
  return loadedFor;
}

/** Fire the cross-component change event after a serverFn mutation. */
export function emitSubscriptionChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("telux:subscription-changed"));
  emit();
}

/**
 * Fetch the user's effective subscription via the serverFn. Idempotent —
 * subsequent calls for the same `userId` within the same page-load hit the
 * cache. Pass `force: true` to refetch (e.g. after `startTrial` returns).
 *
 * Non-blocking: the returned promise resolves with the cached snapshot
 * immediately (if any) and triggers a background refresh. The cache is
 * NOT flipped to `loading: true` — that would unmount the dashboard and
 * show a spinner on every page-load, which feels slow.
 */
export async function loadSubscription(
  userId: string,
  opts: { force?: boolean } = {},
): Promise<SubscriptionSnapshot> {
  if (!opts.force && loadedFor === userId && !cache.loading) {
    return cache;
  }

  const { getEffectivePlan } = await import("@/serverFns/subscription");
  const next = await getEffectivePlan({ data: { userId } });

  const snap: SubscriptionSnapshot = {
    plan: next.plan,
    effectivePlan: next.effectivePlan,
    isOnTrial: next.isOnTrial,
    trialStartedAt: next.trialStartedAt,
    trialEndsAt: next.trialEndsAt,
    trialDaysRemaining: next.trialDaysRemaining,
    billingCycle: next.billingCycle ?? null,
    validUntil: next.validUntil ?? null,
    loading: false,
  };
  setSubscriptionSnapshot(snap, userId);
  return snap;
}
