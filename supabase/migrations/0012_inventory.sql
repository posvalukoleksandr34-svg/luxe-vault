-- ---------------------------------------------------------------------------
-- 0012 — Real inventory, with the oversell guard in the database
-- ---------------------------------------------------------------------------
-- Stock previously lived as a `stock` number inside the `colors` JSONB blob on
-- each product. It drove the low-stock and sold-out badges, so the storefront
-- looked like it tracked inventory — but nothing anywhere decremented it. Not
-- the order route, not the Stripe webhook, not the crypto webhook. It changed
-- only when an admin retyped it.
--
-- Two consequences. A limited item could be sold to an unlimited number of
-- customers, and the badges were wrong the moment the first order landed.
--
-- WHY A TABLE AND NOT A JSONB FIELD
--
-- The fix is not "decrement the JSON from application code". Two checkouts for
-- the last item both read `stock: 1`, both compute 0, and both write it. The
-- read and the write are separate round-trips, so no amount of care in
-- TypeScript closes that window — the guarantee has to come from Postgres.
--
-- Here it comes from two things working together:
--
--   1. `check (stock >= 0)` on a real column. A transaction that would take
--      stock negative is rejected outright. This is the backstop; it cannot be
--      bypassed by any code path, including a future one nobody has written.
--
--   2. `update ... where stock >= qty` inside place_order(). Under READ
--      COMMITTED, an UPDATE re-evaluates its WHERE clause after taking the row
--      lock, so the second of two concurrent buyers sees the first buyer's
--      decrement and matches zero rows — which is raised as a clean
--      "insufficient stock" rather than a constraint violation.
--
-- WHY (product, size, colour) AND NOT JUST COLOUR
--
-- The admin UI tracked stock per colour, but what a customer actually buys is
-- a size in a colour. Selling the last M because there are three L in stock is
-- the failure this table exists to prevent.
--
-- UNTRACKED PRODUCTS STAY UNTRACKED
--
-- A product with no rows here is not "out of stock" — it is a product whose
-- stock nobody is counting, and it sells exactly as it did before. That is
-- what makes this migration safe to apply to a live catalogue: nothing changes
-- until an admin actually enters quantities.
-- ---------------------------------------------------------------------------

create table if not exists public.product_variants (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  product_id  uuid not null references public.products (id) on delete cascade,

  -- Matched against order_items.size / .color, which are plain text captured
  -- from the customer's selection.
  size        text not null check (char_length(btrim(size)) between 1 and 40),
  color       text not null check (char_length(btrim(color)) between 1 and 60),

  -- Stock-keeping unit. Nullable because the catalogue predates it; unique
  -- when present so two variants can never claim the same code.
  sku         text check (sku is null or char_length(btrim(sku)) between 1 and 64),

  -- THE GUARD. Everything else in this file is a convenience around it.
  stock       integer not null default 0 check (stock >= 0),

  -- Below this, the storefront shows "only N left". Per-variant rather than a
  -- global constant: five shirts is plenty, five of a limited watch is not.
  low_stock_at integer not null default 5 check (low_stock_at >= 0),

  unique (product_id, size, color)
);

create unique index if not exists product_variants_sku_key
  on public.product_variants (sku)
  where sku is not null;

-- The storefront's question is always "what is left for this product".
create index if not exists product_variants_product_idx
  on public.product_variants (product_id);

-- The admin's question is "what am I about to run out of".
create index if not exists product_variants_low_idx
  on public.product_variants (product_id, stock)
  where stock <= 5;

drop trigger if exists product_variants_touch_updated_at on public.product_variants;
create trigger product_variants_touch_updated_at
  before update on public.product_variants
  for each row execute function public.touch_updated_at();

alter table public.product_variants enable row level security;

-- Availability is public information — it is rendered on the product page.
-- Writes are service-role only, which bypasses RLS, so no write policy exists
-- and none should: a customer must never be able to set their own stock.
drop policy if exists "variant stock is publicly readable" on public.product_variants;
create policy "variant stock is publicly readable"
  on public.product_variants for select
  using (true);

comment on table public.product_variants is
  'Per (product, size, colour) stock. The check (stock >= 0) is the oversell guard.';
comment on column public.product_variants.stock is
  'Units on hand. Decremented by place_order(), restored by restore_order_stock().';

-- ---------------------------------------------------------------------------
-- place_order — order, items and stock in ONE transaction
-- ---------------------------------------------------------------------------
-- Replaces two separate inserts from the application plus a compensating
-- delete when the second failed. A function body is a single transaction, so
-- a failure anywhere — a bad item, an unavailable variant, a constraint — rolls
-- the whole thing back and leaves no phantom order behind.
--
-- SECURITY DEFINER with an empty search_path, matching the other functions in
-- this schema: it is called with the service-role key from the server only,
-- and the empty search_path stops a hijacked `public` from being resolved to
-- something else.
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
    subtotal, discount, total, promo,
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
    (p_order ->> 'total')::numeric,
    nullif(p_order ->> 'promo', ''),
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

    -- Decrement the matching variant. `stock >= qty` in the WHERE clause is
    -- what makes this safe under concurrency: the row lock is taken first and
    -- the predicate is then re-checked against the committed value, so the
    -- second of two simultaneous buyers matches nothing instead of both
    -- succeeding.
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
      -- Nothing was decremented. Either this product is untracked (fine, and
      -- the common case for a catalogue that has not entered quantities yet)
      -- or there genuinely is not enough left.
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

comment on function public.place_order(jsonb, jsonb) is
  'Creates an order, its items and decrements variant stock atomically. Raises P0001 INSUFFICIENT_STOCK when a tracked variant cannot cover the quantity.';

-- ---------------------------------------------------------------------------
-- restore_order_stock — put the units back
-- ---------------------------------------------------------------------------
-- Called when an order is cancelled or refunded. Idempotent through the
-- `restocked_at` stamp: cancelling an already-cancelled order, or a webhook
-- delivered twice, must not credit the same units repeatedly.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists restocked_at timestamptz;

comment on column public.orders.restocked_at is
  'Set when this order''s units were returned to stock. Guards against double restocking.';

create or replace function public.restore_order_stock(p_order_number text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
begin
  -- Claim the order for restocking. The WHERE clause doing the idempotency
  -- means two concurrent callers cannot both win.
  update public.orders
     set restocked_at = now()
   where order_number = p_order_number
     and restocked_at is null
  returning id into v_order_id;

  if v_order_id is null then
    return false;
  end if;

  update public.product_variants v
     set stock = v.stock + i.qty
    from public.order_items i
    join public.products p on p.slug = i.product_id
   where i.order_id = v_order_id
     and v.product_id = p.id
     and v.size = i.size
     and v.color = i.color;

  return true;
end;
$$;

revoke all on function public.restore_order_stock(text) from public, anon, authenticated;

comment on function public.restore_order_stock(text) is
  'Returns a cancelled or refunded order''s units to stock. Idempotent via orders.restocked_at.';
