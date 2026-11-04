-- Sale-state audit trail (0065): set_product_listing publishes and withdraws
-- atomically and records each change once; any other path is recorded by the
-- trigger; the trail is append-only and unreadable by browser roles.
-- One transaction, rolled back.
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

insert into public.products (slug, name, price, collection_id, category_id, sizes, colors, statuses)
select 'dbaudit-1', '{"en":"Audit piece"}'::jsonb, 150, k.collection_id, k.id, array['M'],
       '[{"name":"Black","hex":"#000"}]'::jsonb, array['in_stock']
  from (select id, collection_id from public.categories where slug = 'dbtest_cat' limit 1) k;

select pg_temp.check('publishing without a basis is refused, nothing changes',
  pg_temp.try($q$ select public.set_product_listing('dbaudit-1', 'publish', null, 'INV-1') $q$) <> 'OK'
  and (select listing_status = 'draft' from public.products where slug = 'dbaudit-1')
  and not exists (select 1 from public.product_listing_events where product_slug = 'dbaudit-1'), 'refused');

select pg_temp.check('a too-short reference is refused',
  pg_temp.try($q$ select public.set_product_listing('dbaudit-1', 'publish', 'own_design', 'ab') $q$) <> 'OK', 'refused');

-- Each call runs in its own statement: within one SELECT, the other
-- subqueries would still see the snapshot from before the call.
create temp table r_publish as select public.set_product_listing('dbaudit-1', 'publish', 'own_design', 'Design file DF-7') as r;
select pg_temp.check('publish: rights, status and one event in one call',
  (select r = 'published' from r_publish)
  and (select listing_status = 'published' and published_at is not null from public.products where slug = 'dbaudit-1')
  and (select basis = 'own_design' and reference = 'Design file DF-7' from public.product_rights r
         join public.products p on p.id = r.product_id where p.slug = 'dbaudit-1')
  and (select count(*) = 1 from public.product_listing_events where product_slug = 'dbaudit-1'), 'published once');

select pg_temp.check('the event records from/to, basis, reference and the console actor',
  (select from_status = 'draft' and to_status = 'published' and basis = 'own_design'
          and reference = 'Design file DF-7' and actor = 'console' and reason is null
     from public.product_listing_events where product_slug = 'dbaudit-1'), 'event fields');

create temp table r_withdraw as select public.set_product_listing('dbaudit-1', 'withdraw', null, null, 'Supplier could not confirm the invoice') as r;
select pg_temp.check('withdraw with a reason: recorded, rights kept',
  (select r = 'withdrawn' from r_withdraw)
  and (select count(*) = 2 from public.product_listing_events where product_slug = 'dbaudit-1')
  and (select reason = 'Supplier could not confirm the invoice' and basis is null and to_status = 'withdrawn'
         from public.product_listing_events where product_slug = 'dbaudit-1' order by id desc limit 1)
  and exists (select 1 from public.product_rights r join public.products p on p.id = r.product_id where p.slug = 'dbaudit-1'),
  'withdrawn');

create temp table r_noop as select public.set_product_listing('dbaudit-1', 'withdraw') as r;
select pg_temp.check('withdrawing what is not on sale changes nothing and logs nothing',
  (select r = 'withdrawn' from r_noop)
  and (select count(*) = 2 from public.product_listing_events where product_slug = 'dbaudit-1'), 'no-op');

create temp table r_republish as select public.set_product_listing('dbaudit-1', 'publish', 'authorized_resale', 'Invoice 2026-118') as r;
select pg_temp.check('republishing with a new reference keeps the old one in history',
  (select r = 'published' from r_republish)
  and (select count(*) = 3 from public.product_listing_events where product_slug = 'dbaudit-1')
  and exists (select 1 from public.product_listing_events where product_slug = 'dbaudit-1' and reference = 'Design file DF-7')
  and exists (select 1 from public.product_listing_events where product_slug = 'dbaudit-1' and reference = 'Invoice 2026-118'),
  'history kept');

update public.products set listing_status = 'withdrawn' where slug = 'dbaudit-1';
select pg_temp.check('a change outside the function (SQL editor) is recorded by the trigger with the db role',
  (select count(*) = 4 from public.product_listing_events where product_slug = 'dbaudit-1')
  and (select actor <> 'console' and to_status = 'withdrawn' and from_status = 'published'
         from public.product_listing_events where product_slug = 'dbaudit-1' order by id desc limit 1), 'backstop');

select pg_temp.check('the trail is append-only: update refused',
  pg_temp.try($q$ update public.product_listing_events set reason = 'x' where product_slug = 'dbaudit-1' $q$) <> 'OK', 'update');
select pg_temp.check('the trail is append-only: delete refused',
  pg_temp.try($q$ delete from public.product_listing_events where product_slug = 'dbaudit-1' $q$) <> 'OK', 'delete');

select pg_temp.check('browser roles cannot read the trail',
  pg_temp.as_role('anon', 'select * from public.product_listing_events') in ('denied', '0')
  and pg_temp.as_role('authenticated', 'select * from public.product_listing_events') in ('denied', '0'), 'read');

select pg_temp.check('browser roles cannot call set_product_listing',
  pg_temp.as_role('anon', $q$ select public.set_product_listing('dbaudit-1', 'withdraw') $q$) = 'denied'
  and pg_temp.as_role('authenticated', $q$ select public.set_product_listing('dbaudit-1', 'withdraw') $q$) = 'denied', 'execute');

select pg_temp.check('an unknown slug answers null',
  public.set_product_listing('dbaudit-none', 'withdraw') is null, 'null');

delete from public.products where slug = 'dbaudit-1';
select pg_temp.check('deleting the product keeps its history',
  not exists (select 1 from public.products where slug = 'dbaudit-1')
  and (select count(*) = 4 from public.product_listing_events where product_slug = 'dbaudit-1'), 'kept');

rollback;
