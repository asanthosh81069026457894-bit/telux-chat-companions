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
import { Mail, Sparkles } from "lucide-react";

const title = "Create your Telux account";
const description =
  "Sign up for Telux and start chatting with PDFs, reports and agreements kept only on your device.";

export const Route = createFileRoute("/signup")({
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
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const { signUpWithPassword, signInWithGoogle, configured, session, loading } = useAuth();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);
  const [phase, setPhase] = useState<SubmitPhase>("idle");

  // Auto-focus the first empty field (skips name if last email is prefilled).
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  useFocusFirstEmpty([nameRef, emailRef, passwordRef]);

  // Prefill the email field from the last-used email. Returning users
  // land on the password field instead of retyping.
  useEffect(() => {
    const last = readLastEmail();
    if (last && !email) setEmail(last);
    // intentionally run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If a freshly-signed-in user lands on /signup (e.g. via a stale link),
  // bounce them to the dashboard instead of showing the form.
  useEffect(() => {
    if (loading || !session) return;
    void navigate({ to: "/dashboard" });
  }, [loading, session, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPhase("submitting");
    const { error: err, needsEmailConfirmation: needsConfirm } = await signUpWithPassword(
      email,
      password,
      fullName,
    );
    if (err) {
      console.error("signup failed", err);
      setError(translateAuthError(err));
      setPhase("idle");
      return;
    }
    // Persist the email so next sign-in can prefill it.
    rememberEmail(email);

    if (needsConfirm) {
      setNeedsEmailConfirmation(true);
      setPhase("idle");
      return;
    }
    // Session is live. The AuthGate on /dashboard will run startTrial()
    // in the background. We hold the form in the "trial" phase so the
    // user sees what's happening during the round-trip; the navigation
    // itself is fast.
    setPhase("trial");
    // `await` (not `void`) so the navigation lands after React has flipped
    // the AuthProvider's session state. The dashboard's AuthGate then sees
    // the session on the very first render and skips the bounce-to-login.
    await navigate({ to: "/dashboard" });
    // The user has left the page — phase is irrelevant now.
  }

  async function onGoogle() {
    setError(null);
    setPhase("submitting");
    const { error: err } = await signInWithGoogle();
    if (err) {
      console.error("google signup failed", err);
      setError(translateAuthError(err));
      setPhase("idle");
    }
    // For OAuth we don't reset phase — the page is redirecting away.
  }

  if (needsEmailConfirmation) {
    return (
      <AuthLayout
        eyebrow="Almost there"
        title="Check your email"
        subtitle={`We sent a confirmation link to ${email}. Click it to finish setting up your account.`}
        footer={
          <Link to="/login" className="font-medium text-signal hover:underline">
            Back to log in
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">
          The link expires in 24 hours. If you don&apos;t see the email, check your spam folder.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow="Get started"
      title="Create your account"
      subtitle="Free plan, no card. Your files never leave this device."
      footer={
        <>
          Already with us?{" "}
          <Link to="/login" className="font-medium text-signal hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <Field
          label="Full name"
          type="text"
          placeholder="Your name"
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.currentTarget.value)}
          required
          // We focus the first empty field via useFocusFirstEmpty.
          // Passing the ref through Field requires the helper to accept
          // extra props; for now we attach via document.getElementById.
          id="signup-name"
        />
        <div ref={emailRef as unknown as React.RefObject<HTMLDivElement>}>
          <Field
            label="Email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            required
            id="signup-email"
          />
        </div>
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          showStrength
          id="signup-password"
        />
        {error ? (
          <div className="space-y-1" role="alert">
            <p className="text-sm text-red-400">{error}</p>
            <p className="text-xs text-muted-foreground">
              Need help?{" "}
              <Link to="/login" className="text-signal hover:underline">
                Log in instead
              </Link>
            </p>
          </div>
        ) : null}
        <SubmitButton
          phase={phase}
          idleLabel="Create account"
          icon={Sparkles}
          disabled={!configured}
        />
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
          We store your email — never your documents
        </p>
      </form>
    </AuthLayout>
  );
}
