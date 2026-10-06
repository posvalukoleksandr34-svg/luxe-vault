-- Card fraud guard: failed-attempt lockout, blocks, and fraud flags.
--
-- Stripe Radar scores and blocks payments on Stripe's side. This adds what
-- the shop itself does with Stripe's signals (lib/server/payment-fraud.ts):
--
--   * Every failed card attempt on an order is counted (wrong CVC counts
--     double). At the limit, or at once on a fraud-type decline (stolen,
--     lost, "fraudulent", blocked by Radar), the order's PaymentIntent is
--     cancelled, so the same payment form cannot be used to try more cards,
--     and card payment for the order is locked.
--   * The customer's email and IP address (hashed) are then blocked from
--     starting card payments for a while: 24 hours after too many failures,
--     30 days after a fraud-type decline.
--   * An order paid with Radar's "elevated" risk score, one that gets an
--     early fraud warning from the card network, or a dispute, is flagged for
--     the admin. Do not ship a flagged order before checking it.
--
-- All of it lives in server-only tables, NOT on public.orders: customers can
-- read their own orders, and must not read their own risk score.
--
-- Deploy order: apply before or together with the code. Without it the code
-- logs the missing tables and carries on WITHOUT the lockout (payments still
-- work; Stripe Radar still applies).
--
-- Idempotent; safe to re-run.

create table if not exists public.order_payment_risk (
  order_id          uuid primary key references public.orders (id) on delete cascade,
  card_failures     integer not null default 0,
  locked_at         timestamptz,
  lock_reason       text,
  fraud_flag        text check (fraud_flag in ('elevated_risk', 'early_fraud_warning', 'dispute')),
  fraud_flagged_at  timestamptz,
  -- HMAC of the IP address that started the card payment; never the address.
  ip_hash           text,
  updated_at        timestamptz not null default now()
);

comment on table public.order_payment_risk is
  'Server-only card-fraud state per order: failed attempts, lockout, Radar/early-fraud-warning/dispute flags. Written by the Stripe webhook.';

alter table public.order_payment_risk enable row level security;
revoke all on public.order_payment_risk from anon, authenticated;

create table if not exists public.payment_blocks (
  kind        text not null check (kind in ('email', 'ip')),
  -- Lower-cased email, or the HMAC of an IP address.
  value       text not null,
  reason      text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  primary key (kind, value)
);

comment on table public.payment_blocks is
  'Server-only: emails and (hashed) IPs refused card payments until expires_at. Expired rows are deleted by the daily retention sweep.';

create index if not exists payment_blocks_expires_idx on public.payment_blocks (expires_at);

alter table public.payment_blocks enable row level security;
revoke all on public.payment_blocks from anon, authenticated;

-- One failed attempt, counted atomically: several declines can arrive at once.
create or replace function public.record_card_failure(p_payment_id text, p_weight integer)
returns table (order_number text, failures integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_order   uuid;
  v_number  text;
  v_count   integer;
begin
  select o.id, o.order_number into v_order, v_number
    from public.orders o
   where o.payment_id = p_payment_id
   limit 1;
  if v_order is null then
    return;
  end if;

  insert into public.order_payment_risk as r (order_id, card_failures)
  values (v_order, greatest(p_weight, 1))
  on conflict (order_id) do update
    set card_failures = r.card_failures + greatest(p_weight, 1),
        updated_at = now()
  returning r.card_failures into v_count;

  return query select v_number, v_count;
end;
$$;

revoke all on function public.record_card_failure(text, integer) from public, anon, authenticated;
grant execute on function public.record_card_failure(text, integer) to service_role;