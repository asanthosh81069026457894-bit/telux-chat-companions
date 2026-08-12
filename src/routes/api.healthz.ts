// Health check endpoint at /api/healthz.
//
// Used by:
//   - Vercel uptime checks (cheap, no auth, no DB call)
//   - operators running `curl https://<domain>/api/healthz` to confirm
//     the deploy is up and env vars are wired correctly
//
// Returns 200 always so a misconfigured deploy is still reported as
// "serving" (the response BODY tells the operator what's wrong).
// Returning 503 on misconfig causes uptime dashboards to page someone
// for what is really a config problem, not a server outage.
//
// The body reports public env vars (which the browser-side VITE_*
// values are baked into the bundle, so are visible), and reports the
// server-side keys as "configured" / "unconfigured" only — we never
// echo the secret itself.

import { createFileRoute } from "@tanstack/react-router";

import { validateEnv } from "@/lib/env";

export const Route = createFileRoute("/api/healthz")({
  server: {
    handlers: {
      GET: async () => {
        const env = validateEnv();
        return Response.json({
          ok: true,
          service: "telux-chat-companion",
          env: {
            public: {
              VITE_SUPABASE_URL: env.public.VITE_SUPABASE_URL ? "set" : "missing",
              VITE_SUPABASE_ANON_KEY: env.public.VITE_SUPABASE_ANON_KEY ? "set" : "missing",
            },
            server: {
              SUPABASE_SERVICE_ROLE_KEY: env.server.SUPABASE_SERVICE_ROLE_KEY ? "set" : "missing",
              GROQ_API_KEY: env.server.GROQ_API_KEY ? "set" : "missing",
            },
            razorpay: {
              RAZORPAY_KEY_ID: env.razorpay.RAZORPAY_KEY_ID ? "set" : "missing",
              RAZORPAY_WEBHOOK_SECRET: env.razorpay.RAZORPAY_WEBHOOK_SECRET ? "set" : "missing",
            },
          },
          missing: env.missing,
        });
      },
    },
  },
});
