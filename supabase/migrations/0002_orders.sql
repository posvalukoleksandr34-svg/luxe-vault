-- ============================================================================
-- 0002_orders.sql  —  STEP 2 & 3: orders, user binding, statuses, tracking
--
-- Run AFTER 0001_profiles.sql.
--
-- Design notes:
--   * user_id is NULLABLE on purpose. Guest checkout works today (the checkout
--     panel never reads the session), and forcing registration mid-purchase
--     would be a conversion regression. Signed-in orders get a user_id;
--     guest orders fall back to lookup_token, exactly as the app does now.
--   * Human-readable LV-XXXXXX lives in `order_number`, not the primary key,
--     so foreign keys stay on a stable uuid.
--   * Money is numeric(12,2), never float. Binary floats cannot represent
--     0.1 exactly and silently drift once you sum a cart.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums ----
-- The English statuses replacing the old Russian union
-- ('В обработке' | 'Отправлен' | 'Доставлен' | 'Отменён').
do $$ begin
  create type public.order_status as enum
    ('pending', 'processing', 'shipped', 'delivered', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum
    ('pending_payment', 'confirming', 'paid', 'failed', 'expired');
exception when duplicate_object then null; end $$;


-- --------------------------------------------------------------- orders ----
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  order_number  text not null unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Null for guest checkout; set to auth.uid() when the buyer is signed in.
  -- ON DELETE SET NULL, not CASCADE: deleting an account must never destroy
  -- financial records.
  user_id       uuid references auth.users (id) on delete set null,

  -- Per-order secret for guest access, mirroring the existing lookupToken.
  lookup_token  text not null,

  status        public.order_status not null default 'pending',

  -- Carrier reference, surfaced on /order/[number] once status = 'shipped'.
  tracking_number text check (tracking_number is null
                              or char_length(btrim(tracking_number)) between 4 and 64),

  -- Status timeline, stamped automatically by the trigger below. These drive
  -- the customer-facing progress bar without needing an audit table.
  processing_at timestamptz,
  shipped_at    timestamptz,
  delivered_at  timestamptz,
  cancelled_at  timestamptz,

  -- Contact + shipping snapshot, captured at purchase time. Deliberately
  -- denormalised: if the customer later edits their profile, the address this
  -- parcel was actually sent to must not change retroactively.
  customer_name   text not null,
  customer_email  text,
  customer_phone  text not null,
  address_line    text not null,
  street          text,
  postal_code     text,
  city            text,
  country         text,

  subtotal      numeric(12,2) not null check (subtotal >= 0),
  discount      numeric(12,2) not null default 0 check (discount >= 0),
  total         numeric(12,2) not null check (total >= 0),
  currency      text not null default 'CHF',
  promo         text,

  payment       text not null,
  payment_status    public.payment_status,
  payment_provider  text,
  payment_id        text,
  payment_currency  text,
  payment_address   text,
  payment_amount    numeric(24,8)
);

create index if not exists orders_user_id_created_idx
  on public.orders (user_id, created_at desc) where user_id is not null;
create index if not exists orders_status_idx        on public.orders (status);
create index if not exists orders_order_number_idx  on public.orders (order_number);
create index if not exists orders_unpaid_idx
  on public.orders (payment_status) where payment_status is not null
                                      and payment_status <> 'paid';


-- ---------------------------------------------------------- order_items ----
create table if not exists public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,

  -- Slug from lib/data.ts (e.g. 'p-hoodie-noir'), NOT a uuid: the catalogue
  -- still lives in code. When products move into Postgres this becomes a real
  -- FK — until then an FK here would be a lie.
  product_id  text not null,

  -- Snapshot of name/image/price at purchase time, so historical orders keep
  -- rendering correctly after the catalogue is edited or an item is deleted.
  name        text not null,
  image       text,
  unit_price  numeric(12,2) not null check (unit_price >= 0),
  size        text not null,
  color       text not null,
  qty         integer not null check (qty > 0)
);

create index if not exists order_items_order_id_idx on public.order_items (order_id);


-- --------------------------------------------------- status timestamping ----
-- Stamps the timeline column matching the new status. Only ever writes a
-- column that is still null, so re-entering a status (or an admin correcting a
-- mistake) never rewrites the original transition time.
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
      else null;
    end case;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists orders_stamp_status on public.orders;
create trigger orders_stamp_status
  before update on public.orders
  for each row execute function public.stamp_order_status();


-- ------------------------------------------------------------------ RLS ----
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- A signed-in customer sees their own orders. Guest orders (user_id is null)
-- match nobody here and are reachable only through the server, which checks
-- the lookup_token — so a token cannot be bypassed by querying directly.
drop policy if exists "users read their own orders" on public.orders;
create policy "users read their own orders"
  on public.orders for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "users read their own order items" on public.order_items;
create policy "users read their own order items"
  on public.order_items for select
  to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_items.order_id and o.user_id = auth.uid()
  ));

-- No insert/update/delete policies on purpose. Orders are written only by the
-- server using the service-role key, which bypasses RLS: totals, status and
-- tracking numbers must never be settable from a browser.
