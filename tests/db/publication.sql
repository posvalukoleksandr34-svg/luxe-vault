-- Publication and sale rights (0062): only published products are public,
-- publishing needs the owner's rights record, the record never reaches a
-- browser role, and the search returns published products only.
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

-- Rows the role can see / change, or 'denied'.
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
select v.slug, jsonb_build_object('en', 'Marigoldine ' || v.slug), 120, k.collection_id, k.id, array['M'],
       '[{"name":"Black","hex":"#000"}]'::jsonb, array['in_stock']
  from (values ('dbpub-draft'), ('dbpub-live')) v(slug)
  cross join lateral (select id, collection_id from public.categories where slug = 'dbtest_cat' limit 1) k;
insert into public.product_variants (product_id, size, color, stock)
select id, 'M', 'Black', 5 from public.products where slug in ('dbpub-draft', 'dbpub-live');

select pg_temp.check('a new product is a draft (not on sale) by default',
  (select listing_status = 'draft' and published_at is null from public.products where slug = 'dbpub-draft'), 'status');

select pg_temp.check('publishing without a rights record is refused',
  pg_temp.try($q$update public.products set listing_status = 'published' where slug = 'dbpub-live'$q$) like 'PRODUCT_RIGHTS_REQUIRED%',
  pg_temp.try($q$update public.products set listing_status = 'published' where slug = 'dbpub-live'$q$));
select pg_temp.check('inserting a product already published, with no record, is refused too',
  pg_temp.try($q$insert into public.products (slug, name, price, collection_id, category_id, listing_status)
                 select 'dbpub-sneak', '{"en":"x"}', 1, collection_id, id, 'published' from public.categories where slug = 'dbtest_cat' limit 1$q$)
    like 'PRODUCT_RIGHTS_REQUIRED%', 'sneak insert');
select pg_temp.check('an unknown basis is refused',
  pg_temp.try($q$insert into public.product_rights (product_id, basis, reference)
                 select id, 'replica', 'invoice 1' from public.products where slug = 'dbpub-live'$q$) like '%check%', 'basis');
select pg_temp.check('a rights record needs a real reference (3+ characters)',
  pg_temp.try($q$insert into public.product_rights (product_id, basis, reference)
                 select id, 'own_design', '  ' from public.products where slug = 'dbpub-live'$q$) like '%check%', 'reference');

insert into public.product_rights (product_id, basis, reference)
select id, 'own_design', 'Design file DS-1 (test)' from public.products where slug = 'dbpub-live';
select pg_temp.check('with a rights record the product can be published',
  pg_temp.try($q$update public.products set listing_status = 'published' where slug = 'dbpub-live'$q$) = 'OK', 'publish');
select pg_temp.check('…and published_at is stamped',
  (select published_at is not null from public.products where slug = 'dbpub-live'), 'published_at');
select pg_temp.check('an unknown listing status is refused',
  pg_temp.try($q$update public.products set listing_status = 'hidden' where slug = 'dbpub-draft'$q$) like '%check%', 'status');

select pg_temp.check('anon sees the published product',
  pg_temp.as_role('anon', $q$select 1 from public.products where slug = 'dbpub-live'$q$) = '1', 'live');
select pg_temp.check('anon does not see the draft',
  pg_temp.as_role('anon', $q$select 1 from public.products where slug = 'dbpub-draft'$q$) = '0', 'draft');
select pg_temp.check('signed-in visitors do not see the draft either',
  pg_temp.as_role('authenticated', $q$select 1 from public.products where slug = 'dbpub-draft'$q$) = '0', 'draft');
select pg_temp.check('anon sees stock of published products only',
  pg_temp.as_role('anon', $q$select 1 from public.product_variants v join public.products p on p.id = v.product_id where p.slug in ('dbpub-draft', 'dbpub-live')$q$) = '1', 'variants');
select pg_temp.check('the rights record is closed to anon',
  pg_temp.as_role('anon', $q$select 1 from public.product_rights$q$) = 'denied', 'anon read');
select pg_temp.check('…and to signed-in visitors',
  pg_temp.as_role('authenticated', $q$select 1 from public.product_rights$q$) = 'denied', 'authenticated read');
select pg_temp.check('no browser role can publish a product',
  pg_temp.as_role('authenticated', $q$update public.products set listing_status = 'published' where slug = 'dbpub-draft'$q$) in ('denied', '0'), 'publish');
select pg_temp.check('product_rights has RLS on and no policies',
  (select relrowsecurity from pg_class where oid = 'public.product_rights'::regclass)
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'product_rights'), 'rls');

select pg_temp.check('search returns the published product',
  exists (select 1 from public.search_products('marigoldine', 50) s where s.slug = 'dbpub-live'), 'live');
select pg_temp.check('search never returns the draft (full text)',
  not exists (select 1 from public.search_products('marigoldine', 50) s where s.slug = 'dbpub-draft'), 'draft');
select pg_temp.check('…nor through the misspelling pass',
  not exists (select 1 from public.search_products('marigoldin', 50) s where s.slug = 'dbpub-draft'), 'fuzzy');

delete from public.product_rights where product_id = (select id from public.products where slug = 'dbpub-live');
select pg_temp.check('deleting the rights record takes the product off sale',
  (select listing_status = 'withdrawn' from public.products where slug = 'dbpub-live'), 'withdrawn');
select pg_temp.check('…and anon no longer sees it',
  pg_temp.as_role('anon', $q$select 1 from public.products where slug = 'dbpub-live'$q$) = '0', 'gone');

rollback;
