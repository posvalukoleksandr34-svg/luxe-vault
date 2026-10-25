-- ============================================================================
-- 0062_product_publication.sql
-- ============================================================================
-- A product is on sale only when someone has published it, and it can be
-- published only once the owner has recorded on what basis the shop may sell
-- it.
--
-- THE PROBLEM. There was no draft or published state: a product saved in the
-- admin was in the catalogue, the search, the sitemap, the cart and the
-- checkout at once. Nothing could keep a piece whose sale rights were not
-- confirmed off the shop, and the public key could read every product row.
--
-- WHAT THIS ADDS.
--
--   products.listing_status   'draft' | 'published' | 'withdrawn'.
--                             EVERY EXISTING PRODUCT BECOMES 'draft', which
--                             takes it off sale until the owner has reviewed
--                             it. That is the point of this migration, not a
--                             side effect.
--   products.published_at     When it was last published.
--
--   public.product_rights     The owner's own record of why the shop may sell
--                             a product: the basis (own design without third-
--                             party marks, or authorised resale of genuine
--                             goods), a reference the owner can produce on
--                             request (an invoice, a supplier agreement, a
--                             design file), and when it was confirmed. Server
--                             only: RLS on, no policies, no grants. It names
--                             suppliers and invoices, so it never reaches a
--                             browser.
--
--   A trigger refuses 'published' for a product with no complete rights
--   record, so no code path — admin API, SQL editor, a future import — can
--   publish around the review.
--
-- READS. Anonymous and signed-in visitors (the public key) see published
-- products only, and only their variants. search_products returns published
-- products only. The service role still reads everything, which is what the
-- admin console uses; the storefront's server code filters by status itself
-- (lib/server/catalog-store.ts).
--
-- What this does NOT do: decide anything. No product is published here, no
-- basis is recorded, no reference is invented. The owner does that per
-- product in Admin → Товары.
--
-- Orders, reviews and stock are untouched; an order keeps its own lines.
-- Idempotent. Rollback: listing_status can be dropped; older code ignores it.
-- ============================================================================

alter table public.products
  add column if not exists listing_status text not null default 'draft',
  add column if not exists published_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.products'::regclass and conname = 'products_listing_status_check'
  ) then
    alter table public.products
      add constraint products_listing_status_check
      check (listing_status in ('draft', 'published', 'withdrawn'));
  end if;
end
$$;

create index if not exists products_listing_status_idx on public.products (listing_status);

comment on column public.products.listing_status is
  'draft = never published; published = on sale; withdrawn = taken off sale. Only published products are public.';

-- ------------------------------------------------------------ rights ------
create table if not exists public.product_rights (
  product_id   uuid primary key references public.products (id) on delete cascade,
  -- own_design:        the shop's own product, no third-party trade marks or designs
  -- authorized_resale: genuine branded goods the shop has the right to resell
  basis        text not null check (basis in ('own_design', 'authorized_resale')),
  -- What the owner can show on request. Free text, required.
  reference    text not null check (char_length(btrim(reference)) between 3 and 500),
  confirmed_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.product_rights enable row level security;
revoke all on public.product_rights from anon, authenticated;

comment on table public.product_rights is
  'Owner-recorded basis for selling a product. Server-only. Required before a product can be published.';

-- ------------------------------------------------ publish needs rights -----
create or replace function public.products_require_rights()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.listing_status = 'published' then
    if not exists (select 1 from public.product_rights r where r.product_id = new.id) then
      raise exception 'PRODUCT_RIGHTS_REQUIRED: product % has no recorded sale rights', new.slug
        using errcode = 'check_violation';
    end if;
    if tg_op = 'INSERT' or old.listing_status is distinct from 'published' then
      new.published_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists products_require_rights on public.products;
create trigger products_require_rights
  before insert or update of listing_status on public.products
  for each row execute function public.products_require_rights();

-- Deleting the rights record takes the product off sale with it.
create or replace function public.product_rights_withdraw()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.products set listing_status = 'withdrawn'
   where id = old.product_id and listing_status = 'published';
  return old;
end;
$$;

drop trigger if exists product_rights_withdraw on public.product_rights;
create trigger product_rights_withdraw
  after delete on public.product_rights
  for each row execute function public.product_rights_withdraw();

-- ------------------------------------------------------ public reads ------
drop policy if exists "products are publicly readable" on public.products;
drop policy if exists "published products are publicly readable" on public.products;
create policy "published products are publicly readable"
  on public.products for select to anon, authenticated
  using (listing_status = 'published');

drop policy if exists "variant stock is publicly readable" on public.product_variants;
drop policy if exists "published variant stock is publicly readable" on public.product_variants;
create policy "published variant stock is publicly readable"
  on public.product_variants for select to anon, authenticated
  using (exists (
    select 1 from public.products p
     where p.id = product_variants.product_id and p.listing_status = 'published'
  ));

-- ------------------------------------------------------------- search ------
-- 0058's function with one condition added to each pass: published only.
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
         where p.listing_status = 'published'
           and p.search_vector @@ v_ts
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
         where p.listing_status = 'published'
           and (coalesce(p.name ->> 'ru', '') || ' ' || coalesce(p.name ->> 'en', ''))
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
  'Catalogue search for /api/search (service role only). Published products only. Limit clamped to 1..50, query to 100 characters.';
