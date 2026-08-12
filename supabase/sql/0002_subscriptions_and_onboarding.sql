-- ============================================================================
-- Telux — Subscriptions
-- Run this once in: Supabase Dashboard → SQL Editor → New query
--
-- Goal: move the 7-day trial from client-side localStorage into a real
-- per-user DB row, so the trial countdown follows the account across devices
-- and browsers. Signup is now zero-questions: the only data we want (name)
-- already comes from the signup form.
--
-- The existing handle_new_user() trigger from 0001 already inserts a row
-- into public.profiles. We extend it here so it ALSO inserts a row into
-- public.subscriptions, defaulting to plan='free'.
-- ============================================================================

-- 1) Subscriptions table — one row per user.
create table if not exists public.subscriptions (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  plan                 text not null default 'free' check (plan in ('free', 'personal', 'pro')),
  trial_started_at     timestamptz,
  trial_ends_at        timestamptz,
  -- Razorpay fields — all nullable, populated by the webhook on first payment.
  razorpay_payment_id  text,
  razorpay_order_id    text,
  valid_until          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Idempotent migration: drop the column that was used by the removed
-- onboarding flow so re-running this file on a fresh DB or an existing one
-- both land at the same shape.
alter table public.subscriptions drop column if exists onboarding_completed;

alter table public.subscriptions enable row level security;

drop policy if exists "subs_select_own" on public.subscriptions;
create policy "subs_select_own"
  on public.subscriptions for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Only the service-role key writes — the client never updates this table
-- directly. Mutations happen via serverFns that read the user's session
-- and verify the call with CSRF.
drop policy if exists "subs_insert_self" on public.subscriptions;
drop policy if exists "subs_update_self" on public.subscriptions;
drop policy if exists "subs_delete_self" on public.subscriptions;

-- Explicit GRANTs for the service role. The service-role JWT bypasses RLS
-- by default, but on Supabase Cloud we still want the GRANT in place so
-- the trial-start writes never trip a defensive check in the PostgREST
-- layer (the same call sometimes surfaces as "permission denied for table
-- subscriptions" when the GRANT is missing).
grant insert, update, delete on public.subscriptions to service_role;

-- 2) Drop the obsolete onboarding_responses table if it still exists from
--    older deployments. The signup form already captures `full_name`, so
--    nothing else needs to be asked.
drop table if exists public.onboarding_responses;

-- 3) Extend handle_new_user() so every signup also gets a subscriptions row.
--    Idempotent: ON CONFLICT DO NOTHING means re-running the trigger is safe.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;

  insert into public.subscriptions (user_id, plan)
  values (new.id, 'free')
  on conflict (user_id) do nothing;

  insert into public.auth_events (user_id, event) values (new.id, 'signup');
  return new;
end;
$$;

-- Re-attach the trigger so any updates to the function take effect.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) Keep updated_at fresh on subscriptions, same pattern as profiles.
drop trigger if exists subscriptions_touch_updated_at on public.subscriptions;
create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- 5) Helpful read view for analytics. The application never reads from here
--    directly — it's a convenience for SQL queries you may want to run in
--    the Supabase dashboard.
create or replace view public.subscription_overview as
select
  s.user_id,
  s.plan,
  s.trial_started_at,
  s.trial_ends_at,
  s.razorpay_payment_id,
  s.valid_until,
  case
    when s.trial_ends_at is not null and s.trial_ends_at > now() then true
    else false
  end as trial_active,
  p.email,
  p.full_name
from public.subscriptions s
left join public.profiles p on p.id = s.user_id;

-- ============================================================================
-- After running this:
--   - Every signup creates a row in public.subscriptions with plan='free'.
--   - Authenticated users can SELECT their own subscription row from the
--     browser (RLS limits it to auth.uid()). Writes are service-role only.
--   - The 7-day trial is now real: setting trial_started_at = now() and
--     trial_ends_at = now() + interval '7 days' makes the user's effective
--     plan "personal" until that timestamp expires.
-- ============================================================================