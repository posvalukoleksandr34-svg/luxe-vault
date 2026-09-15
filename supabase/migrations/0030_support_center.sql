-- ============================================================================
-- 0030_support_center.sql
-- ============================================================================
-- Support tickets become conversations.
--
-- Until now a ticket was one message from a contact form, with two states.
-- The support center needs a ticket number the customer can quote, a
-- category and subject, the order it is about, a thread of messages in both
-- directions with attachments, five states, and read markers on both sides so
-- the storefront can count unread replies and the admin can see new ones.
--
-- Access: every table here is service-role only (RLS on, no policies). The
-- customer reaches their tickets through the server — by their session, or,
-- for a ticket filed without an account, by the ticket's access_token, which
-- is what the emailed link carries. The old policies that let anyone INSERT
-- straight into the table with the public key are dropped: they were a spam
-- route around the rate-limited API.
-- ============================================================================

-- ------------------------------------------------------------- statuses ----
-- enum ('open', 'resolved') → text with a check. Adding enum values cannot be
-- used in the same transaction that adds them; a check constraint has no such
-- trap, and the set is easier to change later.
drop index if exists public.support_tickets_status_idx;

alter table public.support_tickets alter column status drop default;
alter table public.support_tickets alter column status type text using status::text;
alter table public.support_tickets alter column status set default 'open';
alter table public.support_tickets drop constraint if exists support_tickets_status_check;
alter table public.support_tickets add constraint support_tickets_status_check
  check (status in ('open', 'in_progress', 'waiting_user', 'resolved', 'closed'));

-- -------------------------------------------------------------- columns ----
alter table public.support_tickets
  add column if not exists ticket_number        text,
  add column if not exists category             text not null default 'other',
  add column if not exists subject              text,
  add column if not exists order_number         text,
  add column if not exists locale               text,
  add column if not exists access_token         uuid not null default gen_random_uuid(),
  add column if not exists updated_at           timestamptz not null default now(),
  add column if not exists last_message_at      timestamptz not null default now(),
  add column if not exists last_staff_reply_at  timestamptz,
  add column if not exists customer_last_read_at timestamptz,
  add column if not exists staff_last_read_at   timestamptz,
  add column if not exists closed_at            timestamptz,
  -- Who wrote last: an unread badge is "the other side wrote after you last
  -- looked", which needs to know whose message is the latest.
  add column if not exists last_message_by      text not null default 'customer';

alter table public.support_tickets drop constraint if exists support_tickets_last_by_check;
alter table public.support_tickets add constraint support_tickets_last_by_check
  check (last_message_by in ('customer', 'staff'));

-- Existing tickets get a number, a subject and their own date as activity.
update public.support_tickets
   set ticket_number = 'LVS-' || upper(substr(replace(id::text, '-', ''), 1, 6))
 where ticket_number is null;
update public.support_tickets
   set subject = left(btrim(message), 80)
 where subject is null;
update public.support_tickets
   set last_message_at = created_at, updated_at = created_at
 where last_message_at > created_at and last_staff_reply_at is null;

alter table public.support_tickets alter column ticket_number set not null;
create unique index if not exists support_tickets_number_key on public.support_tickets (ticket_number);

alter table public.support_tickets drop constraint if exists support_tickets_category_check;
alter table public.support_tickets add constraint support_tickets_category_check
  check (category in ('order', 'payment', 'shipping', 'returns', 'sizes', 'product', 'account', 'other'));

alter table public.support_tickets drop constraint if exists support_tickets_subject_check;
alter table public.support_tickets add constraint support_tickets_subject_check
  check (subject is null or char_length(btrim(subject)) between 1 and 150);

alter table public.support_tickets drop constraint if exists support_tickets_locale_check;
alter table public.support_tickets add constraint support_tickets_locale_check
  check (locale is null or locale in ('ru', 'en', 'it', 'fr', 'de'));

create index if not exists support_tickets_queue_idx
  on public.support_tickets (status, last_message_at desc);
create index if not exists support_tickets_user_idx
  on public.support_tickets (user_id, last_message_at desc) where user_id is not null;

-- ------------------------------------------------------------- messages ----
create table if not exists public.support_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets (id) on delete cascade,
  created_at  timestamptz not null default now(),
  author      text not null check (author in ('customer', 'staff')),
  body        text not null check (char_length(btrim(body)) between 1 and 5000),
  -- [{ path, name, type, size }] — objects in the private support-attachments
  -- bucket, served to viewers through short-lived signed URLs.
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array')
);

create index if not exists support_messages_ticket_idx
  on public.support_messages (ticket_id, created_at);

alter table public.support_messages enable row level security;

-- Each existing ticket's message becomes the first message of its thread.
insert into public.support_messages (ticket_id, created_at, author, body)
select t.id, t.created_at, 'customer', t.message
  from public.support_tickets t
 where not exists (select 1 from public.support_messages m where m.ticket_id = t.id);

-- ------------------------------------------------------------- policies ----
drop policy if exists "anyone can file a support ticket" on public.support_tickets;
drop policy if exists "users read their own tickets" on public.support_tickets;

-- ---------------------------------------------------------- attachments ----
-- Private bucket: no storage policies, so only the service role can read or
-- write it. 10 MB a file; photos and PDFs only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-attachments', 'support-attachments', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do nothing;

comment on table public.support_messages is
  'The conversation of a support ticket. Service-role only.';

-- ============================================================================
-- Stock at payment confirmation
-- ============================================================================
-- place_order() takes an order's units out of stock when it is created, and
-- restore_order_stock() puts them back when it is cancelled or refunded. A
-- payment that lands on an order whose units were put back — cancelled while
-- the customer was still on the payment sheet — would otherwise sell stock
-- that may already belong to someone else.
--
-- reclaim_order_stock() runs on every confirmed payment. For an order whose
-- stock is still held it is a no-op ('held'). For one that was restocked it
-- takes the units again with the same `stock >= qty` guard as place_order, all
-- or nothing ('reclaimed'), or reports that they are gone ('insufficient') so
-- the payment can be reviewed and refunded — never a negative shelf.
-- ============================================================================
create or replace function public.reclaim_order_stock(p_order_number text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id  uuid;
  v_restocked timestamptz;
  v_item      record;
  v_updated   integer;
  v_tracked   boolean;
begin
  select id, restocked_at into v_order_id, v_restocked
    from public.orders
   where order_number = p_order_number
   for update;

  if v_order_id is null then
    return 'missing';
  end if;
  if v_restocked is null then
    return 'held';
  end if;

  for v_item in
    select i.product_id, i.size, i.color, i.qty, i.name
      from public.order_items i
     where i.order_id = v_order_id
  loop
    update public.product_variants v
       set stock = v.stock - v_item.qty
     where v.product_id = (select p.id from public.products p where p.slug = v_item.product_id)
       and v.size = v_item.size
       and v.color = v_item.color
       and v.stock >= v_item.qty;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      select exists (
        select 1 from public.product_variants v
          join public.products p on p.id = v.product_id
         where p.slug = v_item.product_id
      ) into v_tracked;
      if v_tracked then
        raise exception 'INSUFFICIENT_STOCK: %', v_item.name using errcode = 'P0001';
      end if;
    end if;
  end loop;

  update public.orders set restocked_at = null where id = v_order_id;
  return 'reclaimed';
exception
  -- The block's subtransaction rolls back every decrement made above, so a
  -- partial reclaim can never stick.
  when sqlstate 'P0001' then
    return 'insufficient';
end;
$$;

revoke all on function public.reclaim_order_stock(text) from public, anon, authenticated;

comment on function public.reclaim_order_stock(text) is
  'On payment: re-takes a restocked order''s units atomically. Returns held | reclaimed | insufficient | missing.';
