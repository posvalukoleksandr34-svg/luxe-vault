-- ---------------------------------------------------------------------------
-- 0033 — Search descriptions in every storefront language
-- ---------------------------------------------------------------------------
-- 0017 indexed product NAMES in all five languages but DESCRIPTIONS only in
-- Russian and English, so an Italian, French or German shopper typing a word
-- that appears only in their language's description found nothing — while the
-- same word in English did. The storefront writes descriptions in all five
-- (the admin form fills the missing ones on save), so the index should read
-- all five.
--
-- Weights are unchanged: names still outrank descriptions (A/B over C), and
-- every description language gets the same C weight — no language's
-- description should rank above another's.
--
-- HOW. A generated column's expression cannot be altered in place, so the
-- column is dropped and added again. Its GIN index is dropped with it and
-- recreated below. search_products() refers to the column by name inside
-- PL/pgSQL, which PostgreSQL does not track as a dependency, so the function
-- needs no change and works as soon as the column is back. For the moment in
-- between, /api/search already falls back to a substring scan when the RPC
-- errors, so search never goes dark.
--
-- Adding a stored generated column rewrites the table — trivial at this
-- catalogue's size.
-- ---------------------------------------------------------------------------

alter table public.products drop column if exists search_vector;

alter table public.products
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(name ->> 'ru', '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(name ->> 'en', '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(name ->> 'it', '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(name ->> 'fr', '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(name ->> 'de', '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(slug, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description ->> 'ru', '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(description ->> 'en', '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(description ->> 'it', '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(description ->> 'fr', '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(description ->> 'de', '')), 'C')
  ) stored;

create index if not exists products_search_idx
  on public.products using gin (search_vector);

comment on column public.products.search_vector is
  'Generated full-text vector: names (ru/en A; it/fr/de/slug B) and descriptions in all five languages (C).';
