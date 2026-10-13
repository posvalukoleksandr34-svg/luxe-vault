-- ============================================================================
-- 0057_coupon_line_scope.sql
-- ============================================================================
-- A product- or collection-restricted coupon discounts only the lines it is
-- restricted to.
--
-- redeem_coupon (0015) checked a restriction only as "the basket CONTAINS one
-- of these products", then computed the discount on the WHOLE subtotal: a
-- "10 % off product X" code took 10 % off everything in a basket that also
-- held X. And `collection_slugs` was stored but never read, so a code limited
-- to one collection applied to every product in the shop. No admin screen
-- sets either column today, so nothing was exploitable through the console —
-- but one SQL edit would have made it so.
--
-- From here:
--
--   * No restriction (both arrays empty): unchanged — the discount is sized
--     on p_subtotal, exactly as before.
--   * A restriction: the caller passes the basket as p_lines
--     ([{"slug": "...", "qty": n}, ...]). The function prices each line from
--     products.price itself (never a price from the request), keeps the lines
--     whose product is listed in product_slugs OR whose collection is listed
--     in collection_slugs, and sizes the discount on THAT subtotal:
--       percent  round(eligible × value / 100, 2)  — half away from zero
--       fixed    least(value, eligible)            — never more than the
--                                                   eligible lines are worth
--     No eligible line → NOT_APPLICABLE.
--   * A restriction and no p_lines (an older caller): NOT_APPLICABLE. Refusing
--     a discount is the safe direction; granting it on the whole basket was
--     the bug.
--   * A restriction naming no product or collection that exists can never
--     match anything, so it is NOT_APPLICABLE, never "unrestricted".
--
-- Minimum order totals still apply to the whole basket (p_subtotal), and usage
-- limits are still taken under the row lock, as in 0015.
--
-- Deploy order: either. The new code passes p_lines and, against the old
-- function, retries without it (lib/server/coupons.ts). Idempotent.
-- ============================================================================

-- The old five-argument function is replaced, not overloaded: two candidates
-- for the same named arguments would make PostgREST's call ambiguous.
drop function if exists public.redeem_coupon(text, numeric, uuid, text[], boolean);

create or replace function public.redeem_coupon(
  p_code text,
  p_subtotal numeric,
  p_user_id uuid default null,
  p_product_slugs text[] default '{}',
  p_commit boolean default false,
  p_lines jsonb default null
)
returns table (ok boolean, reason text, discount numeric, coupon_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.coupons%rowtype;
  v_base       numeric(12,2);
  v_discount   numeric(12,2);
  v_updated    integer;
  v_restricted boolean;
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

  if p_subtotal is null or p_subtotal < 0 then
    return query select false, 'NOT_APPLICABLE', 0::numeric, null::uuid; return;
  end if;

  if c.min_order_total is not null and p_subtotal < c.min_order_total then
    return query select false, 'BELOW_MINIMUM', 0::numeric, null::uuid; return;
  end if;

  if c.user_id is not null and (p_user_id is null or c.user_id <> p_user_id) then
    -- Same answer as a code that does not exist (0015).
    return query select false, 'NOT_FOUND', 0::numeric, null::uuid; return;
  end if;

  if c.max_redemptions is not null and c.times_used >= c.max_redemptions then
    return query select false, 'EXHAUSTED', 0::numeric, null::uuid; return;
  end if;

  v_restricted := coalesce(array_length(c.product_slugs, 1), 0) > 0
               or coalesce(array_length(c.collection_slugs, 1), 0) > 0;

  if not v_restricted then
    v_base := p_subtotal;
  else
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
      return query select false, 'NOT_APPLICABLE', 0::numeric, null::uuid; return;
    end if;

    -- The eligible lines, priced from the catalogue. Quantities are clamped
    -- the way checkout clamps them (lib/server/order-drafts.ts).
    select coalesce(sum(p.price * greatest(1, least(20, coalesce((l ->> 'qty')::integer, 1)))), 0)
      into v_base
      from jsonb_array_elements(p_lines) l
      join public.products p on p.slug = l ->> 'slug'
      left join public.collections col on col.id = p.collection_id
     where p.slug = any (c.product_slugs)
        or col.slug = any (c.collection_slugs);

    if v_base <= 0 then
      return query select false, 'NOT_APPLICABLE', 0::numeric, null::uuid; return;
    end if;
  end if;

  v_discount := case
    when c.kind = 'percent' then round(v_base * c.value / 100, 2)
    -- A fixed discount larger than what it applies to must not create a
    -- negative total, and must not become store credit either.
    else least(c.value, v_base)
  end;

  if p_commit then
    update public.coupons
       set times_used = times_used + 1
     where id = c.id
       -- Re-checked after the row lock (0015): the last redemption goes to
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

revoke all on function public.redeem_coupon(text, numeric, uuid, text[], boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.redeem_coupon(text, numeric, uuid, text[], boolean, jsonb)
  to service_role;

comment on function public.redeem_coupon(text, numeric, uuid, text[], boolean, jsonb) is
  'Validates a coupon and returns the discount; a product/collection restriction discounts only the eligible lines of p_lines, priced from products. p_commit=true also consumes a redemption, atomically.';
