-- ============================================================================
-- 0001_profiles.sql  —  STEP 1: auth foundation
--
-- Supabase Auth owns identity in `auth.users` (email, encrypted password,
-- confirmation state). That table is managed by Supabase and must not be
-- written to directly. Application-level profile data lives here instead, in
-- public.profiles, joined 1:1 by id.
--
-- Run this FIRST. 0002 (orders/products) and 0003 (support/reviews/returns)
-- both reference auth.users and assume profiles already exists.
-- ============================================================================

create extension if not exists pgcrypto;

-- -------------------------------------------------------------- profiles ----
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name       text not null check (char_length(btrim(name)) between 1 and 120),
  -- Denormalised from auth.users for cheap display/admin listing. Kept in sync
  -- by the trigger below; auth.users remains the source of truth for login.
  email      text not null
);

create index if not exists profiles_email_idx on public.profiles (lower(email));

alter table public.profiles enable row level security;

drop policy if exists "users read their own profile" on public.profiles;
create policy "users read their own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

-- Name is editable; id and email are not (email changes go through Supabase
-- Auth, which re-fires the sync trigger below).
drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No insert policy on purpose: rows are created only by the signup trigger,
-- which runs as SECURITY DEFINER and therefore bypasses RLS.


-- ---------------------------------------------- signup / email-sync trigger ----
-- SECURITY DEFINER so it can write to a table the new user cannot yet touch.
-- `set search_path = ''` is the Supabase hardening convention: it forces every
-- identifier below to be schema-qualified, so the function cannot be hijacked
-- by a caller-controlled search_path.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    -- `name` is passed from the client as auth metadata at signup; fall back to
    -- the local-part of the email so the column's NOT NULL can never fail.
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(new.email, '@', 1)
    ),
    new.email
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email in step when a user changes their address in Auth.
drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_new_user();


-- ------------------------------------------------------ updated_at helper ----
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();
