-- ---------------------------------------------------------------------------
-- 0014 — Shipping cost and tax on the order
-- ---------------------------------------------------------------------------
-- The orders table could express subtotal, discount and total, and nothing
-- else. There was no shipping cost and no tax line, which means the shop could
-- not charge for delivery, could not offer paid express, and could not produce
-- an invoice that itemises what the customer actually paid for.
--
-- Adding these later is far more expensive than adding them now: `total` is
-- read by the Stripe amount, the receipt email, the refund cap constraint
-- (refunded_amount <= total), the tracker and the admin. Every one of those
-- has to move together, and it is much easier to move them while there are
-- almost no real orders.
--
-- ABOUT THE TAX COLUMN
--
-- It is added, and it defaults to 0, and the storefront does not show a VAT
-- line while it is zero. That is deliberate rather than unfinished.
--
-- This shop is presented throughout — in the Terms, the Refund Policy and the
-- shipping copy — as a Swiss PRIVATVERKAUF: a private individual selling their
-- own goods. A private seller is not VAT-registered and is below the CHF 100k
-- threshold that would require registration, so charging or displaying VAT
-- would be a misrepresentation, not a feature. Printing "incl. 8.1% MwSt" on a
-- receipt from an unregistered seller is the kind of detail that turns a tax
-- question into a fraud question.
--
-- The column exists so that registering for VAT later is a configuration
-- change rather than another migration through the same six call sites.
-- ---------------------------------------------------------------------------

alter table public.orders
  -- What the customer was charged for delivery. Zero is a real value: it means
  -- free shipping was earned, not that shipping was forgotten.
  add column if not exists shipping_cost numeric(12,2) not null default 0
    check (shipping_cost >= 0),

  -- Tax charged, if any. See the note above on why this stays 0 for now.
  add column if not exists tax numeric(12,2) not null default 0
    check (tax >= 0);

comment on column public.orders.shipping_cost is
  'Delivery charge applied at purchase. 0 means free shipping was earned, not absent.';
comment on column public.orders.tax is
  'Tax charged. Stays 0 while the seller trades as a non-VAT-registered Privatverkauf.';

-- ---------------------------------------------------------------------------
-- place_order — now carries the two new figures
-- ---------------------------------------------------------------------------
-- Unchanged from 0012 apart from the two columns. Repeated in full because
-- `create or replace function` has no partial form, and because a reader
-- looking at the current definition should not have to diff two migrations to
-- know what runs.
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
    subtotal, discount, shipping_cost, tax, total, promo,
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
