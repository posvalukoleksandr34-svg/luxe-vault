-- ---------------------------------------------------------------------------
-- 0011 — Persisted delivery estimates and courier details
-- ---------------------------------------------------------------------------
-- The delivery window was computed on every render from the config in
-- lib/fulfilment.ts. That is correct for a quote, but wrong for a promise: the
-- moment someone edits the supply range, every historical order silently
-- re-dates itself, and a customer who was told "arrives 12–27 October" sees a
-- different answer the next time they look.
--
-- The window is therefore STAMPED AT PURCHASE and read back afterwards. The
-- config becomes the source for new orders only.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.shipping_type as enum ('standard', 'express');
exception when duplicate_object then null; end $$;

alter table public.orders
  add column if not exists shipping_type public.shipping_type not null default 'standard',

  -- The window quoted to THIS customer, in absolute dates. Nullable because
  -- every order placed before this migration has no stamped promise; the
  -- tracker falls back to computing one for those.
  add column if not exists delivery_estimate_min timestamptz,
  add column if not exists delivery_estimate_max timestamptz,

  -- Carrier handling the parcel. Free text rather than an enum: the shop is a
  -- private seller posting from a counter, and adding a carrier should not
  -- require a migration.
  add column if not exists courier_name text
    check (courier_name is null or char_length(btrim(courier_name)) between 1 and 60);

-- A window that ends before it starts is a bug, not an intent.
do $$ begin
  alter table public.orders
    add constraint orders_delivery_estimate_ordered
    check (
      delivery_estimate_min is null
      or delivery_estimate_max is null
      or delivery_estimate_max >= delivery_estimate_min
    );
exception when duplicate_object then null; end $$;

-- "Which orders are overdue" is the one question asked of these columns.
create index if not exists orders_delivery_due_idx
  on public.orders (delivery_estimate_max)
  where delivery_estimate_max is not null
    and status not in ('delivered', 'cancelled', 'refunded');

comment on column public.orders.delivery_estimate_min is
  'Earliest delivery date quoted at purchase. Stamped once; never recomputed.';
comment on column public.orders.courier_name is
  'Carrier name, e.g. "Swiss Post". Drives the tracking deep-link on the order page.';
