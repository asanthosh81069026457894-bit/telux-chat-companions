// Pre-trial onboarding modal.
//
// Three-question gate that runs before the trial starts. The user has to
// answer all three to leave the dashboard's first render; the answers are
// persisted to `public.onboarding_responses` and the trial timer starts
// inside the same submitOnboarding round-trip (so the clock doesn't begin
// until the form is in the DB).
//
// Why a modal instead of inline form:
//   - The user explicitly asked for the trial to be gated on these questions —
//     a dismissable card wouldn't enforce that. The previous product
//     decision (see AuthGate's pre-removal comment) had been to drop the
//     questions entirely, but this design wants them back, so the modal
//     is unavoidable.
//   - The card is a single question per step (3 steps total). That keeps
//     the visible payload small and matches the "one decision per screen"
//     pattern from the payment modal.
//
// Step 3 ("how did you hear") offers a select with a fixed list plus an
// "Other" escape that reveals a free-text field. The fixed list powers
// analytics; everything is stored verbatim so the free-text path doesn't
// lose data when "Other" is selected.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { TRIAL_DAYS } from "@/lib/usage";
import { submitOnboarding } from "@/serverFns/onboarding";
import { emitSubscriptionChange, loadSubscription } from "@/lib/subscription";

const HEAR_OPTIONS = [
  "Google",
  "YouTube",
  "Twitter / X",
  "Friend or colleague",
  "Reddit",
  "Podcast",
  "Blog or article",
  "Other",
] as const;

type HearAbout = (typeof HEAR_OPTIONS)[number] | "Other";

type Errors = {
  fullName?: string;
  age?: string;
  hearAbout?: string;
  // Server-side errors (rate-limit, backend offline, etc.)
  submit?: string;
};

export function OnboardingModal() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  // Pre-fill full name from Supabase user_metadata when present (typical for
  // the password signup flow). Google OAuth often leaves it blank — the
  // user can still type it in.
  const initialName = (session?.user?.user_metadata?.full_name as string | undefined)?.trim() ?? "";

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [fullName, setFullName] = useState(initialName);
  const [age, setAge] = useState<string>(""); // string so the field can be empty
  const [hearAbout, setHearAbout] = useState<HearAbout | "">("");
  const [hearAboutOther, setHearAboutOther] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  // Auto-focus the active step's input on step change.
  const nameRef = useRef<HTMLInputElement>(null);
  const ageRef = useRef<HTMLInputElement>(null);
  const hearRef = useRef<HTMLSelectElement>(null);
  const hearOtherRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (step === 0) nameRef.current?.focus();
    if (step === 1) ageRef.current?.focus();
    if (step === 2) hearRef.current?.focus();
  }, [step]);

  // Reset the prefilled name whenever the session logs in (e.g. on the
  // very first paint after sign-up). This guards against AuthGate rendering
  // the modal before the user_metadata has been merged in.
  useEffect(() => {
    if (initialName && !fullName) setFullName(initialName);
    // intentionally only when initialName changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialName]);

  function validateStep(target: 0 | 1 | 2): Errors {
    const next: Errors = {};
    if (target === 0) {
      if (!fullName.trim()) next.fullName = "Please enter your name.";
      else if (fullName.trim().length > 120) next.fullName = "Name is too long.";
    }
    if (target === 1) {
      const n = Number(age);
      if (!Number.isFinite(n) || !Number.isInteger(n)) next.age = "Age must be a whole number.";
      else if (n < 13) next.age = "You must be at least 13 to use Telux.";
      else if (n > 120) next.age = "Please enter a realistic age.";
    }
    if (target === 2) {
      if (!hearAbout) next.hearAbout = "Pick one of the options above.";
      else if (hearAbout === "Other" && !hearAboutOther.trim())
        next.hearAbout = "Tell us a little more.";
      else if (hearAbout === "Other" && hearAboutOther.trim().length > 200)
        next.hearAbout = "Please keep it under 200 characters.";
    }
    return next;
  }

  function goNext() {
    const stepErrors = validateStep(step);
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors);
      return;
    }
    setErrors({});
    setStep((s) => (s < 2 ? ((s + 1) as 0 | 1 | 2) : s));
  }

  function goBack() {
    setErrors({});
    setStep((s) => (s > 0 ? ((s - 1) as 0 | 1 | 2) : s));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userId) {
      setErrors({ submit: "Session expired — please sign in again." });
      return;
    }
    const finalHearAbout = hearAbout === "Other" ? hearAboutOther.trim() : (hearAbout as string);
    // Re-validate everything before the round-trip so we don't discover
    // a mistake on the way back from the server.
    const allErrors: Errors = {
      ...validateStep(0),
      ...validateStep(1),
      ...validateStep(2),
    };
    if (Object.keys(allErrors).length > 0) {
      setErrors(allErrors);
      return;
    }

    setSubmitting(true);
    setErrors({});
    try {
      const result = await submitOnboarding({
        data: {
          userId,
          fullName: fullName.trim(),
          age: Number(age),
          hearAbout: finalHearAbout,
        },
      });
      // Refresh the in-memory subscription snapshot so the trial banner
      // appears immediately. The trial was started inside the same handler.
      await loadSubscription(userId, { force: true });
      emitSubscriptionChange();
      // Don't reset submitting — the modal is unmounted by AuthGate (which
      // sees the new onboarding row on its next status check) and the
      // dashboard renders on the next event loop tick.
      void result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't save your answers.";
      setErrors({ submit: msg });
      setSubmitting(false);
    }
  }

  // Auto-advance on Enter inside the name and age fields, but not inside
  // the select / free-text (where the user might still be typing).
  function onKeyDownStep(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      goNext();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <header className="mb-5">
          <span className="eyebrow">Quick intro</span>
          <h2 id="onboarding-title" className="mt-2 text-2xl font-semibold">
            {step === 0
              ? "What should we call you?"
              : step === 1
                ? "How old are you?"
                : "How did you hear about us?"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Three quick questions — your {TRIAL_DAYS}-day Pro trial starts as soon as you finish.
          </p>
        </header>

        <form onSubmit={onSubmit} noValidate>
          {/* Step 1 — name */}
          <div hidden={step !== 0}>
            <label className="block">
              <span className="text-sm font-medium">Full name</span>
              <input
                ref={nameRef}
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.currentTarget.value)}
                onKeyDown={onKeyDownStep}
                placeholder="Your name"
                autoComplete="name"
                maxLength={120}
                aria-invalid={Boolean(errors.fullName)}
                className="mt-2 w-full rounded-xl border border-input bg-surface-2/60 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-signal focus:ring-2 focus:ring-signal/30 focus:outline-none"
              />
            </label>
            {errors.fullName ? (
              <p className="mt-2 text-xs text-red-400" role="alert">
                {errors.fullName}
              </p>
            ) : null}
          </div>

          {/* Step 2 — age */}
          <div hidden={step !== 1}>
            <label className="block">
              <span className="text-sm font-medium">Age</span>
              <input
                ref={ageRef}
                type="number"
                inputMode="numeric"
                min={13}
                max={120}
                value={age}
                onChange={(e) => setAge(e.currentTarget.value)}
                onKeyDown={onKeyDownStep}
                placeholder="e.g. 28"
                aria-invalid={Boolean(errors.age)}
                className="mt-2 w-full rounded-xl border border-input bg-surface-2/60 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-signal focus:ring-2 focus:ring-signal/30 focus:outline-none"
              />
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              You must be at least 13 to use Telux.
            </p>
            {errors.age ? (
              <p className="mt-2 text-xs text-red-400" role="alert">
                {errors.age}
              </p>
            ) : null}
          </div>

          {/* Step 3 — how did you hear */}
          <div hidden={step !== 2}>
            <label className="block">
              <span className="text-sm font-medium">How did you hear about us?</span>
              <select
                ref={hearRef}
                value={hearAbout}
                onChange={(e) => setHearAbout(e.currentTarget.value as HearAbout | "")}
                aria-invalid={Boolean(errors.hearAbout)}
                className="mt-2 w-full rounded-xl border border-input bg-surface-2/60 px-4 py-3 text-sm text-foreground focus:border-signal focus:ring-2 focus:ring-signal/30 focus:outline-none"
              >
                <option value="" disabled>
                  Choose one…
                </option>
                {HEAR_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
            {hearAbout === "Other" ? (
              <input
                ref={hearOtherRef}
                type="text"
                value={hearAboutOther}
                onChange={(e) => setHearAboutOther(e.currentTarget.value)}
                placeholder="e.g. Product Hunt, a tweet, someone mentioned it…"
                maxLength={200}
                className="mt-3 w-full rounded-xl border border-input bg-surface-2/60 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-signal focus:ring-2 focus:ring-signal/30 focus:outline-none"
              />
            ) : null}
            {errors.hearAbout ? (
              <p className="mt-2 text-xs text-red-400" role="alert">
                {errors.hearAbout}
              </p>
            ) : null}
          </div>

          {errors.submit ? (
            <p className="mt-4 text-xs text-red-400" role="alert">
              {errors.submit}
            </p>
          ) : null}

          {/* Step indicator + nav buttons */}
          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of 3`}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={
                    "h-1.5 w-6 rounded-full transition-colors " +
                    (i <= step ? "bg-signal" : "bg-border")
                  }
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              {step > 0 ? (
                <button
                  type="button"
                  onClick={goBack}
                  disabled={submitting}
                  className="rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2 disabled:opacity-60"
                >
                  Back
                </button>
              ) : null}
              {step < 2 ? (
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-signal px-5 py-2 text-sm font-semibold text-signal-foreground transition-transform hover:scale-[1.01]"
                >
                  Next
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={submitting || !userId}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-signal px-5 py-2 text-sm font-semibold text-signal-foreground transition-transform hover:scale-[1.01] disabled:opacity-70"
                >
                  {submitting ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {submitting ? "Starting your trial…" : "Start trial"}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
