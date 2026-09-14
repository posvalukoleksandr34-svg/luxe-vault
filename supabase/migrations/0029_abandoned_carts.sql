-- ============================================================================
-- 0029_abandoned_carts.sql
-- ============================================================================
-- Abandoned-cart recovery. A cart is captured once its owner types a valid
-- email at checkout (POST /api/abandoned-carts); if no order follows, the
-- hourly cron (/api/cron/abandoned-carts) sends ONE reminder with a link that
-- restores the cart (/cart/restore/<token>).
--
-- Privacy and restraint, enforced here rather than hoped for in code:
--   - the table holds email addresses, so RLS is on with NO policies: only the
--     service role (the server) can read or write it;
--   - one pending cart per address; one reminder per cart, ever;
--   - at most one reminder per address per week, whatever its number of carts;
--   - never again after an opt-out (opted_out_at on any of its carts);
--   - never after the address placed an order.
-- ============================================================================

create table if not exists public.abandoned_carts (
  id               uuid primary key default gen_random_uuid(),
  -- Stored lower-cased: one address, one pending cart.
  email            text not null check (email = lower(email) and char_length(email) between 3 and 254),
  cart_items       jsonb not null default '[]'::jsonb check (jsonb_typeof(cart_items) = 'array'),
  -- The restore link the reminder points at: <site>/cart/restore/<token>.
  checkout_url     text,
  status           text not null default 'pending'
                     check (status in ('pending', 'recovered', 'expired')),
  -- The checkout's language, for the reminder's.
  locale           text check (locale in ('ru', 'en', 'it', 'fr', 'de')),
  -- Unguessable, and separate from the id: it is what the email carries.
  token            uuid not null unique default gen_random_uuid(),
  reminder_sent_at timestamptz,
  opted_out_at     timestamptz,
  created_at       timestamptz not null default now(),
  -- Last activity: capture refreshes it; "untouched for two hours" reads it.
  updated_at       timestamptz not null default now()
);

create unique index if not exists abandoned_carts_one_pending_per_email
  on public.abandoned_carts (email) where status = 'pending';

create index if not exists abandoned_carts_due
  on public.abandoned_carts (updated_at) where status = 'pending' and reminder_sent_at is null;

create index if not exists abandoned_carts_email on public.abandoned_carts (email);

alter table public.abandoned_carts enable row level security;
-- No policies: anon and authenticated can neither read nor write.

comment on table public.abandoned_carts is
  'Carts whose owner entered an email at checkout. Service-role only.';

-- ---------------------------------------------------------------------------
-- capture_abandoned_cart — save or refresh the pending cart for an address
-- ---------------------------------------------------------------------------
-- Update-then-insert rather than ON CONFLICT: the uniqueness is a partial
-- index (pending carts only), which ON CONFLICT cannot target through the
-- API. A concurrent insert for the same address loses to the unique index and
-- falls back to updating the winner's row.
-- ---------------------------------------------------------------------------
create or replace function public.capture_abandoned_cart(
  p_email text,
  p_items jsonb,
  p_locale text,
  p_checkout_base text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_token uuid;
begin
  update public.abandoned_carts
     set cart_items = p_items,
         locale = coalesce(p_locale, locale),
         updated_at = now()
   where email = v_email and status = 'pending'
  returning token into v_token;

  if v_token is not null then
    return v_token;
  end if;

  v_token := gen_random_uuid();
  insert into public.abandoned_carts (email, cart_items, locale, token, checkout_url)
  values (v_email, p_items, p_locale, v_token, p_checkout_base || v_token::text);
  return v_token;
exception
  when unique_violation then
    update public.abandoned_carts
       set cart_items = p_items, updated_at = now()
     where email = v_email and status = 'pending'
    returning token into v_token;
    return v_token;
end;
$$;

revoke all on function public.capture_abandoned_cart(text, jsonb, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- claim_abandoned_carts — the carts due a reminder, claimed in one statement
-- ---------------------------------------------------------------------------
-- Same shape as claim_recoverable_orders (0019): stamping and selecting
-- together hands each cart to exactly one caller, and `for update skip
-- locked` lets overlapping runs divide the work. Carts idle past p_max_age are
-- expired first — a reminder about something a week old is a surprise, not a
-- service.
-- ---------------------------------------------------------------------------
create or replace function public.claim_abandoned_carts(
  p_idle interval default interval '2 hours',
  p_max_age interval default interval '7 days',
  p_limit integer default 100
)
returns setof public.abandoned_carts
language sql
security definer
set search_path = ''
as $$
  update public.abandoned_carts
     set status = 'expired', updated_at = now()
   where status = 'pending'
     and updated_at < now() - p_max_age;

  update public.abandoned_carts c
     set reminder_sent_at = now()
   where c.id in (
     select a.id from public.abandoned_carts a
      where a.status = 'pending'
        and a.reminder_sent_at is null
        and a.updated_at < now() - p_idle
        and jsonb_array_length(a.cart_items) > 0
        -- Opted out once is opted out for good.
        and not exists (
          select 1 from public.abandoned_carts o
           where o.email = a.email and o.opted_out_at is not null)
        -- One reminder per address per week, however many carts it has.
        and not exists (
          select 1 from public.abandoned_carts r
           where r.email = a.email and r.reminder_sent_at > now() - interval '7 days')
        -- They ordered after all (on another device, say): nothing to remind.
        and not exists (
          select 1 from public.orders x
           where lower(x.customer_email) = a.email and x.created_at > a.created_at)
      order by a.updated_at
      limit p_limit
      for update skip locked
   )
  returning c.*;
$$;

revoke all on function public.claim_abandoned_carts(interval, interval, integer)
  from public, anon, authenticated;

comment on function public.claim_abandoned_carts(interval, interval, integer) is
  'Expires stale carts, then claims those due their one reminder. Safe to run concurrently.';
