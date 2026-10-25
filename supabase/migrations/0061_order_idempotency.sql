-- ============================================================================
-- 0061_order_idempotency.sql
-- ============================================================================
-- One order per checkout attempt, however many times the browser sends it.
--
-- THE PROBLEM. The response to "Place order" can be lost after the order was
-- created (the connection drops, the phone sleeps). The customer sees an
-- error and presses the button again: a second unpaid order, its units held
-- by a second reservation for 48 hours, a second use of their coupon and a
-- second confirmation email.
--
-- THE FIX. Checkout sends a random key per attempt (the same key when it
-- re-sends the same attempt). /api/orders claims the key here BEFORE it
-- creates anything:
--
--   key free        the INSERT succeeds; this request creates the order and
--                   records its number on the row (order_number).
--   key taken,      the order exists: it is returned again, nothing is
--   order recorded  created, nothing is emailed.
--   key taken,      the first request is still working: "in progress",
--   no order yet    and the browser asks again a moment later. A claim that
--                   has had no order for 2 minutes belongs to a request that
--                   died; it may be taken over.
--
-- The primary key makes the claim atomic: two requests with one key cannot
-- both create an order. Only the key's SHA-256 is stored, so a row cannot be
-- used to fetch the order it points at.
--
-- Server-only (service role); rows older than a week are deleted by the daily
-- sweep (lib/server/retention.ts). Additive; /api/orders works as before
-- while this is not applied.
-- ============================================================================

create table if not exists public.order_idempotency (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  -- Null while the claiming request is creating the order.
  order_number text,
  created_at timestamptz not null default now()
);

create index if not exists order_idempotency_created_idx on public.order_idempotency (created_at);

alter table public.order_idempotency enable row level security;
revoke all on public.order_idempotency from anon, authenticated;
