-- Price history (0063): every price a product is offered at is recorded by the
-- database itself, and the record is closed to browser roles.
-- One transaction, rolled back.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.check(p_name text, p_got boolean, p_detail text) returns void
language plpgsql as $$ begin
  if not p_got then raise exception 'FAIL %: %', p_name, p_detail; end if;
  raise notice 'PASS %', p_name;
end $$;

create or replace function pg_temp.as_role(p_role text, p_sql text) returns text
language plpgsql as $$
declare n bigint;
begin
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

insert into public.products (slug, name, price, collection_id, category_id)
select 'dbprice-1', '{"en":"Price test"}', 150, collection_id, id from public.categories where slug = 'dbtest_cat' limit 1;

select pg_temp.check('a new product records its first price',
  (select count(*) = 1 and min(h.price) = 150 from public.product_price_history h join public.products p on p.id = h.product_id where p.slug = 'dbprice-1'), 'rows');

update public.products set price = 120 where slug = 'dbprice-1';
update public.products set name = '{"en":"Renamed"}' where slug = 'dbprice-1';
update public.products set price = 120 where slug = 'dbprice-1';
select pg_temp.check('a price change is recorded; other edits and same-price saves are not',
  (select array_agg(h.price order by h.id) = array[150, 120]::numeric[] from public.product_price_history h join public.products p on p.id = h.product_id where p.slug = 'dbprice-1'),
  (select array_agg(h.price order by h.id)::text from public.product_price_history h join public.products p on p.id = h.product_id where p.slug = 'dbprice-1'));

select pg_temp.check('every product has a history row (the backfill)',
  not exists (select 1 from public.products p where not exists (select 1 from public.product_price_history h where h.product_id = p.id)), 'missing');

select pg_temp.check('the history is closed to anon',
  pg_temp.as_role('anon', $q$select 1 from public.product_price_history$q$) = 'denied', 'anon');
select pg_temp.check('…and to signed-in visitors',
  pg_temp.as_role('authenticated', $q$select 1 from public.product_price_history$q$) = 'denied', 'authenticated');

delete from public.products where slug = 'dbprice-1';
select pg_temp.check('deleting a product removes its history',
  not exists (select 1 from public.product_price_history h where not exists (select 1 from public.products p where p.id = h.product_id)), 'orphans');

rollback;
