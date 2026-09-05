-- ============================================================================
-- 0001_support_reviews_returns.sql
--
-- Adds: support_tickets, reviews, and orders.return_status.
--
-- ASSUMPTIONS — verify these before running:
--   * public.orders exists with a uuid primary key (created by 0002_orders.sql).
--   * public.products does NOT exist yet — the catalogue is still in lib/data.ts,
--     so reviews.product_id is a text slug rather than a foreign key. Add the
--     FK in a later migration once products move into Postgres.
--   * Admin access happens through the service_role key, which bypasses RLS.
--     That is why there is deliberately NO select policy on support_tickets:
--     the public may write to it, but only the server may read it.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------- enums ----
do $$ begin
  create type public.support_ticket_status as enum ('open', 'resolved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.review_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.return_status as enum ('none', 'requested', 'approved', 'refunded');
exception when duplicate_object then null; end $$;


-- ------------------------------------------------------- support_tickets ----
create table if not exists public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  -- Null for logged-out visitors: the contact form must work without an account.
  user_id     uuid references auth.users (id) on delete set null,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  email       text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  message     text not null check (char_length(btrim(message)) between 1 and 4000),
  status      public.support_ticket_status not null default 'open',
  -- Set once the confirmation email is accepted by Resend; lets you find and
  -- retry tickets whose email failed without re-sending the successful ones.
  email_sent_at timestamptz
);

create index if not exists support_tickets_created_at_idx
  on public.support_tickets (created_at desc);
create index if not exists support_tickets_status_idx
  on public.support_tickets (status) where status = 'open';

alter table public.support_tickets enable row level security;

-- Anyone may file a ticket...
drop policy if exists "anyone can file a support ticket" on public.support_tickets;
create policy "anyone can file a support ticket"
  on public.support_tickets for insert
  to anon, authenticated
  with check (true);

-- ...and a signed-in user may read only their own. Anonymous tickets are
-- readable by the service_role key alone (no policy grants them).
drop policy if exists "users read their own tickets" on public.support_tickets;
create policy "users read their own tickets"
  on public.support_tickets for select
  to authenticated
  using (user_id = auth.uid());


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
