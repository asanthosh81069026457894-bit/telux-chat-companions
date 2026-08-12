// Billing page content. Shows current plan, monthly usage meter, and the
// three plan cards. A monthly/yearly toggle switches the displayed price
// and the "Subscribe" button that opens the Razorpay checkout.
//
// Trial wording: "Start 3-day trial" is the public name for the same
// `startTrial` serverFn. The button calls `startTrial` and the server
// stores `trial_started_at` / `trial_ends_at` in `public.subscriptions`.
// The countdown is server-tracked so clearing localStorage or switching
// browsers does not extend the trial. AuthGate also auto-starts the trial
// on first sign-in; this button is the manual fallback (e.g. user closed
// the trial card earlier).
//
// Plan switching: direct "switch to Personal/Pro/Free" buttons were removed.
// The only way to upgrade is via Razorpay checkout, and the only way to
// downgrade is to cancel the subscription from Razorpay. This prevents the
// localStorage bypass that previously existed via `setPlan(plan)`.

import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, Gift, Mic, Sparkles, Wallet } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { useUsage } from "@/hooks/useUsage";
import {
  formatPriceLabel,
  PLAN_LIMITS,
  TRIAL_DAYS,
  type BillingCycle,
  type Plan,
} from "@/lib/usage";
import {
  startTrial,
  TeluxBackendOfflineError,
  TrialRateLimitedError,
} from "@/serverFns/subscription";
import { createRazorpaySubscription } from "@/serverFns/razorpay";
import { getOnboardingStatus } from "@/serverFns/onboarding";
import { emitSubscriptionChange, loadSubscription } from "@/lib/subscription";
import { translateRazorpayError } from "@/lib/razorpay-errors";

export function DashboardBillingSection() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { plan, questionsThisMonth, trialUntil, trialDaysRemaining } = useUsage();
  const current = PLAN_LIMITS[plan];
  const onTrial = trialUntil != null && trialDaysRemaining > 0;
  // Monthly / yearly toggle. Default to yearly — the 20% discount is the
  // closer; users who want monthly flip the switch back.
  const [cycle, setCycle] = useState<BillingCycle>("yearly");
  const [startingTrial, setStartingTrial] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [openingPlan, setOpeningPlan] = useState<Plan | null>(null);

  async function onStartTrial() {
    setTrialError(null);
    if (!session?.user?.id) {
      setTrialError("You must be signed in to start a trial.");
      return;
    }
    setStartingTrial(true);
    try {
      // If onboarding hasn't been completed, route the user back to the
      // dashboard where the OnboardingModal is already blocking the page.
      // The modal's submit handler is what actually starts the trial — we
      // intentionally don't start the trial here so the user doesn't see
      // the trial banner without having answered the questions first.
      const status = await getOnboardingStatus({ data: { userId: session.user.id } });
      if (!status.completed) {
        await navigate({ to: "/dashboard/documents" });
        return;
      }
      // Onboarding is done — go straight to the trial-start path. The
      // startTrial serverFn is idempotent, so re-clicking the button while
      // a trial is running is a no-op (the user just sees the existing
      // "Trial running" badge).
      await startTrial({ data: { userId: session.user.id } });
      await loadSubscription(session.user.id, { force: true });
      emitSubscriptionChange();
      // One-click flow: drop the user straight into the documents workspace
      // so they can start uploading without a second navigation. The trial
      // banner above the documents panel confirms the trial is active.
      await navigate({ to: "/dashboard/documents" });
    } catch (err) {
      // Don't surface infrastructure language to end users. Trial-start
      // failures are most commonly a server-side env-var not being set; we
      // re-word the message so it reads as a user-facing retry hint rather
      // than an internal config leak.
      const msg =
        err instanceof TrialRateLimitedError
          ? "You've tried to start the trial a few times. Please wait a few minutes before trying again."
          : err instanceof TeluxBackendOfflineError
            ? "Trials are temporarily unavailable. Please try again in a few minutes — the team has been notified."
            : err instanceof Error
              ? err.message
              : "Could not start the trial.";
      setTrialError(msg);
    } finally {
      setStartingTrial(false);
    }
  }

  async function onSubscribe(planKind: Plan) {
    if (!session?.user?.id) {
      setCheckoutError("You must be signed in to subscribe.");
      return;
    }
    if (planKind === "starter") return; // Free tier — no checkout needed.
    setCheckoutError(null);
    setOpeningPlan(planKind);
    try {
      const result = await createRazorpaySubscription({
        data: {
          userId: session.user.id,
          plan: planKind,
          cycle,
        },
      });
      // Open Razorpay Standard Checkout in a new tab. The subscription id
      // is bound to the user_id + plan + cycle in Razorpay's notes; the
      // webhook flips the subscriptions row on success.
      const w = window.open(result.shortUrl, "_blank", "noopener,noreferrer,width=520,height=720");
      if (!w) {
        setCheckoutError("Popup blocked — allow popups for this site to complete checkout.");
      }
    } catch (err) {
      setCheckoutError(translateRazorpayError(err));
    } finally {
      setOpeningPlan(null);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface-2/30 p-5 sm:p-6">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="eyebrow">Billing</span>
          <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">Pick what fits</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Switch any time. Cancel any time. Your documents stay on your device — only the relevant
            paragraph leaves.
          </p>
        </div>
        <Link
          to="/history"
          className="text-xs font-medium text-signal transition-colors hover:underline"
        >
          View history →
        </Link>
      </div>

      {/* ── Hero: 3-day free trial of Talk with Document ──────────────────── */}
      <div className="mb-6 flex flex-col items-start gap-4 rounded-2xl border border-signal/40 bg-gradient-to-br from-signal/15 via-signal/5 to-transparent p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-signal text-signal-foreground">
            <Gift className="size-5" />
          </span>
          <div>
            <h3 className="text-lg font-semibold sm:text-xl">
              Try Talk with Document free for {TRIAL_DAYS} days
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Start the trial — once you click, the {TRIAL_DAYS}-day countdown begins on your
              account. Cancel any time from this page. No card required.
            </p>
            {onTrial ? (
              <p className="mt-2 text-xs font-medium text-signal">
                Trial active · {trialDaysRemaining} {trialDaysRemaining === 1 ? "day" : "days"} left
              </p>
            ) : null}
            {trialError ? (
              <p className="mt-2 text-xs text-red-400" role="alert">
                {trialError}
              </p>
            ) : null}
          </div>
        </div>
        {onTrial ? (
          <div className="flex items-center gap-2 rounded-full border border-signal/30 bg-signal/10 px-4 py-2 text-sm font-medium text-signal">
            <Check className="size-3.5" />
            Trial running
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void onStartTrial()}
            disabled={startingTrial}
            className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-full bg-signal px-5 py-3 text-sm font-semibold text-signal-foreground transition-transform hover:scale-[1.02] disabled:opacity-60 sm:w-auto"
          >
            <Wallet className="size-4" />
            {startingTrial ? "Starting…" : `Start ${TRIAL_DAYS}-day trial`}
          </button>
        )}
      </div>

      {/* ── Current plan banner ───────────────────────────────────────────── */}
      <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-signal" />
            <p className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
              Your plan
            </p>
          </div>
          <h3 className="mt-2 text-2xl font-semibold">{current.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{current.priceLabel}</p>
        </div>
        <UsageMeter used={questionsThisMonth} limit={current.questionsPerMonth} />
      </div>

      {/* ── Monthly / Yearly toggle ───────────────────────────────────────── */}
      <div className="mb-4 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => setCycle("monthly")}
          className={
            "rounded-full px-4 py-2 text-sm font-medium transition-colors " +
            (cycle === "monthly"
              ? "bg-signal text-signal-foreground"
              : "text-muted-foreground hover:text-foreground")
          }
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => setCycle("yearly")}
          className={
            "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors " +
            (cycle === "yearly"
              ? "bg-signal text-signal-foreground"
              : "text-muted-foreground hover:text-foreground")
          }
        >
          Yearly
          <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold tracking-widest text-emerald-400 uppercase">
            Save 20%
          </span>
        </button>
      </div>

      {/* ── Plan cards ────────────────────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-3">
        {(Object.keys(PLAN_LIMITS) as Plan[]).map((p) => (
          <PlanCard
            key={p}
            plan={p}
            current={plan}
            cycle={cycle}
            onSubscribe={onSubscribe}
            isOpening={openingPlan === p}
          />
        ))}
      </div>

      {checkoutError ? (
        <p className="mt-4 text-center text-xs text-red-400" role="alert">
          {checkoutError}
        </p>
      ) : null}

      <p className="mt-8 text-center font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
        Secured by Razorpay · Cancel anytime from your Razorpay dashboard
      </p>
    </section>
  );
}

function UsageMeter({ used, limit }: { used: number; limit: number }) {
  const isUnlimited = !Number.isFinite(limit);
  const pct = isUnlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <div className="w-full max-w-xs">
      <div className="flex items-baseline justify-between">
        <span className="text-xs tracking-widest text-muted-foreground uppercase">This month</span>
        <span className="font-mono text-xs">
          {isUnlimited ? "Unlimited" : `${used} / ${limit}`}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={"h-full rounded-full " + (pct >= 90 ? "bg-red-400" : "bg-signal")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {isUnlimited
          ? "No question cap on this plan."
          : `${Math.max(0, limit - used)} questions left`}
      </p>
    </div>
  );
}

function PlanCard({
  plan,
  current,
  cycle,
  onSubscribe,
  isOpening,
}: {
  plan: Plan;
  current: Plan;
  cycle: BillingCycle;
  onSubscribe: (plan: Plan) => void;
  isOpening: boolean;
}) {
  const p = PLAN_LIMITS[plan];
  const isCurrent = plan === current;
  const isPaid = plan !== "starter";
  const label = formatPriceLabel(plan, cycle);
  return (
    <article
      className={
        "flex h-full flex-col rounded-2xl border p-5 sm:p-6 " +
        (isCurrent
          ? "border-signal/60 bg-surface-2 shadow-[var(--shadow-signal)]"
          : "border-border bg-surface")
      }
    >
      <div className="mb-3 flex items-center gap-2">
        {isCurrent ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-signal px-2.5 py-1 font-mono text-[10px] tracking-widest text-signal-foreground uppercase">
            <Check className="size-3" /> Your plan
          </span>
        ) : null}
        {isPaid ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            <Mic className="size-3 text-signal" />
            Voice
          </span>
        ) : null}
      </div>

      <h3 className="text-xl font-semibold">{p.name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {plan === "starter"
          ? "For trying Telux on a few files."
          : plan === "personal"
            ? "For everyday paperwork."
            : "For heavy document work."}
      </p>
      <p className="mt-5 flex items-baseline gap-2">
        <span className="font-display text-3xl font-bold">{label.split(" ")[0]}</span>
        <span className="text-xs text-muted-foreground">{label.split(" ").slice(1).join(" ")}</span>
      </p>
      {isPaid && cycle === "yearly" && p.featuresYearlyBadge ? (
        <p className="mt-1 text-xs font-medium text-emerald-400">{p.featuresYearlyBadge}</p>
      ) : null}

      <p className="mt-3 font-mono text-[10px] tracking-widest text-signal uppercase">
        What's included
      </p>
      <ul className="mt-2 space-y-2.5">
        {p.features.map((f) => (
          <li key={f} className="flex gap-2 text-sm text-muted-foreground">
            <Check className="mt-0.5 size-4 shrink-0 text-signal" />
            {f}
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-6">
        {isCurrent ? (
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded-xl border border-border bg-surface py-2.5 text-sm font-medium text-muted-foreground"
          >
            Current plan
          </button>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => onSubscribe(plan)}
              disabled={isOpening}
              className="w-full rounded-xl bg-signal py-2.5 text-sm font-semibold text-signal-foreground transition-transform hover:scale-[1.01] disabled:opacity-60"
            >
              {isPaid
                ? isOpening
                  ? "Opening checkout…"
                  : `Subscribe ${cycle}`
                : `Use ${p.name} free`}
            </button>
            {!isPaid ? (
              <p className="text-center text-xs text-muted-foreground">
                Or start the 3-day trial above
              </p>
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
}
