// Self-loading Razorpay Standard Checkout modal.
//
// Flow:
//   1. Billing section calls onSubscribe(plan, cycle).
//   2. We POST to createRazorpaySubscription serverFn → get key_id +
//      subscription_id back.
//   3. Lazy-load https://checkout.razorpay.com/v1/checkout.js (cached after
//      first load — Vite + browser both dedupe by URL).
//   4. Open the modal. On success, refresh the subscription snapshot so
//      the dashboard reflects the new plan without a page reload.
//
// The script tag is loaded inside an idempotent promise. Repeated clicks on
// "Subscribe" don't refetch the script.
//
// We never read RAZORPAY_KEY_SECRET or RAZORPAY_WEBHOOK_SECRET here — those
// are server-only. The key_id is the public half of the API keypair, the
// same value that ships on every checkout.js page; it cannot sign requests
// or refund subscriptions on its own.

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { cancelRazorpaySubscription, createRazorpaySubscription } from "@/serverFns/razorpay";
import { emitSubscriptionChange, loadSubscription } from "@/lib/subscription";
import { translateRazorpayError } from "@/lib/razorpay-errors";
import type { BillingCycle, Plan } from "@/lib/usage";

type RazorpayCheckoutOptions = {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  image?: string;
  handler: (response: { razorpay_payment_id: string; razorpay_subscription_id: string }) => void;
  modal: { ondismiss: () => void; backdropclose?: boolean };
  prefill?: { name?: string; email?: string };
};

type RazorpayInstance = {
  open: () => void;
  on: (event: string, cb: (resp: unknown) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayInstance;
  }
}

let scriptLoader: Promise<void> | null = null;

/**
 * Lazily load https://checkout.razorpay.com/v1/checkout.js. Idempotent —
 * subsequent calls return the same promise. The script is ~50KB and is
 * cached in the browser after first load, so we only pay the network cost
 * once per device.
 */
function loadRazorpayScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Razorpay) return Promise.resolve();
  if (scriptLoader) return scriptLoader;
  scriptLoader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-razorpay-checkout="1"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Razorpay script failed to load")));
      return;
    }
    const tag = document.createElement("script");
    tag.src = "https://checkout.razorpay.com/v1/checkout.js";
    tag.async = true;
    tag.defer = true;
    tag.dataset.razorpayCheckout = "1";
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error("Razorpay script failed to load"));
    document.head.appendChild(tag);
  });
  return scriptLoader;
}

export function useRazorpayCheckout() {
  const [busy, setBusy] = useState<null | { plan: Plan; cycle: BillingCycle }>(null);
  const [error, setError] = useState<string | null>(null);
  // Ref to cancel an in-flight modal dismiss → tidy up Razorpay's checkout.
  // Using a ref because we don't want a re-render when we set it.
  const inFlightRef = useRef(false);

  const checkout = useCallback(
    async (args: { userId: string; plan: Plan; cycle: BillingCycle; customerEmail?: string }) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setBusy({ plan: args.plan, cycle: args.cycle });
      setError(null);
      try {
        const sub = await createRazorpaySubscription({
          data: {
            userId: args.userId,
            // Razorpay serverFn rejects "starter" — narrow here so callers
            // get a type error if they ever pass the free plan by mistake.
            plan: (args.plan === "starter" ? "personal" : args.plan) as "personal" | "pro",
            cycle: args.cycle,
          },
        });
        try {
          await loadRazorpayScript();
        } catch {
          // Script load failure — offer the short_url fallback so the user
          // can still pay via a separate tab.
          window.open(sub.shortUrl, "_blank", "noopener,noreferrer");
          setError(
            "Couldn't open the secure checkout window in this browser. We opened it in a new tab instead — finish payment there, then return.",
          );
          return;
        }
        if (!window.Razorpay) {
          window.open(sub.shortUrl, "_blank", "noopener,noreferrer");
          setError(
            "Couldn't open the secure checkout window. We opened it in a new tab instead — finish payment there, then return.",
          );
          return;
        }
        const instance = new window.Razorpay({
          key: sub.razorpayKeyId,
          subscription_id: sub.razorpaySubscriptionId,
          name: "Telux",
          description: `Telux ${args.plan === "personal" ? "Personal" : "Pro"} — ${args.cycle === "monthly" ? "monthly" : "yearly"} subscription`,
          handler: async (resp) => {
            try {
              // The webhook is the authority on activation — by the time
              // Razorpay shows success, the DB row should already be paid.
              // We refresh optimistically so the UI updates without a
              // page reload; the next serverFn call reconciles.
              await loadSubscription(args.userId, { force: true });
              emitSubscriptionChange();
            } catch (err) {
              console.error("post-checkout refresh failed", err);
            } finally {
              void resp; // unused but kept for type narrowing
              setBusy(null);
            }
          },
          modal: {
            ondismiss: () => {
              setBusy(null);
            },
            backdropclose: true,
          },
          prefill: args.customerEmail ? { email: args.customerEmail } : undefined,
        });
        instance.open();
        instance.on("payment.failed", (resp: unknown) => {
          console.error("[razorpay] payment failed", resp);
          setError(
            "Payment failed before reaching us. Please try again or use a different method.",
          );
          setBusy(null);
        });
      } catch (err) {
        // Centralised translator — handles typed errors AND scans raw
        // upstream messages for stack-trace / API-key substrings before
        // displaying. Never echoes the raw error.message unless the
        // message is on the translator's allowlist.
        setError(translateRazorpayError(err));
        setBusy(null);
      } finally {
        inFlightRef.current = false;
      }
    },
    [],
  );

  const cancel = useCallback(async (userId: string) => {
    setError(null);
    try {
      await cancelRazorpaySubscription({ data: { userId } });
      await loadSubscription(userId, { force: true });
      emitSubscriptionChange();
    } catch (err) {
      // translateRazorpayError also handles cancellation-side errors —
      // it scans for the same dangerous substrings so a misconfigured
      // webhook secret in `cancelRazorpaySubscription` doesn't leak
      // through to the toast.
      setError(translateRazorpayError(err));
    }
  }, []);

  // If the user navigates away mid-checkout, clear the busy state so the
  // rest of the dashboard isn't stuck in "Starting…".
  useEffect(() => {
    return () => {
      inFlightRef.current = false;
    };
  }, []);

  return { checkout, cancel, busy, error };
}

/**
 * Small presentational loader used by <PlanCard> while a checkout is being
 * created. Lives in its own component so the card row stays readable.
 */
export function CheckoutSpinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <LoaderCircle className="size-3.5 animate-spin" />
      {label}
    </span>
  );
}
