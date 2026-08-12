import { createFileRoute, redirect } from "@tanstack/react-router";

// Friendly URL for the workspace. The actual rendering happens at
// `/dashboard?view=documents` — the dashboard reads `view` from the URL
// search string and chooses the active mobile tab. Keeping a stable
// `/dashboard/documents` path lets onboarding, trial CTAs, and any
// future "share link" use this URL without depending on raw query
// strings.
export const Route = createFileRoute("/dashboard/documents")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard", search: { view: "documents" } });
  },
});
