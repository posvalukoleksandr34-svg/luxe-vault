-- ============================================================================
-- 0037_newsletter_campaigns.sql
-- ============================================================================
-- Email campaigns to newsletter subscribers. Requires 0034.
--
-- newsletter_subscribers gains:
--   status             'active' | 'unsubscribed' — what the admin list shows and
--                      toggles, and what a campaign sends to. Kept in step
--                      with the existing `unsubscribed_at` by a trigger, so
--                      code that writes either column stays correct.
--   unsubscribe_token  a random per-subscriber key for the link in every
--                      email. Unguessable, so nobody can unsubscribe (or
--                      resubscribe) an address they do not receive mail at.
--
-- newsletter_campaigns records each send: what was sent, to how many, and how
-- it went. `client_key` is minted by the admin page per composition and is
-- unique, so a double-click or a retried request cannot send a campaign twice.
--
-- Access: server only, through the service role, as for 0034. RLS on, no
-- policies.
-- ============================================================================

alter table public.newsletter_subscribers
  add column if not exists status text not null default 'active'
    check (status in ('active', 'unsubscribed'));

alter table public.newsletter_subscribers
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

create unique index if not exists newsletter_subscribers_unsubscribe_token_key
  on public.newsletter_subscribers (unsubscribe_token);

create index if not exists newsletter_subscribers_status_idx
  on public.newsletter_subscribers (status, created_at desc);

-- Rows written before this migration.
update public.newsletter_subscribers
   set status = 'unsubscribed'
 where unsubscribed_at is not null and status <> 'unsubscribed';

/**
 * One source of truth, two columns. Writing `status` stamps or clears
 * `unsubscribed_at`; writing only `unsubscribed_at` (the 0034 sign-up code)
 * sets `status` to match.
 */
create or replace function public.newsletter_sync_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.unsubscribed_at is not null then
      new.status := 'unsubscribed';
    elsif new.status = 'unsubscribed' then
      new.unsubscribed_at := now();
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    new.unsubscribed_at := case when new.status = 'unsubscribed' then coalesce(new.unsubscribed_at, now()) else null end;
  elsif new.unsubscribed_at is distinct from old.unsubscribed_at then
    new.status := case when new.unsubscribed_at is null then 'active' else 'unsubscribed' end;
  end if;
  return new;
end;
$$;

drop trigger if exists newsletter_subscribers_sync_status on public.newsletter_subscribers;
create trigger newsletter_subscribers_sync_status
  before insert or update on public.newsletter_subscribers
  for each row
  execute function public.newsletter_sync_status();

create table if not exists public.newsletter_campaigns (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  client_key  uuid not null unique,

  subject     text not null check (char_length(subject) between 1 and 150),
  preheader   text not null default '' check (char_length(preheader) <= 200),
  -- { title, body, imageUrl, ctaLabel, ctaUrl } as composed.
  content     jsonb not null,

  status      text not null default 'sending'
                check (status in ('sending', 'sent', 'partial', 'failed')),
  -- 'live' sent to subscribers; 'test' rendered but not delivered to them
  -- (EMAIL_DELIVERY=test, see lib/server/resend.ts).
  mode        text not null default 'live' check (mode in ('live', 'test')),
  recipients  integer not null default 0 check (recipients >= 0),
  sent        integer not null default 0 check (sent >= 0),
  failed      integer not null default 0 check (failed >= 0),
  finished_at timestamptz,
  error       text
);

create index if not exists newsletter_campaigns_created_idx
  on public.newsletter_campaigns (created_at desc);

alter table public.newsletter_campaigns enable row level security;
