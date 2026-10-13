-- ============================================================================
-- 0058_search_products_limits.sql
-- ============================================================================
-- search_products (0017, rewritten in 0045) trusted its caller for two things:
--
--   * p_limit went straight into LIMIT. 1000000 asked for everything; NULL
--     meant no limit at all; a negative number raised an error.
--   * p_query had no length bound. The misspelling pass runs pg_trgm's
--     similarity() of the query against every product name, so a query of
--     hundreds of kilobytes is a CPU cost per product, per call.
--
-- And it was granted to anon and authenticated, so both were reachable with
-- the public key straight through PostgREST — around /api/search, its rate
-- limit ('search' bucket) and its CDN cache. Nothing private leaked (it returns
-- slugs of products, which are public), but it was an unthrottled way to make
-- the database work.
--
-- From here:
--
--   * the limit is clamped to 1..50 (the storefront asks for 24), NULL → 24;
--   * the query is trimmed and cut to 100 characters (the route already cuts
--     to 60), and below 2 characters nothing is returned, as before;
--   * only service_role may execute it. The storefront calls it through
--     /api/search with the service-role client (app/api/search/route.ts) and
--     never from the browser, so nothing user-facing changes.
--
-- Same signature, same results for every call the storefront makes.
-- Idempotent. Rollback-safe: older code calls it the same way.
-- ============================================================================

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
      v_q     text    := left(btrim(coalesce(p_query, '')), 100);
      v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 50);
      v_ts    tsquery;
      v_found integer;
    begin
      if char_length(v_q) < 2 then
        return;
      end if;

      v_ts := websearch_to_tsquery('simple', v_q);

      return query
        select p.slug,
               ts_rank(p.search_vector, v_ts) as rank,
               false
          from public.products p
         where p.search_vector @@ v_ts
         order by rank desc, p.created_at desc
         limit v_limit;

      get diagnostics v_found = row_count;
      if v_found > 0 then
        return;
      end if;

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
         limit v_limit;
    end;
    $body$
  $fn$, v_trgm);
end
$migration$;

revoke all on function public.search_products(text, integer) from public, anon, authenticated;
grant execute on function public.search_products(text, integer) to service_role;

comment on function public.search_products(text, integer) is
  'Catalogue search for /api/search (service role only). Limit clamped to 1..50, query to 100 characters.';
