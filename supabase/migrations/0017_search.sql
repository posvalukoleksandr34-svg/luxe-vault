-- ---------------------------------------------------------------------------
-- 0017 — Search that can actually find things
-- ---------------------------------------------------------------------------
-- Search was one line in the product grid:
--
--   if (!localize(p.name).toLowerCase().includes(q)) return false
--
-- A case-insensitive substring match, in the browser, against the localised
-- product name only. That means:
--
--   * "coat" does not match a product described as a coat unless the word is
--     in its name — the description, category and collection are invisible.
--   * "cot" finds nothing. One transposed letter is a dead end, and a dead end
--     on a search box is a lost sale.
--   * "coats" does not match "coat". No stemming.
--   * Ranking does not exist: results come back in catalogue order, so the
--     best match can be last.
--   * It only works on products already downloaded to the browser, which stops
--     being true the moment the catalogue outgrows one payload.
--
-- WHY BOTH FTS AND TRIGRAM
--
-- They fail in opposite directions and cover each other. Full-text search
-- stems and ranks real words but cannot cope with a typo: to tsquery, "cot" is
-- simply a different word. Trigram similarity is spelling-tolerant but has no
-- concept of language, so on its own it ranks nonsense highly.
--
-- So: FTS first, and only when it returns nothing does the query fall back to
-- trigram. A customer who spells the word correctly gets ranked, stemmed
-- results; one who fat-fingers it still gets the product.
-- ---------------------------------------------------------------------------

create extension if not exists pg_trgm;

-- A generated column, not a trigger-maintained one: it cannot drift from the
-- row, and there is no ordering hazard with other triggers on the table.
--
-- Weights carry the ranking. A hit in the NAME (A) should always outrank one
-- in the DESCRIPTION (C), which is what makes ts_rank meaningful rather than
-- decorative. The 'simple' configuration is deliberate — the catalogue holds
-- five languages in one jsonb column, and applying English stemming to French
-- and Russian text produces worse matches than applying none.
alter table public.products
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(name ->> 'ru', '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(name ->> 'en', '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(name ->> 'it', '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(name ->> 'fr', '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(name ->> 'de', '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(slug, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(description ->> 'ru', '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(description ->> 'en', '')), 'C')
  ) stored;

create index if not exists products_search_idx
  on public.products using gin (search_vector);

-- Backs the trigram fallback. Indexes the two names most likely to be
-- mistyped; the description is excluded because fuzzy-matching a paragraph
-- produces noise, not tolerance.
create index if not exists products_trgm_idx
  on public.products using gin (
    ((coalesce(name ->> 'ru', '') || ' ' || coalesce(name ->> 'en', ''))) gin_trgm_ops
  );

-- ---------------------------------------------------------------------------
-- Popular searches
-- ---------------------------------------------------------------------------
-- What people actually type, so the empty search panel can suggest something
-- real instead of a hardcoded list that goes stale the week it is written.
-- Only terms that RETURNED RESULTS are counted: suggesting a query that finds
-- nothing is worse than suggesting nothing.
-- ---------------------------------------------------------------------------
create table if not exists public.search_terms (
  term        text primary key check (char_length(term) between 2 and 60),
  hits        integer not null default 0 check (hits >= 0),
  last_seen   timestamptz not null default now()
);

create index if not exists search_terms_popular_idx
  on public.search_terms (hits desc, last_seen desc);

alter table public.search_terms enable row level security;

-- Readable by anyone (it drives a public suggestion list); written only by the
-- service role through record_search() below. A client that could write here
-- could stuff the suggestion list with anything it liked.
drop policy if exists "popular searches are public" on public.search_terms;
create policy "popular searches are public"
  on public.search_terms for select
  using (true);

comment on table public.search_terms is
  'Search terms that returned results, counted for the popular-searches list.';

-- ---------------------------------------------------------------------------
-- search_products — FTS, then trigram
-- ---------------------------------------------------------------------------
create or replace function public.search_products(
  p_query text,
  p_limit integer default 24
)
returns table (slug text, rank real, fuzzy boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q   text := btrim(p_query);
  v_ts  tsquery;
  v_any boolean;
begin
  if char_length(v_q) < 2 then
    return;
  end if;

  -- websearch_to_tsquery understands quoted phrases and "-word", and — unlike
  -- to_tsquery — never raises on punctuation a customer happens to type.
  v_ts := websearch_to_tsquery('simple', v_q);

  return query
    select p.slug,
           ts_rank(p.search_vector, v_ts) as rank,
           false
      from public.products p
     where p.search_vector @@ v_ts
     order by rank desc, p.created_at desc
     limit p_limit;

  get diagnostics v_any = row_count;
  if v_any then
    return;
  end if;

  -- Nothing matched as words. Try it as a misspelling.
  return query
    select p.slug,
           similarity(
             coalesce(p.name ->> 'ru', '') || ' ' || coalesce(p.name ->> 'en', ''),
             v_q
           )::real as rank,
           true
      from public.products p
     where (coalesce(p.name ->> 'ru', '') || ' ' || coalesce(p.name ->> 'en', '')) % v_q
     order by rank desc
     limit p_limit;
end;
$$;

revoke all on function public.search_products(text, integer) from public;
grant execute on function public.search_products(text, integer) to anon, authenticated;

comment on function public.search_products(text, integer) is
  'Full-text search over the catalogue, falling back to trigram similarity when FTS finds nothing.';

-- ---------------------------------------------------------------------------
-- record_search — count a term that found something
-- ---------------------------------------------------------------------------
create or replace function public.record_search(p_term text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term text := lower(btrim(p_term));
begin
  if char_length(v_term) < 2 or char_length(v_term) > 60 then
    return;
  end if;

  insert into public.search_terms (term, hits, last_seen)
  values (v_term, 1, now())
  on conflict (term) do update
    set hits = public.search_terms.hits + 1,
        last_seen = now();
end;
$$;

revoke all on function public.record_search(text) from public, anon, authenticated;

comment on function public.record_search(text) is
  'Increments a search term. Called server-side only, and only for searches that returned results.';
