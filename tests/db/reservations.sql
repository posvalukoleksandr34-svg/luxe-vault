-- expirable_unpaid_orders (0056) and the idempotent release it relies on.
-- One transaction, rolled back: leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.check(p_name text, p_got boolean, p_detail text) returns void
language plpgsql as $$ begin
  if not p_got then raise exception 'FAIL %: %', p_name, p_detail; end if;
  raise notice 'PASS %', p_name;
end $$;

-- An order of one dbtest-coat, created `age` ago, in the given state.
create or replace function pg_temp.mk(p_no text, p_age interval, p_status text, p_pay text, p_session interval default null)
returns void language plpgsql as $$
declare v_id uuid;
begin
  insert into public.orders (order_number, lookup_token, customer_name, customer_phone, address_line, subtotal, total, payment,
                             status, payment_status, created_at, payment_session_at)
  values (p_no, 'tok-' || p_no, 'DB Test', '+41000000000', 'Teststrasse 1, 8000 Zurich', 300, 300, 'Карта онлайн',
          p_status::public.order_status, p_pay::public.payment_status, now() - p_age, case when p_session is null then null else now() - p_session end)
  returning id into v_id;
  insert into public.order_items (order_id, product_id, name, unit_price, size, color, qty)
  values (v_id, 'dbtest-coat', 'Coat', 300, 'M', 'Black', 1);
end $$;

select pg_temp.mk('LV-DBR001', interval '49 hours', 'pending',    'pending_payment');            -- lapsed
select pg_temp.mk('LV-DBR002', interval '47 hours', 'pending',    'pending_payment');            -- inside the hold
select pg_temp.mk('LV-DBR003', interval '49 hours', 'pending',    'pending_payment', '10 minutes'); -- paying right now
select pg_temp.mk('LV-DBR004', interval '73 hours', 'pending',    'pending_payment', '10 minutes'); -- past the ceiling
select pg_temp.mk('LV-DBR005', interval '99 hours', 'processing', 'paid');                       -- paid: never
select pg_temp.mk('LV-DBR006', interval '99 hours', 'pending',    'confirming');                 -- in flight: never
select pg_temp.mk('LV-DBR007', interval '99 hours', 'shipped',    'pending_payment');            -- shipped: never
select pg_temp.mk('LV-DBR008', interval '99 hours', 'pending',    'expired');                    -- PI cancelled, still holding: lapsed
select pg_temp.mk('LV-DBR009', interval '99 hours', 'pending',    'failed');                     -- lapsed
select pg_temp.mk('LV-DBR010', interval '99 hours', 'pending',    'partially_refunded');         -- money: never
select pg_temp.mk('LV-DBR011', interval '99 hours', 'cancelled',  'expired');                    -- already released elsewhere

create temp table t_lapsed as
  select order_number from public.expirable_unpaid_orders(interval '48 hours', interval '1 hour', interval '72 hours', 100)
   where order_number like 'LV-DBR%';

select pg_temp.check('exactly the lapsed unpaid orders are named',
  (select array_agg(order_number order by order_number) from t_lapsed) = array['LV-DBR001','LV-DBR004','LV-DBR008','LV-DBR009'],
  (select coalesce(array_agg(order_number order by order_number)::text, '{}') from t_lapsed));

select pg_temp.check('a paid order is never named', not exists (select 1 from t_lapsed where order_number = 'LV-DBR005'), 'LV-DBR005 named');
select pg_temp.check('a settling payment is never named', not exists (select 1 from t_lapsed where order_number = 'LV-DBR006'), 'LV-DBR006 named');
select pg_temp.check('a customer paying right now is not interrupted', not exists (select 1 from t_lapsed where order_number = 'LV-DBR003'), 'LV-DBR003 named');
select pg_temp.check('the ceiling ends the grace', exists (select 1 from t_lapsed where order_number = 'LV-DBR004'), 'LV-DBR004 missing');

-- Released twice (two overlapping sweeps): the units come back once.
create temp table t_stock as
  select v.stock from public.product_variants v join public.products p on p.id = v.product_id
   where p.slug = 'dbtest-coat' and v.size = 'M' and v.color = 'Black';
select public.restore_order_stock('LV-DBR001');
select public.restore_order_stock('LV-DBR001');
select pg_temp.check('a double release restocks once',
  (select v.stock from public.product_variants v join public.products p on p.id = v.product_id
    where p.slug = 'dbtest-coat' and v.size = 'M' and v.color = 'Black') = (select stock + 1 from t_stock),
  'stock did not rise by exactly one');

-- A restocked order is no longer named (nothing to release twice).
select pg_temp.check('a released order drops out of the list',
  not exists (select 1 from public.expirable_unpaid_orders(interval '48 hours', interval '1 hour', interval '72 hours', 100)
               where order_number = 'LV-DBR001'), 'still named');

-- Paid after the release (a late crypto payment): the units are taken again.
update public.orders set payment_status = 'paid' where order_number = 'LV-DBR001';
select pg_temp.check('a payment after release re-takes the units (reclaim_order_stock)',
  public.reclaim_order_stock('LV-DBR001') = 'reclaimed', 'not reclaimed');
select pg_temp.check('…and the shelf is back where it was',
  (select v.stock from public.product_variants v join public.products p on p.id = v.product_id
    where p.slug = 'dbtest-coat' and v.size = 'M' and v.color = 'Black') = (select stock from t_stock),
  'stock not back');

select pg_temp.check('the browser cannot call it',
  not has_function_privilege('anon', 'public.expirable_unpaid_orders(interval, interval, interval, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.expirable_unpaid_orders(interval, interval, interval, integer)', 'execute'),
  'executable by anon/authenticated');

rollback;
