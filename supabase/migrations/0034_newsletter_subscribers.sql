-- ============================================================================
-- 0034_newsletter_subscribers.sql
-- ============================================================================
-- Newsletter sign-ups from the "Ничего не пропустите" block (/contact).
--
-- One row per address. The address is stored lower-cased and is unique, so
-- signing up twice is a no-op rather than a duplicate. `consented_at` records
-- when the visitor submitted the form beside the consent wording; a later
-- opt-out sets `unsubscribed_at` rather than deleting the row, so the record
-- of what was agreed and withdrawn is kept.
--
-- Access: written ONLY by the server (/api/newsletter, through the service
-- role), after checking the address, the consent flag and a rate limit. RLS is
-- on with deliberately no policies: an INSERT policy would let anyone write
-- rows straight through the public key and skip every one of those checks,
-- and a SELECT policy would publish the list.
-- ============================================================================

create table if not exists public.newsletter_subscribers (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),

  email            text not null
                     check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
                            and email = lower(email)),

  -- The storefront language at sign-up, so a future send can use it.
  locale           text not null default 'ru'
                     check (locale in ('ru', 'en', 'it', 'fr', 'de')),

  -- Where the form was: 'contact' today; room for a footer block later.
  source           text not null default 'contact'
                     check (char_length(source) <= 40),

  -- Null for a guest.
  user_id          uuid references auth.users (id) on delete set null,

  consented_at     timestamptz not null default now(),
  unsubscribed_at  timestamptz
);

create unique index if not exists newsletter_subscribers_email_key
  on public.newsletter_subscribers (email);

create index if not exists newsletter_subscribers_active_idx
  on public.newsletter_subscribers (created_at desc)
  where unsubscribed_at is null;

alter table public.newsletter_subscribers enable row level security;
