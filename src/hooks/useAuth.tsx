import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase, SUPABASE_CONFIGURED } from "@/lib/supabase";
import { loginWithRateLimit, signupWithRateLimit } from "@/serverFns/auth";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  configured: boolean;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithPassword: (
    email: string,
    password: string,
    fullName?: string,
  ) => Promise<{ error: string | null; needsEmailConfirmation: boolean }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) {
      setLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      configured: SUPABASE_CONFIGURED,
      async signInWithPassword(email, password) {
        if (!SUPABASE_CONFIGURED) {
          return {
            error:
              "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.",
          };
        }
        try {
          // Route through the serverFn so the per-IP / per-email rate
          // limit applies BEFORE the Supabase call. The returned tokens
          // are applied to the browser anon client via setSession, so
          // subsequent calls behave exactly as if the user had typed
          // their password into the Supabase client directly.
          const result = await loginWithRateLimit({
            data: { email, password },
          });
          const { error: setErr } = await supabase.auth.setSession({
            access_token: result.accessToken,
            refresh_token: result.refreshToken,
          });
          if (setErr) {
            return { error: "Signed in but the session could not be applied. Please refresh." };
          }
          return { error: null };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Sign-in failed." };
        }
      },
      async signUpWithPassword(email, password, fullName) {
        if (!SUPABASE_CONFIGURED) {
          return { error: "Supabase is not configured.", needsEmailConfirmation: false };
        }
        const origin = import.meta.env.VITE_AUTH_REDIRECT_ORIGIN ?? window.location.origin;
        // Trim full_name so empty/whitespace doesn't get persisted into user_metadata.
        const trimmedName = fullName?.trim() ? fullName.trim() : undefined;
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${origin.replace(/\/$/, "")}/auth/callback`,
            // The DB trigger handle_new_user() reads raw_user_meta_data->>'full_name'
            // to populate public.profiles. Without this, the full_name column is empty.
            data: trimmedName ? { full_name: trimmedName } : undefined,
          },
        });
        if (error) return { error: error.message, needsEmailConfirmation: false };
        // If Supabase returned a session, the user is already signed in
        // (this happens when "Confirm email" is disabled in the dashboard).
        // If it returned a user with no session AND no confirmed email, the
        // user genuinely has to click the confirmation link before logging in.
        const user = data.user;
        const hasSession = Boolean(data.session);
        const unconfirmed = !hasSession && user != null && user.email_confirmed_at == null;
        return { error: null, needsEmailConfirmation: unconfirmed };
      },
      async signInWithGoogle() {
        if (!SUPABASE_CONFIGURED) {
          return { error: "Supabase is not configured." };
        }
        // IMPORTANT: this redirect URL MUST be registered in two places, exactly:
        //   1. Supabase Dashboard → Authentication → URL Configuration → Redirect URLs
        //   2. Google Cloud Console → APIs & Services → Credentials → OAuth client
        //      "Authorized redirect URIs": https://<ref>.supabase.co/auth/v1/callback
        // Override the origin via VITE_AUTH_REDIRECT_ORIGIN if needed (e.g. production
        // behind a reverse proxy), otherwise it falls back to the current page origin.
        const origin = import.meta.env.VITE_AUTH_REDIRECT_ORIGIN ?? window.location.origin;
        const redirectTo = `${origin.replace(/\/$/, "")}/auth/callback`;
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo,
            queryParams: { prompt: "select_account" },
          },
        });
        return { error: error?.message ?? null };
      },
      async signOut() {
        if (!SUPABASE_CONFIGURED) return;
        await supabase.auth.signOut();
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
