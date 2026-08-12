// Pre-trial onboarding serverFns.
//
// Two entry points:
//   - getOnboardingStatus: cheap read used by AuthGate to decide whether to
//     render the OnboardingModal. Returns { completed: boolean }.
//   - submitOnboarding: writes the three questionnaire answers to
//     `public.onboarding_responses` and, if the user has no active trial or
//     paid plan, kicks off the trial via startTrial().
//
// Security / rate-limit notes:
//   - Both serverFns are protected by the existing CSRF middleware (every
//     serverFn is) and the rate-limit window in submitOnboarding prevents
//     a tight loop from repeatedly creating / overwriting onboarding rows
//     (each submission is a Supabase round-trip).
//   - The userId is supplied by the caller, not derived from auth headers,
//     because the function is called from the browser anon client. AuthGate
//     enforces that the caller is signed in (otherwise the dashboard never
//     mounts). The CSRF token is the second layer of defence.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { consume } from "@/lib/rate-limit";
import {
  isSupabaseConfigured,
  readOnboardingRow,
  readSubscriptionRow,
  writeOnboardingRow,
} from "@/lib/supabaseServer";
import { resolveSubscription as resolveSubscriptionPure } from "@/lib/resolve-subscription";
import type { ServerSubscription } from "@/serverFns/subscription";
import { TrialRateLimitedError } from "@/serverFns/subscription";

const answersSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().trim().min(1, "Please enter your name").max(120),
  age: z
    .number()
    .int("Age must be a whole number")
    .min(13, "You must be at least 13 to use Telux")
    .max(120, "Please enter a realistic age"),
  hearAbout: z.string().trim().min(1, "Please tell us how you heard about us").max(200),
});

export const getOnboardingStatus = createServerFn({ method: "POST" })
  .validator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data }): Promise<{ completed: boolean }> => {
    // Backend offline → treat as not-completed so the modal still appears;
    // submitting while offline will surface a clear backend-offline error
    // from submitOnboarding. We prefer this over silently dropping the user
    // into the dashboard without ever seeing the questionnaire.
    if (!isSupabaseConfigured()) return { completed: false };
    const row = await readOnboardingRow(data.userId);
    return { completed: row != null };
  });

export const submitOnboarding = createServerFn({ method: "POST" })
  .validator(answersSchema)
  .handler(async ({ data }): Promise<{ completed: true; subscription: ServerSubscription }> => {
    // Same shape as the trial-start rate limit so we don't double-charge
    // the user's bucket when they navigate from the modal straight to the
    // trial-start round-trip. Capacity 5/hour is plenty for a human
    // correcting a typo or two.
    const rl = consume(`onboarding:${data.userId}`, {
      capacity: 5,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.ok) {
      throw new TrialRateLimitedError(rl.retryAfterMs);
    }
    if (!isSupabaseConfigured()) {
      // Re-throw a shape AuthGate can recognise (the existing
      // TeluxBackendOfflineError is defined alongside the trial/paid
      // serverFns). Importing it here would create a circular dep, so we
      // re-import dynamically.
      const { TeluxBackendOfflineError } = await import("@/serverFns/subscription");
      throw new TeluxBackendOfflineError();
    }

    // 1. Persist the answers. Upsert keyed by user_id so a re-submit (e.g.
    //    the user fixed a typo) overwrites cleanly. The PRIMARY KEY
    //    constraint on onboarding_responses.user_id makes this safe.
    await writeOnboardingRow(data.userId, {
      full_name: data.fullName,
      age: data.age,
      hear_about: data.hearAbout,
    });

    // 2. Decide whether to start the trial. If the user is already on a
    //    paid plan (they came back from a subscription), or already has
    //    an active trial, do NOT clobber it — the questionnaire is
    //    standalone from the trial clock.
    const existing = await readSubscriptionRow(data.userId);
    const now = Date.now();
    const trialStillActive =
      existing?.trial_ends_at != null && Date.parse(existing.trial_ends_at) > now;
    const paidActive =
      existing != null &&
      existing.plan !== "free" &&
      (existing.valid_until == null || Date.parse(existing.valid_until) > now);

    if (!trialStillActive && !paidActive) {
      // Re-use the canonical trial-start path so we don't duplicate the
      // idempotency / rate-limit logic. The dynamic import keeps this
      // file's import graph independent of subscription.ts (which itself
      // imports from supabaseServer).
      const { startTrial } = await import("@/serverFns/subscription");
      const sub: ServerSubscription = await startTrial({ data: { userId: data.userId } });
      return { completed: true, subscription: sub };
    }

    // No trial started (already had one or already paid). Just resolve
    // the existing subscription row so the client gets the snapshot it
    // would have gotten if it had called getEffectivePlan.
    return {
      completed: true,
      subscription: resolveSubscriptionPure(existing, now) as ServerSubscription,
    };
  });
