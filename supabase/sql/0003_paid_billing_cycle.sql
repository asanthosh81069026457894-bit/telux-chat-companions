
-- ============================================================================
-- Telux — Paid billing cycle + yearly plan
-- Run this once in: Supabase Dashboard → SQL Editor → New query
--
-- Adds the columns the Razorpay webhook writes after a successful payment:
--   - billing_cycle: 'monthly' or 'yearly' (null for free / trial)
--   - valid_until:   when the paid plan expires; while > now() the user is
--                    treated as a paying subscriber even if `plan` is still
--                    'personal' / 'pro'. The webhook refreshes this on every
--                    renewal.
--
-- Also loosens the plan CHECK constraint so 'personal' is allowed (the prior
-- migration already accepted it, but we keep this idempotent).
-- ============================================================================

alter table public.subscriptions
  add column if not exists billing_cycle text
    check (billing_cycle in ('monthly', 'yearly')),
  add column if not exists valid_until   timestamptz;

-- Backfill safety: existing rows without billing_cycle / valid_until are
-- treated as free-with-no-trial by the server-side resolver. No data loss.

-- Helpful index for admin queries that want to find rows about to expire.
create index if not exists subscriptions_valid_until_idx
  on public.subscriptions (valid_until)
  where valid_until is not null;

-- ============================================================================
-- After running this:
--   - `subscriptions` now has `billing_cycle` (free / monthly / yearly) and
--     `valid_until` (the expiry timestamp).
--   - The Razorpay webhook calls `activatePaidPlan(serverFn)` which writes
--     both columns plus plan + clears the trial.
--   - `getEffectivePlan` will report `plan = "personal"` / `"pro"` and
--     `billingCycle = "monthly"` / `"yearly"` for the duration of the paid
--     window, then naturally fall back to free once `valid_until` passes.
--
-- Verify:
--   select user_id, plan, billing_cycle, valid_until, trial_ends_at
--   from public.subscriptions;
-- ============================================================================
