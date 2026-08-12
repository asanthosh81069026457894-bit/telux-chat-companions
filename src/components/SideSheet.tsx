import { Link } from "@tanstack/react-router";

// Slim brand header used at the top of the workspace when the user wants a
// prominent logo lockup. The hamburger / side-sheet menu is gone — the top
// sub-nav (DashboardSubNav) carries navigation and sign-out instead.
export function DashboardTopBar() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 pt-8 sm:px-6">
      <Link to="/" className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg bg-signal">
          <span className="size-2.5 rounded-[3px] bg-signal-foreground" />
        </span>
        <span className="font-display text-base font-bold">telux</span>
      </Link>
    </header>
  );
}
