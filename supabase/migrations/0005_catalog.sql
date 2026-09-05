-- ============================================================================
-- 0005_catalog.sql  —  collections, categories and products
--
-- Moves the catalogue out of lib/data.ts + localStorage and into Postgres.
--
-- Why this matters: products were previously written to the *admin's own
-- browser* local storage. A customer's browser held its own separate copy and
-- could never see an admin edit — on any timescale. This was not a caching
-- problem and revalidatePath could not have fixed it; the data simply never
-- travelled between browsers. This migration is that fix.
--
-- Naming: what the UI calls a "collection" is the top-level group
-- (clothing / shoes / accessories); `categories` are its children
-- (hoodies, tshirts, ...). Both keep their existing slugs so every product
-- reference, filter and translation key in the codebase keeps working.
--
-- Run AFTER 0001_profiles.sql. Independent of orders.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------- collections ----
create table if not exists public.collections (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Stable identifier used by products and by the storefront filters.
  -- Lowercase slug so URLs and query params stay predictable.
  slug       text not null unique
             check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  -- Localised display name: {"ru":"Одежда","en":"Clothing",...}. JSONB rather
  -- than one column per language so adding a locale is not a schema change.
  name       jsonb not null default '{}'::jsonb,

  -- Preview image for the homepage card. May be a data: URI (the admin
  -- uploader inlines small files) or a normal URL.
  image_url  text,

  sort_order integer not null default 0
);

create index if not exists collections_sort_idx on public.collections (sort_order, slug);

-- ------------------------------------------------------------ categories ----
create table if not exists public.categories (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  slug          text not null unique
                check (slug ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  name          jsonb not null default '{}'::jsonb,
  sort_order    integer not null default 0
);

create index if not exists categories_collection_idx
  on public.categories (collection_id, sort_order);

-- -------------------------------------------------------------- products ----
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Matches order_items.product_id and reviews.product_id, both of which store
  -- this slug as text. Keeping it stable is what lets historical orders keep
  -- pointing at the right product.
  slug          text not null unique,

  name          jsonb not null default '{}'::jsonb,
  description   jsonb not null default '{}'::jsonb,

  -- RESTRICT, not CASCADE: deleting a collection that still has products in it
  -- should fail loudly rather than silently destroy the catalogue.
  collection_id uuid not null references public.collections (id) on delete restrict,
  category_id   uuid not null references public.categories  (id) on delete restrict,

  price         numeric(12,2) not null check (price >= 0),
  old_price     numeric(12,2) check (old_price is null or old_price >= 0),

  image         text,
  images        text[] not null default '{}',
  sizes         text[] not null default '{}',

  -- [{"name":"Onyx","hex":"#141414"}, ...]
  colors        jsonb not null default '[]'::jsonb,
  -- ['in_stock','mirror_quality', ...] — matches StatusKey in lib/types.ts
  statuses      text[] not null default '{}',

  is_new        boolean not null default false,
  limited       boolean not null default false,

  -- [{"size":"S","length":63,"chest":106,"shoulder":47,"sleeve":60}, ...]
  size_chart    jsonb
);

create index if not exists products_collection_idx on public.products (collection_id);
create index if not exists products_category_idx   on public.products (category_id);
create index if not exists products_sale_idx       on public.products (old_price)
  where old_price is not null;

-- ------------------------------------------------------------ updated_at ----
drop trigger if exists collections_touch_updated_at on public.collections;
create trigger collections_touch_updated_at
  before update on public.collections
  for each row execute function public.touch_updated_at();

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------ RLS ----
alter table public.collections enable row level security;
alter table public.categories  enable row level security;
alter table public.products    enable row level security;

-- The catalogue is public by definition — anyone browsing the shop reads it.
drop policy if exists "catalogue is publicly readable" on public.collections;
create policy "catalogue is publicly readable"
  on public.collections for select to anon, authenticated using (true);

drop policy if exists "categories are publicly readable" on public.categories;
create policy "categories are publicly readable"
  on public.categories for select to anon, authenticated using (true);

drop policy if exists "products are publicly readable" on public.products;
create policy "products are publicly readable"
  on public.products for select to anon, authenticated using (true);

-- No insert/update/delete policies: the admin console writes with the
-- service-role key, which bypasses RLS. Prices must never be settable from a
-- browser.

-- --------------------------------------------------------------- seeding ----
-- The three collections and seven categories that were previously hardcoded in
-- lib/data.ts. Idempotent, so re-running the migration is safe.
insert into public.collections (slug, name, sort_order) values
  ('clothing',    '{"ru":"Одежда","en":"Clothing","it":"Abbigliamento","fr":"Vêtements","de":"Kleidung"}',      0),
  ('shoes',       '{"ru":"Обувь","en":"Shoes","it":"Scarpe","fr":"Chaussures","de":"Schuhe"}',                   1),
  ('accessories', '{"ru":"Аксессуары","en":"Accessories","it":"Accessori","fr":"Accessoires","de":"Accessoires"}', 2)
on conflict (slug) do nothing;

insert into public.categories (collection_id, slug, name, sort_order)
select c.id, v.slug, v.name::jsonb, v.sort_order
from (values
  ('clothing',    'hoodies',      '{"ru":"Худи","en":"Hoodies","it":"Felpe","fr":"Sweats","de":"Hoodies"}',                     0),
  ('clothing',    'tshirts',      '{"ru":"Футболки","en":"T-Shirts","it":"T-Shirt","fr":"T-Shirts","de":"T-Shirts"}',           1),
  ('clothing',    'jackets',      '{"ru":"Куртки","en":"Jackets","it":"Giacche","fr":"Vestes","de":"Jacken"}',                  2),
  ('shoes',       'sneakers',     '{"ru":"Кроссовки","en":"Sneakers","it":"Sneakers","fr":"Baskets","de":"Sneaker"}',           0),
  ('shoes',       'sneakers_low', '{"ru":"Кеды","en":"Low-Top","it":"Basse","fr":"Basses","de":"Low-Top"}',                     1),
  ('accessories', 'bags',         '{"ru":"Сумки","en":"Bags","it":"Borse","fr":"Sacs","de":"Taschen"}',                         0),
  ('accessories', 'caps',         '{"ru":"Кепки","en":"Caps","it":"Cappelli","fr":"Casquettes","de":"Kappen"}',                 1)
) as v(collection_slug, slug, name, sort_order)
join public.collections c on c.slug = v.collection_slug
on conflict (slug) do nothing;
