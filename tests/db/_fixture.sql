-- Synthetic catalogue shared by the database tests (tests/db). Idempotent.
-- Test data for a DISPOSABLE database only: scripts/ci/db-tests.sh refuses
-- anything that looks like a Supabase project.
insert into public.collections (slug, name) values
  ('dbtest-coats', '{"en":"DB test coats"}'), ('dbtest-bags', '{"en":"DB test bags"}')
on conflict (slug) do nothing;

insert into public.categories (slug, name, collection_id)
select 'dbtest_cat', '{"en":"DB test"}', c.id
  from public.collections c
 where c.slug in ('dbtest-coats', 'dbtest-bags')
on conflict (collection_id, slug) do nothing;

insert into public.products (slug, name, price, collection_id, category_id, sizes, colors, statuses)
select v.slug, jsonb_build_object('en', v.slug), v.price, c.id, k.id, array['M'],
       '[{"name":"Black","hex":"#000"}]'::jsonb, array['in_stock']
  from (values ('dbtest-coat', 'dbtest-coats', 300.00),
               ('dbtest-scarf', 'dbtest-coats', 99.99),
               ('dbtest-bag', 'dbtest-bags', 200.00),
               ('dbtest-last', 'dbtest-bags', 50.00)) v(slug, coll, price)
  join public.collections c on c.slug = v.coll
  join public.categories k on k.collection_id = c.id and k.slug = 'dbtest_cat'
on conflict (slug) do update
   set price = excluded.price, collection_id = excluded.collection_id, category_id = excluded.category_id;

insert into public.product_variants (product_id, size, color, stock)
select id, 'M', 'Black', case when slug = 'dbtest-last' then 1 else 50 end
  from public.products where slug like 'dbtest-%'
on conflict (product_id, size, color) do update set stock = excluded.stock;
