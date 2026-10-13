-- What the browser's roles must NOT be able to do, attempted directly against
-- the database the way a forged REST call would. One transaction, rolled back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('0000aaaa-0000-4000-8000-00000000000a', 'a@rls.test'),
  ('0000bbbb-0000-4000-8000-00000000000b', 'b@rls.test');
insert into public.profiles (id, name, email) values
  ('0000aaaa-0000-4000-8000-00000000000a', 'A', 'a@rls.test'),
  ('0000bbbb-0000-4000-8000-00000000000b', 'B', 'b@rls.test')
on conflict (id) do nothing;
insert into public.orders (order_number, user_id, lookup_token, customer_name, customer_phone, address_line, subtotal, total, payment, payment_status)
values ('LV-RLSB01', '0000bbbb-0000-4000-8000-00000000000b', 'tok-b', 'B', '+41000000000', 'Street 1, 8000 Zurich', 10, 10, 'Карта онлайн', 'pending_payment');
insert into public.coupons (code, kind, value) values ('RLS-SECRET', 'percent', 50);

-- Runs `sql` as `role` (with `uid` as the JWT subject) and returns what
-- happened: 'denied' (an error) or the number of rows affected/returned.
create or replace function pg_temp.attempt(p_role text, p_uid text, p_sql text) returns text
language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    get diagnostics n = row_count;
    reset role;
    return n::text;
  exception when others then
    reset role;
    return 'denied';
  end;
end $$;

create or replace function pg_temp.expect(p_name text, p_got text, p_want text[]) returns void
language plpgsql as $$ begin
  if not (p_got = any (p_want)) then raise exception 'FAIL %: got %, expected one of %', p_name, p_got, p_want; end if;
  raise notice 'PASS %', p_name;
end $$;

\set A '''0000aaaa-0000-4000-8000-00000000000a'''

select pg_temp.expect('anon cannot read orders',
  pg_temp.attempt('anon', null, 'select * from public.orders'), array['denied', '0']);
select pg_temp.expect('anon cannot read profiles',
  pg_temp.attempt('anon', null, 'select * from public.profiles'), array['denied', '0']);
select pg_temp.expect('anon cannot read coupons (the code list is an oracle)',
  pg_temp.attempt('anon', null, 'select * from public.coupons'), array['denied', '0']);
select pg_temp.expect('a customer cannot read another customer''s order',
  pg_temp.attempt('authenticated', :A, $q$select * from public.orders where order_number = 'LV-RLSB01'$q$), array['denied', '0']);
select pg_temp.expect('a customer cannot mark an order paid',
  pg_temp.attempt('authenticated', :A, $q$update public.orders set payment_status = 'paid'$q$), array['denied', '0']);
select pg_temp.expect('a customer cannot change a total or a discount',
  pg_temp.attempt('authenticated', :A, $q$update public.orders set total = 0.01, discount = 999$q$), array['denied', '0']);
select pg_temp.expect('a customer cannot insert an order (prices are the server''s)',
  pg_temp.attempt('authenticated', :A, $q$insert into public.orders (order_number, lookup_token, customer_name, customer_phone, address_line, subtotal, total, payment) values ('LV-RLSX01','t','n','p','a',1,1,'card')$q$), array['denied']);
select pg_temp.expect('a customer cannot change stock',
  pg_temp.attempt('authenticated', :A, $q$update public.product_variants set stock = 999$q$), array['denied', '0']);
select pg_temp.expect('a customer cannot change prices',
  pg_temp.attempt('authenticated', :A, $q$update public.products set price = 1$q$), array['denied', '0']);
select pg_temp.expect('a customer cannot edit coupons',
  pg_temp.attempt('authenticated', :A, $q$update public.coupons set value = 100$q$), array['denied', '0']);
select pg_temp.expect('a customer cannot change store settings',
  pg_temp.attempt('authenticated', :A, $q$update public.store_settings set value = '{}'$q$), array['denied', '0']);
select pg_temp.expect('a customer cannot read admin sessions',
  pg_temp.attempt('authenticated', :A, 'select * from public.admin_sessions'), array['denied', '0']);
select pg_temp.expect('a customer cannot set their Stripe customer id',
  pg_temp.attempt('authenticated', :A, $q$update public.profiles set stripe_customer_id = 'cus_x' where id = auth.uid()$q$), array['denied']);
select pg_temp.expect('a customer cannot edit another profile',
  pg_temp.attempt('authenticated', :A, $q$update public.profiles set name = 'x' where id <> auth.uid()$q$), array['denied', '0']);
select pg_temp.expect('a customer cannot place an order through the definer function',
  pg_temp.attempt('authenticated', :A, $q$select public.place_order('{}'::jsonb, '[]'::jsonb)$q$), array['denied']);
select pg_temp.expect('a customer cannot redeem a coupon directly',
  pg_temp.attempt('authenticated', :A, $q$select * from public.redeem_coupon('RLS-SECRET', 100)$q$), array['denied']);
select pg_temp.expect('a customer cannot restock',
  pg_temp.attempt('authenticated', :A, $q$select public.restore_order_stock('LV-RLSB01')$q$), array['denied']);
select pg_temp.expect('a customer cannot list lapsed reservations',
  pg_temp.attempt('authenticated', :A, $q$select * from public.expirable_unpaid_orders()$q$), array['denied']);
select pg_temp.expect('a customer cannot delete orders',
  pg_temp.attempt('authenticated', :A, 'delete from public.orders'), array['denied', '0']);

-- And the order really is untouched.
select pg_temp.expect('the other customer''s order is unchanged',
  (select payment_status::text || '/' || total::text from public.orders where order_number = 'LV-RLSB01'), array['pending_payment/10.00']);

rollback;
