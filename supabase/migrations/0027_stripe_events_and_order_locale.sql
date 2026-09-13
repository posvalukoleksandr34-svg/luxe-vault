-- ============================================================================
-- 0027_stripe_events_and_order_locale.sql
--
-- 1. stripe_events — the webhook's idempotency ledger.
--
--    Stripe delivers every event AT LEAST once: a timeout, a slow response or
--    a manual "resend" in the dashboard all deliver the same event again,
--    sometimes to two serverless instances at the same moment. The handlers
--    were already safe to repeat (status writes are idempotent, the receipt
--    has its own claim), but "safe to repeat" is not "processed once" — a
--    refund sync or a one-off email must run exactly once per event.
--
--    The webhook inserts the event id BEFORE doing any work. The primary key
--    makes the insert the claim: exactly one delivery succeeds, every other
--    one gets a unique violation and is acknowledged without reprocessing.
--    A delivery that then fails deletes its row, so Stripe's retry can claim
--    it again.
--
--    Also used for one-off email claims ("payment failed" once per order),
--    under ids like 'email:payment_failed:LV-ABC123'.
--
-- 2. orders.locale — the storefront language the order was placed in, so the
--    transactional emails about it arrive in that language.
--
-- Safe to run more than once. The application works without this migration
-- (it logs a warning and falls back), but applying it is what turns the
-- guarantees on.
-- ============================================================================

create table if not exists public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

comment on table public.stripe_events is
  'Stripe webhook events already claimed for processing (idempotency ledger), plus one-off email claims.';

-- Old rows are only useful for as long as Stripe might redeliver (days). An
-- index on the timestamp keeps an occasional cleanup cheap:
--   delete from public.stripe_events where received_at < now() - interval '90 days';
create index if not exists stripe_events_received_idx on public.stripe_events (received_at);

-- Service role only. No policies: nothing in a browser has any business
-- reading or writing this table.
alter table public.stripe_events enable row level security;


alter table public.orders
  add column if not exists locale text
  check (locale is null or locale in ('ru', 'en', 'it', 'fr', 'de'));

comment on column public.orders.locale is
  'Storefront language at checkout. Transactional emails about the order use it; null falls back to English.';
