-- Cover photographs for subcategories.
--
-- The department pages show each subcategory as a card with a photograph
-- (components/products/subcategory-cards.tsx). Until now that photograph was
-- always the subcategory's own best product. This lets the admin choose one
-- instead (Admin → Разделы → Категории): the chosen cover wins, the product
-- photo is the fallback, and an empty subcategory without either shows its
-- initial.
--
-- Public like the rest of the category row: categories are publicly readable
-- (0005) and the image is shown on the storefront. Written only by the server
-- (service role) from the admin console; there is no customer write policy.
--
-- Deploy order: either. The code reads categories without this column when
-- it is missing (no covers, everything else unchanged) and refuses to save a
-- cover until it exists.
--
-- Idempotent; safe to re-run.

alter table public.categories
  add column if not exists image_url text;

-- An address, not a blob: a base64 image in this column would travel in every
-- page's HTML (the same reason collection covers moved to Storage). http is
-- allowed for a local Supabase; the API accepts http only from our Storage.
do $$ begin
  alter table public.categories
    add constraint categories_image_url_check
    check (image_url is null or (char_length(image_url) <= 2048 and image_url ~ '^(https?://|/)'));
exception when duplicate_object then null; end $$;

comment on column public.categories.image_url is
  'Optional cover photograph for the subcategory card on the department page. Falls back to the subcategory''s best product photo.';
