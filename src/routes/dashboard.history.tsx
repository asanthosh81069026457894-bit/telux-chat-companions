import { createFileRoute, redirect } from "@tanstack/react-router";

// History is now a standalone top-level page at /history. This shell exists
// only to forward any stale /dashboard/history links to the new URL so nothing
// 404s. Safe to delete once all callers are updated.
export const Route = createFileRoute("/dashboard/history")({
  beforeLoad: () => {
    throw redirect({ to: "/history" });
  },
});
