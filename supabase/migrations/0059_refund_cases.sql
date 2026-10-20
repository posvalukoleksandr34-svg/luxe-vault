-- ============================================================================
-- 0059_refund_cases.sql
-- ============================================================================
-- The refund & return management system (docs/refunds/README.md).
--
-- WHAT IT GROWS FROM. Migration 0039 gave the shop return_requests: one row per
-- request, four states (pending / approved / rejected / completed), photos in
-- the private 'returns' bucket. That table becomes the REFUND CASE rather than
-- being replaced, so every request already filed carries on in the new
-- workflow and nothing that reads it loses its rows:
--
--   * return_requests gains the case: claim type, a full state machine
--     (`state`), requested/approved resolution, money in minor units, the
--     policy it was judged under, assignment, deadlines, investigation status.
--     The old `status` column stays, kept in step by a trigger, so a report
--     that reads it still sees a coarse version of the truth.
--   * return_request_items: which order lines, how many, and what inspection
--     found. Quantities are what stop a second claim for the same unit.
--   * refund_transactions: the LEDGER. One row per attempt to move money back,
--     whatever started it (a case, the order screen, a cancellation, the fraud
--     guard, a refund made in the Stripe dashboard). orders.refunded_amount
--     becomes a summary of this table, written by settle_refund_transaction.
--   * evidence, messages, risk assessments, approvals, notifications, and an
--     append-only audit log (refund_case_events).
--   * admin_staff: named staff with roles, on top of the shared admin login,
--     so a decision has a person behind it and a second approval can be a
--     different person (lib/server/staff.ts).
--
-- MONEY. Every new amount is a bigint of MINOR units (rappen): the order's
-- total is numeric(12,2) francs, so total * 100 is exact. Floating point never
-- touches a balance; the functions below compute in integers under a row lock.
--
-- ACCESS. Every new table is server-only: RLS on, no policies, browser roles
-- revoked. Customers reach their own cases through the API, which projects out
-- risk scores, internal notes and staff identities. The customer SELECT policy
-- 0039 created on return_requests is dropped for the same reason — the row now
-- carries a risk level and an assignee a customer must not read.
--
-- Re-runnable: every statement is guarded (CI re-applies 0027 onwards).
-- ============================================================================


-- ============================================================== staff =======
create table if not exists public.admin_staff (
  id               uuid primary key default gen_random_uuid(),
  display_name     text not null check (char_length(btrim(display_name)) between 2 and 60),
  role             text not null check (role in ('owner', 'manager', 'agent', 'viewer')),
  -- scrypt, encoded as scrypt$N$r$p$salt$hash (lib/server/staff-password.ts).
  passphrase_hash  text not null check (passphrase_hash like 'scrypt$%'),
  active           boolean not null default true,
  failed_attempts  integer not null default 0 check (failed_attempts >= 0),
  locked_until     timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.admin_staff (id) on delete set null,
  last_signed_in_at timestamptz,
  deactivated_at   timestamptz
);

create unique index if not exists admin_staff_name_key on public.admin_staff (lower(btrim(display_name)));

alter table public.admin_staff enable row level security;
revoke all on public.admin_staff from anon, authenticated;

comment on table public.admin_staff is
  'Named staff on top of the shared admin login: who decided, with which role. Server-only.';

-- A console session is bound to one staff member after they confirm who they
-- are (their own passphrase). Null = not bound, or a shop with no staff yet.
alter table public.admin_sessions
  add column if not exists staff_id       uuid references public.admin_staff (id) on delete set null,
  add column if not exists staff_bound_at timestamptz;


-- ============================================================ policies ======
-- Versioned refund policy (lib/refunds/policy.ts validates `config`). Version 0
-- is the built-in default in code and is never stored; the first save is 1.
-- Rows are never edited: a case records the version it was judged under, and
-- that version must still say what it said.
create table if not exists public.refund_policies (
  version          integer primary key check (version >= 1),
  config           jsonb not null,
  note             text check (note is null or char_length(note) <= 500),
  created_at       timestamptz not null default now(),
  created_by       uuid references public.admin_staff (id) on delete set null,
  created_by_label text not null
);

alter table public.refund_policies enable row level security;
revoke all on public.refund_policies from anon, authenticated;


-- =============================================================== cases ======
alter table public.return_requests
  add column if not exists case_number            text,
  add column if not exists claim_type             text,
  add column if not exists state                  text,
  add column if not exists state_changed_at       timestamptz,
  add column if not exists requested_resolution   text,
  add column if not exists approved_resolution    text,
  add column if not exists currency               text not null default 'CHF',
  add column if not exists requested_amount_minor bigint,
  add column if not exists approved_amount_minor  bigint,
  -- Settled (succeeded) refunds attributed to this case. Written only by
  -- settle_refund_transaction, from the ledger.
  add column if not exists refunded_amount_minor  bigint not null default 0,
  add column if not exists assigned_to            uuid references public.admin_staff (id) on delete set null,
  add column if not exists escalated_at           timestamptz,
  add column if not exists escalation_reason      text,
  -- The customer's deadline in the current state: an information request, or
  -- the window to send a return. Past it, the nightly sweep expires the case.
  add column if not exists customer_deadline_at   timestamptz,
  -- A non-delivery claim inside the parcel's delivery window waits until here
  -- before it is judged (investigation_status 'waiting_delivery_window').
  add column if not exists wait_until             timestamptz,
  add column if not exists investigation_status   text not null default 'none',
  add column if not exists carrier_claim_ref      text,
  add column if not exists policy_version         integer,
  add column if not exists policy_snapshot        jsonb,
  add column if not exists eligibility            jsonb,
  -- The explanation the CUSTOMER reads with a decision. Internal reasoning
  -- lives in refund_case_messages with visibility 'internal'.
  add column if not exists decision_note          text,
  -- A first approval waiting for a second approver (high-value refunds).
  add column if not exists pending_approval       jsonb,
  -- The calculation an approval was made on (lines, delivery charge, postage,
  -- deduction): what the approved amount consists of, and whether this case
  -- already gave the delivery charge back.
  add column if not exists approval               jsonb,
  add column if not exists appeal_count           integer not null default 0,
  add column if not exists source                 text not null default 'customer',
  add column if not exists created_by_staff       uuid references public.admin_staff (id) on delete set null,
  -- The browser's own key for one submission: a double tap files one case.
  add column if not exists submission_key         text,
  -- Optimistic lock: every change to a case bumps it, and every change says
  -- which version it was decided on (refund_case_apply).
  add column if not exists version                integer not null default 0,
  add column if not exists closed_at              timestamptz,
  add column if not exists return_tracking_number text,
  add column if not exists return_carrier         text,
  add column if not exists return_shipped_at      timestamptz,
  add column if not exists return_received_at     timestamptz,
  add column if not exists dispute_ref            text,
  -- A replacement or reshipment: what was sent (an order number, a tracking
  -- number), recorded when the case is resolved that way.
  add column if not exists resolution_ref         text,
  add column if not exists risk_level             text,
  add column if not exists risk_score             integer,
  -- What staff ESTABLISHED, recorded separately from what was alleged: only a
  -- documented 'abuse_confirmed' finding may weigh on a later case's risk
  -- (lib/refunds/risk.ts, prior_documented_findings).
  add column if not exists finding                text,
  add column if not exists finding_note           text,
  add column if not exists evidence_purged_at     timestamptz;

-- Requests filed before this migration, in the vocabulary of the new one.
update public.return_requests
   set state = case status::text
                 when 'pending'   then 'requested'
                 when 'approved'  then 'approved'
                 when 'rejected'  then 'rejected'
                 when 'completed' then 'refunded'
               end,
       state_changed_at = coalesce(decided_at, created_at)
 where state is null;

update public.return_requests
   set claim_type = case reason::text
                      when 'defective'        then 'defective'
                      when 'wrong_size'       then 'wrong_size'
                      when 'not_as_described' then 'not_as_described'
                      when 'changed_mind'     then 'changed_mind'
                      else 'other'
                    end
 where claim_type is null;

update public.return_requests set requested_resolution = 'return_and_refund' where requested_resolution is null;
update public.return_requests set approved_resolution = 'return_and_refund'
 where approved_resolution is null and state in ('approved', 'refunded');
update public.return_requests set case_number = 'RC-' || upper(substr(md5(id::text), 1, 8)) where case_number is null;
update public.return_requests set closed_at = coalesce(decided_at, updated_at)
 where closed_at is null and state in ('rejected', 'refunded');
-- Legacy decisions kept their reason in admin_notes, which a customer was
-- shown for rejections. Carried into the customer-visible field.
update public.return_requests set decision_note = admin_notes
 where decision_note is null and admin_notes is not null and state = 'rejected';

alter table public.return_requests
  alter column case_number set not null,
  alter column claim_type set not null,
  alter column state set not null,
  alter column requested_resolution set not null,
  alter column state set default 'requested';
alter table public.return_requests alter column state_changed_at set default now();
update public.return_requests set state_changed_at = created_at where state_changed_at is null;
alter table public.return_requests alter column state_changed_at set not null;

do $$ begin
  alter table public.return_requests add constraint return_requests_state_check check (state in (
    'requested', 'under_review', 'awaiting_customer_info', 'awaiting_return_shipment',
    'return_in_transit', 'return_delivered', 'awaiting_inspection', 'approved',
    'refund_processing', 'partially_refunded', 'refunded', 'resolved', 'rejected',
    'cancelled', 'expired', 'disputed'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.return_requests add constraint return_requests_claim_type_check check (claim_type in (
    'non_delivery', 'damaged', 'defective', 'wrong_item', 'missing_item', 'not_as_described',
    'wrong_size', 'changed_mind', 'cancel_before_dispatch', 'other'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.return_requests add constraint return_requests_resolution_check check (
    requested_resolution in ('refund', 'return_and_refund', 'replacement', 'reshipment')
    and (approved_resolution is null
         or approved_resolution in ('refund', 'return_and_refund', 'replacement', 'reshipment')));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.return_requests add constraint return_requests_amounts_check check (
    (requested_amount_minor is null or requested_amount_minor >= 0)
    and (approved_amount_minor is null or approved_amount_minor >= 0)
    and refunded_amount_minor >= 0
    and (approved_amount_minor is null or refunded_amount_minor <= approved_amount_minor
         -- a legacy case refunded before amounts were recorded
         or approved_amount_minor = 0));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.return_requests add constraint return_requests_investigation_check check (
    investigation_status in ('none', 'open', 'waiting_delivery_window', 'carrier_claim_opened',
                             'delivered_confirmed', 'lost_confirmed', 'inconclusive'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.return_requests add constraint return_requests_risk_check check (
    (risk_level is null or risk_level in ('low', 'medium', 'high'))
    and (risk_score is null or risk_score between 0 and 100));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.return_requests add constraint return_requests_source_check check (source in ('customer', 'staff'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.return_requests add constraint return_requests_finding_check check (
    (finding is null or finding in ('legitimate', 'not_substantiated', 'abuse_confirmed'))
    and (finding is distinct from 'abuse_confirmed' or char_length(btrim(coalesce(finding_note, ''))) >= 10));
exception when duplicate_object then null; end $$;

create unique index if not exists return_requests_case_number_key on public.return_requests (case_number);
create unique index if not exists return_requests_submission_key on public.return_requests (submission_key)
  where submission_key is not null;

-- 0039 allowed ONE open request per order. A customer may legitimately have
-- two open claims on one order (a missing item, then a faulty one); what must
-- not happen is two claims on the same UNIT, which create_refund_case checks
-- per line under a lock on the order.
drop index if exists public.return_requests_one_open_per_order;

create index if not exists return_requests_state_idx on public.return_requests (state, updated_at desc);
create index if not exists return_requests_order_idx on public.return_requests (order_id);
create index if not exists return_requests_assignee_idx on public.return_requests (assigned_to, state) where assigned_to is not null;
create index if not exists return_requests_claim_idx on public.return_requests (claim_type, created_at desc);
create index if not exists return_requests_user_created_idx on public.return_requests (user_id, created_at desc) where user_id is not null;
create index if not exists return_requests_deadline_idx on public.return_requests (customer_deadline_at)
  where customer_deadline_at is not null;

-- The legacy column follows the state, so nothing that reads it is lied to.
create or replace function public.return_requests_sync_legacy_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.status := (case
    when new.state in ('requested', 'under_review', 'awaiting_customer_info', 'awaiting_return_shipment',
                       'return_in_transit', 'return_delivered', 'awaiting_inspection') then 'pending'
    when new.state in ('approved', 'refund_processing', 'disputed') then 'approved'
    when new.state in ('refunded', 'partially_refunded', 'resolved') then 'completed'
    else 'rejected'
  end)::public.return_request_status;
  return new;
end
$$;

drop trigger if exists return_requests_legacy_status on public.return_requests;
create trigger return_requests_legacy_status
  before insert or update of state on public.return_requests
  for each row execute function public.return_requests_sync_legacy_status();

-- Customers read their cases through the API now (see the header).
drop policy if exists "users read their own return requests" on public.return_requests;


-- ========================================================== case items ======
create table if not exists public.return_request_items (
  id                 uuid primary key default gen_random_uuid(),
  case_id            uuid not null references public.return_requests (id) on delete cascade,
  order_item_id      uuid not null references public.order_items (id) on delete cascade,
  qty_requested      integer not null check (qty_requested > 0),
  qty_approved       integer check (qty_approved >= 0),
  qty_received       integer not null default 0 check (qty_received >= 0),
  -- The line's unit price when the claim was filed, in minor units — a
  -- snapshot, so a later price edit cannot change what is owed.
  unit_price_minor   bigint not null check (unit_price_minor >= 0),
  inspection_outcome text check (inspection_outcome is null or inspection_outcome in (
                       'accepted', 'damaged', 'incorrect_item', 'missing_components',
                       'used_or_altered', 'not_received', 'further_inspection')),
  inspection_note    text check (inspection_note is null or char_length(inspection_note) <= 2000),
  inspected_at       timestamptz,
  inspected_by       uuid references public.admin_staff (id) on delete set null,
  -- Units put back on sale from this line (restock_return_item). Never more
  -- than were received, and never twice.
  restocked_qty      integer not null default 0,
  restocked_at       timestamptz,
  unique (case_id, order_item_id),
  check (qty_approved is null or qty_approved <= qty_requested),
  check (qty_received <= qty_requested),
  check (restocked_qty >= 0 and restocked_qty <= qty_received)
);

create index if not exists return_request_items_order_item_idx on public.return_request_items (order_item_id);

alter table public.return_request_items enable row level security;
revoke all on public.return_request_items from anon, authenticated;


-- ============================================================== ledger ======
create table if not exists public.refund_transactions (
  id                   uuid primary key default gen_random_uuid(),
  -- RESTRICT: a refund is a financial fact and outlives nothing it refers to.
  -- Cascade, not restrict: an order leaves the database only through the
  -- published retention period (lib/server/retention.ts, 5 years), and its
  -- refunds go with it. The guard below refuses deleting a ledger row on its
  -- own while the order exists.
  order_id             uuid not null references public.orders (id) on delete cascade,
  case_id              uuid references public.return_requests (id) on delete set null,
  provider             text not null check (provider in ('stripe', 'manual', 'legacy')),
  -- The payment the money goes back to: the Stripe PaymentIntent, or for a
  -- manual payout whatever identifies the original payment.
  payment_reference    text,
  provider_refund_id   text,
  -- Stable per transaction, and sent to Stripe as its idempotency key: a
  -- retried call can never create a second refund.
  idempotency_key      text not null,
  -- CHF minor units — the order's currency, the unit every cap is checked in.
  amount_minor         bigint not null check (amount_minor > 0),
  currency             text not null default 'CHF',
  -- What the provider moves, in the currency it was charged in.
  provider_amount_minor bigint check (provider_amount_minor is null or provider_amount_minor > 0),
  provider_currency    text,
  reason               text not null check (char_length(reason) between 1 and 500),
  status               text not null check (status in ('pending_submission', 'submitted', 'unknown',
                         'pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
  source               text not null check (source in ('case', 'order_screen', 'cancellation',
                         'fraud_guard', 'external', 'backfill')),
  initiated_by         uuid references public.admin_staff (id) on delete set null,
  initiated_by_label   text not null,
  approved_by          uuid references public.admin_staff (id) on delete set null,
  approved_by_label    text,
  second_approved_by   uuid references public.admin_staff (id) on delete set null,
  manual_reference     text,
  failure_code         text,
  failure_message      text,
  attempts             integer not null default 0,
  created_at           timestamptz not null default now(),
  submitted_at         timestamptz,
  settled_at           timestamptz,
  last_checked_at      timestamptz,
  updated_at           timestamptz not null default now()
);

create unique index if not exists refund_transactions_idempotency_key on public.refund_transactions (idempotency_key);
create unique index if not exists refund_transactions_provider_refund_key on public.refund_transactions (provider, provider_refund_id)
  where provider_refund_id is not null;
create index if not exists refund_transactions_order_idx on public.refund_transactions (order_id, created_at);
create index if not exists refund_transactions_case_idx on public.refund_transactions (case_id) where case_id is not null;
create index if not exists refund_transactions_inflight_idx on public.refund_transactions (status, created_at)
  where status in ('pending_submission', 'submitted', 'unknown', 'pending', 'requires_action');

-- Databases that created the table with 'on delete restrict' get the cascade.
alter table public.refund_transactions drop constraint if exists refund_transactions_order_id_fkey;
alter table public.refund_transactions
  add constraint refund_transactions_order_id_fkey foreign key (order_id) references public.orders (id) on delete cascade;

-- When the provider was last called for this row. Distinct from
-- last_checked_at (any look at it): reconciliation waits for a quiet period
-- after the last CALL before trusting the provider's list to be complete.
alter table public.refund_transactions add column if not exists last_attempt_at timestamptz;

alter table public.refund_transactions enable row level security;
revoke all on public.refund_transactions from anon, authenticated;

comment on table public.refund_transactions is
  'Refund ledger: every attempt to return money, with its provider state. orders.refunded_amount summarises the succeeded rows.';

-- Financial facts do not change; only the provider state moves, and only
-- forward (a succeeded refund CAN still fail later — Stripe reports a refund
-- the card network bounced as refund.failed).
create or replace function public.refund_transactions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Only together with its order (the retention period ending): by the time
    -- the cascade reaches this row, the order is gone.
    if exists (select 1 from public.orders o where o.id = old.order_id) then
      raise exception 'refund_transactions rows cannot be deleted';
    end if;
    return old;
  end if;
  if new.order_id is distinct from old.order_id
     or new.amount_minor is distinct from old.amount_minor
     or new.currency is distinct from old.currency
     or new.provider is distinct from old.provider
     or new.idempotency_key is distinct from old.idempotency_key
     or new.source is distinct from old.source
     or new.created_at is distinct from old.created_at
     or new.initiated_by_label is distinct from old.initiated_by_label
     or new.case_id is distinct from old.case_id and old.case_id is not null then
    raise exception 'refund_transactions: the financial fields of a refund cannot be changed';
  end if;
  if new.provider_refund_id is distinct from old.provider_refund_id and old.provider_refund_id is not null then
    raise exception 'refund_transactions: provider_refund_id is set once';
  end if;
  if new.status <> old.status and not (
       (old.status = 'pending_submission' and new.status in ('submitted', 'unknown', 'pending', 'requires_action', 'succeeded', 'failed', 'canceled'))
    or (old.status = 'submitted' and new.status in ('unknown', 'pending', 'requires_action', 'succeeded', 'failed', 'canceled'))
    or (old.status = 'unknown' and new.status in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled'))
    or (old.status = 'pending' and new.status in ('requires_action', 'succeeded', 'failed', 'canceled'))
    or (old.status = 'requires_action' and new.status in ('pending', 'succeeded', 'failed', 'canceled'))
    or (old.status = 'succeeded' and new.status = 'failed')) then
    raise exception 'refund_transactions: % -> % is not a valid refund state change', old.status, new.status;
  end if;
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists refund_transactions_guard on public.refund_transactions;
create trigger refund_transactions_guard
  before update or delete on public.refund_transactions
  for each row execute function public.refund_transactions_guard();

-- Refunds recorded before the ledger existed live only as
-- orders.refunded_amount. One 'backfill' row each, so the ledger and the
-- summary agree from the first day.
insert into public.refund_transactions (
  order_id, provider, payment_reference, provider_refund_id, idempotency_key, amount_minor, currency,
  reason, status, source, initiated_by_label, created_at, settled_at)
select o.id,
       case when o.payment_provider = 'stripe' then 'stripe' else 'legacy' end,
       o.payment_id,
       case when o.payment_provider = 'stripe' then o.stripe_refund_id end,
       'backfill:' || o.id::text,
       round(o.refunded_amount * 100)::bigint,
       'CHF',
       'Recorded before the refund ledger (migration 0059)',
       'succeeded',
       'backfill',
       'system: backfill',
       coalesce(o.refunded_at, o.updated_at, now()),
       coalesce(o.refunded_at, o.updated_at, now())
  from public.orders o
 where o.refunded_amount > 0
   and not exists (select 1 from public.refund_transactions t where t.idempotency_key = 'backfill:' || o.id::text)
on conflict do nothing;


-- ============================================================ evidence ======
create table if not exists public.refund_case_evidence (
  id                uuid primary key default gen_random_uuid(),
  case_id           uuid not null references public.return_requests (id) on delete cascade,
  kind              text not null check (kind in ('tracking_snapshot', 'carrier_correspondence',
                      'proof_of_delivery', 'customer_photo', 'return_receipt', 'inspection_report',
                      'order_event', 'other')),
  -- Where it came from. 'carrier_api' is reserved for a live carrier
  -- integration; none is configured today (docs/refunds/README.md), so
  -- tracking evidence is 'staff' (read off the carrier's site) or 'system'
  -- (the order's own record).
  source            text not null check (source in ('customer', 'staff', 'system', 'carrier_api')),
  title             text check (title is null or char_length(title) <= 200),
  storage_bucket    text check (storage_bucket is null or storage_bucket in ('returns', 'refund-evidence')),
  storage_path      text,
  mime_type         text,
  size_bytes        integer check (size_bytes is null or size_bytes >= 0),
  sha256            text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  data              jsonb not null default '{}'::jsonb,
  customer_visible  boolean not null default false,
  -- When the fact was observed (a tracking page read, a photo taken), as
  -- distinct from when it was written here.
  captured_at       timestamptz not null default now(),
  recorded_at       timestamptz not null default now(),
  recorded_by       uuid references public.admin_staff (id) on delete set null,
  recorded_by_label text not null,
  purged_at         timestamptz
);

create index if not exists refund_case_evidence_case_idx on public.refund_case_evidence (case_id, recorded_at);
create index if not exists refund_case_evidence_sha_idx on public.refund_case_evidence (sha256) where sha256 is not null;

alter table public.refund_case_evidence enable row level security;
revoke all on public.refund_case_evidence from anon, authenticated;

-- Evidence is not edited. The one permitted change is retention: the file is
-- deleted and the row says so (lib/server/refunds/retention.ts).
create or replace function public.refund_case_evidence_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Only as part of deleting the case itself (its order was deleted).
    if exists (select 1 from public.return_requests r where r.id = old.case_id) then
      raise exception 'refund_case_evidence rows cannot be deleted';
    end if;
    return old;
  end if;
  if new.purged_at is not null and old.purged_at is null
     and new.storage_path is null
     and new.case_id = old.case_id and new.kind = old.kind and new.sha256 is not distinct from old.sha256 then
    return new;
  end if;
  raise exception 'refund_case_evidence rows cannot be changed';
end
$$;

drop trigger if exists refund_case_evidence_guard on public.refund_case_evidence;
create trigger refund_case_evidence_guard
  before update or delete on public.refund_case_evidence
  for each row execute function public.refund_case_evidence_guard();


-- ============================================================ messages ======
create table if not exists public.refund_case_messages (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.return_requests (id) on delete cascade,
  author_type  text not null check (author_type in ('customer', 'staff', 'system')),
  author_staff uuid references public.admin_staff (id) on delete set null,
  author_label text not null,
  -- 'internal' is a staff note and is never sent to, or read by, a customer.
  visibility   text not null check (visibility in ('customer', 'internal')),
  body         text not null check (char_length(btrim(body)) between 1 and 4000),
  attachments  uuid[] not null default '{}',
  created_at   timestamptz not null default now(),
  check (author_type = 'staff' or visibility = 'customer')
);

create index if not exists refund_case_messages_case_idx on public.refund_case_messages (case_id, created_at);

alter table public.refund_case_messages enable row level security;
revoke all on public.refund_case_messages from anon, authenticated;


-- =============================================================== audit ======
-- No foreign keys on purpose: the trail outlives anything it mentions.
create table if not exists public.refund_case_events (
  id             bigint generated always as identity primary key,
  event_id       uuid not null default gen_random_uuid(),
  case_id        uuid,
  order_id       uuid,
  actor_type     text not null check (actor_type in ('customer', 'staff', 'system', 'provider')),
  actor_id       text,
  actor_label    text not null,
  action         text not null check (char_length(action) between 1 and 80),
  from_state     text,
  to_state       text,
  reason         text,
  data           jsonb not null default '{}'::jsonb,
  correlation_id text,
  provider_ref   text,
  created_at     timestamptz not null default now()
);

create unique index if not exists refund_case_events_event_id on public.refund_case_events (event_id);
create index if not exists refund_case_events_case_idx on public.refund_case_events (case_id, id) where case_id is not null;
create index if not exists refund_case_events_order_idx on public.refund_case_events (order_id, id) where order_id is not null;
create index if not exists refund_case_events_action_idx on public.refund_case_events (action, created_at desc);

alter table public.refund_case_events enable row level security;
revoke all on public.refund_case_events from anon, authenticated;

comment on table public.refund_case_events is
  'Append-only audit trail of the refund system. Rows cannot be updated or deleted, even by the service role.';

create or replace function public.refund_case_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Never edited. Deleted only once older than the orders' own retention
  -- period (5 years, lib/server/retention.ts) plus a month's grace — the
  -- trail must not outlive the records it describes, and nothing younger can
  -- be removed by anyone.
  if tg_op = 'DELETE' then
    if old.created_at < now() - interval '5 years 31 days' then
      return old;
    end if;
  end if;
  raise exception 'refund_case_events is append-only';
end
$$;

drop trigger if exists refund_case_events_no_change on public.refund_case_events;
create trigger refund_case_events_no_change
  before update or delete on public.refund_case_events
  for each row execute function public.refund_case_events_append_only();

drop trigger if exists refund_case_events_no_truncate on public.refund_case_events;
create trigger refund_case_events_no_truncate
  before truncate on public.refund_case_events
  for each statement execute function public.refund_case_events_append_only();


-- ================================================================ risk ======
create table if not exists public.refund_risk_assessments (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.return_requests (id) on delete cascade,
  score          integer not null check (score between 0 and 100),
  level          text not null check (level in ('low', 'medium', 'high')),
  -- Every rule that fired, with the facts it fired on (lib/refunds/risk.ts).
  rules          jsonb not null,
  facts          jsonb not null,
  engine_version text not null,
  policy_version integer not null,
  evaluated_at   timestamptz not null default now(),
  evaluated_by_label text not null
);

create index if not exists refund_risk_assessments_case_idx on public.refund_risk_assessments (case_id, evaluated_at desc);

alter table public.refund_risk_assessments enable row level security;
revoke all on public.refund_risk_assessments from anon, authenticated;


-- =========================================================== approvals ======
create table if not exists public.refund_approvals (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null references public.return_requests (id) on delete cascade,
  kind          text not null check (kind in ('approve', 'second_approval')),
  staff_id      uuid references public.admin_staff (id) on delete set null,
  staff_label   text not null,
  amount_minor  bigint not null check (amount_minor >= 0),
  resolution    text not null,
  note          text,
  created_at    timestamptz not null default now()
);

create index if not exists refund_approvals_case_idx on public.refund_approvals (case_id, created_at);

alter table public.refund_approvals enable row level security;
revoke all on public.refund_approvals from anon, authenticated;


-- ======================================================= notifications ======
create table if not exists public.refund_notifications (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid references public.return_requests (id) on delete cascade,
  event       text not null,
  channel     text not null check (channel in ('email', 'in_app', 'staff')),
  -- One notification per (case, event, occurrence): a retried transition or a
  -- redelivered webhook finds its key taken and sends nothing twice.
  dedupe_key  text not null,
  status      text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  attempts    integer not null default 0,
  last_error  text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

create unique index if not exists refund_notifications_dedupe_key on public.refund_notifications (dedupe_key);
create index if not exists refund_notifications_retry_idx on public.refund_notifications (status, created_at)
  where status in ('queued', 'failed');

alter table public.refund_notifications enable row level security;
revoke all on public.refund_notifications from anon, authenticated;

alter type public.notification_type add value if not exists 'refund_update';


-- ============================================================= storage ======
-- Staff evidence: carrier letters and proof-of-delivery PDFs as well as
-- photographs. Private, like 'returns'; served only through short-lived
-- signed URLs from an admin route that logs the access.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('refund-evidence', 'refund-evidence', false, 15728640,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ============================================================ functions =====

-- One case and its lines, atomically, under a lock on the order: two
-- submissions for the same units — two tabs, a double tap, two staff members —
-- cannot both pass the quantity check.
create or replace function public.create_refund_case(p_case jsonb, p_items jsonb, p_event jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_order_id   uuid := (p_case ->> 'order_id')::uuid;
  v_existing   uuid;
  v_case_id    uuid;
  v_item       jsonb;
  v_oi         record;
  v_claimed    integer;
  v_qty        integer;
  v_claim      text := p_case ->> 'claim_type';
begin
  perform 1 from public.orders where id = v_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if coalesce(p_case ->> 'submission_key', '') <> '' then
    select id into v_existing from public.return_requests where submission_key = p_case ->> 'submission_key';
    if v_existing is not null then return v_existing; end if;
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'NO_ITEMS';
  end if;

  insert into public.return_requests (
    order_id, user_id, reason, comment, images, case_number, claim_type, state,
    requested_resolution, currency, requested_amount_minor, source, created_by_staff,
    submission_key, policy_version, policy_snapshot, eligibility, investigation_status,
    wait_until, risk_level, risk_score)
  values (
    v_order_id,
    nullif(p_case ->> 'user_id', '')::uuid,
    (case v_claim
       when 'defective' then 'defective' when 'damaged' then 'defective'
       when 'wrong_size' then 'wrong_size' when 'changed_mind' then 'changed_mind'
       when 'not_as_described' then 'not_as_described' when 'wrong_item' then 'not_as_described'
       else 'other' end)::public.return_reason,
    coalesce(p_case ->> 'comment', ''),
    coalesce(array(select jsonb_array_elements_text(p_case -> 'images')), '{}'),
    p_case ->> 'case_number',
    v_claim,
    coalesce(p_case ->> 'state', 'requested'),
    p_case ->> 'requested_resolution',
    coalesce(p_case ->> 'currency', 'CHF'),
    nullif(p_case ->> 'requested_amount_minor', '')::bigint,
    coalesce(p_case ->> 'source', 'customer'),
    nullif(p_case ->> 'created_by_staff', '')::uuid,
    nullif(p_case ->> 'submission_key', ''),
    nullif(p_case ->> 'policy_version', '')::integer,
    p_case -> 'policy_snapshot',
    p_case -> 'eligibility',
    coalesce(p_case ->> 'investigation_status', 'none'),
    nullif(p_case ->> 'wait_until', '')::timestamptz,
    nullif(p_case ->> 'risk_level', ''),
    nullif(p_case ->> 'risk_score', '')::integer)
  returning id into v_case_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'qty')::integer;
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QTY'; end if;

    select oi.id, oi.qty, oi.unit_price into v_oi
      from public.order_items oi
     where oi.id = (v_item ->> 'order_item_id')::uuid and oi.order_id = v_order_id;
    if not found then raise exception 'ITEM_NOT_IN_ORDER'; end if;

    -- Units already claimed on this line by a case that is still alive or
    -- that was settled. Rejected, cancelled and expired claims give their
    -- units back.
    select coalesce(sum(coalesce(i.qty_approved, i.qty_requested)), 0) into v_claimed
      from public.return_request_items i
      join public.return_requests r on r.id = i.case_id
     where i.order_item_id = v_oi.id
       and r.id <> v_case_id
       and r.state not in ('rejected', 'cancelled', 'expired');

    if v_claimed + v_qty > v_oi.qty then
      raise exception 'QTY_EXCEEDS_AVAILABLE';
    end if;

    insert into public.return_request_items (case_id, order_item_id, qty_requested, unit_price_minor)
    values (v_case_id, v_oi.id, v_qty, round(v_oi.unit_price * 100)::bigint);
  end loop;

  insert into public.refund_case_events (case_id, order_id, actor_type, actor_id, actor_label, action,
                                         to_state, reason, data, correlation_id)
  values (v_case_id, v_order_id,
          coalesce(p_event ->> 'actor_type', 'customer'), p_event ->> 'actor_id',
          coalesce(p_event ->> 'actor_label', 'customer'), 'case.created',
          coalesce(p_case ->> 'state', 'requested'), p_event ->> 'reason',
          coalesce(p_event -> 'data', '{}'::jsonb), p_event ->> 'correlation_id');

  return v_case_id;
end
$$;

-- A change to one case: only from the states the caller says it may come
-- from, only on the version the caller read, and audited in the same
-- transaction. Returns the new row, or nothing when the case had moved on —
-- which the caller reports as a conflict rather than overwriting a decision.
create or replace function public.refund_case_apply(
  p_case_id uuid,
  p_expected_version integer,
  p_allowed_from text[],
  p_changes jsonb,
  p_event jsonb)
returns setof public.return_requests
language plpgsql
set search_path = ''
as $$
declare
  v_old  public.return_requests;
  v_new  public.return_requests;
  v_item jsonb;
begin
  select * into v_old from public.return_requests where id = p_case_id for update;
  if not found then return; end if;
  if v_old.version <> p_expected_version then return; end if;
  if p_allowed_from is not null and not (v_old.state = any (p_allowed_from)) then return; end if;

  update public.return_requests r set
    state                 = case when p_changes ? 'state' then p_changes ->> 'state' else r.state end,
    state_changed_at      = case when p_changes ? 'state' and (p_changes ->> 'state') <> r.state then now() else r.state_changed_at end,
    assigned_to           = case when p_changes ? 'assigned_to' then nullif(p_changes ->> 'assigned_to', '')::uuid else r.assigned_to end,
    escalated_at          = case when p_changes ? 'escalated_at' then nullif(p_changes ->> 'escalated_at', '')::timestamptz else r.escalated_at end,
    escalation_reason     = case when p_changes ? 'escalation_reason' then p_changes ->> 'escalation_reason' else r.escalation_reason end,
    customer_deadline_at  = case when p_changes ? 'customer_deadline_at' then nullif(p_changes ->> 'customer_deadline_at', '')::timestamptz else r.customer_deadline_at end,
    wait_until            = case when p_changes ? 'wait_until' then nullif(p_changes ->> 'wait_until', '')::timestamptz else r.wait_until end,
    investigation_status  = case when p_changes ? 'investigation_status' then p_changes ->> 'investigation_status' else r.investigation_status end,
    carrier_claim_ref     = case when p_changes ? 'carrier_claim_ref' then p_changes ->> 'carrier_claim_ref' else r.carrier_claim_ref end,
    decision_note         = case when p_changes ? 'decision_note' then p_changes ->> 'decision_note' else r.decision_note end,
    pending_approval      = case when p_changes ? 'pending_approval' then nullif(p_changes -> 'pending_approval', 'null'::jsonb) else r.pending_approval end,
    approval              = case when p_changes ? 'approval' then nullif(p_changes -> 'approval', 'null'::jsonb) else r.approval end,
    approved_resolution   = case when p_changes ? 'approved_resolution' then p_changes ->> 'approved_resolution' else r.approved_resolution end,
    approved_amount_minor = case when p_changes ? 'approved_amount_minor' then nullif(p_changes ->> 'approved_amount_minor', '')::bigint else r.approved_amount_minor end,
    requested_amount_minor = case when p_changes ? 'requested_amount_minor' then nullif(p_changes ->> 'requested_amount_minor', '')::bigint else r.requested_amount_minor end,
    appeal_count          = case when p_changes ? 'appeal_count' then (p_changes ->> 'appeal_count')::integer else r.appeal_count end,
    closed_at             = case when p_changes ? 'closed_at' then nullif(p_changes ->> 'closed_at', '')::timestamptz else r.closed_at end,
    return_tracking_number = case when p_changes ? 'return_tracking_number' then p_changes ->> 'return_tracking_number' else r.return_tracking_number end,
    return_carrier        = case when p_changes ? 'return_carrier' then p_changes ->> 'return_carrier' else r.return_carrier end,
    return_shipped_at     = case when p_changes ? 'return_shipped_at' then nullif(p_changes ->> 'return_shipped_at', '')::timestamptz else r.return_shipped_at end,
    return_received_at    = case when p_changes ? 'return_received_at' then nullif(p_changes ->> 'return_received_at', '')::timestamptz else r.return_received_at end,
    dispute_ref           = case when p_changes ? 'dispute_ref' then p_changes ->> 'dispute_ref' else r.dispute_ref end,
    resolution_ref        = case when p_changes ? 'resolution_ref' then p_changes ->> 'resolution_ref' else r.resolution_ref end,
    risk_level            = case when p_changes ? 'risk_level' then p_changes ->> 'risk_level' else r.risk_level end,
    risk_score            = case when p_changes ? 'risk_score' then nullif(p_changes ->> 'risk_score', '')::integer else r.risk_score end,
    finding               = case when p_changes ? 'finding' then nullif(p_changes ->> 'finding', '') else r.finding end,
    finding_note          = case when p_changes ? 'finding_note' then p_changes ->> 'finding_note' else r.finding_note end,
    eligibility           = case when p_changes ? 'eligibility' then nullif(p_changes -> 'eligibility', 'null'::jsonb) else r.eligibility end,
    decided_at            = case when p_changes ? 'decided_at' then nullif(p_changes ->> 'decided_at', '')::timestamptz else r.decided_at end,
    version               = r.version + 1
  where r.id = p_case_id
  returning * into v_new;

  -- Line changes travel with the case change, in the same transaction:
  -- what was received, what inspection found, what was approved.
  if p_changes ? 'items' then
    for v_item in select * from jsonb_array_elements(p_changes -> 'items') loop
      update public.return_request_items i set
        qty_approved       = case when v_item ? 'qty_approved' then nullif(v_item ->> 'qty_approved', '')::integer else i.qty_approved end,
        qty_received       = case when v_item ? 'qty_received' then (v_item ->> 'qty_received')::integer else i.qty_received end,
        inspection_outcome = case when v_item ? 'inspection_outcome' then nullif(v_item ->> 'inspection_outcome', '') else i.inspection_outcome end,
        inspection_note    = case when v_item ? 'inspection_note' then nullif(v_item ->> 'inspection_note', '') else i.inspection_note end,
        inspected_at       = case when v_item ? 'inspection_outcome' then now() else i.inspected_at end,
        inspected_by       = case when v_item ? 'inspected_by' then nullif(v_item ->> 'inspected_by', '')::uuid else i.inspected_by end
      where i.id = (v_item ->> 'id')::uuid and i.case_id = p_case_id;
      if not found then raise exception 'ITEM_NOT_IN_CASE'; end if;
    end loop;
  end if;

  insert into public.refund_case_events (case_id, order_id, actor_type, actor_id, actor_label, action,
                                         from_state, to_state, reason, data, correlation_id, provider_ref)
  values (p_case_id, v_old.order_id,
          coalesce(p_event ->> 'actor_type', 'system'), p_event ->> 'actor_id',
          coalesce(p_event ->> 'actor_label', 'system'),
          coalesce(p_event ->> 'action', 'case.updated'),
          v_old.state, v_new.state, p_event ->> 'reason',
          coalesce(p_event -> 'data', '{}'::jsonb), p_event ->> 'correlation_id', p_event ->> 'provider_ref');

  return next v_new;
end
$$;

-- THE OVER-REFUND GUARD. Reserves an amount against an order under a row lock:
-- everything already succeeded plus everything still in flight plus this must
-- fit inside what the order was paid, and inside what the case approved. One
-- refund in flight per order at a time — a second waits for the first to
-- settle, so two members of staff (or a retry racing its original) cannot
-- both reserve the same money.
create or replace function public.reserve_refund_transaction(p jsonb)
returns public.refund_transactions
language plpgsql
set search_path = ''
as $$
declare
  v_order      record;
  v_total      bigint;
  v_committed  bigint;
  v_case       record;
  v_case_committed bigint;
  v_amount     bigint := (p ->> 'amount_minor')::bigint;
  v_existing   public.refund_transactions;
  v_row        public.refund_transactions;
begin
  if v_amount is null or v_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  select id, total, payment_status into v_order
    from public.orders where id = (p ->> 'order_id')::uuid for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  -- The same reservation asked twice is the same reservation.
  select * into v_existing from public.refund_transactions where idempotency_key = p ->> 'idempotency_key';
  if found then return v_existing; end if;

  if v_order.payment_status::text not in ('paid', 'partially_refunded') then
    raise exception 'ORDER_NOT_REFUNDABLE';
  end if;

  if exists (select 1 from public.refund_transactions
              where order_id = v_order.id
                and status in ('pending_submission', 'submitted', 'unknown', 'pending', 'requires_action')) then
    raise exception 'REFUND_IN_FLIGHT';
  end if;

  v_total := round(v_order.total * 100)::bigint;
  select coalesce(sum(amount_minor), 0) into v_committed
    from public.refund_transactions
   where order_id = v_order.id
     and status in ('pending_submission', 'submitted', 'unknown', 'pending', 'requires_action', 'succeeded');
  if v_committed + v_amount > v_total then
    raise exception 'REFUND_EXCEEDS_BALANCE' using detail = format('total=%s committed=%s requested=%s', v_total, v_committed, v_amount);
  end if;

  if nullif(p ->> 'case_id', '') is not null then
    select id, order_id, state, approved_amount_minor into v_case
      from public.return_requests where id = (p ->> 'case_id')::uuid for update;
    if not found or v_case.order_id <> v_order.id then raise exception 'CASE_ORDER_MISMATCH'; end if;
    -- Approval is not payment, and payment needs an approval: only a case in
    -- 'approved', with an approved amount, can have money reserved for it.
    -- ('refund_processing': the workflow claims the case first — approved →
    -- refund_processing, compare-and-set — and then reserves.)
    if v_case.approved_amount_minor is null or v_case.state not in ('approved', 'refund_processing') then
      raise exception 'CASE_NOT_APPROVED';
    end if;
    select coalesce(sum(amount_minor), 0) into v_case_committed
      from public.refund_transactions
     where case_id = v_case.id
       and status in ('pending_submission', 'submitted', 'unknown', 'pending', 'requires_action', 'succeeded');
    if v_case_committed + v_amount > v_case.approved_amount_minor then
      raise exception 'REFUND_EXCEEDS_APPROVED' using detail = format('approved=%s committed=%s requested=%s', v_case.approved_amount_minor, v_case_committed, v_amount);
    end if;
  end if;

  insert into public.refund_transactions (
    order_id, case_id, provider, payment_reference, idempotency_key, amount_minor, currency,
    provider_amount_minor, provider_currency, reason, status, source,
    initiated_by, initiated_by_label, approved_by, approved_by_label, second_approved_by, manual_reference)
  values (
    v_order.id, nullif(p ->> 'case_id', '')::uuid, p ->> 'provider', p ->> 'payment_reference',
    p ->> 'idempotency_key', v_amount, coalesce(p ->> 'currency', 'CHF'),
    nullif(p ->> 'provider_amount_minor', '')::bigint, p ->> 'provider_currency',
    p ->> 'reason', 'pending_submission', p ->> 'source',
    nullif(p ->> 'initiated_by', '')::uuid, p ->> 'initiated_by_label',
    nullif(p ->> 'approved_by', '')::uuid, p ->> 'approved_by_label',
    nullif(p ->> 'second_approved_by', '')::uuid, p ->> 'manual_reference')
  returning * into v_row;

  insert into public.refund_case_events (case_id, order_id, actor_type, actor_id, actor_label, action, data, correlation_id)
  values (v_row.case_id, v_order.id, coalesce(p ->> 'actor_type', 'staff'), p ->> 'initiated_by', p ->> 'initiated_by_label',
          'refund.reserved',
          jsonb_build_object('transaction_id', v_row.id, 'amount_minor', v_amount, 'provider', v_row.provider, 'source', v_row.source),
          p ->> 'correlation_id');

  return v_row;
end
$$;

-- Records what the provider said about one transaction, then rebuilds the
-- order's refund summary and the case's settled amount FROM THE LEDGER — never
-- by adding to a stored figure, so a replayed webhook cannot count twice.
create or replace function public.settle_refund_transaction(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tx        public.refund_transactions;
  v_order     record;
  v_total     bigint;
  v_succeeded bigint;
  v_case_sum  bigint;
  v_status    text := p ->> 'status';
  v_pay       text;
  v_ostatus   text;
  v_latest    text;
begin
  select * into v_tx from public.refund_transactions where id = (p ->> 'transaction_id')::uuid for update;
  if not found then raise exception 'TRANSACTION_NOT_FOUND'; end if;

  select id, total, payment_status, status, shipped_at, delivered_at into v_order
    from public.orders where id = v_tx.order_id for update;

  if v_status is not null and v_status <> v_tx.status then
    update public.refund_transactions set
      status = v_status,
      provider_refund_id = coalesce(provider_refund_id, nullif(p ->> 'provider_refund_id', '')),
      provider_amount_minor = coalesce(nullif(p ->> 'provider_amount_minor', '')::bigint, provider_amount_minor),
      provider_currency = coalesce(nullif(p ->> 'provider_currency', ''), provider_currency),
      failure_code = case when v_status in ('failed', 'canceled') then coalesce(p ->> 'failure_code', failure_code) else failure_code end,
      failure_message = case when v_status in ('failed', 'canceled') then coalesce(p ->> 'failure_message', failure_message) else failure_message end,
      submitted_at = case when v_status <> 'pending_submission' then coalesce(submitted_at, now()) else submitted_at end,
      settled_at = case when v_status in ('succeeded', 'failed', 'canceled') then now() else settled_at end,
      attempts = attempts + case when (p ->> 'count_attempt')::boolean then 1 else 0 end,
      last_checked_at = now()
    where id = v_tx.id
    returning * into v_tx;
  elsif nullif(p ->> 'provider_refund_id', '') is not null and v_tx.provider_refund_id is null then
    update public.refund_transactions set provider_refund_id = p ->> 'provider_refund_id', last_checked_at = now(),
           attempts = attempts + case when (p ->> 'count_attempt')::boolean then 1 else 0 end
     where id = v_tx.id returning * into v_tx;
  else
    -- No new status: a check that found nothing new, or another attempt at a
    -- submission whose outcome is still unknown (its count keys the retry).
    update public.refund_transactions set last_checked_at = now(),
           attempts = attempts + case when (p ->> 'count_attempt')::boolean then 1 else 0 end
     where id = v_tx.id returning * into v_tx;
  end if;

  v_total := round(v_order.total * 100)::bigint;
  select coalesce(sum(amount_minor), 0) into v_succeeded
    from public.refund_transactions where order_id = v_order.id and status = 'succeeded';
  select provider_refund_id into v_latest
    from public.refund_transactions
   where order_id = v_order.id and status = 'succeeded' and provider = 'stripe' and provider_refund_id is not null
   order by settled_at desc nulls last, created_at desc limit 1;

  v_pay := v_order.payment_status::text;
  v_ostatus := v_order.status::text;
  if v_pay in ('paid', 'partially_refunded', 'refunded') then
    if v_succeeded >= v_total and v_total > 0 then
      v_pay := 'refunded';
      v_ostatus := 'refunded';
    elsif v_succeeded > 0 then
      v_pay := 'partially_refunded';
    else
      v_pay := 'paid';
    end if;
    -- A full refund that a later failure undid: the order goes back to where
    -- its own timeline says it was.
    if v_ostatus = 'refunded' and v_pay <> 'refunded' then
      v_ostatus := case when v_order.delivered_at is not null then 'delivered'
                        when v_order.shipped_at is not null then 'shipped'
                        else 'processing' end;
    end if;
    update public.orders set
      refunded_amount = least(v_succeeded, v_total)::numeric / 100,
      refunded_at = case when v_succeeded > 0 then coalesce(refunded_at, now()) else refunded_at end,
      stripe_refund_id = coalesce(v_latest, stripe_refund_id),
      payment_status = v_pay::public.payment_status,
      status = v_ostatus::public.order_status
    where id = v_order.id;
  end if;

  if v_tx.case_id is not null then
    select coalesce(sum(amount_minor), 0) into v_case_sum
      from public.refund_transactions where case_id = v_tx.case_id and status = 'succeeded';
    update public.return_requests set refunded_amount_minor = v_case_sum where id = v_tx.case_id;
  end if;

  insert into public.refund_case_events (case_id, order_id, actor_type, actor_id, actor_label, action, data, correlation_id, provider_ref)
  values (v_tx.case_id, v_order.id, coalesce(p ->> 'actor_type', 'provider'), p ->> 'actor_id',
          coalesce(p ->> 'actor_label', 'provider'), 'refund.' || v_tx.status,
          jsonb_build_object('transaction_id', v_tx.id, 'amount_minor', v_tx.amount_minor, 'status', v_tx.status,
                             'order_refunded_minor', v_succeeded, 'failure_code', v_tx.failure_code),
          p ->> 'correlation_id', v_tx.provider_refund_id);

  return jsonb_build_object(
    'transaction', to_jsonb(v_tx),
    'order_refunded_minor', v_succeeded,
    'order_total_minor', v_total,
    'payment_status', v_pay,
    'case_refunded_minor', v_case_sum);
end
$$;

-- The right to call the provider once more for one row. Compare-and-set on
-- the attempt count: two requests that both hold the row (a double submit, a
-- retry racing the sweep) cannot both call — the loser sees no row back. The
-- attempt number keys the provider request (lib/server/refunds/payments.ts).
create or replace function public.claim_refund_attempt(p_tx uuid, p_expected integer, p_event jsonb)
returns setof public.refund_transactions
language plpgsql
set search_path = ''
as $$
declare
  v_row public.refund_transactions;
begin
  update public.refund_transactions
     set attempts = attempts + 1,
         last_attempt_at = now(),
         status = case when status = 'pending_submission' then 'submitted' else status end,
         submitted_at = coalesce(submitted_at, now())
   where id = p_tx
     and attempts = p_expected
     and status in ('pending_submission', 'submitted', 'unknown')
  returning * into v_row;
  if not found then return; end if;

  insert into public.refund_case_events (case_id, order_id, actor_type, actor_id, actor_label, action, data, correlation_id)
  values (v_row.case_id, v_row.order_id, coalesce(p_event ->> 'actor_type', 'system'), p_event ->> 'actor_id',
          coalesce(p_event ->> 'actor_label', 'system'), 'refund.submitted',
          jsonb_build_object('transaction_id', v_row.id, 'attempt', v_row.attempts, 'amount_minor', v_row.amount_minor),
          p_event ->> 'correlation_id');
  return next v_row;
end
$$;

-- A refund the shop did not start — made in the Stripe dashboard, or by
-- Stripe resolving a dispute — recorded so the ledger stays the whole truth.
-- Idempotent on the provider's refund id. Capped at what is still unrefunded
-- on the order: money that really moved is never refused, but a franc
-- conversion can be a rappen out, and the summary must stay within the total.
create or replace function public.record_external_refund(p jsonb)
returns public.refund_transactions
language plpgsql
set search_path = ''
as $$
declare
  v_order     record;
  v_existing  public.refund_transactions;
  v_row       public.refund_transactions;
  v_total     bigint;
  v_succeeded bigint;
  v_amount    bigint := (p ->> 'amount_minor')::bigint;
begin
  if coalesce(p ->> 'provider_refund_id', '') = '' then raise exception 'PROVIDER_REFUND_ID_REQUIRED'; end if;
  select id, total into v_order from public.orders where id = (p ->> 'order_id')::uuid for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  select * into v_existing from public.refund_transactions
   where provider = p ->> 'provider' and provider_refund_id = p ->> 'provider_refund_id';
  if found then return v_existing; end if;

  v_total := round(v_order.total * 100)::bigint;
  select coalesce(sum(amount_minor), 0) into v_succeeded
    from public.refund_transactions where order_id = v_order.id and status = 'succeeded';
  v_amount := least(v_amount, v_total - v_succeeded);
  if v_amount is null or v_amount <= 0 then raise exception 'NOTHING_TO_RECORD'; end if;

  insert into public.refund_transactions (
    order_id, provider, payment_reference, provider_refund_id, idempotency_key, amount_minor, currency,
    provider_amount_minor, provider_currency, reason, status, source, initiated_by_label)
  values (
    v_order.id, p ->> 'provider', p ->> 'payment_reference', p ->> 'provider_refund_id',
    'external:' || (p ->> 'provider') || ':' || (p ->> 'provider_refund_id'), v_amount, 'CHF',
    nullif(p ->> 'provider_amount_minor', '')::bigint, p ->> 'provider_currency',
    coalesce(p ->> 'reason', 'Refund made outside the console'), 'pending_submission', 'external',
    coalesce(p ->> 'actor_label', 'provider'))
  returning * into v_row;

  perform public.settle_refund_transaction(jsonb_build_object(
    'transaction_id', v_row.id,
    'status', coalesce(p ->> 'status', 'succeeded'),
    'actor_type', 'provider',
    'actor_label', coalesce(p ->> 'actor_label', 'provider'),
    'correlation_id', p ->> 'correlation_id'));

  select * into v_row from public.refund_transactions where id = v_row.id;
  return v_row;
end
$$;

-- Puts inspected units back on sale. Idempotent by TARGET, not by increment:
-- the caller says how many units of this line should have been restocked in
-- total, so a retry asks for the same number and changes nothing.
create or replace function public.restock_return_item(p_item_id uuid, p_target_qty integer)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_item  record;
  v_delta integer;
begin
  select i.id, i.restocked_qty, i.qty_received, i.inspection_outcome, oi.product_id, oi.size, oi.color
    into v_item
    from public.return_request_items i
    join public.order_items oi on oi.id = i.order_item_id
   where i.id = p_item_id
     for update of i;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  if v_item.inspection_outcome is distinct from 'accepted' then raise exception 'NOT_RESTOCKABLE'; end if;
  if p_target_qty is null or p_target_qty < 0 or p_target_qty > v_item.qty_received then
    raise exception 'INVALID_RESTOCK_QTY';
  end if;

  v_delta := p_target_qty - v_item.restocked_qty;
  if v_delta <= 0 then return v_item.restocked_qty; end if;

  update public.product_variants v
     set stock = v.stock + v_delta
    from public.products p
   where p.slug = v_item.product_id
     and v.product_id = p.id
     and v.size = v_item.size
     and v.color = v_item.color;

  update public.return_request_items
     set restocked_qty = p_target_qty, restocked_at = now()
   where id = p_item_id;

  return p_target_qty;
end
$$;

revoke all on function public.create_refund_case(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.refund_case_apply(uuid, integer, text[], jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.reserve_refund_transaction(jsonb) from public, anon, authenticated;
revoke all on function public.settle_refund_transaction(jsonb) from public, anon, authenticated;
revoke all on function public.restock_return_item(uuid, integer) from public, anon, authenticated;
revoke all on function public.record_external_refund(jsonb) from public, anon, authenticated;
revoke all on function public.claim_refund_attempt(uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function public.return_requests_sync_legacy_status() from public, anon, authenticated;
revoke all on function public.refund_transactions_guard() from public, anon, authenticated;
revoke all on function public.refund_case_evidence_guard() from public, anon, authenticated;
revoke all on function public.refund_case_events_append_only() from public, anon, authenticated;

grant execute on function public.create_refund_case(jsonb, jsonb, jsonb) to service_role;
grant execute on function public.refund_case_apply(uuid, integer, text[], jsonb, jsonb) to service_role;
grant execute on function public.reserve_refund_transaction(jsonb) to service_role;
grant execute on function public.settle_refund_transaction(jsonb) to service_role;
grant execute on function public.restock_return_item(uuid, integer) to service_role;
grant execute on function public.record_external_refund(jsonb) to service_role;
grant execute on function public.claim_refund_attempt(uuid, integer, jsonb) to service_role;

comment on function public.reserve_refund_transaction(jsonb) is
  'Reserves a refund against an order under a row lock; refuses anything that would exceed what was paid or what the case approved.';
comment on function public.settle_refund_transaction(jsonb) is
  'Records a provider outcome for one refund and rebuilds the order and case summaries from the ledger.';
