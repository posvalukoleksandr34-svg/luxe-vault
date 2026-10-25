-- ============================================================================
-- 0063_price_history.sql
-- ============================================================================
-- Every price a product is offered at, and from when — so a strike-through
-- "was" price can only ever be a price the shop really charged.
--
-- THE PROBLEM. products.old_price was a number the admin typed. Nothing tied
-- it to a price that ever applied, and the seed catalogue carried such numbers
-- for products that had never been sold at them. Swiss and EU price-indication
-- rules require a reference price to be one actually charged (lib/price-
-- reference.ts says which reading the shop applies).
--
-- WHAT THIS ADDS.
--
--   product_price_history (product_id, price, valid_from)
--     One row per price, written by a trigger whenever a product is created
--     or its price changes — by the admin, an import or the SQL editor alike.
--     Server-only: RLS on, no policies, no grants. The storefront's server
--     code computes the reference price from it.
--
--   BACKFILL: one row per existing product, at its CURRENT price, dated NOW.
--   The past is not known, so none is invented: no product shows a
--   strike-through price until a real reduction has a real history (30 days
--   of a higher price before it).
--
-- products.old_price is left in place and simply no longer read by the
-- storefront. Idempotent.
-- ============================================================================

create table if not exists public.product_price_history (
  id         bigserial primary key,
  product_id uuid not null references public.products (id) on delete cascade,
  price      numeric(12,2) not null check (price >= 0),
  valid_from timestamptz not null default now()
);

create index if not exists product_price_history_product_idx
  on public.product_price_history (product_id, valid_from desc);

alter table public.product_price_history enable row level security;
revoke all on public.product_price_history from anon, authenticated;

comment on table public.product_price_history is
  'Every price a product was offered at, from valid_from. Written by trigger only; source of the strike-through reference price.';

create or replace function public.products_record_price()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.price is distinct from old.price then
    insert into public.product_price_history (product_id, price, valid_from)
    values (new.id, new.price, now());
  end if;
  return new;
end;
$$;

drop trigger if exists products_record_price on public.products;
create trigger products_record_price
  after insert or update of price on public.products
  for each row execute function public.products_record_price();

-- Backfill: the current price, from now. Only for products with no row yet,
-- so re-running adds nothing.
insert into public.product_price_history (product_id, price, valid_from)
select p.id, p.price, now()
  from public.products p
 where not exists (select 1 from public.product_price_history h where h.product_id = p.id);
