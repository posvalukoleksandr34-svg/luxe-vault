-- ---------------------------------------------------------------------------
-- 0045 — search_products: make both of its passes actually run
-- ---------------------------------------------------------------------------
-- Two defects in 0017's function, each of which sent /api/search to its
-- fallback — a plain substring match over product names, with no ranking, no
-- description or brand matching and no typo tolerance. That answer is marked
-- degraded, which the route deliberately never caches, so the affected
-- searches also skipped the edge cache and re-read the whole catalogue.
--
-- 1. The full-text pass stored GET DIAGNOSTICS row_count in a BOOLEAN.
--    PL/pgSQL converts the integer through text, and a boolean accepts only
--    '0' and '1', so every search that found TWO OR MORE products raised
--      invalid input syntax for type boolean: "24"
--    — the common searches ("jacket", "black"), not the rare ones.
--
-- 2. The misspelling pass called pg_trgm's similarity() and % unqualified
--    under `set search_path = ''`, where they cannot be found:
--      function similarity(text, text) does not exist
--    Typo tolerance has never run. The functions are now qualified with the
--    schema pg_trgm is actually installed in (public or extensions, depending
--    on how the project was set up), looked up here rather than assumed, and
--    the hardened empty search_path stays.
--
-- Both reproduced against a database built from these migrations:
--   select count(*) from public.search_products('hoodie', 24);  -- defect 1
--   select count(*) from public.search_products('hodie', 24);   -- defect 2
--
-- Otherwise the body is 0017's.
-- ---------------------------------------------------------------------------

do $migration$
declare
  v_trgm text;
begin
  select n.nspname
    into v_trgm
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';

  if v_trgm is null then
    raise exception 'pg_trgm is not installed — apply 0017_search.sql first';
  end if;

  -- format(): %1$I is the pg_trgm schema; %% is a literal % (the operator).
  execute format($fn$
    create or replace function public.search_products(
      p_query text,
      p_limit integer default 24
    )
    returns table (slug text, rank real, fuzzy boolean)
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $body$
    declare
      v_q     text := btrim(p_query);
      v_ts    tsquery;
      v_found integer;
    begin
      if char_length(v_q) < 2 then
        return;
      end if;

      -- websearch_to_tsquery understands quoted phrases and "-word", and —
      -- unlike to_tsquery — never raises on punctuation a customer types.
      v_ts := websearch_to_tsquery('simple', v_q);

      return query
        select p.slug,
               ts_rank(p.search_vector, v_ts) as rank,
               false
          from public.products p
         where p.search_vector @@ v_ts
         order by rank desc, p.created_at desc
         limit p_limit;

      get diagnostics v_found = row_count;
      if v_found > 0 then
        return;
      end if;

      -- Nothing matched as words. Try it as a misspelling.
      return query
        select p.slug,
               %1$I.similarity(
                 coalesce(p.name ->> 'ru', '') || ' ' || coalesce(p.name ->> 'en', ''),
                 v_q
               )::real as rank,
               true
          from public.products p
         where (coalesce(p.name ->> 'ru', '') || ' ' || coalesce(p.name ->> 'en', ''))
               operator(%1$I.%%) v_q
         order by rank desc
         limit p_limit;
    end;
    $body$
  $fn$, v_trgm);
end
$migration$;

revoke all on function public.search_products(text, integer) from public;
grant execute on function public.search_products(text, integer) to anon, authenticated;