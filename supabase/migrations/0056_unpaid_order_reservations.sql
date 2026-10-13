-- ============================================================================
-- 0056_unpaid_order_reservations.sql
-- ============================================================================
-- Unpaid orders stop holding stock forever.
--
-- place_order() (0012) takes an order's units the moment the order is
-- created, before anything is paid — every method is paid up front, and an
-- unpaid order is kept so the customer can pay it later. Until now nothing
-- ever gave those units back except a cancellation by hand, so an abandoned
-- checkout (or a script placing orders it never meant to pay) kept pieces off
-- sale indefinitely.
--
-- THE RESERVATION LIFECYCLE
--
--   placed        units taken, payment_status 'pending_payment'
--   paying        a payment session was started (payment_session_at, below)
--   paid          the units are the customer's; never released by this
--   in flight     'confirming' (a bank debit, a crypto payment seen on chain):
--                 never released by this — money may be on its way
--   expired       still unpaid HOLD after it was placed, and no payment was
--                 started in the last GRACE, or older than CEILING whatever
--                 happened: the application cancels any open Stripe
--                 PaymentIntent FIRST, then cancels the order through the
--                 guarded cancelOrder() — units back (restore_order_stock,
--                 idempotent via restocked_at), promo use back, payment
--                 'expired'. A PaymentIntent Stripe reports as succeeded or
--                 processing is left alone: the webhook settles it.
--   paid late     a crypto payment that lands after expiry is still marked
--                 paid by the webhook, which re-takes the units
--                 (reclaim_order_stock, 0030) or alerts when they are gone.
--
-- HOLD, GRACE and CEILING are parameters, chosen by the application
-- (lib/server/reservations.ts): 48 h / 1 h / 72 h by default. This migration
-- only adds what the database has to know and answer.
--
-- Deploy order: migration first, then the code. The code without the
-- migration answers "unmigrated" and releases nothing — the old behaviour.
-- Idempotent; safe to re-run.
-- ============================================================================

-- When a payment session was last started for the order (the Stripe intent
-- route, the crypto resume route). A customer who is paying right now is not
-- interrupted by an expiry; see GRACE above.
alter table public.orders
  add column if not exists payment_session_at timestamptz;

comment on column public.orders.payment_session_at is
  'When a payment session was last started for this order. An unpaid order is not released while a payment started within the grace period.';

-- The sweep's question, kept cheap as the table grows: paid orders — eventually
-- almost all of them — are not in this index.
create index if not exists orders_unpaid_reservations_idx
  on public.orders (created_at)
  where restocked_at is null
    and status in ('pending', 'processing')
    and payment_status in ('pending_payment', 'failed', 'expired');

-- ---------------------------------------------------------------------------
-- expirable_unpaid_orders — which reservations have lapsed
-- ---------------------------------------------------------------------------
-- Read-only: it only NAMES the orders. Releasing them is the application's
-- job, through the same guarded cancellation the customer's own button uses,
-- because a card order needs its PaymentIntent cancelled at Stripe first and
-- the database cannot do that. Two overlapping sweeps are safe: cancelOrder()
-- only succeeds once (its UPDATE re-checks the state), and restore_order_stock
-- only restocks once (restocked_at).
--
-- 'expired' is included: a Stripe PaymentIntent that was cancelled
-- (payment_intent.canceled) marks the order 'expired' WITHOUT restocking it,
-- so those orders held their units too.
-- ---------------------------------------------------------------------------
create or replace function public.expirable_unpaid_orders(
  p_hold    interval default interval '48 hours',
  p_grace   interval default interval '1 hour',
  p_ceiling interval default interval '72 hours',
  p_limit   integer  default 100
)
returns table (order_number text, payment_provider text, payment_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.order_number, o.payment_provider, o.payment_id
    from public.orders o
   where o.restocked_at is null
     and o.status in ('pending', 'processing')
     and o.payment_status in ('pending_payment', 'failed', 'expired')
     and o.created_at < now() - p_hold
     and (
       o.payment_session_at is null
       or o.payment_session_at < now() - p_grace
       or o.created_at < now() - p_ceiling
     )
   order by o.created_at
   limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.expirable_unpaid_orders(interval, interval, interval, integer)
  from public, anon, authenticated;
grant execute on function public.expirable_unpaid_orders(interval, interval, interval, integer)
  to service_role;

comment on function public.expirable_unpaid_orders(interval, interval, interval, integer) is
  'Unpaid orders whose stock reservation has lapsed (hold / grace / ceiling). Read-only; the application releases them through cancelOrder().';
