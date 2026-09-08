-- ---------------------------------------------------------------------------
-- 0015 — Coupons
-- ---------------------------------------------------------------------------
-- Discount codes were two entries in a TypeScript array:
--
--   SEED_PROMOS = [{ code: 'LUXE10', percent: 10, active: true }, ...]
--
-- Percentage only. No expiry, so a launch promotion ran forever. No usage
-- limit, so a code shared on a deals forum could be redeemed unboundedly. No
-- minimum order, so a CHF 20 basket took the same 20% as a CHF 2000 one. No
-- scoping, so a code meant for one collection applied to everything. And
-- changing any of it needed a deploy — the admin panel's "promos" tab edited
-- an in-memory array that reset on the next cold start.
--
-- REDEMPTION IS COUNTED, NOT TRUSTED
--
-- `times_used` is incremented inside redeem_coupon() with the same
-- `where times_used < max_redemptions` predicate trick that guards stock in
-- 0012 — two people racing to spend the last redemption of a code cannot both
-- win. A coupon is money; it deserves the same treatment as inventory.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.discount_kind as enum ('percent', 'fixed');
exception when duplicate_object then null; end $$;

create table if not exists public.coupons (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Stored upper-case; the storefront upper-cases input before looking up, so
  -- "luxe10" and "LUXE10" are the same coupon rather than two.
  code        text not null unique
                check (code = upper(code) and char_length(btrim(code)) between 3 and 32),

  kind        public.discount_kind not null default 'percent',

  -- Percent (1-100) when kind='percent', else an absolute amount in CHF.
  -- One column rather than two: a coupon has exactly one value, and two
  -- nullable columns would allow a row that is both and a row that is neither.
  value       numeric(12,2) not null check (value > 0),

  active      boolean not null default true,

  -- Null means no constraint. Nullable rather than sentinel values (0, 9999,
  -- year 2999) so "unlimited" is unambiguous in the data.
  starts_at        timestamptz,
  expires_at       timestamptz,
  min_order_total  numeric(12,2) check (min_order_total is null or min_order_total >= 0),
  max_redemptions  integer check (max_redemptions is null or max_redemptions > 0),

  times_used  integer not null default 0 check (times_used >= 0),

  -- Scoping. Empty array means "applies to everything", which is the common
  -- case and therefore the default.
  product_slugs    text[] not null default '{}',
  collection_slugs text[] not null default '{}',

  -- A code issued to one customer (a goodwill gesture, an influencer). Null
  -- means anyone may use it.
  user_id     uuid references auth.users (id) on delete cascade,

  -- A percentage over 100 is always a typo, and would produce a negative total.
  constraint coupons_percent_range
    check (kind <> 'percent' or (value > 0 and value <= 100)),

  -- A window that closes before it opens is a mistake, not an intent.
  constraint coupons_window_ordered
    check (starts_at is null or expires_at is null or expires_at > starts_at)
);

create index if not exists coupons_active_idx
  on public.coupons (code)
  where active;

create index if not exists coupons_user_idx
  on public.coupons (user_id)
  where user_id is not null;

drop trigger if exists coupons_touch_updated_at on public.coupons;
create trigger coupons_touch_updated_at
  before update on public.coupons
  for each row execute function public.touch_updated_at();

alter table public.coupons enable row level security;

-- No policies. Coupons are read and redeemed only through the service role:
-- a client that could SELECT this table could enumerate every unpublished
-- code, and one that could UPDATE it could reset its own redemption count.

comment on table public.coupons is
  'Discount codes. Validated and redeemed server-side only; never readable by a client.';
comment on column public.coupons.times_used is
  'Redemptions so far. Incremented atomically by redeem_coupon() against max_redemptions.';

-- Which order used which code, so redemptions can be audited and a refunded
-- order's coupon can be released later if that policy is ever wanted.
alter table public.orders
  add column if not exists coupon_id uuid references public.coupons (id) on delete set null;

create index if not exists orders_coupon_idx
  on public.orders (coupon_id)
  where coupon_id is not null;

-- ---------------------------------------------------------------------------
-- redeem_coupon — validate and consume in one statement
-- ---------------------------------------------------------------------------
-- Returns the discount to apply, or a reason. The reason is a stable code
-- rather than prose so the API can translate it; the storefront speaks five
-- languages and an English sentence from Postgres would leak into all of them.
--
-- `p_commit = false` validates without consuming, which is what the "apply
-- code" button in the cart needs — a customer trying a code has not bought
-- anything yet, and burning a redemption on a preview would exhaust
-- single-use codes before they were ever used.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_coupon(
  p_code text,
  p_subtotal numeric,
  p_user_id uuid default null,
  p_product_slugs text[] default '{}',
  p_commit boolean default false
)
returns table (ok boolean, reason text, discount numeric, coupon_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.coupons%rowtype;
  v_discount numeric(12,2);
  v_updated  integer;
begin
  select * into c from public.coupons where code = upper(btrim(p_code));

  if not found then
    return query select false, 'NOT_FOUND', 0::numeric, null::uuid; return;
  end if;

  if not c.active then
    return query select false, 'INACTIVE', 0::numeric, null::uuid; return;
  end if;

  if c.starts_at is not null and now() < c.starts_at then
    return query select false, 'NOT_STARTED', 0::numeric, null::uuid; return;
  end if;

  if c.expires_at is not null and now() >= c.expires_at then
    return query select false, 'EXPIRED', 0::numeric, null::uuid; return;
  end if;

  if c.min_order_total is not null and p_subtotal < c.min_order_total then
    return query select false, 'BELOW_MINIMUM', 0::numeric, null::uuid; return;
  end if;

  if c.user_id is not null and (p_user_id is null or c.user_id <> p_user_id) then
    -- Deliberately the same answer as a code that does not exist: telling a
    -- stranger "this code is real but not yours" is an invitation to hunt for
    -- codes that are.
    return query select false, 'NOT_FOUND', 0::numeric, null::uuid; return;
  end if;

  if c.max_redemptions is not null and c.times_used >= c.max_redemptions then
    return query select false, 'EXHAUSTED', 0::numeric, null::uuid; return;
  end if;

  if array_length(c.product_slugs, 1) is not null
     and not (p_product_slugs && c.product_slugs) then
    return query select false, 'NOT_APPLICABLE', 0::numeric, null::uuid; return;
  end if;

  v_discount := case
    when c.kind = 'percent' then round(p_subtotal * c.value / 100, 2)
    -- A fixed discount larger than the basket must not create a negative
    -- total, and must not become store credit either.
    else least(c.value, p_subtotal)
  end;

  if p_commit then
    update public.coupons
       set times_used = times_used + 1
     where id = c.id
       -- Same guard shape as the stock decrement in 0012: the predicate is
       -- re-checked after the row lock, so the last redemption goes to
       -- exactly one of two simultaneous claimants.
       and (max_redemptions is null or times_used < max_redemptions);

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      return query select false, 'EXHAUSTED', 0::numeric, null::uuid; return;
    end if;
  end if;

  return query select true, 'OK', v_discount, c.id;
end;
$$;

revoke all on function public.redeem_coupon(text, numeric, uuid, text[], boolean)
  from public, anon, authenticated;

comment on function public.redeem_coupon(text, numeric, uuid, text[], boolean) is
  'Validates a coupon and returns the discount. p_commit=true also consumes a redemption, atomically.';

-- Carry the two codes that were hardcoded in lib/data.ts, so nothing a
-- customer may already be holding stops working the moment this lands.
insert into public.coupons (code, kind, value, active)
values ('LUXE10', 'percent', 10, true),
       ('VAULT20', 'percent', 20, true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- place_order — now also records which coupon was redeemed
-- ---------------------------------------------------------------------------
-- Superseding definition. Identical to 0014 apart from coupon_id, which links
-- the order to the row whose times_used it consumed; without it a redemption
-- count can never be reconciled against the orders that caused it.
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_order jsonb,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_item     jsonb;
  v_updated  integer;
  v_tracked  boolean;
begin
  insert into public.orders (
    order_number, user_id, lookup_token, status,
    customer_name, customer_email, customer_phone,
    address_line, street, postal_code, city, country,
    subtotal, discount, shipping_cost, tax, total, promo, coupon_id,
    payment, payment_status,
    shipping_type, delivery_estimate_min, delivery_estimate_max
  )
  values (
    p_order ->> 'order_number',
    nullif(p_order ->> 'user_id', '')::uuid,
    p_order ->> 'lookup_token',
    coalesce((p_order ->> 'status')::public.order_status, 'pending'),
    p_order ->> 'customer_name',
    nullif(p_order ->> 'customer_email', ''),
    p_order ->> 'customer_phone',
    p_order ->> 'address_line',
    nullif(p_order ->> 'street', ''),
    nullif(p_order ->> 'postal_code', ''),
    nullif(p_order ->> 'city', ''),
    nullif(p_order ->> 'country', ''),
    (p_order ->> 'subtotal')::numeric,
    coalesce((p_order ->> 'discount')::numeric, 0),
    coalesce((p_order ->> 'shipping_cost')::numeric, 0),
    coalesce((p_order ->> 'tax')::numeric, 0),
    (p_order ->> 'total')::numeric,
    nullif(p_order ->> 'promo', ''),
    nullif(p_order ->> 'coupon_id', '')::uuid,
    p_order ->> 'payment',
    nullif(p_order ->> 'payment_status', '')::public.payment_status,
    coalesce((p_order ->> 'shipping_type')::public.shipping_type, 'standard'),
    nullif(p_order ->> 'delivery_estimate_min', '')::timestamptz,
    nullif(p_order ->> 'delivery_estimate_max', '')::timestamptz
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      order_id, product_id, name, image, unit_price, size, color, qty
    )
    values (
      v_order_id,
      v_item ->> 'product_id',
      v_item ->> 'name',
      nullif(v_item ->> 'image', ''),
      (v_item ->> 'unit_price')::numeric,
      v_item ->> 'size',
      v_item ->> 'color',
      (v_item ->> 'qty')::integer
    );

    -- `stock >= qty` in the WHERE is what makes this safe under concurrency:
    -- the row lock is taken first and the predicate re-checked against the
    -- committed value, so the second of two simultaneous buyers matches
    -- nothing instead of both succeeding. See 0012.
    update public.product_variants v
       set stock = v.stock - (v_item ->> 'qty')::integer
     where v.product_id = (
             select p.id from public.products p
              where p.slug = v_item ->> 'product_id'
           )
       and v.size = v_item ->> 'size'
       and v.color = v_item ->> 'color'
       and v.stock >= (v_item ->> 'qty')::integer;

    get diagnostics v_updated = row_count;

    if v_updated = 0 then
      select exists (
        select 1
          from public.product_variants v
          join public.products p on p.id = v.product_id
         where p.slug = v_item ->> 'product_id'
      ) into v_tracked;

      if v_tracked then
        raise exception 'INSUFFICIENT_STOCK: % (%, %)',
          v_item ->> 'name', v_item ->> 'size', v_item ->> 'color'
          using errcode = 'P0001';
      end if;
    end if;
  end loop;

  return v_order_id;
end;
$$;

revoke all on function public.place_order(jsonb, jsonb) from public, anon, authenticated;
