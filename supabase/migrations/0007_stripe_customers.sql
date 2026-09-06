-- ---------------------------------------------------------------------------
-- 0007 — Stripe customer link, for saved cards
-- ---------------------------------------------------------------------------
-- Saving a card means saving it AT STRIPE. What lives here is only the id of
-- the Stripe Customer object that owns the customer's saved payment methods.
--
-- Nothing resembling a card number, expiry or CVC is stored in this database,
-- or in the browser. Card data never touches our servers at all: the customer
-- types it into Stripe's own hosted Checkout page. When they ask us to
-- remember it, Stripe attaches the resulting PaymentMethod to this customer id
-- and we read back a brand and last four digits for display — values that
-- cannot be used to charge anything.
--
-- One customer per user, hence the unique constraint: two Stripe customers for
-- one account would split their saved cards across two invisible buckets.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists stripe_customer_id text;

create unique index if not exists profiles_stripe_customer_id_key
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

comment on column public.profiles.stripe_customer_id is
  'Stripe Customer id owning this user''s saved payment methods. Never contains card data.';

-- Deliberately NOT exposed through the existing "users update their own
-- profile" policy in any meaningful way: the column is written only by the
-- server (service role) when a Checkout session is created. A client that
-- could set this could point their account at somebody else''s Stripe customer
-- and read that person''s saved cards.
--
-- The existing update policy allows a user to update their own row, so the
-- column is protected by a trigger rather than by RLS alone.
create or replace function public.protect_stripe_customer_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Service-role connections bypass RLS and run as 'service_role'; anyone else
  -- must leave the column exactly as they found it.
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and new.stripe_customer_id is distinct from old.stripe_customer_id then
    raise exception 'stripe_customer_id is not user-writable';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_stripe_customer_id on public.profiles;
create trigger profiles_protect_stripe_customer_id
  before update on public.profiles
  for each row
  execute function public.protect_stripe_customer_id();
