-- Styling metadata for the AI Stylist.
--
-- ONE nullable jsonb column, not a new table and not a rewrite of `products`.
-- Everything the stylist needs that the catalogue does not already carry —
-- style register, fit, occasion, season — lives here; everything it already
-- carries (category, colours, sizes, price, brand, stock) is read from the
-- existing columns rather than duplicated, so there is no second copy to drift.
--
-- Nullable on purpose. The engine derives a usable tag set from the category,
-- colours, name and price of an untagged product (see deriveTags in
-- lib/stylist/tagging.ts), so the feature works on a catalogue nobody has
-- tagged yet and improves as the admin fills these in. A NOT NULL column with
-- a default would have made every existing product claim tags it never chose.
alter table public.products
  add column if not exists style_tags jsonb;

comment on column public.products.style_tags is
  'AI Stylist metadata: {"style":["streetwear"],"fit":"oversized","occasion":["casual"],"season":["fall","winter"]}. Null means "not tagged" — the stylist infers a fallback from the product''s other fields rather than excluding it.';

-- A shape guard rather than a schema. The stylist reads these defensively and
-- ignores anything it does not recognise, so the constraint only rejects the
-- case that would be a mistake in any reading: a non-object.
alter table public.products
  drop constraint if exists products_style_tags_is_object;

alter table public.products
  add constraint products_style_tags_is_object
  check (style_tags is null or jsonb_typeof(style_tags) = 'object');

-- No index. The stylist loads the catalogue once per request and scores it in
-- memory — this shop's catalogue is small, and a GIN index on a column that is
-- never used in a WHERE clause would cost every write and serve no read.
