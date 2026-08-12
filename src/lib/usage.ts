// On-device usage tracking. Plan + monthly question counter live in localStorage;
// the actual plan + trial state now lives in Supabase (see src/lib/subscription.ts).
//
// What stays here:
//   - The PLAN_LIMITS table (single source of truth for what each plan offers).
//   - The gate helpers: canUseVoice, canUploadDocument, canAsk.
//   - The on-device question counter (Starter has 50/month; we still track this
//     locally because personal/pro are unlimited and never hit the limit).
//
// What moved out:
//   - tryProFor7Days / cancelTrial / TrialUntil storage — replaced by
//     startTrial/cancelTrial serverFns that write to public.subscriptions.

import type { BillingCycle, Plan } from "./usage.types";

export type { BillingCycle, Plan } from "./usage.types";
export { YEARLY_DISCOUNT_PERCENT } from "./usage.types";

type PlanDef = {
  name: string;
  // In INR, NOT paisa. Razorpay expects paise at checkout; multiply there.
  priceMonthly: number;
  priceYearly: number;
  priceLabel: string;
  priceLabelYearly: string;
  // Hard caps. `Infinity` means "unlimited".
  docs: number;
  // Total PDF pages across all uploaded docs. `Infinity` = uncapped.
  // Yearly Pro is uncapped (see canUploadDocument override below).
  pages: number;
  // Monthly question limit on the chat proxy. Personal/Pro are uncapped.
  questionsPerMonth: number;
  // Voice (Talk-with-Document + chat mic + read aloud) is a paid feature.
  // Server re-checks this so it can't be bypassed by editing localStorage.
  voice: boolean;
  // Multi-document simultaneous chat (Pro only). When true, the user can ask
  // questions spanning all uploaded docs and get a synthesised answer.
  multiDocChat: boolean;
  // Voice-gender picker surfaced in the Talk-with-Document workspace.
  // All voice-enabled tiers expose the picker; voice-disabled tiers (Free)
  // do not.
  voiceGenderPicker: boolean;
  features: string[];
  featuresYearlyBadge?: string;
};

export const PLAN_LIMITS: Record<Plan, PlanDef> = {
  starter: {
    name: "Free",
    priceMonthly: 0,
    priceYearly: 0,
    priceLabel: "₹0 / forever",
    priceLabelYearly: "₹0 / forever",
    docs: 10,
    pages: 50,
    questionsPerMonth: 50,
    voice: false,
    multiDocChat: false,
    voiceGenderPicker: false,
    features: [
      "Up to 50 pages total",
      "Up to 10 documents",
      "50 questions per month",
      "PDF & text files",
    ],
  },
  personal: {
    name: "Personal",
    priceMonthly: 299,
    // 299 × 12 × 0.8 = 2870.40 → ₹2,870/yr (saves ₹718 vs monthly)
    priceYearly: 2870,
    priceLabel: "₹299 / month",
    priceLabelYearly: "₹2,870 / year",
    docs: 10,
    pages: 200,
    questionsPerMonth: Number.POSITIVE_INFINITY,
    voice: true,
    multiDocChat: false,
    voiceGenderPicker: true,
    features: [
      "Up to 200 pages total",
      "Up to 10 documents",
      "Unlimited questions",
      "PDF & text files",
      "🎙️ Talk with Document — speak & listen",
      "🗣️ Male / Female voice picker",
      "📖 Speech-to-text & read-aloud in chat",
    ],
    featuresYearlyBadge: "Save 20% vs monthly",
  },
  pro: {
    name: "Pro",
    priceMonthly: 749,
    // 749 × 12 × 0.8 = 7190.40 → ₹7,190/yr (saves ₹1,798 vs monthly)
    priceYearly: 7190,
    priceLabel: "₹749 / month",
    priceLabelYearly: "₹7,190 / year",
    docs: 30,
    pages: 1000,
    questionsPerMonth: Number.POSITIVE_INFINITY,
    voice: true,
    multiDocChat: true,
    voiceGenderPicker: true,
    features: [
      "Up to 1,000 pages total",
      "Up to 30 documents",
      "Unlimited questions",
      "Multi-document simultaneous chat",
      "🎙️ Talk with Document — priority voice",
      "🗣️ Male / Female voice picker",
      "📖 Speech-to-text & read-aloud in chat",
      "Priority response speed",
    ],
    featuresYearlyBadge: "Save 20% vs monthly",
  },
};

/**
 * Returns the effective page cap for the user's plan. Yearly Pro has no
 * cap (Infinity). The static `pages` field on the plan is the *monthly*
 * cap; yearly Pro exceeds that.
 */
export function pageCapFor(plan: Plan, billingCycle: BillingCycle | null = null): number {
  if (plan === "pro" && billingCycle === "yearly") return Number.POSITIVE_INFINITY;
  return PLAN_LIMITS[plan].pages;
}

/**
 * Format a price label for a plan + cycle combo. Keeps the Billing UI in sync
 * with the plan table without re-implementing the math per screen.
 */
export function formatPriceLabel(plan: Plan, cycle: BillingCycle): string {
  return cycle === "yearly" ? PLAN_LIMITS[plan].priceLabelYearly : PLAN_LIMITS[plan].priceLabel;
}

// --- Voice gating --------------------------------------------------------------
//
// Voice ("Talk with Document") is a paid feature on every plan that does not
// have it. Personal/Pro have unlimited voice across all documents. The server
// (`src/lib/chat.ts`) re-checks the user's effective plan against the
// `subscriptions` row in Supabase — a Starter user cannot unlock voice by
// editing localStorage because the server-side check is the authority.
//
// A 3-day trial can be activated from /billing. While the trial is active
// the user's effective plan is "pro", so all gates below treat them as a
// paying Pro subscriber. Cancelling the trial reverts immediately.

/**
 * Hard upload cap on the Starter (Free) plan. Personal/Pro are unlimited
 * (well, bounded by 200 / 1,000 pages). After a Free user has this many
 * documents, further uploads are blocked at the source (the dashboard
 * drop-zone shows a paywall CTA). The same constant is exposed publicly
 * for UI badges and the /talk workspace header.
 */
export const STARTER_DOC_LIMIT = 10;

/** Length of the free trial offered on the billing page. 3-day countdown
 *  unlocks Pro-tier features while it's running. */
export const TRIAL_DAYS = 3;

export function planHasVoice(plan: Plan): boolean {
  return PLAN_LIMITS[plan].voice;
}

export function planHasPremium(plan: Plan): boolean {
  return plan !== "starter";
}

/**
 * Voice capability for the current plan.
 * - Personal / Pro: always true
 * - Starter: never (voice is a paid feature)
 *
 * Accepts an optional `planOverride` (the effective plan during a trial).
 * Callers that already have the effective plan pass it through to skip the
 * trial lookup.
 */
export function canUseVoice(plan: Plan, _docCount: number, planOverride?: Plan): boolean {
  const p = planOverride ?? plan;
  return PLAN_LIMITS[p].voice;
}

/**
 * Returns true when a user on this plan can upload another document right now.
 * - Personal / Pro: true only while docCount < plan.docs AND totalPages <= plan.pages.
 *   Yearly Pro has no page cap.
 * - Starter (Free): true only while docCount < STARTER_DOC_LIMIT AND totalPages < 50.
 *
 * The page sum is supplied by the caller (read from IndexedDB doc metadata).
 * New uploads pre-count their own page count and only block if the running
 * total would exceed the cap.
 */
export function canUploadDocument(
  plan: Plan,
  docCount: number,
  totalPages: number = 0,
  planOverride?: Plan,
  billingCycle: BillingCycle | null = null,
): boolean {
  const p = planOverride ?? plan;
  const def = PLAN_LIMITS[p];
  if (docCount >= def.docs) return false;
  const pageCap = pageCapFor(p, billingCycle);
  if (!Number.isFinite(pageCap)) return true;
  return totalPages < pageCap;
}

/**
 * Human-readable reason the user can't upload another document right now.
 * Returns null when upload is allowed. Used by the dashboard drop-zone
 * paywall toast.
 */
export function uploadBlockReason(
  plan: Plan,
  docCount: number,
  totalPages: number = 0,
  planOverride?: Plan,
  billingCycle: BillingCycle | null = null,
): string | null {
  if (canUploadDocument(plan, docCount, totalPages, planOverride, billingCycle)) return null;
  const def = PLAN_LIMITS[planOverride ?? plan];
  if (docCount >= def.docs) {
    return `You've used all ${def.docs} document slots on this plan. Upgrade to upload more.`;
  }
  return `You've hit the page limit on this plan (${def.pages} pages). Upgrade to a higher tier for more room.`;
}

/**
 * Number of upload slots remaining for the user on their current plan, or
 * `Infinity` for paid plans that haven't hit the cap. Used by the upload UI
 * to show "X of Y free slots left" badges.
 */
export function remainingSlots(plan: Plan, docCount: number, planOverride?: Plan): number {
  const p = planOverride ?? plan;
  return Math.max(0, PLAN_LIMITS[p].docs - docCount);
}

/**
 * Multi-document chat access. Pro only. Free and Personal fall back to
 * single-doc chat (the chat panel picks chunks from all docs but Pro is
 * the tier where this is explicitly marketed and supported).
 */
export function canUseMultiDocChat(plan: Plan, planOverride?: Plan): boolean {
  const p = planOverride ?? plan;
  return PLAN_LIMITS[p].multiDocChat;
}

/**
 * Voice gender picker access. Any plan with voice access exposes the picker.
 */
export function hasVoiceGenderPicker(plan: Plan, planOverride?: Plan): boolean {
  const p = planOverride ?? plan;
  return PLAN_LIMITS[p].voiceGenderPicker;
}

/**
 * Human-readable reason the user can't use voice right now. Used by paywall
 * screens. Returns null when voice is allowed.
 */
export function voiceBlockReason(
  plan: Plan,
  _docCount: number,
  planOverride?: Plan,
): string | null {
  if (canUseVoice(plan, _docCount, planOverride)) return null;
  return "Talk with Document is included on Personal and Pro plans. Upgrade in Billing to unlock.";
}

// --- Monthly question counter (still local — Personal/Pro are unlimited) ----

const STORAGE_KEY = "telux:usage:v1";

type StoredUsage = {
  // `plan` is a mirror of the DB plan for quick read; trial state is no
  // longer stored here — it lives in `public.subscriptions`.
  plan: Plan;
  questionsThisMonth: number;
  monthKey: string;
};

function currentMonthKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function readUsage(): StoredUsage {
  if (typeof window === "undefined") {
    return { plan: "starter", questionsThisMonth: 0, monthKey: currentMonthKey() };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { plan: "starter", questionsThisMonth: 0, monthKey: currentMonthKey() };
    }
    const parsed = JSON.parse(raw) as Partial<StoredUsage>;
    const plan: Plan =
      parsed.plan === "personal" || parsed.plan === "pro" ? parsed.plan : "starter";
    const monthKey = typeof parsed.monthKey === "string" ? parsed.monthKey : currentMonthKey();
    const count = typeof parsed.questionsThisMonth === "number" ? parsed.questionsThisMonth : 0;
    return { plan, monthKey, questionsThisMonth: count };
  } catch {
    return { plan: "starter", questionsThisMonth: 0, monthKey: currentMonthKey() };
  }
}

function writeUsage(u: StoredUsage): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
  } catch {
    // Quota exceeded or storage disabled — fail silently, usage just won't track.
  }
}

// Public API ------------------------------------------------------------------

export type UsageSnapshot = {
  plan: Plan;
  questionsThisMonth: number;
  monthKey: string;
};

export function getUsage(): UsageSnapshot {
  const u = readUsage();
  const month = currentMonthKey();
  if (u.monthKey !== month) {
    const reset: StoredUsage = { ...u, questionsThisMonth: 0, monthKey: month };
    writeUsage(reset);
    return { plan: reset.plan, questionsThisMonth: 0, monthKey: month };
  }
  return { plan: u.plan, questionsThisMonth: u.questionsThisMonth, monthKey: u.monthKey };
}

export type CanAskResult =
  | { ok: true; remaining: number; resetsAt: Date }
  | { ok: false; reason: "limit-reached"; resetsAt: Date };

/**
 * Local question-cap check. Pass `effectivePlan` from the subscription store
 * so trial / paid users get unlimited questions without us having to mutate
 * the stored plan.
 */
export function canAsk(effectivePlan: Plan): CanAskResult {
  const { questionsThisMonth } = getUsage();
  const limit = PLAN_LIMITS[effectivePlan].questionsPerMonth;
  // End of the current calendar month in UTC.
  const now = new Date();
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  if (questionsThisMonth >= limit) {
    return { ok: false, reason: "limit-reached", resetsAt };
  }
  return { ok: true, remaining: Math.max(0, limit - questionsThisMonth), resetsAt };
}

export function recordQuestion(): void {
  const u = readUsage();
  const month = currentMonthKey();
  const next: StoredUsage = {
    ...u,
    monthKey: month,
    questionsThisMonth: u.monthKey === month ? u.questionsThisMonth + 1 : 1,
  };
  writeUsage(next);
  // Notify React subscribers listening via useUsage().
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("telux:usage-changed"));
  }
}

export function formatResetsAt(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
