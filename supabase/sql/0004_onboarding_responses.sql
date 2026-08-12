-- ============================================================================
-- Telux — Onboarding responses
-- Run this once in: Supabase Dashboard → SQL Editor → New query
--
-- Goal: store the three pre-trial questions (name, age, "how did you hear
-- about us") that the OnboardingModal collects on first sign-in. The trial
-- is gated on a row existing here, so this table is the de-facto "is the
-- onboarding done" check used by AuthGate.
--
-- Re-introduces the table that 0002_subscriptions_and_onboarding.sql
-- deliberately dropped. The previous onboarding flow was a friction tax;
-- this one is the smallest possible set of fields needed to keep the trial
-- starting on a human-confirmed action (rather than auto-firing on every
-- sign-in, the previous behavior).
-- ============================================================================

create table if not exists public.onboarding_responses (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  -- full_name mirrors what's in public.profiles.full_name; we re-collect it
  -- here because Google OAuth often leaves it blank and the signup form is
  -- the one place the user is most willing to type their name.
  full_name  text not null,
  -- 13+ is a hard floor — the chat proxy doesn't have a separate age gate,
  -- so we enforce it here. Max 120 is generous and matches our UI.
  age        int  not null check (age between 13 and 120),
  -- "How did you hear about us" — select-one of a fixed list, or "Other" +
  -- free-text. We store the literal value (the select label, or the typed
  -- text when Other). Free-form text is bounded so a 50 KB payload can't
  -- sneak through.
  hear_about text not null check (length(hear_about) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.onboarding_responses enable row level security;

-- A user can read their own row (e.g. to pre-fill the form next time) and
-- can insert/update their own row. We deliberately allow UPDATE so the
-- modal can re-submit with corrections — the primary-key constraint still
-- keeps it one row per user.
drop policy if exists "onboarding_select_own" on public.onboarding_responses;
create policy "onboarding_select_own"
  on public.onboarding_responses for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "onboarding_insert_own" on public.onboarding_responses;
create policy "onboarding_insert_own"
  on public.onboarding_responses for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "onboarding_update_own" on public.onboarding_responses;
create policy "onboarding_update_own"
  on public.onboarding_responses for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Explicit GRANTs for the service role. The service-role JWT bypasses RLS,
-- but on Supabase Cloud the GRANT still matters for the serverFn's UPSERT
-- path (PostgREST sometimes surfaces "permission denied" if the GRANT is
-- missing even when RLS would otherwise let the row through).
grant insert, select, update on public.onboarding_responses to service_role;

-- Keep updated_at fresh on edits. Same pattern as profiles / subscriptions.
drop trigger if exists onboarding_responses_touch_updated_at on public.onboarding_responses;
create trigger onboarding_responses_touch_updated_at
  before update on public.onboarding_responses
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- After running this:
--   - `public.onboarding_responses` exists with one row per user (PK on
--     user_id, FK to auth.users with cascade delete).
--   - Authenticated users can read / write their own row; everyone else
--     (anon, other users) gets nothing.
--   - The OnboardingModal in src/components/OnboardingModal.tsx writes
--     here via the submitOnboarding serverFn; AuthGate hides the modal
--     when a row exists.
--
-- Verify:
--   select user_id, full_name, age, hear_about, created_at
--   from public.onboarding_responses
--   order by created_at desc
--   limit 5;
-- ============================================================================