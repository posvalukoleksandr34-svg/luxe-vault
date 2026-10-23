-- ============================================================================
-- 0060_review_requests.sql
-- ============================================================================
-- Post-delivery review requests: one email per delivered order, sent a
-- configurable time (default 48 h) after delivery was confirmed.
--
-- THE LIFECYCLE (lib/review-requests.ts, lib/server/review-requests/)
--
--   scheduled   created when the order's delivery is confirmed
--               (orders.delivered_at, stamped by orders_stamp_status), due at
--               delivered_at + delay. The hourly job also creates any that a
--               missed event left out, and moves scheduled_at when a
--               corrected delivered_at arrives.
--   sending     claimed by one worker (claim_review_requests, FOR UPDATE
--               SKIP LOCKED): no second worker can take it. A claim older
--               than 30 minutes is a crashed worker; it goes back to
--               scheduled with the SAME attempt number, so the email
--               provider's idempotency key makes a resend a no-op.
--   sent        the provider accepted it. The link token is valid for a
--               while after this (token_expires_at).
--   failed      permanently: a rejected address, or retries exhausted.
--   cancelled   by staff.
--   suppressed  not sent, on purpose, with the reason in `reason`: the
--               order was cancelled or fully refunded, flagged as fraud, a
--               guest order (reviews need an account, 0052), no valid
--               address, unsubscribed, no marketing consent when that is
--               required, everything already reviewed, or too long after
--               delivery to still ask.
--
-- ONE PER ORDER: the unique index on order_id. A duplicate delivery event, a
-- re-run job or two workers at once cannot create or send a second one.
--
-- THE LINK carries a token derived on the server (HMAC of a server secret,
-- the request id and token_nonce); only its SHA-256 is stored here, so a
-- leaked row does not leak a working link.
--
-- email_suppressions: addresses that asked not to get review requests (or
-- whose address the provider rejected). Kept by address, because that is
-- what an unsubscribe is about; the row has no other personal data.
--
-- Service role only: no customer reads or writes these tables directly. The
-- review form reaches them through the server, with the token.
--
-- Additive and idempotent. Deploy order: apply before or with the code; the
-- code treats a missing table as "feature unavailable" and changes nothing.
-- ============================================================================

create table if not exists public.review_requests (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id) on delete cascade,
  -- The account the review will belong to (0052 reviews need one). Null for
  -- a guest order, or when the account was deleted.
  user_id             uuid references auth.users (id) on delete set null,
  status              text not null default 'scheduled'
                        check (status in ('scheduled', 'sending', 'sent', 'failed', 'cancelled', 'suppressed')),
  -- A code, not prose: see lib/review-requests.ts SUPPRESS_REASONS.
  reason              text check (reason is null or char_length(reason) <= 60),
  delivered_at        timestamptz not null,
  scheduled_at        timestamptz not null,
  next_attempt_at     timestamptz,
  attempts            integer not null default 0 check (attempts between 0 and 50),
  last_error          text check (last_error is null or char_length(last_error) <= 500),
  claimed_at          timestamptz,
  sent_at             timestamptz,
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) <= 200),
  token_nonce         text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  token_hash          text check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  token_expires_at    timestamptz,
  first_review_at     timestamptz,
  reviews_submitted   integer not null default 0 check (reviews_submitted >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists review_requests_order_key on public.review_requests (order_id);
create unique index if not exists review_requests_token_key on public.review_requests (token_hash)
  where token_hash is not null;
create index if not exists review_requests_due_idx on public.review_requests (coalesce(next_attempt_at, scheduled_at))
  where status = 'scheduled';
create index if not exists review_requests_status_idx on public.review_requests (status, scheduled_at desc);
create index if not exists review_requests_user_sent_idx on public.review_requests (user_id, sent_at desc)
  where sent_at is not null;

drop trigger if exists review_requests_touch on public.review_requests;
create trigger review_requests_touch
  before update on public.review_requests
  for each row execute function public.touch_updated_at();

alter table public.review_requests enable row level security;
revoke all on public.review_requests from anon, authenticated;

comment on table public.review_requests is
  'Post-delivery review request emails, one per order (0060). Service role only; see lib/server/review-requests/.';

create table if not exists public.email_suppressions (
  email       text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 320),
  kind        text not null check (kind in ('review_requests')),
  reason      text not null check (reason in ('unsubscribed', 'bounced', 'invalid', 'admin')),
  created_at  timestamptz not null default now(),
  primary key (email, kind)
);

alter table public.email_suppressions enable row level security;
revoke all on public.email_suppressions from anon, authenticated;

comment on table public.email_suppressions is
  'Addresses that must not receive a kind of optional email (0060): unsubscribed, bounced or rejected. Service role only.';

-- ------------------------------------------------------------ claiming ----
-- Takes up to p_limit due requests for ONE worker. FOR UPDATE SKIP LOCKED:
-- concurrent workers get disjoint sets, never the same row. A claim older
-- than p_stale is a worker that died mid-send; it returns to scheduled with
-- its attempt number unchanged (the provider idempotency key repeats).
create or replace function public.claim_review_requests(p_limit integer, p_stale interval default interval '30 minutes')
returns setof public.review_requests
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.review_requests
     set status = 'scheduled', claimed_at = null
   where status = 'sending'
     and claimed_at < now() - p_stale;

  return query
  update public.review_requests r
     set status = 'sending', claimed_at = now()
   where r.id in (
     select q.id
       from public.review_requests q
      where q.status = 'scheduled'
        and coalesce(q.next_attempt_at, q.scheduled_at) <= now()
      order by coalesce(q.next_attempt_at, q.scheduled_at)
      limit greatest(1, least(coalesce(p_limit, 25), 200))
      for update skip locked
   )
  returning r.*;
end;
$$;

revoke all on function public.claim_review_requests(integer, interval) from public, anon, authenticated;
grant execute on function public.claim_review_requests(integer, interval) to service_role;

comment on function public.claim_review_requests(integer, interval) is
  'Claims due review requests for one worker (SKIP LOCKED) and returns crashed claims to the queue (0060).';
