-- One-time use for the admin console's 6-digit codes (lib/server/admin-totp.ts).
--
-- A time-based code is valid for its whole 30-second step, and one step either
-- side is accepted for clock drift, so without this a code seen once could be
-- replayed for up to 90 seconds. Each accepted step is inserted here; the
-- primary key makes a second use of the same step fail.
--
-- Service role only: RLS on, no policies, no grants to anon/authenticated.
-- Safe to apply before or after the deploy (the app logs and carries on
-- without replay protection until the table exists).

create table if not exists public.admin_totp_steps (
  step     bigint primary key,
  used_at  timestamptz not null default now()
);

alter table public.admin_totp_steps enable row level security;
revoke all on public.admin_totp_steps from anon, authenticated;

comment on table public.admin_totp_steps is
  'Admin two-factor time steps already used. Server-only (service role); the primary key refuses a replayed code.';
