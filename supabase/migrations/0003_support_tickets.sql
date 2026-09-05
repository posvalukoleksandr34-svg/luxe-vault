-- ============================================================================
-- 0003_support_tickets.sql  —  contact form persistence
--
-- Run AFTER 0001_profiles.sql. Independent of 0002_orders.sql.
--
-- Replaces the JSON-file store in lib/server/support-store.ts, which cannot
-- work on Vercel: the filesystem is read-only outside /tmp, so fs.writeFile
-- throws and the customer sees "Failed to send message".
--
-- No general SELECT policy is granted on purpose: the public may insert a
-- ticket, but only the service_role key may read the queue. A readable
-- contact-form table is a scrapeable email list.
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
