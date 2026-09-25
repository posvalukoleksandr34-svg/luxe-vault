-- ============================================================================
-- 0044_production_indexes.sql
-- ============================================================================
-- Pre-launch audit: indexes for the lookups that run on every payment, every
-- checkout with a referral code and every product page, one duplicate index
-- removed, and the function that gives back a promo-code use when the order
-- it was taken for could not be created.
--
-- Every index is IF NOT EXISTS and built on small tables, so the migration is
-- safe to re-run and takes no noticeable lock today. (On a large table, build
-- them with CREATE INDEX CONCURRENTLY outside a transaction instead.)
-- ============================================================================

-- ---------------------------------------------------------------- orders --

-- Every Stripe and NOWPayments webhook finds its order by payment_id
-- (setPaymentStatus, findOrderByPaymentId). Without an index each delivery
-- scans the whole orders table. UNIQUE as well: one payment belongs to one
-- order, and the database should refuse a second — checked before writing
-- this: no two orders share a payment_id today.
create unique index if not exists orders_payment_id_key
  on public.orders (payment_id)
  where payment_id is not null;

-- The referral first-order check looks orders up by the buyer's email
-- (lib/server/referrals.ts, hasPreviousOrder) on every checkout that uses a
-- referral code.
create index if not exists orders_customer_email_idx
  on public.orders (customer_email)
  where customer_email is not null;

-- The admin order list, the customers page and the sweep read orders newest
-- first with no other filter.
create index if not exists orders_created_at_idx
  on public.orders (created_at desc);

-- A duplicate: order_number is declared UNIQUE in 0002, which already gives
-- it an index. This second one only costs every insert a second write.
drop index if exists public.orders_order_number_idx;

-- ----------------------------------------------------------- order_items --

-- "How do other buyers find the fit" on the product page
-- (lib/server/size-stats.ts) reads order_items by product_id.
create index if not exists order_items_product_id_idx
  on public.order_items (product_id);

-- ------------------------------------------------------- return_requests --

-- Foreign key to orders (ON DELETE CASCADE). The existing unique index
-- covers only open requests, so deleting an order had to scan the table to
-- find closed ones.
create index if not exists return_requests_order_id_idx
  on public.return_requests (order_id);

-- --------------------------------------------------------------- coupons --

/**
 * Gives back one use of a coupon taken for an order that was then NOT
 * created — the stock ran out between the redemption and place_order(), or
 * the insert failed. Without this, a limited code ("the first 100") loses a
 * use to every failed checkout, which is exactly what happens in a rush.
 *
 * Only for that case: an order that exists gives its use back through
 * release_order_coupon() (0043), which is idempotent per order.
 */
create or replace function public.release_coupon_use(p_coupon_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.coupons
     set times_used = greatest(times_used - 1, 0),
         updated_at = now()
   where id = p_coupon_id
     and times_used > 0;
  return found;
end;
$$;

revoke all on function public.release_coupon_use(uuid) from public, anon, authenticated;
