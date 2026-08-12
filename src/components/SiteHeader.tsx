import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const links = [
  { label: "How it works", href: "/#how" },
  { label: "Use cases", href: "/#usecases" },
  { label: "Pricing", href: "/#pricing" },
];

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-500",
        scrolled ? "backdrop-blur-xl" : "",
      )}
    >
      <div
        className={cn(
          "mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 transition-all duration-500",
          scrolled
            ? "my-3 rounded-2xl border border-border bg-surface/80 py-2.5 shadow-[var(--shadow-lift)]"
            : "my-4 border border-transparent py-3",
        )}
      >
        <Link to="/" className="flex items-center gap-2.5">
          <span className="relative grid size-8 place-items-center rounded-lg bg-signal">
            <span className="size-3 rounded-[3px] bg-signal-foreground" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight">telux</span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
          <Link
            to="/privacy"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Privacy
          </Link>
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            to="/login"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Log in
          </Link>
          <Link
            to="/signup"
            className="rounded-full bg-signal px-4 py-2 text-sm font-semibold text-signal-foreground transition-transform hover:scale-[1.03]"
          >
            Start free
          </Link>
        </div>

        <button
          type="button"
          aria-label="Toggle menu"
          onClick={() => setOpen((v) => !v)}
          className="grid size-9 place-items-center rounded-lg border border-border md:hidden"
        >
          <span className="flex flex-col gap-1">
            <span className="block h-px w-4 bg-foreground" />
            <span className="block h-px w-4 bg-foreground" />
          </span>
        </button>
      </div>

      {open ? (
        <div className="mx-auto max-w-6xl px-5 md:hidden">
          <div className="surface-card flex flex-col gap-1 p-3">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              >
                {l.label}
              </a>
            ))}
            <Link
              to="/privacy"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            >
              Privacy
            </Link>
            <Link to="/login" className="rounded-lg px-3 py-2 text-sm text-muted-foreground">
              Log in
            </Link>
            <Link
              to="/signup"
              className="rounded-lg bg-signal px-3 py-2 text-center text-sm font-semibold text-signal-foreground"
            >
              Start free
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
