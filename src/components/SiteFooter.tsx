import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-signal">
            <span className="size-3 rounded-[3px] bg-signal-foreground" />
          </span>
          <div>
            <p className="font-display text-base font-bold">telux</p>
            <p className="text-xs text-muted-foreground">Your documents never leave your device.</p>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <a href="/#how" className="hover:text-foreground">
            How it works
          </a>
          <Link to="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <a href="/#pricing" className="hover:text-foreground">
            Pricing
          </a>
          <Link to="/login" className="hover:text-foreground">
            Log in
          </Link>
          <Link to="/signup" className="hover:text-foreground">
            Sign up
          </Link>
        </nav>
      </div>
      <div className="border-t border-border">
        <p className="mx-auto max-w-6xl px-5 py-5 font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
          © {new Date().getFullYear()} Telux — zero-storage document intelligence
        </p>
      </div>
    </footer>
  );
}
