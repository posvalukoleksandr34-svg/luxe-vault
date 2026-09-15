-- ============================================================================
-- 0032_derived_availability.sql
-- ============================================================================
-- A product's availability tag follows its stock.
--
-- Availability lives in products.statuses as 'in_stock' / 'out_of_stock'.
-- For a product that tracks stock (has product_variants rows) it used to be
-- a separate, hand-set toggle, so the two drifted: a product marked "out of
-- stock" with 13 units on the shelf, or "in stock" with none.
--
-- From here, for every tracked product: the sum of its variant stock > 0
-- means 'in_stock', 0 means 'out_of_stock' — kept in step by a trigger on
-- every stock change, wherever it comes from: an admin save, a checkout
-- (place_order), a cancellation or refund (restore_order_stock), a payment
-- that re-takes stock (reclaim_order_stock), the inventory screen or the CSV
-- import. The admin form and the save path apply the same rule
-- (lib/availability.ts), so the tag is right before this trigger runs too.
--
-- A product WITHOUT variant rows does not track stock; its tag stays exactly
-- what the admin set. Deleting a product's last variant returns it to that
-- manual state with the tag it last had.
-- ============================================================================

create or replace function public.sync_product_availability(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_total bigint;
  v_tag   text;
  v_other text;
begin
  select count(*), coalesce(sum(greatest(v.stock, 0)), 0)
    into v_count, v_total
    from public.product_variants v
   where v.product_id = p_product_id;

  -- Untracked: the admin's own tag stands.
  if v_count = 0 then
    return;
  end if;

  v_tag   := case when v_total > 0 then 'in_stock' else 'out_of_stock' end;
  v_other := case when v_total > 0 then 'out_of_stock' else 'in_stock' end;

  -- Only when it is actually wrong, so a sale that leaves stock above zero
  -- does not rewrite the product row (and bump its updated_at) every time.
  update public.products p
     set statuses = array_append(
           array_remove(array_remove(p.statuses, 'in_stock'::text), 'out_of_stock'::text),
           v_tag
         )
   where p.id = p_product_id
     and (not (v_tag = any (p.statuses)) or v_other = any (p.statuses));
end;
$$;

revoke all on function public.sync_product_availability(uuid) from public, anon, authenticated;

comment on function public.sync_product_availability(uuid) is
  'Sets a tracked product''s in_stock / out_of_stock tag from the sum of its variant stock.';

create or replace function public.product_variants_sync_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_product_availability(old.product_id);
  else
    perform public.sync_product_availability(new.product_id);
    if tg_op = 'UPDATE' and old.product_id is distinct from new.product_id then
      perform public.sync_product_availability(old.product_id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists product_variants_sync_availability on public.product_variants;
create trigger product_variants_sync_availability
  after insert or delete or update of stock, product_id on public.product_variants
  for each row execute function public.product_variants_sync_availability();

-- Bring every tracked product in line now.
select public.sync_product_availability(p.id)
  from public.products p
 where exists (select 1 from public.product_variants v where v.product_id = p.id);
