-- 0024 — Saved looks and shareable capsules (AI Stylist)
--
-- A look the stylist assembled, kept so it can be revisited or sent to
-- someone as a link: /stylist/share/<id>.
--
-- product_ids holds product SLUGS, not uuids. The whole app keys products by
-- slug (Product.id IS products.slug), and a capsule has to resolve against the
-- same catalogue the stylist reads. They are validated against the catalogue
-- by the API before insert, so a capsule can only ever contain real products.

create table if not exists public.saved_looks (
  id          uuid primary key default gen_random_uuid(),

  -- Null for a guest. Guests can save and share too — a share link has to
  -- work for whoever receives it, which needs a row either way.
  user_id     uuid references auth.users (id) on delete cascade,

  product_ids text[] not null
    check (cardinality(product_ids) between 1 and 8),
  title       text not null default ''
    check (char_length(title) <= 80),
  notes       text not null default ''
    check (char_length(notes) <= 500),

  created_at  timestamptz not null default now()
);

-- A customer's own looks, newest first. Partial: guest rows (user_id null)
-- are never looked up by user and would only bloat the index.
create index if not exists saved_looks_user_created_idx
  on public.saved_looks (user_id, created_at desc)
  where user_id is not null;

alter table public.saved_looks enable row level security;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- DELIBERATELY NO PUBLIC SELECT POLICY.
--
-- "Anyone with the link can view it" is not expressible in RLS. A policy of
-- `for select using (true)` does not mean "readable by id" — it means any
-- holder of the public anon key can run `select * from saved_looks` and walk
-- every look ever saved, user_id included. The uuid in the URL is only a
-- secret if the table cannot be listed.
--
-- So public viewing goes through the server instead: /stylist/share/[id]
-- reads ONE row by primary key with the service role and never returns
-- user_id. That is exactly "read by id", enforced in code where it can be.
--
-- The policies below cover a signed-in customer's own rows, for any direct
-- client access now or later. `(select auth.uid())` rather than a bare
-- auth.uid() so Postgres evaluates it once per statement, not once per row.

drop policy if exists "saved_looks: owners read their own" on public.saved_looks;
create policy "saved_looks: owners read their own"
  on public.saved_looks
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "saved_looks: owners insert their own" on public.saved_looks;
create policy "saved_looks: owners insert their own"
  on public.saved_looks
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "saved_looks: owners delete their own" on public.saved_looks;
create policy "saved_looks: owners delete their own"
  on public.saved_looks
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- No update policy: a saved look is a snapshot. Editing one in place would
-- silently change what a previously shared link shows.

comment on table public.saved_looks is
  'AI Stylist capsules. Public viewing is by id through the server (service role), never via a public RLS select — see 0024 for why.';

-- ---------------------------------------------------------------------------
-- There is no 0025_back_in_stock.sql.
--
-- Back-in-stock subscriptions already exist as public.stock_alerts (0019,
-- with the uniqueness fix in 0020), and the scheduled sweep that sends the
-- emails (app/api/cron/sweep) reads ONLY that table. A second
-- back_in_stock_subscriptions table would accept sign-ups the sweep never
-- reads — subscriptions that look fine and are never notified.
-- ---------------------------------------------------------------------------
