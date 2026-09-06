-- ---------------------------------------------------------------------------
-- 0009 — Payment receipt de-duplication
-- ---------------------------------------------------------------------------
-- Stripe delivers webhooks AT LEAST ONCE, not exactly once. It retries on any
-- non-2xx, on a timeout, and occasionally re-delivers an event that already
-- succeeded. Without a persisted marker, every retry of
-- `payment_intent.succeeded` would send the customer another receipt.
--
-- An in-memory guard is not enough: serverless handlers are per-invocation, so
-- two concurrent deliveries land in two isolated processes that cannot see
-- each other. The claim has to happen in the database.
--
-- Read the pairing with the send in lib/server/orders-store.ts@claimReceiptSend:
-- the row is claimed with a conditional UPDATE first, and the email is sent
-- only by whoever won that update.
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists receipt_sent_at timestamptz;

comment on column public.orders.receipt_sent_at is
  'When the payment receipt was sent. Claimed atomically before sending so a Stripe webhook retry cannot send a second copy.';

-- Partial index: the only question ever asked of this column is "which paid
-- orders never got a receipt", so indexing the nulls is what pays off.
create index if not exists orders_receipt_pending_idx
  on public.orders (created_at desc)
  where receipt_sent_at is null;
