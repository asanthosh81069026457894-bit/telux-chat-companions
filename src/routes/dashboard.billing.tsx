import { createFileRoute, redirect } from "@tanstack/react-router";

// Billing is now a standalone top-level page at /billing. This shell exists
// only to forward any stale /dashboard/billing links (top-tab nav, old docs)
// to the new URL so nothing 404s. Safe to delete once all callers are updated.
export const Route = createFileRoute("/dashboard/billing")({
  beforeLoad: () => {
    throw redirect({ to: "/billing" });
  },
});
