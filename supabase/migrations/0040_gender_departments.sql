-- ============================================================================
-- 0040_gender_departments.sql
-- ============================================================================
-- The storefront's top level becomes the DEPARTMENT — Women, Men, Kids — with
-- Clothing, Shoes and Accessories beneath each.
--
-- WHY THIS IS NEEDED. lib/departments.ts, the homepage cards and the header
-- have all named Women/Men/Kids for some time, while the catalogue's
-- collections were clothing/shoes/accessories. The result is that
-- /category/women, /category/men and /category/kids have been returning 404
-- from every link that advertises them.
--
-- THE CONSTRAINT THAT PREVENTED IT. `categories.slug` was globally unique, so
-- one "clothing" could exist in the whole catalogue — not one per department.
-- A gendered taxonomy needs Women→Clothing AND Men→Clothing, so the constraint
-- is moved to (collection_id, slug), which is also what the routes already
-- assume: /category/[collection]/[subcategory] resolves the subcategory WITHIN
-- its collection (see resolve() in the subcategory route), and has never
-- needed the slug to be unique beyond it.
--
-- WHAT THIS MIGRATION DOES NOT DO — DELIBERATELY:
--
--   * It does not move a single product. A product's GENDER is not recorded
--     anywhere in the current schema and cannot be derived from its category:
--     a jacket is a jacket. Deciding whether each one is womenswear is a
--     human judgement, and guessing would silently mis-file the catalogue.
--     Re-tag them in the admin (Product → Department + Category) after this
--     runs.
--
--   * It does not delete the old clothing/shoes/accessories collections or
--     their fine-grained categories (jackets, sneakers, …). Products still
--     reference them, and products.collection_id is ON DELETE RESTRICT, so a
--     premature drop would fail loudly — or, worse, succeed and orphan the
--     catalogue. They are retired in a follow-up once empty.
--
-- SO THE SHOP IS BROWSABLE THROUGHOUT. Until products are re-tagged the new
-- departments are simply empty, and the storefront already hides an empty
-- collection from the sitemap and shows a zero count in the sidebar. Nothing
-- 404s that did not 404 before, and nothing stops working.
-- ============================================================================


-- ------------------------------------------------- one "clothing" per dept ---
-- Dropped by name if it is the constraint, by index if the original CREATE
-- TABLE's inline `unique` produced one — which it did.
do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.categories'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) = 'UNIQUE (slug)';

  if v_name is not null then
    execute format('alter table public.categories drop constraint %I', v_name);
  end if;
end
$$;

create unique index if not exists categories_collection_slug_key
  on public.categories (collection_id, slug);


-- ------------------------------------------------------------ departments ---
-- sort_order mirrors CORE_DEPARTMENTS in lib/departments.ts, so the storefront
-- and the database agree on the order without either one hardcoding the other.
insert into public.collections (slug, name, sort_order)
values
  ('women', '{"ru":"Женщины","en":"Women","it":"Donna","fr":"Femme","de":"Damen"}'::jsonb, 0),
  ('men',   '{"ru":"Мужчины","en":"Men","it":"Uomo","fr":"Homme","de":"Herren"}'::jsonb,   1),
  ('kids',  '{"ru":"Дети","en":"Kids","it":"Bambini","fr":"Enfants","de":"Kinder"}'::jsonb, 2)
on conflict (slug) do update
  set name = excluded.name,
      sort_order = excluded.sort_order;


-- ------------------------------------------------------- their categories ---
-- The same three types under each department. Their names are the ones the
-- old collections carried, so nothing has to be re-translated.
insert into public.categories (collection_id, slug, name, sort_order)
select
  c.id,
  t.slug,
  t.name,
  t.sort_order
from public.collections c
cross join (
  values
    ('clothing',    '{"ru":"Одежда","en":"Clothing","it":"Abbigliamento","fr":"Vêtements","de":"Kleidung"}'::jsonb,        0),
    ('shoes',       '{"ru":"Обувь","en":"Shoes","it":"Scarpe","fr":"Chaussures","de":"Schuhe"}'::jsonb,                    1),
    ('accessories', '{"ru":"Аксессуары","en":"Accessories","it":"Accessori","fr":"Accessoires","de":"Accessoires"}'::jsonb, 2)
) as t(slug, name, sort_order)
where c.slug in ('women', 'men', 'kids')
on conflict (collection_id, slug) do update
  set name = excluded.name,
      sort_order = excluded.sort_order;


comment on index public.categories_collection_slug_key is
  'A category slug is unique within its department, not across the catalogue: Women and Men each have their own Clothing.';
