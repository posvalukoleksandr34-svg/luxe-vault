-- ============================================================================
-- 0026_delivery_days_and_categories.sql
--
-- 1. A per-product delivery estimate.
-- 2. The expanded category set:
--      clothing     pants
--      shoes        boots, loafers, sandals
--      accessories  hats, watches, sunglasses, gloves
--
-- Safe to re-run. Run after 0005 (collections, categories) and 0022.
-- ============================================================================

-- ---------------------------------------------------- delivery estimate ----
-- Days from payment confirmation to delivery, per product. Dropshipped lines
-- ship on their supplier's schedule, so one store-wide figure over-promises
-- some pieces and under-sells others.
--
-- Both NULL means "use the store default" (DEFAULT_DELIVERY_DAYS in
-- lib/fulfilment.ts). Existing products are deliberately NOT backfilled: a
-- number nobody has checked would be a promise nobody made.
alter table public.products
  add column if not exists delivery_days_min smallint,
  add column if not exists delivery_days_max smallint;

do $$ begin
  alter table public.products
    add constraint products_delivery_days_valid check (
      (delivery_days_min is null and delivery_days_max is null)
      or (
        delivery_days_min between 1 and 120
        and delivery_days_max between 1 and 120
        and delivery_days_max >= delivery_days_min
      )
    );
exception when duplicate_object then null; end $$;

comment on column public.products.delivery_days_min is
  'Earliest delivery, in days from payment confirmation. Null (with max) = store default.';
comment on column public.products.delivery_days_max is
  'Latest delivery, in days from payment confirmation. Null (with min) = store default.';

-- ----------------------------------------------------------- categories ----
-- Names in all five storefront languages. Idempotent: an existing slug is left
-- exactly as the admin may since have edited it. A collection that does not
-- exist (renamed or deleted in the admin) simply gets none of its rows.
insert into public.categories (collection_id, slug, name, sort_order)
select c.id, v.slug, v.name::jsonb, v.sort_order
from (values
  ('clothing',    'pants',      '{"ru":"Брюки","en":"Pants","it":"Pantaloni","fr":"Pantalons","de":"Hosen"}',                                   3),
  ('shoes',       'boots',      '{"ru":"Ботинки","en":"Boots","it":"Stivali","fr":"Bottes","de":"Stiefel"}',                                   2),
  ('shoes',       'loafers',    '{"ru":"Лоферы","en":"Loafers","it":"Mocassini","fr":"Mocassins","de":"Loafer"}',                               3),
  ('shoes',       'sandals',    '{"ru":"Сандалии и слайды","en":"Sandals & Slides","it":"Sandali e slides","fr":"Sandales et claquettes","de":"Sandalen & Slides"}', 4),
  ('accessories', 'hats',       '{"ru":"Шляпы","en":"Hats","it":"Cappelli","fr":"Chapeaux","de":"Hüte"}',                                       2),
  ('accessories', 'watches',    '{"ru":"Часы","en":"Watches","it":"Orologi","fr":"Montres","de":"Uhren"}',                                      3),
  ('accessories', 'sunglasses', '{"ru":"Солнцезащитные очки","en":"Sunglasses","it":"Occhiali","fr":"Lunettes de soleil","de":"Sonnenbrillen"}', 4),
  ('accessories', 'gloves',     '{"ru":"Перчатки","en":"Gloves","it":"Guanti","fr":"Gants","de":"Handschuhe"}',                                 5)
) as v(collection_slug, slug, name, sort_order)
join public.collections c on c.slug = v.collection_slug
on conflict (slug) do nothing;

-- "Cappelli" now names hats. Caps become "Cappellini" in Italian so the
-- storefront does not show two filters both labelled "Cappelli". Only the
-- seeded label is touched — one an admin has already changed is left alone.
update public.categories
   set name = name || '{"it":"Cappellini"}'::jsonb
 where slug = 'caps'
   and name ->> 'it' = 'Cappelli';
