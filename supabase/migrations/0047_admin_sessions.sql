-- Server-side record of admin console sessions, so a session can be REVOKED.
--
-- The admin session cookie is an HMAC-signed token with an expiry
-- (lib/server/admin-auth.ts). On its own that cannot be withdrawn: signing out
-- only deleted the cookie in the browser, and a copy of the token taken
-- earlier stayed valid until it expired, up to 8 hours later.
--
-- Each login now records the token's random nonce here. The server-side admin
-- check (lib/server/admin-guard.ts), which runs in every admin API handler and
-- admin page before any data is read or written, accepts a token only when its
-- nonce is here, not revoked and not expired. Signing out sets revoked_at.
--
-- Service role only: RLS on with no policies, and no grants to anon or
-- authenticated. The browser never reads or writes this table.
--
-- Deploy order: safe either way. Until this table exists the app logs an
-- error and falls back to the signature-and-expiry check it had before.

create table if not exists public.admin_sessions (
  nonce       text primary key check (nonce ~ '^[0-9a-f]{24}$'),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  ip          text,
  user_agent  text
);

create index if not exists admin_sessions_expires_at_idx on public.admin_sessions (expires_at);

alter table public.admin_sessions enable row level security;
revoke all on public.admin_sessions from anon, authenticated;

comment on table public.admin_sessions is
  'Admin console sessions by token nonce. Server-only (service role). A token is accepted only while its row exists, is unrevoked and unexpired.';
