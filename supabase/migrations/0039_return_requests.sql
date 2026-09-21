-- ============================================================================
-- 0039_return_requests.sql
-- ============================================================================
-- RMA: a customer's return request as a record of its own, with a reason, a
-- description, photographs and the manager's decision.
--
-- WHAT WAS ALREADY HERE. Migration 0004 gave orders a `return_status` and a
-- `return_reason`, and a policy letting a customer move their own order from
-- 'none' to 'requested'. That models the ORDER's state, which is still where
-- it belongs — one order has one return state. What it cannot hold is the
-- request itself: why, in the customer's words, with evidence, and what the
-- manager decided and why. That is this table.
--
-- The two stay in step: orders.return_status is the summary a listing reads,
-- return_requests is the detail a manager reads. The server writes both in
-- lib/server/returns-store.ts.
-- ============================================================================


-- --------------------------------------------------------------- statuses ---
-- 'rejected' is new. The enum is EXTENDED rather than replaced: dropping it
-- for a text column would take the orders_return_status_idx index and the
-- 0004 policy with it, and rewrite every existing row, to gain nothing that
-- an enum does not already give — which is exactly the check constraint the
-- text version would have needed anyway.
--
-- ADD VALUE cannot run inside a transaction block in PostgreSQL below 12, and
-- cannot be repeated, hence the guard rather than a bare statement.
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'return_status' and e.enumlabel = 'rejected'
  ) then
    alter type public.return_status add value 'rejected';
  end if;
end
$$;

-- Why a return was asked for. An enum, so a typo in application code is a
-- database error rather than a category nobody can filter on later.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'return_reason') then
    create type public.return_reason as enum (
      'defective',
      'wrong_size',
      'not_as_described',
      'changed_mind',
      'other'
    );
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'return_request_status') then
    create type public.return_request_status as enum (
      'pending',
      'approved',
      'rejected',
      'completed'
    );
  end if;
end
$$;


-- ---------------------------------------------------------------- table ----
create table if not exists public.return_requests (
  id          uuid primary key default gen_random_uuid(),

  -- The order's uuid, not its LV-XXXXXX number: the number is the business
  -- key the application speaks in, the uuid is what the row is joined on.
  -- CASCADE, unlike orders.user_id: a return cannot outlive its order.
  order_id    uuid not null references public.orders (id) on delete cascade,

  -- Null for a guest, exactly as orders.user_id is. A guest reaches their
  -- order through its lookup token, so a return must not require an account;
  -- SET NULL keeps the record when an account is deleted, because a refund
  -- that was issued is a financial fact.
  user_id     uuid references auth.users (id) on delete set null,

  reason      public.return_reason not null,
  comment     text not null default '',

  -- Object paths in the 'returns' bucket, not URLs: the bucket is private and
  -- a URL to it is signed and short-lived, so storing one would store
  -- something that stops working. The server signs them when a manager looks.
  images      text[] not null default '{}',

  status      public.return_request_status not null default 'pending',

  -- The manager's reason for rejecting, or an internal note. Shown to the
  -- customer only where the application chooses to.
  admin_notes text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  decided_at  timestamptz
);

-- One OPEN request per order. A customer whose request was rejected may send
-- another; one who already has a pending one may not, and the database says
-- so rather than the application remembering to check.
create unique index if not exists return_requests_one_open_per_order
  on public.return_requests (order_id)
  where status in ('pending', 'approved');

create index if not exists return_requests_status_idx
  on public.return_requests (status, created_at desc);

create index if not exists return_requests_user_idx
  on public.return_requests (user_id) where user_id is not null;

comment on table public.return_requests is
  'RMA requests. Customers insert and read their own; only the service role decides.';


-- ------------------------------------------------------------ updated_at ----
create or replace function public.touch_return_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists return_requests_touch on public.return_requests;
create trigger return_requests_touch
  before update on public.return_requests
  for each row execute function public.touch_return_request();


-- ----------------------------------------------------------------- RLS ----
alter table public.return_requests enable row level security;

-- A signed-in customer sees their own requests and nothing else. Guests read
-- theirs through the server, which holds the order's lookup token.
drop policy if exists "users read their own return requests" on public.return_requests;
create policy "users read their own return requests"
  on public.return_requests for select
  to authenticated
  using (user_id = auth.uid());

-- Filing one is allowed only against an order that is the customer's own and
-- actually paid. The status is pinned to 'pending': without the WITH CHECK a
-- customer could insert their own request pre-approved.
drop policy if exists "users file a return on their paid orders" on public.return_requests;
create policy "users file a return on their paid orders"
  on public.return_requests for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and admin_notes is null
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.user_id = auth.uid()
        and o.payment_status = 'paid'
    )
  );

-- No update or delete policy at all, deliberately. Approving, rejecting and
-- refunding are the service role's, as migration 0004 established for
-- returns: a customer who could update this row could approve their own
-- refund.


-- -------------------------------------------------------------- storage ----
-- Private bucket, like support-attachments and unlike newsletter-images: a
-- photograph of someone's damaged order is their property, not the web's. No
-- storage policies, so only the service role reads or writes it; the upload
-- route validates the file and the manager's view is served signed URLs.
--
-- 10 MB a file, photographs only — no PDF here, unlike support: the form asks
-- for a picture of the item, and accepting documents invites the customer to
-- attach an invoice that then sits in a bucket nobody reviews.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'returns', 'returns', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
