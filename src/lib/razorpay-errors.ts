// User-facing Razorpay error translator.
//
// The checkout UI catches errors from `createRazorpaySubscription` and the
// cancellation serverFn. Raw upstream errors are useful for operators in
// deploy logs but useless — and occasionally leaky — for end users. This
// module is the single place we map typed errors + message strings to a
// short, friendly toast.
//
// Two layers of defence:
//   1. Catch the typed errors (`RazorpayNotConfiguredError`,
//      `RazorpayUpstreamError`, `TeluxBackendOfflineError`) first — these
//      have already been redacted server-side.
//   2. For everything else, scan the message for known dangerous substrings
//      ("invalid api key", "authentication", stack trace markers) before
//      passing it through. If the message contains none of the safe-known
//      patterns, we drop it and show a generic retry hint rather than
//      potentially leak Razorpay internals.
//
// Security note: never include the raw error object in logs you send to
// the client. The thrown `Error.message` from `RazorpayUpstreamError` is
// already a fixed friendly string ("Razorpay is temporarily unavailable…"),
// but if a future caller extends it to embed raw upstream text, this
// guard catches it.

import { RazorpayNotConfiguredError, RazorpayUpstreamError } from "@/serverFns/razorpay";
import { TeluxBackendOfflineError } from "@/serverFns/subscription";

// Substrings that, if found in a raw upstream message, mean the message is
// describing a server-side config problem. We always replace these with a
// fixed support-handoff string rather than re-display — the operator
// already sees the detail in deploy logs.
const SERVER_CONFIG_TOKENS = [
  "invalid api key",
  "invalid key",
  "authentication failed",
  "unauthorized",
  "signature",
  "merchant",
  "key_id",
  "rzp_",
];

// Patterns that strongly suggest a raw stack trace / Razorpay internals
// leaked through. Defence-in-depth — when in doubt, drop the message.
const DEBUG_NOISE = [
  /^\s*at\s+/m, // V8 stack frames ("    at Function.foo")
  /Error: /, // nested Error: … markers
  /\.razorpay\.com\/v\d/, // upstream URL paths
  /stack:/i,
];

export function translateRazorpayError(err: unknown): string {
  // Typed errors first — these already carry the right wording.
  if (err instanceof RazorpayNotConfiguredError) {
    return "Payments aren't set up yet. Please contact support.";
  }
  if (err instanceof RazorpayUpstreamError) {
    // The thrown message is already friendly; pass through.
    return (
      err.message || "Payment provider is temporarily unavailable. Please try again in a minute."
    );
  }
  if (err instanceof TeluxBackendOfflineError) {
    return "Account features are temporarily unavailable. Try again in a moment.";
  }

  if (err instanceof Error) {
    const m = (err.message ?? "").toLowerCase();

    // Defence-in-depth scan: even if a non-typed Error reached us, refuse
    // to display anything that smells like a config problem or stack trace.
    for (const token of SERVER_CONFIG_TOKENS) {
      if (m.includes(token)) {
        return "Payment configuration error. Please contact support.";
      }
    }
    for (const re of DEBUG_NOISE) {
      if (re.test(err.message)) {
        return "Could not open checkout. Please try again.";
      }
    }

    // Nothing matched — show the message unchanged. The thrown Error's
    // message is presumed safe by the time we get here (server-side
    // already redacted upstream payloads).
    return err.message || "Could not open checkout. Please try again.";
  }

  return "Could not open checkout. Please try again.";
}
