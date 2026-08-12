import { createFileRoute } from "@tanstack/react-router";

import { DashboardSubNav } from "@/components/dashboard-nav";
import { DashboardHistorySection } from "@/components/dashboard-history-section";
import { AuthGate } from "@/components/AuthGate";

// Standalone History page. Lifted out of the dashboard so the workspace stays
// focused on documents + chat. The same top sub-nav (Documents / Chat / Billing
// / History / Sign out) is rendered so the user can hop back to the workspace
// in one click.

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [{ title: "History — Telux" }, { name: "robots", content: "noindex" }],
  }),
  component: () => (
    <AuthGate>
      <HistoryPage />
    </AuthGate>
  ),
});

function HistoryPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <DashboardSubNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-12 pt-8 sm:px-6">
        <DashboardHistorySection />
      </main>
    </div>
  );
}
