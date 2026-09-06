-- ---------------------------------------------------------------------------
-- 0010 — In-app notifications
-- ---------------------------------------------------------------------------
-- Backs the notification bell. Distinct from the transactional email in
-- lib/server/mailer.ts: email is push (it reaches someone who is not on the
-- site), this is pull (it is waiting when they come back). A payment failure
-- needs both — the email so they find out, the notification so the site can
-- still tell them when the email lands in spam.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.notification_type as enum ('payment_failed', 'status_update');
exception when duplicate_object then null; end $$;

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),

  -- CASCADE, not SET NULL: a notification with no recipient is unreadable by
  -- anyone and would linger forever. Deleting the account deletes them.
  user_id     uuid not null references auth.users (id) on delete cascade,

  type        public.notification_type not null,
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  -- Optional second line. Kept separate from title so the bell can show a
  -- one-line summary without truncating mid-sentence.
  body        text check (body is null or char_length(body) <= 500),

  -- Where clicking the notification goes, e.g. /order/LV-ABC123. Relative on
  -- purpose: an absolute URL baked in at write time would rot the moment the
  -- domain changes, which it already has once in this project.
  action_url  text check (action_url is null or action_url ~ '^/'),

  -- Correlates a notification with the order it is about, so a status change
  -- can supersede or de-duplicate an earlier one without a text match.
  order_id    text,

  is_read     boolean not null default false,
  read_at     timestamptz
);

-- The bell asks exactly one question on every page load: "what is unread for
-- this user". A partial index answers it without scanning read history.
create index if not exists notifications_unread_idx
  on public.notifications (user_id, created_at desc)
  where is_read = false;

-- The panel then asks for the recent list regardless of read state.
create index if not exists notifications_user_recent_idx
  on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists "users read their own notifications" on public.notifications;
create policy "users read their own notifications"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

-- A user may mark their own notifications read, and nothing else. The WITH
-- CHECK clause keeps the row theirs: without it a user could update user_id
-- and hand their notification to somebody else.
drop policy if exists "users mark their own notifications read" on public.notifications;
create policy "users mark their own notifications read"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- NO insert policy, deliberately. Notifications are statements of fact made by
-- the system ("your payment failed", "your order shipped"). If a client could
-- insert, anyone could fabricate a "Payment received" notice for themselves,
-- or spam another account. Writes go through the service role only —
-- lib/server/notifications.ts.
--
-- Nor a delete policy: the read/unread flag is the whole lifecycle, and a
-- customer deleting the record of a failed payment helps nobody.

-- ---------------------------------------------------------------------------
-- read_at is stamped by the database, not the client
-- ---------------------------------------------------------------------------
-- The client sends is_read = true and nothing else; letting it supply the
-- timestamp would put an unvalidated, client-clock value into an audit field.
create or replace function public.stamp_notification_read()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_read and not old.is_read then
    new.read_at := now();
  elsif not new.is_read then
    new.read_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_stamp_read on public.notifications;
create trigger notifications_stamp_read
  before update on public.notifications
  for each row
  execute function public.stamp_notification_read();

comment on table public.notifications is
  'In-app notification feed. Rows are written only by the service role; users may read their own and toggle is_read.';
