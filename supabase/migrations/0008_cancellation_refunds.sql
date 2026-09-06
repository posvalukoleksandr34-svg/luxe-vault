-- ---------------------------------------------------------------------------
-- 0008 — Order cancellation and refunds
-- ---------------------------------------------------------------------------

-- New terminal states. Postgres will not add an enum value inside a
-- transaction that also uses it, and `if not exists` makes re-running safe.
alter type public.order_status add value if not exists 'refunded';

alter type public.payment_status add value if not exists 'refunded';
-- A partial refund is NOT 'refunded': the order keeps money against it and
-- must stay distinguishable in reporting and in the customer's history.
alter type public.payment_status add value if not exists 'partially_refunded';

-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists cancelled_reason  text,
  -- Money actually returned, in major units, matching `total`. Cumulative:
  -- several partial refunds sum here, so the column always answers "how much
  -- has this customer had back" without replaying Stripe's ledger.
  add column if not exists refunded_amount   numeric(12,2) not null default 0,
  add column if not exists refunded_at       timestamptz,
  -- Most recent Stripe refund id, for reconciliation against the dashboard.
  add column if not exists stripe_refund_id  text;

-- Refunding more than was charged is a bug, never an intent.
do $$ begin
  alter table public.orders
    add constraint orders_refunded_amount_within_total
    check (refunded_amount >= 0 and refunded_amount <= total);
exception when duplicate_object then null; end $$;

create index if not exists orders_refunded_idx
  on public.orders (refunded_at desc) where refunded_amount > 0;

-- ---------------------------------------------------------------------------
-- Timeline stamping
-- ---------------------------------------------------------------------------
-- Extends the existing trigger so `refunded` stamps its own timestamp, the
-- same way the other terminal states do. Redefined in full because CREATE OR
-- REPLACE FUNCTION has no partial form.
create or replace function public.stamp_order_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    case new.status
      when 'processing' then new.processing_at := coalesce(new.processing_at, now());
      when 'shipped'    then new.shipped_at    := coalesce(new.shipped_at, now());
      when 'delivered'  then new.delivered_at  := coalesce(new.delivered_at, now());
      when 'cancelled'  then new.cancelled_at  := coalesce(new.cancelled_at, now());
      when 'refunded'   then new.refunded_at   := coalesce(new.refunded_at, now());
      else null;
    end case;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Deliberately NO customer-facing policy for refunds.
--
-- Cancelling an UNPAID order costs nothing and is safe to self-serve, but it
-- still goes through the API route rather than a direct table write, because
-- the Stripe PaymentIntent has to be cancelled in the same operation — a row
-- flipped to 'cancelled' while its intent stays confirmable would let a
-- customer be charged for an order the shop believes is dead.
--
-- Refunds move real money OUT and stay with the service_role key, matching the
-- precedent set for returns in 0004 ("Approving and refunding stay with the
-- service_role key"). A customer-triggered refund button would let anyone
-- order, receive the goods, and refund themselves.
drop policy if exists "users cancel their own unpaid orders" on public.orders;

comment on column public.orders.refunded_amount is
  'Cumulative amount refunded, in the same units as total. Written only by the service role.';
