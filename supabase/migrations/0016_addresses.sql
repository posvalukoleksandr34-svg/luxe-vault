-- ---------------------------------------------------------------------------
-- 0016 — Address book, and a welcome-email stamp
-- ---------------------------------------------------------------------------
-- Saved checkout details lived in localStorage (lib/saved-profile.ts). That is
-- the right home for a guest's convenience copy, and it stays — but for a
-- signed-in customer it means the address they carefully typed on their laptop
-- does not exist on their phone, and vanishes when they clear site data.
--
-- These rows are the customer's own contact details, on the customer's own
-- account, readable and writable only by them. RLS does that work here rather
-- than the API layer, so a mistake in a route handler cannot expose one
-- customer's address to another.
--
-- WHAT IS STILL NOT STORED
--
-- Nothing that could charge a card. Saved cards remain a Stripe Customer
-- object; the app sees a brand and last four and nothing else. See
-- lib/server/stripe.ts.
-- ---------------------------------------------------------------------------

create table if not exists public.addresses (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  user_id     uuid not null references auth.users (id) on delete cascade,

  -- Optional label the customer chooses: "Home", "Office". Not an enum — the
  -- point is that they name it whatever they like.
  label       text check (label is null or char_length(btrim(label)) between 1 and 40),

  name        text not null check (char_length(btrim(name)) between 1 and 120),
  phone       text not null check (char_length(btrim(phone)) between 4 and 32),

  street      text not null check (char_length(btrim(street)) between 2 and 200),
  postal_code text not null check (char_length(btrim(postal_code)) between 2 and 20),
  city        text not null check (char_length(btrim(city)) between 1 and 100),
  -- ISO 3166-1 alpha-2, matching the country selector.
  country     text not null check (country ~ '^[A-Z]{2}$'),

  is_default  boolean not null default false
);

create index if not exists addresses_user_idx
  on public.addresses (user_id, created_at desc);

-- At most one default per customer. A partial unique index rather than
-- application logic: two "default" rows is a state the UI cannot render and
-- checkout cannot choose between, so the database refuses to hold it.
create unique index if not exists addresses_one_default_per_user
  on public.addresses (user_id)
  where is_default;

drop trigger if exists addresses_touch_updated_at on public.addresses;
create trigger addresses_touch_updated_at
  before update on public.addresses
  for each row execute function public.touch_updated_at();

alter table public.addresses enable row level security;

drop policy if exists "users read their own addresses" on public.addresses;
create policy "users read their own addresses"
  on public.addresses for select
  using (user_id = auth.uid());

drop policy if exists "users add their own addresses" on public.addresses;
create policy "users add their own addresses"
  on public.addresses for insert
  with check (user_id = auth.uid());

drop policy if exists "users update their own addresses" on public.addresses;
create policy "users update their own addresses"
  on public.addresses for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "users delete their own addresses" on public.addresses;
create policy "users delete their own addresses"
  on public.addresses for delete
  using (user_id = auth.uid());

comment on table public.addresses is
  'Customer address book. RLS-scoped to the owner; never contains payment data.';

-- ---------------------------------------------------------------------------
-- set_default_address — flip the default without violating the unique index
-- ---------------------------------------------------------------------------
-- Clearing the old default and setting the new one are two statements, and
-- between them either zero or two rows are default. Doing both inside one
-- function makes that window invisible, and the partial unique index above
-- means a bug here fails loudly instead of silently corrupting the book.
-- ---------------------------------------------------------------------------
create or replace function public.set_default_address(p_address_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select user_id into v_user
    from public.addresses
   where id = p_address_id
     -- auth.uid() inside a SECURITY DEFINER function still reflects the
     -- calling user, so this cannot be used to re-point somebody else's book.
     and user_id = auth.uid();

  if v_user is null then
    return false;
  end if;

  update public.addresses set is_default = false
   where user_id = v_user and is_default and id <> p_address_id;

  update public.addresses set is_default = true
   where id = p_address_id;

  return true;
end;
$$;

comment on function public.set_default_address(uuid) is
  'Moves the default flag atomically, preserving the one-default-per-user index.';

-- ---------------------------------------------------------------------------
-- Welcome email, sent once
-- ---------------------------------------------------------------------------
-- The stamp lives on the profile rather than in application memory so a
-- customer who signs in from three devices, or whose confirmation link is
-- clicked twice, still receives exactly one welcome.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists welcome_sent_at timestamptz;

comment on column public.profiles.welcome_sent_at is
  'Set when the welcome email was sent. Claimed atomically so it goes out once.';
