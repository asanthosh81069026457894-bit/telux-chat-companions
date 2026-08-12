// useSubscription — react hook backed by useSyncExternalStore, mirroring the
// `useUsage` pattern. Subscribes to:
//   - The in-memory cache (so a serverFn result lands instantly).
//   - The `telux:subscription-changed` window event (cross-component sync).
//   - The `storage` event (cross-tab sync).

import { useSyncExternalStore } from "react";

import {
  getSubscriptionServerSnapshot,
  getSubscriptionSnapshot,
  subscribeSubscription,
} from "@/lib/subscription";

export function useSubscription() {
  return useSyncExternalStore(
    subscribeSubscription,
    getSubscriptionSnapshot,
    getSubscriptionServerSnapshot,
  );
}
