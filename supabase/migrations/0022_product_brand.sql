-- Per-product brand.
--
-- The product page displayed a hardcoded "Бренд: Luxe Vault" on every item and
-- there was no column behind it, so an admin had no way to say what a piece
-- actually is. This is that column.
--
-- Nullable and with no default: a product with no brand renders no brand line
-- at all, which is why the app treats null and '' identically. Backfilling
-- every existing row with a placeholder would put a label on products nobody
-- has reviewed yet.
alter table public.products
  add column if not exists brand text;

comment on column public.products.brand is
  'Free-text brand shown on the product card and product page. Null or empty means no brand label is rendered.';

-- Products are read by slug and by collection, never searched by brand, so no
-- index: one on a low-cardinality nullable text column would cost every write
-- and serve no query this app makes.
