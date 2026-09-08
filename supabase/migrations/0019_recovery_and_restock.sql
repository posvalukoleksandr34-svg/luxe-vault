-- ---------------------------------------------------------------------------
-- 0019 — Unpaid-order recovery, and back-in-stock alerts
-- ---------------------------------------------------------------------------
-- ABOUT "ABANDONED CART"
--
-- The usual abandoned-cart feature stores a shadow copy of every visitor's
-- basket server-side and mails people who never checked out. This shop does
-- not need that, and building it would be worse than what already exists.
--
-- Checkout here creates the ORDER before payment (see place_order in 0012) and
-- leaves it `pending` with payment_status `pending_payment`. So a customer who
-- reaches checkout and walks away has not left an anonymous basket — they have
-- left a real order, with their name, address, chosen items and email already
-- on it. Recovering that is more accurate than guessing from a cart snapshot,
-- and it needs no new storage of anyone's browsing.
--
-- Earlier than that — items added but checkout never reached — there is no
-- email address to write to, and harvesting one would mean tracking people who
-- never gave us anything. Not worth doing, so this migration does not.
--
-- ONE REMINDER, NOT A SEQUENCE. `recovery_sent_at` is claimed atomically, so a
-- cron that runs twice, or two instances racing, still sends once.
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists recovery_sent_at timestamptz;

comment on column public.orders.recovery_sent_at is
  'Set when the unpaid-order reminder went out. Claimed atomically so it sends once.';

-- The recovery sweep asks one question: which unpaid orders are old enough to
-- chase and have not been chased. A partial index keeps that cheap as the
-- table grows, because paid orders — eventually almost all of them — are not
-- in the index at all.
create index if not exists orders_recovery_pending_idx
  on public.orders (created_at)
  where recovery_sent_at is null
    and payment_status = 'pending_payment'
    and status = 'pending';

-- ---------------------------------------------------------------------------
-- claim_recoverable_orders — the orders to chase, claimed in one statement
-- ---------------------------------------------------------------------------
-- Stamping and selecting together is what makes this safe to call from a cron
-- that might overlap itself: the UPDATE ... RETURNING hands each order to
-- exactly one caller.
--
-- The window has both ends. Younger than `p_min_age` and the customer may
-- simply still be typing their card number; older than `p_max_age` and a
-- reminder is an unwelcome surprise about something they have forgotten.
-- ---------------------------------------------------------------------------
create or replace function public.claim_recoverable_orders(
  p_min_age interval default interval '2 hours',
  p_max_age interval default interval '7 days',
  p_limit integer default 50
)
returns setof text
language sql
security definer
set search_path = ''
as $$
  update public.orders o
     set recovery_sent_at = now()
   where o.id in (
     select id from public.orders
      where recovery_sent_at is null
        and payment_status = 'pending_payment'
        and status = 'pending'
        and customer_email is not null
        and created_at < now() - p_min_age
        and created_at > now() - p_max_age
      order by created_at
      limit p_limit
      -- Another sweep running concurrently skips these rather than blocking
      -- on them, so two overlapping runs divide the work instead of serialising.
      for update skip locked
   )
  returning o.order_number;
$$;

revoke all on function public.claim_recoverable_orders(interval, interval, integer)
  from public, anon, authenticated;

comment on function public.claim_recoverable_orders(interval, interval, integer) is
  'Claims unpaid orders due a reminder and returns their numbers. Safe to run concurrently.';

-- ---------------------------------------------------------------------------
-- Back-in-stock alerts
-- ---------------------------------------------------------------------------
-- A customer who wanted the last medium and found it gone is the single most
-- qualified lead a shop has: they chose the product, the size and the colour,
-- and the only thing that stopped them was supply.
-- ---------------------------------------------------------------------------

create table if not exists public.stock_alerts (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),

  -- Null for someone who was not signed in. The email is what the alert is
  -- sent to either way; user_id only exists so a customer can see and cancel
  -- their own alerts.
  user_id     uuid references auth.users (id) on delete cascade,
  email       text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),

  -- The exact variant, matching product_variants.
  product_id  text not null,
  size        text not null,
  color       text not null,

  -- Set when the alert fires. The row is KEPT rather than deleted, so the same
  -- person re-subscribing after a restock is a new row and the history of who
  -- was told what survives.
  notified_at timestamptz,

  -- One live alert per person per variant. Partial, so a notified row does not
  -- block re-subscribing next time it sells out.
  unique (email, product_id, size, color, notified_at)
);

create index if not exists stock_alerts_pending_idx
  on public.stock_alerts (product_id, size, color)
  where notified_at is null;

create index if not exists stock_alerts_user_idx
  on public.stock_alerts (user_id)
  where user_id is not null;

alter table public.stock_alerts enable row level security;

-- Signed-in customers may see and cancel their own alerts. Subscribing goes
-- through the server so the email cannot be set to somebody else's, and so a
-- guest without a session can still subscribe.
drop policy if exists "users read their own stock alerts" on public.stock_alerts;
create policy "users read their own stock alerts"
  on public.stock_alerts for select
  using (user_id = auth.uid());

drop policy if exists "users cancel their own stock alerts" on public.stock_alerts;
create policy "users cancel their own stock alerts"
  on public.stock_alerts for delete
  using (user_id = auth.uid());

comment on table public.stock_alerts is
  'Back-in-stock requests. Written server-side only; notified rows are kept, not deleted.';

-- ---------------------------------------------------------------------------
-- claim_restock_alerts — whose alerts are now satisfiable
-- ---------------------------------------------------------------------------
-- Joined against live stock, so an alert only fires for a variant that
-- actually has units right now. Claimed the same way as the recovery sweep, so
-- overlapping runs cannot double-send.
-- ---------------------------------------------------------------------------
create or replace function public.claim_restock_alerts(p_limit integer default 100)
returns table (email text, product_id text, size text, color text)
language sql
security definer
set search_path = ''
as $$
  update public.stock_alerts a
     set notified_at = now()
   where a.id in (
     select al.id
       from public.stock_alerts al
       join public.products p on p.slug = al.product_id
       join public.product_variants v
         on v.product_id = p.id
        and v.size = al.size
        and v.color = al.color
      where al.notified_at is null
        and v.stock > 0
      limit p_limit
      for update skip locked
   )
  returning a.email, a.product_id, a.size, a.color;
$$;

revoke all on function public.claim_restock_alerts(integer)
  from public, anon, authenticated;

comment on function public.claim_restock_alerts(integer) is
  'Claims back-in-stock alerts whose variant now has stock. Safe to run concurrently.';
