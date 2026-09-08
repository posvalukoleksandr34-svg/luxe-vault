-- ---------------------------------------------------------------------------
-- 0018 — Product specifications, and making the reviews table usable
-- ---------------------------------------------------------------------------
-- Two small things the product page needs.
--
-- SPECS
--
-- There was nowhere to record what a garment is made of. "100% merino wool",
-- "Italian calf leather", "dry clean only" — the details a customer looks for
-- before spending CHF 400, and the details that reduce returns when they are
-- present. A jsonb array rather than columns because the useful fields differ
-- per category: a coat has a composition and a care instruction, a bag has
-- dimensions and a hardware finish, and a column per possibility would be
-- mostly nulls.
--
-- REVIEWS
--
-- public.reviews has existed since 0004 and nothing has ever read or written
-- it. The table is fine; what was missing is an index for the query the
-- product page actually makes, and a way to show a reviewer's name without
-- exposing the profiles table.
-- ---------------------------------------------------------------------------

alter table public.products
  -- [{"label":"Composition","value":"100% merino wool"}, ...]
  -- Plain strings, not localised: an admin maintaining five translations of
  -- "100% cotton" will not, and a half-translated spec list looks worse than
  -- an untranslated one.
  add column if not exists specs jsonb not null default '[]'::jsonb;

comment on column public.products.specs is
  'Specification rows as [{label, value}]. Rendered on the product page.';

-- The product page asks exactly one question of this table: "approved reviews
-- for this product, newest first". 0004 indexed (product_id) where approved;
-- adding created_at lets the sort come from the index too.
create index if not exists reviews_product_recent_idx
  on public.reviews (product_id, created_at desc)
  where status = 'approved';

-- ---------------------------------------------------------------------------
-- product_review_stats — the summary the page shows above the list
-- ---------------------------------------------------------------------------
-- Average and per-star counts, computed in one pass. A view rather than
-- application code so the storefront and the admin cannot disagree about what
-- a product's rating is, and so the counts arrive in the same round trip.
--
-- Only APPROVED reviews count. A pending review must not move the average
-- before a human has looked at it, or moderation is decorative.
-- ---------------------------------------------------------------------------
create or replace view public.product_review_stats as
  select
    product_id,
    count(*)::integer                                   as total,
    round(avg(rating)::numeric, 2)                      as average,
    count(*) filter (where rating = 5)::integer         as five,
    count(*) filter (where rating = 4)::integer         as four,
    count(*) filter (where rating = 3)::integer         as three,
    count(*) filter (where rating = 2)::integer         as two,
    count(*) filter (where rating = 1)::integer         as one
  from public.reviews
  where status = 'approved'
  group by product_id;

comment on view public.product_review_stats is
  'Approved-review counts and average per product. Pending reviews are excluded on purpose.';

-- ---------------------------------------------------------------------------
-- can_review — may this customer review this product?
-- ---------------------------------------------------------------------------
-- The RLS policy from 0004 already enforces this on INSERT, but the product
-- page needs to know BEFORE rendering a form: offering a review box to someone
-- who will be refused is a worse experience than not offering one.
--
-- The rule is deliberately strict. Only a delivered order counts, so a review
-- is always from someone who received the goods, and the unique index from
-- 0004 keeps it to one review per product per order.
-- ---------------------------------------------------------------------------
create or replace function public.can_review(p_product_id text)
returns table (allowed boolean, order_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select true, o.id
    from public.orders o
    join public.order_items i on i.order_id = o.id
   where o.user_id = auth.uid()
     and o.status = 'delivered'
     and i.product_id = p_product_id
     and not exists (
       select 1 from public.reviews r
        where r.user_id = auth.uid()
          and r.product_id = p_product_id
          and r.order_id = o.id
     )
   order by o.delivered_at desc nulls last
   limit 1;
$$;

revoke all on function public.can_review(text) from public;
grant execute on function public.can_review(text) to authenticated;

comment on function public.can_review(text) is
  'Returns the delivered order a signed-in customer may review this product against, if any.';
