-- redeem_coupon (0057): scoping, limits, rounding. Runs inside one
-- transaction that is rolled back, so it leaves nothing behind.
-- Each check raises on failure; scripts/ci/db-tests.sh stops at the first.
\set ON_ERROR_STOP on
begin;

create temp table t_result (name text, ok boolean, reason text, discount numeric);
create or replace function pg_temp.check(p_name text, p_got boolean, p_detail text) returns void
language plpgsql as $$ begin
  if not p_got then raise exception 'FAIL %: %', p_name, p_detail; end if;
  raise notice 'PASS %', p_name;
end $$;
create or replace function pg_temp.redeem(p_code text, p_subtotal numeric, p_lines jsonb, p_commit boolean default false)
returns table (ok boolean, reason text, discount numeric) language sql as $$
  select r.ok, r.reason, r.discount from public.redeem_coupon(p_code, p_subtotal, null, '{}', p_commit, p_lines) r
$$;

insert into public.coupons (code, kind, value, product_slugs, collection_slugs, min_order_total, max_redemptions, expires_at, active) values
  ('DBT-ALL10',   'percent', 10,   '{}',                    '{}',               null, null, null, true),
  ('DBT-COAT10',  'percent', 10,   '{dbtest-coat}',         '{}',               null, null, null, true),
  ('DBT-COATS25', 'percent', 25,   '{}',                    '{dbtest-coats}',   null, null, null, true),
  ('DBT-BAGFIX',  'fixed',   500,  '{dbtest-bag}',          '{}',               null, null, null, true),
  ('DBT-GHOST',   'percent', 50,   '{no-such-product}',     '{no-such-coll}',   null, null, null, true),
  ('DBT-OLD',     'percent', 10,   '{}',                    '{}',               null, null, now() - interval '1 day', true),
  ('DBT-ONCE',    'fixed',   5,    '{}',                    '{}',               null, 1,    null, true),
  ('DBT-MIN',     'fixed',   5,    '{}',                    '{}',               1000, null, null, true),
  ('DBT-THIRD',   'percent', 33.33,'{dbtest-scarf}',        '{}',               null, null, null, true);

-- Basket: coat 300 + scarf 99.99 + bag 200 = 599.99
\set mixed '[{"slug":"dbtest-coat","qty":1},{"slug":"dbtest-scarf","qty":1},{"slug":"dbtest-bag","qty":1}]'

select pg_temp.check('unrestricted: 10 % of the whole basket',
  (select ok and discount = 60.00 from pg_temp.redeem('DBT-ALL10', 599.99, :'mixed')), 'expected 60.00');

select pg_temp.check('product-restricted: 10 % of the coat line only (not of 599.99)',
  (select ok and discount = 30.00 from pg_temp.redeem('DBT-COAT10', 599.99, :'mixed')),
  (select format('%s %s %s', ok, reason, discount) from pg_temp.redeem('DBT-COAT10', 599.99, :'mixed')));

select pg_temp.check('product-restricted: quantity counts (2 coats → 60.00)',
  (select ok and discount = 60.00 from pg_temp.redeem('DBT-COAT10', 899.99, '[{"slug":"dbtest-coat","qty":2},{"slug":"dbtest-scarf","qty":1}]')), 'expected 60.00');

select pg_temp.check('product-restricted: basket without the product → NOT_APPLICABLE',
  (select not ok and reason = 'NOT_APPLICABLE' from pg_temp.redeem('DBT-COAT10', 200, '[{"slug":"dbtest-bag","qty":1}]')), 'expected NOT_APPLICABLE');

select pg_temp.check('collection-restricted: 25 % of coat + scarf only (99.9975 → 100.00)',
  (select ok and discount = 100.00 from pg_temp.redeem('DBT-COATS25', 599.99, :'mixed')),
  (select format('%s %s %s', ok, reason, discount) from pg_temp.redeem('DBT-COATS25', 599.99, :'mixed')));

select pg_temp.check('collection-restricted: basket outside the collection → NOT_APPLICABLE',
  (select not ok and reason = 'NOT_APPLICABLE' from pg_temp.redeem('DBT-COATS25', 200, '[{"slug":"dbtest-bag","qty":1}]')), 'expected NOT_APPLICABLE');

select pg_temp.check('fixed, restricted: capped at the eligible line (500 off a 200 bag → 200)',
  (select ok and discount = 200.00 from pg_temp.redeem('DBT-BAGFIX', 599.99, :'mixed')), 'expected 200.00');

select pg_temp.check('restricted coupon without lines (older caller) → NOT_APPLICABLE, never whole-basket',
  (select not ok and reason = 'NOT_APPLICABLE' from pg_temp.redeem('DBT-COAT10', 599.99, null)), 'expected NOT_APPLICABLE');

select pg_temp.check('restriction naming nothing that exists → NOT_APPLICABLE (invalid configuration fails closed)',
  (select not ok and reason = 'NOT_APPLICABLE' from pg_temp.redeem('DBT-GHOST', 599.99, :'mixed')), 'expected NOT_APPLICABLE');

select pg_temp.check('line prices come from the catalogue, not the request (a price field is ignored)',
  (select ok and discount = 30.00 from pg_temp.redeem('DBT-COAT10', 599.99, '[{"slug":"dbtest-coat","qty":1,"price":999999}]')), 'expected 30.00');

select pg_temp.check('quantities are clamped like checkout (qty 1000 → 20)',
  (select ok and discount = 600.00 from pg_temp.redeem('DBT-COAT10', 6000, '[{"slug":"dbtest-coat","qty":1000}]')), 'expected 600.00');

select pg_temp.check('rounding: 33.33 % of 99.99 = 33.3267 → 33.33',
  (select ok and discount = 33.33 from pg_temp.redeem('DBT-THIRD', 99.99, '[{"slug":"dbtest-scarf","qty":1}]')), 'expected 33.33');

select pg_temp.check('expired → EXPIRED',
  (select not ok and reason = 'EXPIRED' from pg_temp.redeem('DBT-OLD', 100, null)), 'expected EXPIRED');

select pg_temp.check('below the minimum order → BELOW_MINIMUM',
  (select not ok and reason = 'BELOW_MINIMUM' from pg_temp.redeem('DBT-MIN', 999.99, null)), 'expected BELOW_MINIMUM');

select pg_temp.check('boundary: exactly the minimum → OK',
  (select ok from pg_temp.redeem('DBT-MIN', 1000, null)), 'expected OK');

select pg_temp.check('zero-value basket: fixed discount capped at 0',
  (select ok and discount = 0 from pg_temp.redeem('DBT-ONCE', 0, null)), 'expected 0');

select pg_temp.check('negative subtotal → NOT_APPLICABLE',
  (select not ok and reason = 'NOT_APPLICABLE' from pg_temp.redeem('DBT-ALL10', -1, null)), 'expected NOT_APPLICABLE');

select pg_temp.check('preview does not consume a use',
  (select ok from pg_temp.redeem('DBT-ONCE', 100, null, false)) and (select times_used = 0 from public.coupons where code = 'DBT-ONCE'), 'times_used changed');

-- Two statements: within one, the count would be read from the snapshot taken
-- before the redemption's UPDATE.
insert into t_result select 'once', ok, reason, discount from pg_temp.redeem('DBT-ONCE', 100, null, true);
select pg_temp.check('commit consumes the single use',
  (select ok from t_result where name = 'once') and (select times_used = 1 from public.coupons where code = 'DBT-ONCE'), 'times_used not 1');

select pg_temp.check('usage limit reached → EXHAUSTED',
  (select not ok and reason = 'EXHAUSTED' from pg_temp.redeem('DBT-ONCE', 100, null, true)), 'expected EXHAUSTED');

select pg_temp.check('unknown code → NOT_FOUND',
  (select not ok and reason = 'NOT_FOUND' from pg_temp.redeem('DBT-NOPE', 100, null)), 'expected NOT_FOUND');

rollback;
