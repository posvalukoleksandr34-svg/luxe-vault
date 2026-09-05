-- ============================================================================
-- 0004_reviews_returns.sql  —  STEP 4 (not yet runnable as written)
--
-- NOTE: the reviews table below models PURCHASE-LINKED product reviews
-- (user_id + product_id NOT NULL, gated on a delivered order). The review
-- feature currently live on the site is different: anonymous site
-- testimonials with only a name, rating and message. Decide which one you
-- want before running this — see the note in the chat.
-- ============================================================================

-- --------------------------------------------------------------- reviews ----
create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid not null references auth.users (id)     on delete cascade,
  -- Catalogue slug from lib/data.ts (e.g. 'p-hoodie-noir'), matching
  -- order_items.product_id. Not a uuid and not an FK: products still live in
  -- code, so a reference to public.products would fail to create.
  product_id  text not null,
  -- Nullable so a review survives an order being purged, but present it lets
  -- you show a "verified purchase" badge.
  order_id    uuid references public.orders (id) on delete set null,
  rating      smallint not null check (rating between 1 and 5),
  comment     text check (char_length(btrim(comment)) <= 4000),
  status      public.review_status not null default 'pending'
);

-- One review per customer per product per order.
create unique index if not exists reviews_one_per_user_product_order_idx
  on public.reviews (user_id, product_id, coalesce(order_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists reviews_product_approved_idx
  on public.reviews (product_id, created_at desc) where status = 'approved';

alter table public.reviews enable row level security;

-- The storefront shows approved reviews to everyone.
drop policy if exists "approved reviews are public" on public.reviews;
create policy "approved reviews are public"
  on public.reviews for select
  to anon, authenticated
  using (status = 'approved');

-- A user always sees their own, including while still pending.
drop policy if exists "users read their own reviews" on public.reviews;
create policy "users read their own reviews"
  on public.reviews for select
  to authenticated
  using (user_id = auth.uid());

-- A user may only review a product on an order that is theirs AND delivered.
-- `status` is forced to 'pending' here so a client cannot self-approve.
drop policy if exists "users review their delivered orders" on public.reviews;
create policy "users review their delivered orders"
  on public.reviews for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.user_id = auth.uid()
        and o.status = 'delivered'
    )
  );


-- ------------------------------------------------- orders.return_status ----
alter table public.orders
  add column if not exists return_status       public.return_status not null default 'none',
  add column if not exists return_reason       text,
  add column if not exists return_requested_at timestamptz;

create index if not exists orders_return_status_idx
  on public.orders (return_status) where return_status <> 'none';

-- A customer may move their own delivered order from 'none' to 'requested',
-- and nothing else. Approving and refunding stay with the service_role key.
drop policy if exists "users request a return on delivered orders" on public.orders;
create policy "users request a return on delivered orders"
  on public.orders for update
  to authenticated
  using (user_id = auth.uid() and status = 'delivered' and return_status = 'none')
  with check (user_id = auth.uid() and return_status = 'requested');
