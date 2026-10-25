-- Checkout attempt keys (0061): one claim per key, only hashes, and no
-- customer access. One transaction, rolled back.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.check(p_name text, p_got boolean, p_detail text) returns void
language plpgsql as $$ begin
  if not p_got then raise exception 'FAIL %: %', p_name, p_detail; end if;
  raise notice 'PASS %', p_name;
end $$;

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$ begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlerrm;
end $$;

select pg_temp.check('a key can be claimed once',
  pg_temp.try($q$insert into public.order_idempotency (key_hash) values (repeat('a', 64))$q$) = 'OK', 'first claim');
select pg_temp.check('a second claim of the same key is refused (the atomic part)',
  pg_temp.try($q$insert into public.order_idempotency (key_hash) values (repeat('a', 64))$q$) like '%duplicate key%',
  pg_temp.try($q$insert into public.order_idempotency (key_hash) values (repeat('a', 64))$q$));
select pg_temp.check('only a SHA-256 hex digest is accepted as the key, never the key itself',
  pg_temp.try($q$insert into public.order_idempotency (key_hash) values ('3f2b8c1e-0b7a-4f3e-9a51-6d0c2e7f4a10')$q$) like '%check%', 'raw key');
select pg_temp.check('a claim starts without an order and records it later',
  (select order_number is null from public.order_idempotency where key_hash = repeat('a', 64)), 'order_number');
update public.order_idempotency set order_number = 'LV-TEST01' where key_hash = repeat('a', 64);
select pg_temp.check('…and then points at the order',
  (select order_number = 'LV-TEST01' from public.order_idempotency where key_hash = repeat('a', 64)), 'order_number');
select pg_temp.check('row level security is on',
  (select relrowsecurity from pg_class where oid = 'public.order_idempotency'::regclass), 'relrowsecurity');
select pg_temp.check('customers (anon, authenticated) have no privileges on it',
  not has_table_privilege('anon', 'public.order_idempotency', 'select, insert, update, delete')
  and not has_table_privilege('authenticated', 'public.order_idempotency', 'select, insert, update, delete'), 'grants');
select pg_temp.check('no policies: server only',
  not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'order_idempotency'), 'policies');

rollback;
