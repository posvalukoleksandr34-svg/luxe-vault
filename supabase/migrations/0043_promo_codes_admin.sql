-- ============================================================================
-- 0043_promo_codes_admin.sql
-- ============================================================================
-- Promo codes as run from /admin/promocodes, and the personal code the
-- installed app issues. Builds on `coupons` (0015), which already holds the
-- code, the discount (percent or fixed), the active flag, the expiry, the
-- usage limit (max_redemptions) and the count (times_used). Adds:
--
--   coupons.valid_for_days  how long a code lasts from the moment it is issued.
--                           For an admin code the expiry is computed from it at
--                           creation; for an app code, at issue. Kept so the
--                           list can say "30 days" rather than only a date.
--
--   coupons.source          'admin' (made in /admin/promocodes) or 'app_welcome'
--                           (issued to one customer by the installed app). At
--                           most one app code per customer, enforced below.
--
--   orders.coupon_released_at
--                           A USE THAT CAME BACK. A use is counted when the order
--                           is placed, in the same transaction (redeem_coupon via
--                           place_order), because that is the only way a limit of
--                           100 stays 100 when two people take the last slot at
--                           once. An order that is never paid gives its use back:
--                             * cancelled, or its payment expired → at once
--                             * still unpaid after 48 hours → the nightly sweep
--                           If such an order is paid after all, the use is taken
--                           again (reclaim_order_coupon). The count then settles
--                           on the orders that were actually paid.
--
-- Access: server only, through the service role, like 0015.
-- ============================================================================

alter table public.coupons
  add column if not exists valid_for_days integer
    check (valid_for_days is null or valid_for_days between 1 and 3650),
  add column if not exists source text not null default 'admin'
    check (source in ('admin', 'app_welcome'));

-- One app code per customer, whatever races the first launch.
create unique index if not exists coupons_app_welcome_user_key
  on public.coupons (user_id)
  where source = 'app_welcome';

alter table public.orders
  add column if not exists coupon_released_at timestamptz;

-- The sweep's candidates: unpaid orders still holding a use.
create index if not exists orders_coupon_held_idx
  on public.orders (created_at)
  where coupon_id is not null and coupon_released_at is null;

-- ------------------------------------------------------------ functions --

/**
 * Gives an order's coupon use back. Idempotent: the order is stamped in the
 * same statement that finds it, so a second call (a replayed webhook, the
 * sweep and a cancel together) returns false and changes nothing.
 */
create or replace function public.release_order_coupon(p_order_number text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coupon_id uuid;
begin
  update public.orders
     set coupon_released_at = now()
   where order_number = p_order_number
     and coupon_id is not null
     and coupon_released_at is null
  returning coupon_id into v_coupon_id;

  if v_coupon_id is null then
    return false;
  end if;

  update public.coupons
     set times_used = greatest(times_used - 1, 0),
         updated_at = now()
   where id = v_coupon_id;
  return true;
end;
$$;

/**
 * An order whose use had been given back was paid after all: count it again.
 * Deliberately NOT capped at max_redemptions — the customer has the discount
 * and has paid; the count must say so, even if that puts it one over.
 */
create or replace function public.reclaim_order_coupon(p_order_number text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coupon_id uuid;
begin
  update public.orders
     set coupon_released_at = null
   where order_number = p_order_number
     and coupon_id is not null
     and coupon_released_at is not null
  returning coupon_id into v_coupon_id;

  if v_coupon_id is null then
    return false;
  end if;

  update public.coupons
     set times_used = times_used + 1,
         updated_at = now()
   where id = v_coupon_id;
  return true;
end;
$$;

/**
 * The nightly sweep: gives back the uses held by orders that have waited
 * longer than `p_older_than` without being paid. Returns how many.
 * `for update skip locked` so two overlapping sweeps divide the rows.
 */
create or replace function public.release_stale_coupon_holds(p_older_than interval default interval '48 hours')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order text;
  v_count integer := 0;
begin
  for v_order in
    select o.order_number
      from public.orders o
     where o.coupon_id is not null
       and o.coupon_released_at is null
       and o.created_at < now() - p_older_than
       and (o.payment_status is null or o.payment_status in ('pending_payment', 'failed'))
       and o.status <> 'cancelled'
     order by o.created_at
     limit 500
     for update skip locked
  loop
    if public.release_order_coupon(v_order) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.release_order_coupon(text) from public, anon, authenticated;
revoke all on function public.reclaim_order_coupon(text) from public, anon, authenticated;
revoke all on function public.release_stale_coupon_holds(interval) from public, anon, authenticated;
