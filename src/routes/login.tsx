import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { AuthLayout, Field } from "@/components/AuthLayout";
import { useAuth } from "@/hooks/useAuth";
import {
  GoogleMark,
  PasswordField,
  SubmitButton,
  SubmitPhase,
  readLastEmail,
  rememberEmail,
  translateAuthError,
  useFocusFirstEmpty,
} from "@/lib/auth-helpers";
import { LogIn, Mail } from "lucide-react";

const title = "Log in to Telux";
const description = "Sign in to Telux and keep chatting with the documents stored on your device.";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { signInWithPassword, signInWithGoogle, configured, session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SubmitPhase>("idle");

  // Focus the first empty field. If we remembered an email from last time,
  // the cursor lands in the password field on mount — small thing, big UX.
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  useFocusFirstEmpty([emailRef, passwordRef]);

  // Prefill the email field from the last-used email.
  useEffect(() => {
    const last = readLastEmail();
    if (last && !email) setEmail(last);
    // intentionally run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the user is already signed in, bounce them straight to the dashboard
  // instead of showing the form. Skipped during the initial auth hydration
  // tick so a freshly-clicked "log in" link doesn't briefly redirect to
  // /dashboard before the form has a chance to render.
  useEffect(() => {
    if (loading || !session) return;
    void navigate({ to: "/dashboard" });
  }, [loading, session, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPhase("submitting");
    const { error: err } = await signInWithPassword(email, password);
    if (err) {
      console.error("login failed", err);
      setError(translateAuthError(err));
      setPhase("idle");
      return;
    }
    // Persist for next time.
    rememberEmail(email);
    // `await` instead of `void` so the navigation is scheduled after React
    // commits the new session into context. The dashboard's AuthGate then
    // sees the session on its first render and skips the bounce-to-login.
    await navigate({ to: "/dashboard" });
  }

  async function onGoogle() {
    setError(null);
    setPhase("submitting");
    const { error: err } = await signInWithGoogle();
    if (err) {
      console.error("google login failed", err);
      setError(translateAuthError(err));
      setPhase("idle");
    }
    // For OAuth we don't reset phase — the page is redirecting away.
  }

  return (
    <AuthLayout
      eyebrow="Welcome back"
      title="Log in to Telux"
      subtitle="Your documents are waiting on this device."
      footer={
        <>
          New here?{" "}
          <Link to="/signup" className="font-medium text-signal hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <div ref={emailRef as unknown as React.RefObject<HTMLDivElement>}>
          <Field
            label="Email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            required
            id="login-email"
          />
        </div>
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          id="login-password"
        />
        {error ? (
          <div className="space-y-1" role="alert">
            <p className="text-sm text-red-400">{error}</p>
            <p className="text-xs text-muted-foreground">
              Forgot your password?{" "}
              <Link to="/signup" className="text-signal hover:underline">
                Create a new account
              </Link>
            </p>
          </div>
        ) : null}
        <SubmitButton phase={phase} idleLabel="Log in" icon={LogIn} disabled={!configured} />
        <div className="flex items-center gap-3 text-xs tracking-widest text-muted-foreground uppercase">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>
        <button
          type="button"
          onClick={onGoogle}
          disabled={!configured || phase !== "idle"}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-input bg-surface-2/60 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <GoogleMark />
          Continue with Google
        </button>
        <p className="flex items-center justify-center gap-1.5 text-center font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          <Mail className="size-3" />
          Account is only used for sign-in
        </p>
      </form>
    </AuthLayout>
  );
}
