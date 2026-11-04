-- ============================================================================
-- 0065_product_listing_events.sql
-- ============================================================================
-- An audit trail for putting products on sale and taking them off (0062).
--
-- Until now the only record was the CURRENT state: products.listing_status,
-- products.published_at and one product_rights row, which a re-publication
-- overwrote. Who published a product, on which basis at the time, and when
-- and why it was withdrawn was not kept anywhere.
--
-- 1. product_listing_events — append-only. One row per change of a product's
--    sale state: the status before and after, the rights basis and reference
--    in force at that moment (a snapshot, so a later re-publication with a
--    different reference does not rewrite history), who made the change and
--    the reason given. Server-only (RLS on, no grants), like product_rights.
--    Rows cannot be updated or deleted (trigger), and are not removed with
--    the product (no foreign key; the slug is kept beside the id).
--
-- 2. set_product_listing() — the console's publish / withdraw, in ONE
--    transaction: the rights record, the status and the event together. It
--    used to be two separate requests, so a failure in between left the
--    rights record changed and the product not published. Executable by the
--    service role only.
--
-- 3. A trigger on products.listing_status records an event for any change
--    made by another path — the SQL editor, a script — with the database
--    role as the actor. A change through set_product_listing() is recorded
--    once, by the function itself.
--
-- The application works before and after this migration: without it, the
-- console publishes as before (lib/server/catalog-store.ts) and shows no
-- history. Idempotent.
-- ============================================================================

create table if not exists public.product_listing_events (
  id           bigint generated always as identity primary key,
  product_id   uuid not null,
  product_slug text not null,
  from_status  text,
  to_status    text not null check (to_status in ('draft', 'published', 'withdrawn')),
  basis        text check (basis in ('own_design', 'authorized_resale')),
  reference    text check (reference is null or char_length(reference) <= 500),
  reason       text check (reason is null or char_length(reason) <= 500),
  -- 'console' (the admin API), or the database role for any other path.
  actor        text not null check (char_length(actor) between 1 and 120),
  created_at   timestamptz not null default now()
);

create index if not exists product_listing_events_product_idx
  on public.product_listing_events (product_id, created_at desc);

alter table public.product_listing_events enable row level security;
revoke all on public.product_listing_events from anon, authenticated;

comment on table public.product_listing_events is
  'Append-only audit trail of product sale-state changes (publish / withdraw), with the rights basis and reference at the time. Server-only.';

-- ------------------------------------------------------------ append-only --
create or replace function public.product_listing_events_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'product_listing_events is append-only'
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists product_listing_events_immutable on public.product_listing_events;
create trigger product_listing_events_immutable
  before update or delete on public.product_listing_events
  for each row execute function public.product_listing_events_immutable();

-- ------------------------------------------- backstop for any other path --
create or replace function public.products_log_listing_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if new.listing_status is not distinct from old.listing_status then
    return new;
  end if;
  -- set_product_listing() records its own change (with the console's reason).
  if coalesce(current_setting('lv.listing_logged', true), '') = 'on' then
    return new;
  end if;
  select basis, reference into r from public.product_rights where product_id = new.id;
  insert into public.product_listing_events
    (product_id, product_slug, from_status, to_status, basis, reference, actor)
  values
    (new.id, new.slug, old.listing_status, new.listing_status,
     case when new.listing_status = 'published' then r.basis end,
     case when new.listing_status = 'published' then r.reference end,
     left(session_user::text, 120));
  return new;
end;
$$;

revoke all on function public.products_log_listing_change() from public, anon, authenticated;

drop trigger if exists products_log_listing_change on public.products;
create trigger products_log_listing_change
  after update of listing_status on public.products
  for each row execute function public.products_log_listing_change();

-- ------------------------------------------------- the console's change --
create or replace function public.set_product_listing(
  p_slug      text,
  p_action    text,
  p_basis     text default null,
  p_reference text default null,
  p_reason    text default null,
  p_actor     text default 'console'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_status text;
  v_next   text;
begin
  if p_action not in ('publish', 'withdraw') then
    raise exception 'unknown action %', p_action using errcode = 'invalid_parameter_value';
  end if;

  select id, listing_status into v_id, v_status
    from public.products where slug = p_slug for update;
  if v_id is null then
    return null;
  end if;

  if p_action = 'publish' then
    if p_basis is null or p_basis not in ('own_design', 'authorized_resale') then
      raise exception 'a rights basis is required' using errcode = 'check_violation';
    end if;
    if p_reference is null or char_length(btrim(p_reference)) not between 3 and 500 then
      raise exception 'a rights reference of 3 to 500 characters is required' using errcode = 'check_violation';
    end if;
    insert into public.product_rights (product_id, basis, reference, confirmed_at, updated_at)
    values (v_id, p_basis, btrim(p_reference), now(), now())
    on conflict (product_id) do update
      set basis = excluded.basis, reference = excluded.reference,
          confirmed_at = excluded.confirmed_at, updated_at = excluded.updated_at;
    v_next := 'published';
  else
    -- Only a product on sale can be taken off it.
    if v_status is distinct from 'published' then
      return v_status;
    end if;
    v_next := 'withdrawn';
  end if;

  -- This transaction's change is recorded here, not by the backstop trigger.
  perform set_config('lv.listing_logged', 'on', true);
  update public.products set listing_status = v_next where id = v_id;
  perform set_config('lv.listing_logged', 'off', true);

  insert into public.product_listing_events
    (product_id, product_slug, from_status, to_status, basis, reference, reason, actor)
  values
    (v_id, p_slug, v_status, v_next,
     case when v_next = 'published' then p_basis end,
     case when v_next = 'published' then btrim(p_reference) end,
     nullif(left(btrim(coalesce(p_reason, '')), 500), ''),
     left(coalesce(nullif(btrim(p_actor), ''), 'console'), 120));

  return v_next;
end;
$$;

revoke all on function public.set_product_listing(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.set_product_listing(text, text, text, text, text, text) to service_role;

comment on function public.set_product_listing(text, text, text, text, text, text) is
  'Publish (with the owner''s rights record) or withdraw a product, and record the event, in one transaction. Service role only.';
