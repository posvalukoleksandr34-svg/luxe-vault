-- ============================================================================
-- 0006_site_reviews.sql  —  anonymous testimonials, kept apart from
--                           purchase-verified product reviews
--
-- The problem this solves: `public.reviews` (from the earlier migration)
-- models a PURCHASE-LINKED review — user_id and product_id are NOT NULL and
-- the insert policy requires a delivered order belonging to the reviewer.
-- The testimonial widget already live on the site posts {name, rating,
-- message} with no account and no product, so its inserts fail outright:
--
--   PGRST204: Could not find the 'name' column of 'reviews'
--
-- Rather than weaken `reviews` (which would destroy the "verified purchase"
-- guarantee that makes those reviews worth showing), anonymous testimonials
-- get their own table. Two tables because they are two different claims:
--
--   public.reviews       "a real buyer received this product and rates it X"
--   public.site_reviews  "someone left a comment about the store"
--
-- Run AFTER 0001_profiles.sql.
-- ============================================================================

create extension if not exists pgcrypto;

do $$ begin
  create type public.site_review_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.site_reviews (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Display name or alias. Not an identity claim, so no auth.users reference;
  -- user_id below is set only when the sender happened to be signed in.
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  rating     smallint not null check (rating between 1 and 5),
  message    text not null check (char_length(btrim(message)) between 1 and 800),

  user_id    uuid references auth.users (id) on delete set null,

  -- Moderated: nothing reaches the storefront until an admin approves it.
  status     public.site_review_status not null default 'pending'
);

create index if not exists site_reviews_approved_idx
  on public.site_reviews (created_at desc) where status = 'approved';

alter table public.site_reviews enable row level security;

-- Anyone may leave a testimonial...
drop policy if exists "anyone can leave a testimonial" on public.site_reviews;
create policy "anyone can leave a testimonial"
  on public.site_reviews for insert
  to anon, authenticated
  with check (status = 'pending');   -- clients cannot self-approve

-- ...and anyone may read the approved ones. Pending and rejected rows stay
-- invisible to the public and are readable only with the service-role key.
drop policy if exists "approved testimonials are public" on public.site_reviews;
create policy "approved testimonials are public"
  on public.site_reviews for select
  to anon, authenticated
  using (status = 'approved');
