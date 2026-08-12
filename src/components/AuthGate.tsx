// AuthGate — single wrapper applied to every protected route.
//
// Performance contract: the dashboard mounts in the same render as the
// auth state resolution. We do NOT block on subscription serverFn
// responses — those are fetched in the background and update the UI
// incrementally. The only thing we block on is the Supabase session:
// until we know who's signed in, we don't render protected children.
//
// What gates what:
//   - Supabase session → renders the dashboard at all (otherwise bounces
//     to /login after a brief grace window).
//   - Onboarding row → renders the OnboardingModal *over* the dashboard
//     when missing. The trial is now exclusively started by the modal
//     submitting submitOnboarding(), so the previous auto-trial effect is
//     gone — a fresh user lands on a generic dashboard with the modal
//     blocking it, and the trial starts when they complete the form.

import { useEffect, useState, type ReactNode } from "react";

import { TeluxBackendOfflineError } from "@/serverFns/subscription";
import { useNavigate } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { loadSubscription, resetSubscriptionCache } from "@/lib/subscription";
import { getOnboardingStatus } from "@/serverFns/onboarding";
import { OnboardingModal } from "@/components/OnboardingModal";

export function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  // `bootWarning` is a non-fatal hint — the serverFn chain failed for a
  // reason that doesn't block the dashboard (e.g. server-side Supabase is
  // not configured). We surface it as a small banner rather than an error
  // wall so the user can still use the app while the operator investigates.
  const [bootWarning, setBootWarning] = useState<string | null>(null);
  // `undefined` = "still loading", `false` = "no onboarding row → show modal",
  // `true` = "row exists → render dashboard". Mirrors the subscription
  // cache's loading convention so a slow backend doesn't unmount the
  // dashboard on every navigation.
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | undefined>(undefined);

  // Boot sequence — kick off the subscription fetch + onboarding check in
  // the background as soon as we know who the user is. We do NOT await
  // either before mounting the children; the dashboard renders immediately
  // and re-renders when the responses land.
  useEffect(() => {
    if (loading || !session?.user?.id) return;
    const userId = session.user.id;

    // Reset caches so a sign-in from a different account on the same browser
    // doesn't leak state from the previous user.
    resetSubscriptionCache();
    setBootWarning(null);
    setOnboardingCompleted(undefined);

    void loadSubscription(userId, { force: true }).catch((err: unknown) => {
      console.error("[AuthGate] subscription load failed:", err);
      // Non-fatal: dashboard still mounts on Starter defaults.
      if (err instanceof TeluxBackendOfflineError) {
        setBootWarning(
          "Live billing data is temporarily unavailable. Some paid features may be locked until the backend reconnects.",
        );
      }
    });

    // Onboarding status drives whether the modal blocks the dashboard.
    // We deliberately fetch this in parallel with the subscription load — it
    // usually returns in <50 ms and we don't want to delay first paint.
    // Backend offline → treat as "not completed" (the modal will surface a
    // clear error when the user tries to submit).
    void getOnboardingStatus({ data: { userId } })
      .then((res) => {
        setOnboardingCompleted(res.completed);
      })
      .catch((err: unknown) => {
        console.warn("[AuthGate] onboarding status check failed:", err);
        // Default to "modal stays open" so the user *can't* skip the form
        // on a transient backend blip. The submit will surface a clearer
        // error if the backend is genuinely offline.
        setOnboardingCompleted(false);
      });
  }, [loading, session?.user?.id]);

  // Re-check onboarding status whenever the subscription changes. The
  // OnboardingModal dispatches this event after a successful submitOnboarding
  // (alongside the subscription refresh), so this listener is the bridge
  // from "submit succeeded" → "parent unmounts the modal". We also fire it
  // after the user upgrades from a paid plan, but that path is a no-op
  // (the row already exists).
  useEffect(() => {
    if (loading || !session?.user?.id) return;
    function onChange() {
      const userId = session?.user?.id;
      if (!userId) return;
      void getOnboardingStatus({ data: { userId } })
        .then((res) => setOnboardingCompleted(res.completed))
        .catch(() => {
          // Keep the existing state on a transient failure.
        });
    }
    window.addEventListener("telux:subscription-changed", onChange);
    return () => window.removeEventListener("telux:subscription-changed", onChange);
  }, [loading, session?.user?.id]);

  // Auth guard. Only navigates once we know there's no session.
  //
  // Hydration-race fix: when a user just signed up or invited from /auth/callback,
  // the session arrives asynchronously via `supabase.auth.onAuthStateChange`. The
  // very first render of <AuthGate> on /dashboard sees `session === null` and
  // would otherwise bounce to /login. We wait a brief grace window (800 ms) before
  // redirecting so freshly-set sessions have time to land. If the user is genuinely
  // signed out (a real page load on a protected route), they still get redirected
  // quickly — the 800 ms is below the "% feels broken" bar.
  useEffect(() => {
    if (loading) return;
    if (session) return;
    const t = window.setTimeout(() => {
      void navigate({ to: "/login" });
    }, 800);
    return () => window.clearTimeout(t);
  }, [loading, session, navigate]);

  // The ONLY thing we wait on is the Supabase session. Subscription fetches
  // in the background — the dashboard mounts the moment we know who's
  // signed in, and overlays update lazily.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-signal">
            <LoaderCircle className="size-4 animate-spin text-signal-foreground" />
          </span>
          <p className="text-xs tracking-widest text-muted-foreground uppercase">Loading…</p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  // The modal blocks the dashboard until onboarding completes. The
  // `undefined` state (initial mount before the status fetch lands) is
  // intentionally not blocking — we let the dashboard render for a tick
  // and the modal pops in once the response arrives. The downside is a
  // half-second flash of the dashboard on slow connections; the upside is
  // not unmounting the dashboard on every navigation.
  const showOnboarding = onboardingCompleted === false;

  return (
    <>
      {bootWarning ? (
        <div role="status" className="border-b border-amber-400/30 bg-amber-400/10">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-2 text-xs text-amber-200 sm:px-6">
            <span>{bootWarning}</span>
            <button
              type="button"
              onClick={() => setBootWarning(null)}
              aria-label="Dismiss"
              className="rounded-md px-2 py-1 font-medium text-amber-200/70 transition-colors hover:bg-amber-400/15 hover:text-amber-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      {children}
      {showOnboarding ? <OnboardingModal key={session.user.id} /> : null}
    </>
  );
}
