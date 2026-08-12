import { useSyncExternalStore } from "react";

import {
  getSubscriptionServerSnapshot,
  getSubscriptionSnapshot,
  subscribeSubscription,
} from "@/lib/subscription";
import { getUsage, type Plan, type UsageSnapshot } from "@/lib/usage";

/**
 * Composite view used by the dashboard / chat panel.
 *
 * - `plan` / `effectivePlan` come from the server-backed subscription store
 *   (Supabase `subscriptions` row). Trial state lives there.
 * - `questionsThisMonth` still comes from localStorage because Personal/Pro
 *   are unlimited and Starter only ever sees a 50/month cap that we can
 *   keep on-device.
 *
 * `useSyncExternalStore` against the subscription store so any change in the
 * trial / plan re-renders the dashboard immediately.
 *
 * Snapshot identity is stable across renders when neither subscription nor
 * local-storage usage changed — the previous implementation JSON-stringified
 * the composite on every getSnapshot() call, which made
 * useSyncExternalStore think the value always changed and re-render every
 * subscriber (including the dashboard) on every render pass.
 */

export type DashboardUsage = UsageSnapshot & {
  effectivePlan: Plan;
  trialUntil: number | null;
  trialDaysRemaining: number;
  isOnTrial: boolean;
  billingCycle: "monthly" | "yearly" | null;
};

const EMPTY_SUB = {
  effectivePlan: "starter" as Plan,
  trialEndsAt: null as number | null,
  trialDaysRemaining: 0,
  isOnTrial: false,
  billingCycle: null as "monthly" | "yearly" | null,
};

function buildComposite(): DashboardUsage {
  const sub =
    getSubscriptionSnapshot() ?? (EMPTY_SUB as ReturnType<typeof getSubscriptionSnapshot>);
  const usage = getUsage();
  return {
    ...usage,
    effectivePlan: sub.effectivePlan,
    trialUntil: sub.trialEndsAt,
    trialDaysRemaining: sub.trialDaysRemaining,
    isOnTrial: sub.isOnTrial,
    billingCycle: sub.billingCycle ?? null,
  };
}

let lastComposite: DashboardUsage = buildComposite();
const compositeListeners = new Set<() => void>();

function recomputeIfChanged(): void {
  const next = buildComposite();
  // Shallow equality — every field on the composite is a primitive or a
  // plain object whose fields are primitives, so a top-level compare is
  // sound and cheap.
  if (
    lastComposite.plan !== next.plan ||
    lastComposite.questionsThisMonth !== next.questionsThisMonth ||
    lastComposite.monthKey !== next.monthKey ||
    lastComposite.effectivePlan !== next.effectivePlan ||
    lastComposite.trialUntil !== next.trialUntil ||
    lastComposite.trialDaysRemaining !== next.trialDaysRemaining ||
    lastComposite.isOnTrial !== next.isOnTrial ||
    lastComposite.billingCycle !== next.billingCycle
  ) {
    lastComposite = next;
    for (const l of compositeListeners) l();
  }
}

function subscribe(callback: () => void): () => void {
  recomputeIfChanged();
  const unsubSub = subscribeSubscription(() => recomputeIfChanged());
  compositeListeners.add(callback);
  // Listen for usage-counter mutations (recordQuestion bumps it).
  if (typeof window !== "undefined") {
    window.addEventListener("telux:usage-changed", recomputeIfChanged);
  }
  return () => {
    unsubSub();
    compositeListeners.delete(callback);
    if (typeof window !== "undefined") {
      window.removeEventListener("telux:usage-changed", recomputeIfChanged);
    }
  };
}

function getSnapshot(): DashboardUsage {
  return lastComposite;
}

function getServerSnapshot(): DashboardUsage {
  // Use a stable module-level cache so server renders produce a stable
  // reference (otherwise React 19 will warn about getSnapshot returning a
  // new object every call during SSR).
  return SERVER_SNAPSHOT;
}

const SERVER_SNAPSHOT: DashboardUsage = {
  plan: "starter",
  questionsThisMonth: 0,
  monthKey: "1970-01",
  effectivePlan: "starter",
  trialUntil: null,
  trialDaysRemaining: 0,
  isOnTrial: false,
  billingCycle: null,
};

export function useUsage(): DashboardUsage {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Convenience: read only the effective plan. */
export function usePlan(): Plan {
  return useUsage().effectivePlan;
}
