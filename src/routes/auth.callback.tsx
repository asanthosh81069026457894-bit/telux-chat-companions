import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase, SUPABASE_CONFIGURED } from "@/lib/supabase";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) {
      setError(
        "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.",
      );
      return;
    }

    // detectSessionInUrl is enabled, so the client has already parsed the
    // URL fragment / query. Wait for the resulting session to appear.
    let cancelled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (session) {
        // `await` so the navigation lands after the AuthProvider flips to
        // the new session. Without `await` the AuthGate on /dashboard
        // occasionally reads `session === null` on first render and bounces
        // the user back to /login.
        void navigate({ to: "/dashboard" });
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) {
        void navigate({ to: "/dashboard" });
      }
    });

    // If the URL itself had a problem (e.g. expired OAuth code), Supabase
    // surfaces it via getSessionFromUrl which detectSessionInUrl calls.
    // Give it a generous window — many flows take a second to land — before
    // falling back to /login. We previously used 4 s which was too short
    // for users on slow connections and would drop them into /login while
    // the session was still in flight.
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setError("Sign-in didn't complete. Please try again.");
      void navigate({ to: "/login" });
    }, 8_000);

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {error ? "Sign-in failed" : "Finishing sign-in…"}
        </h1>
        {error ? <p className="mt-2 text-sm text-muted-foreground">{error}</p> : null}
      </div>
    </div>
  );
}
