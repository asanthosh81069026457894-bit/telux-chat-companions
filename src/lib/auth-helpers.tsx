// ============================================================================
// Auth UX helpers — keep the signup/login forms consistent.
//
// The forms look simple but each one had subtly different copy, different
// error mapping, and different loading states. This file centralises:
//   - Field components with show/hide password toggle + auto-focus
//   - Error message translation (Supabase → human)
//   - Password strength scoring
//   - "Last used email" persistence in localStorage
// ============================================================================

import { Eye, EyeOff, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

// ---- Last-used email -----------------------------------------------------

const LAST_EMAIL_KEY = "telux:last-email";

export function readLastEmail(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(LAST_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberEmail(email: string): void {
  if (typeof window === "undefined" || !email) return;
  try {
    window.localStorage.setItem(LAST_EMAIL_KEY, email);
  } catch {
    // ignore — non-fatal
  }
}

// ---- Password strength ----------------------------------------------------

type Strength = 0 | 1 | 2 | 3 | 4;
type StrengthLabel = "Too short" | "Weak" | "Okay" | "Strong" | "Excellent";
type StrengthColor =
  "bg-red-500" | "bg-orange-500" | "bg-amber-500" | "bg-emerald-500" | "bg-emerald-400";

const STRENGTH_LABEL: Record<Strength, StrengthLabel> = {
  0: "Too short",
  1: "Weak",
  2: "Okay",
  3: "Strong",
  4: "Excellent",
};

const STRENGTH_COLOR: Record<Strength, StrengthColor> = {
  0: "bg-red-500",
  1: "bg-orange-500",
  2: "bg-amber-500",
  3: "bg-emerald-500",
  4: "bg-emerald-400",
};

/**
 * Score a password 0-4. We deliberately keep this client-side only — a
 * signup form can show the meter without round-tripping to a server, and
 * Supabase's password policy is the only hard requirement.
 *
 * Heuristics (in order of weight):
 *   - Length >= 8 (minimum)
 *   - Length >= 12
 *   - Mix of upper + lower
 *   - Has a digit
 *   - Has a symbol
 */
export function scorePassword(pw: string): {
  score: Strength;
  label: StrengthLabel;
  color: StrengthColor;
} {
  if (pw.length < 8) return { score: 0, label: STRENGTH_LABEL[0], color: STRENGTH_COLOR[0] };
  let s = 1;
  if (pw.length >= 12) s += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s += 1;
  if (/\d/.test(pw)) s += 1;
  if (/[^A-Za-z0-9]/.test(pw)) s += 1;
  const score = Math.min(4, s) as Strength;
  return { score, label: STRENGTH_LABEL[score], color: STRENGTH_COLOR[score] };
}

// ---- Supabase error translation ------------------------------------------

/**
 * Map the raw Supabase auth error messages to something a human can act on.
 * Supabase intentionally returns terse, security-aware messages (e.g.
 * "Invalid login credentials") which are correct but unhelpful for the
 * user who typed the wrong email OR the wrong password.
 *
 * We never leak internal state — the translated messages are all generic
 * enough to be safe in both flows.
 */
export function translateAuthError(message: string | undefined): string {
  if (!message) return "Something went wrong. Please try again.";
  const m = message.toLowerCase();

  if (m.includes("invalid login credentials") || m.includes("invalid email or password")) {
    return "Email or password is wrong. Double-check both and try again.";
  }
  if (m.includes("user already registered") || m.includes("already been registered")) {
    return "An account with this email already exists. Try logging in instead.";
  }
  if (m.includes("email not confirmed")) {
    return "Check your inbox — we sent a confirmation link to that email.";
  }
  if (m.includes("password should be at least") || m.includes("password is too short")) {
    return "Password is too short. Use at least 8 characters.";
  }
  if (m.includes("rate limit") || m.includes("too many requests")) {
    return "Too many attempts. Wait a moment and try again.";
  }
  if (m.includes("network") || m.includes("fetch")) {
    return "Network hiccup. Check your connection and try again.";
  }
  if (m.includes("email") && m.includes("invalid")) {
    return "That email address doesn't look right.";
  }
  if (m.includes("signup") && m.includes("disabled")) {
    return "Signups are temporarily disabled. Try again in a few minutes.";
  }

  // Fall through with a generic prefix so the user knows it was an auth issue,
  // not something unrelated. The original goes to the console via the caller.
  return "Couldn't complete that. Please try again.";
}

// ---- Password input with show/hide toggle --------------------------------

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  required = true,
  showStrength = false,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  autoComplete: string;
  required?: boolean;
  /** When true (signup), renders a 5-bar strength meter under the field. */
  showStrength?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const strength = scorePassword(value);

  return (
    <div>
      <label className="block">
        <span className="text-sm font-medium">{label}</span>
        <div className="relative mt-2">
          <input
            id={id}
            type={visible ? "text" : "password"}
            placeholder="••••••••"
            autoComplete={autoComplete}
            value={value}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.currentTarget.value)}
            required={required}
            className="w-full rounded-xl border border-input bg-surface-2/60 px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:border-signal focus:ring-2 focus:ring-signal/30 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </label>
      {showStrength && value.length > 0 ? (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex flex-1 gap-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                className={
                  "h-1 flex-1 rounded-full transition-colors " +
                  (i <= strength.score ? strength.color : "bg-border")
                }
              />
            ))}
          </div>
          <span className="text-xs font-medium text-muted-foreground">{strength.label}</span>
        </div>
      ) : null}
    </div>
  );
}

// ---- Auto-focus first empty field ---------------------------------------

/**
 * On mount, focus the first empty field. Returning users (who saved their
 * email) will land in the password field, where the cursor does the most
 * good.
 */
export function useFocusFirstEmpty(fieldRefs: Array<React.RefObject<HTMLInputElement | null>>) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    for (const ref of fieldRefs) {
      const node = ref.current;
      if (node && !node.value) {
        node.focus();
        done.current = true;
        return;
      }
    }
    // All fields filled — focus the first one so Tab order starts at top.
    if (fieldRefs[0]?.current) {
      fieldRefs[0].current.focus();
      done.current = true;
    }
  }, [fieldRefs]);
}

// ---- Inline social-mark icons (kept here so signup + login share them) -

export function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
      <path
        fill="#EA4335"
        d="M12 10.2v3.94h5.51c-.24 1.32-1.66 3.86-5.51 3.86-3.32 0-6.03-2.75-6.03-6.14S8.68 5.72 12 5.72c1.89 0 3.16.81 3.89 1.5l2.65-2.56C16.95 3.18 14.68 2.2 12 2.2 6.92 2.2 2.86 6.26 2.86 11.34S6.92 20.48 12 20.48c6.93 0 9.04-4.85 9.04-7.34 0-.5-.05-.88-.12-1.26H12Z"
      />
    </svg>
  );
}

// Helper type for the action button label cycles used across forms.

export type SubmitPhase = "idle" | "submitting" | "trial" | "done";

export function SubmitButton({
  phase,
  idleLabel,
  icon: Icon,
  disabled,
}: {
  phase: SubmitPhase;
  idleLabel: string;
  icon?: LucideIcon;
  disabled?: boolean;
}) {
  const label =
    phase === "submitting"
      ? "Creating account…"
      : phase === "trial"
        ? "Starting your 3-day trial…"
        : phase === "done"
          ? "All set — opening dashboard"
          : idleLabel;

  return (
    <button
      type="submit"
      disabled={disabled || phase !== "idle"}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-signal py-3 font-semibold text-signal-foreground transition-transform hover:scale-[1.01] disabled:cursor-progress disabled:opacity-70"
    >
      {phase !== "idle" ? (
        <span className="inline-block size-4 animate-spin rounded-full border-2 border-signal-foreground/40 border-t-signal-foreground" />
      ) : Icon ? (
        <Icon className="size-4" />
      ) : null}
      <span>{label}</span>
    </button>
  );
}
