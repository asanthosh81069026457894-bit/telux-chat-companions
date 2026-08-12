// Razorpay webhook receiver.
//
// This is a plain HTTP endpoint, NOT a serverFn. Razorpay signs the exact
// raw body of the request, so we must read it verbatim — going through
// TanStack's serverFn JSON-validator would mangle the bytes and break the
// HMAC check.
//
// POST /api/razorpay/webhook
//   - Headers: X-Razorpay-Signature: <hex hmac-sha256(body, webhook_secret)>
//   - Body:    JSON in Razorpay's webhook event schema.
//
// Responses:
//   200 → accepted (including for events we ignore)
//   400 → bad payload / missing signature / missing notes
//   405 → non-POST request (defence-in-depth: GET shouldn't reach here)
//   500 → server misconfig (env missing)
//
// We DO NOT echo the failure reason back to Razorpay — that would let an
// attacker probe for env state. Razorpay only cares that valid signatures
// return 200; everything else is retried.
//
// CSRF: NOT enforced on this route. Razorpay's servers cannot supply the
// CSRF token our middleware expects for serverFn calls, but the signature
// check is the authority here — without `RAZORPAY_WEBHOOK_SECRET` the
// request is rejected wholesale. The route is intentionally created as
// a plain HTTP handler (not a serverFn) so it bypasses the CSRF filter.

import { createFileRoute } from "@tanstack/react-router";

import { handleRazorpayWebhook } from "@/serverFns/razorpay";

export const Route = createFileRoute("/api/razorpay/webhook")({
  // No `component` — this route is server-only.
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const signature = request.headers.get("x-razorpay-signature");
        const outcome = await handleRazorpayWebhook(raw, signature);
        if (!outcome.ok) {
          // Log the reason server-side so the operator can debug; return a
          // bare 400 to Razorpay. Never echo the reason over the wire —
          // that would let an attacker probe for env state.
          console.warn(`[razorpay-webhook] rejected: ${outcome.reason}`);
          return new Response("bad signature or payload", { status: 400 });
        }
        // Successful acknowledgement. Echo the event name so the operator
        // can grep deploy logs ("did the activation webhook fire?") without
        // having to unlock Razorpay's dashboard.
        console.info(`[razorpay-webhook] ok: event=${outcome.event} user=${outcome.userId ?? "—"}`);
        return new Response(JSON.stringify({ received: true, event: outcome.event }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      // Defence-in-depth: any non-POST to a webhook URL is almost certainly
      // a probe. TanStack's file router only matches POST when handlers
      // declares POST, but explicitly rejecting here keeps the contract
      // visible in the route file.
      GET: () => new Response("method not allowed", { status: 405 }),
    },
  },
});
