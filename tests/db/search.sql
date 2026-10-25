-- search_products (0058): bounded, service-role only, safe on any input.
-- One transaction, rolled back: leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.check(p_name text, p_got boolean, p_detail text) returns void
language plpgsql as $$ begin
  if not p_got then raise exception 'FAIL %: %', p_name, p_detail; end if;
  raise notice 'PASS %', p_name;
end $$;

-- 60 products sharing one word, so a limit can be exceeded.
insert into public.products (slug, name, price, collection_id, category_id, sizes, colors, statuses)
select 'dbsearch-' || g, jsonb_build_object('en', 'Velvetine jacket ' || g), 100, k.collection_id, k.id, array['M'],
       '[{"name":"Black","hex":"#000"}]'::jsonb, array['in_stock']
  from generate_series(1, 60) g
  cross join lateral (select id, collection_id from public.categories where slug = 'dbtest_cat' limit 1) k;
-- On sale (0062), so the search may return them. Test data only.
insert into public.product_rights (product_id, basis, reference)
select id, 'own_design', 'DB test fixture' from public.products where slug like 'dbsearch-%';
update public.products set listing_status = 'published' where slug like 'dbsearch-%';

create temp table t_n as
select (select count(*) from public.search_products('velvetine', 1000000)) as huge,
       (select count(*) from public.search_products('velvetine', null))    as nul,
       (select count(*) from public.search_products('velvetine', -5))      as neg,
       (select count(*) from public.search_products('velvetine', 0))       as zero,
       (select count(*) from public.search_products('velvetine'))          as dflt,
       (select count(*) from public.search_products('velvetin', 1000))     as fuzzy;

select pg_temp.check('a huge limit is clamped to 50', (select huge = 50 from t_n), (select huge::text from t_n));
select pg_temp.check('a NULL limit means the default 24, not "no limit"', (select nul = 24 from t_n), (select nul::text from t_n));
select pg_temp.check('a negative limit returns 1 row instead of raising', (select neg = 1 from t_n), (select neg::text from t_n));
select pg_temp.check('a zero limit returns 1 row', (select zero = 1 from t_n), (select zero::text from t_n));
select pg_temp.check('no limit given: 24', (select dflt = 24 from t_n), (select dflt::text from t_n));
select pg_temp.check('the misspelling pass is clamped too', (select fuzzy between 1 and 50 from t_n), (select fuzzy::text from t_n));

select pg_temp.check('a single 200 000-character word: no error, no rows',
  (select count(*) = 0 from public.search_products(repeat('x', 200000), 50)), 'returned rows');
select pg_temp.check('a long query still finds what its first words name',
  (select count(*) > 0 from public.search_products('velvetine ' || repeat('y', 200000), 50)), 'no rows');
-- On 0045 this ran ~2 s of CPU and then raised "stack depth limit exceeded":
-- a cheap way to load the database with the public key.
select pg_temp.check('70 000 short words: cut to 100 characters, answered without error',
  (select count(*) = 0 from public.search_products(repeat('ab ', 70000), 50)), 'returned rows');
select pg_temp.check('below two characters: nothing', (select count(*) = 0 from public.search_products('v', 50)), 'rows');
select pg_temp.check('NULL query: nothing, no error', (select count(*) = 0 from public.search_products(null, 50)), 'rows');

select pg_temp.check('SQL in the query is text, not SQL',
  (select count(*) >= 0 from public.search_products($q$'; drop table public.products; --$q$, 50))
    and exists (select 1 from public.products where slug = 'dbsearch-1'), 'products gone');
select pg_temp.check('broken search syntax does not raise',
  (select count(*) >= 0 from public.search_products($q$"unbalanced & | ! ( -$q$, 50)), 'raised');

select pg_temp.check('returns slugs, ranks and a flag only — no other column',
  pg_get_function_result('public.search_products(text, integer)'::regprocedure) = 'TABLE(slug text, rank real, fuzzy boolean)',
  pg_get_function_result('public.search_products(text, integer)'::regprocedure));

select pg_temp.check('anon cannot call it (around /api/search and its rate limit)',
  not has_function_privilege('anon', 'public.search_products(text, integer)', 'execute'), 'anon can execute');
select pg_temp.check('authenticated cannot call it',
  not has_function_privilege('authenticated', 'public.search_products(text, integer)', 'execute'), 'authenticated can execute');
select pg_temp.check('service_role can (the route''s client)',
  has_function_privilege('service_role', 'public.search_products(text, integer)', 'execute'), 'service_role cannot execute');

rollback;
