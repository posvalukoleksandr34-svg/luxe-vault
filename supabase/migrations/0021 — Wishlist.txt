-- ---------------------------------------------------------------------------
-- 0021 — Wishlist
-- ---------------------------------------------------------------------------
-- Server-backed rather than localStorage, because the whole value of a
-- wishlist is that it survives: the customer who saved a coat on their phone
-- during a commute is the one who buys it on a laptop that evening. A local
-- list is invisible to that second device and gone when site data is cleared.
--
-- Stored per PRODUCT, not per variant. A wishlist is "I want this thing",
-- decided before size and colour are; the cart is where those get chosen.
-- Keying on the variant would force a decision the customer has not made and
-- would fragment one saved product into four rows.
-- ---------------------------------------------------------------------------

create table if not exists public.wishlist_items (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),

  user_id     uuid not null references auth.users (id) on delete cascade,

  -- The catalogue slug, matching order_items.product_id and reviews.product_id.
  -- Text rather than a uuid FK for the same reason those are: the application
  -- refers to products by slug throughout.
  product_id  text not null check (char_length(btrim(product_id)) between 1 and 200),

  unique (user_id, product_id)
);

-- "What has this customer saved", newest first — the only query the account
-- page makes.
create index if not exists wishlist_user_recent_idx
  on public.wishlist_items (user_id, created_at desc);

alter table public.wishlist_items enable row level security;

-- Entirely the customer's own. Every policy is scoped to auth.uid(), so the
-- database refuses to hand one person another's list even if a route handler
-- asks for it.
drop policy if exists "users read their own wishlist" on public.wishlist_items;
create policy "users read their own wishlist"
  on public.wishlist_items for select
  using (user_id = auth.uid());

drop policy if exists "users add to their own wishlist" on public.wishlist_items;
create policy "users add to their own wishlist"
  on public.wishlist_items for insert
  with check (user_id = auth.uid());

drop policy if exists "users remove from their own wishlist" on public.wishlist_items;
create policy "users remove from their own wishlist"
  on public.wishlist_items for delete
  using (user_id = auth.uid());

comment on table public.wishlist_items is
  'Saved products, per customer. RLS-scoped to the owner; keyed by product, not variant.';
