-- ============================================================================
-- 0031_waitlist.sql
-- ============================================================================
-- The back-in-stock waitlist.
--
-- Replaces public.stock_alerts as the ONE table sign-ups are written to and
-- the scheduled sweep reads from (claim_restock_alerts, app/api/cron/sweep).
-- Two tables would mean a sign-up the sweep never reads — a promise to email
-- someone that nobody keeps — so this migration moves the sweep over too.
--
-- Differences from stock_alerts:
--   * the variant is a real foreign key (product_variants.id) rather than
--     slug + size + colour text, so a renamed colour cannot orphan a sign-up;
--   * `is_notified` is the explicit flag, with `notified_at` kept alongside it
--     for the history of who was told what, and when.
--
-- Access: written ONLY by the server (the joinWaitlist Server Action and the
-- /api/stock-alerts route, both through the service role), after checking the
-- address, that the variant exists and is sold out, and a rate limit. There is
-- deliberately no INSERT policy: one would let anyone write rows straight
-- through the public key and skip every one of those checks.
-- ============================================================================

create table if not exists public.waitlist (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  email        text not null
                 check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),

  -- Set from the variant by the trigger below; stored so a product's whole
  -- waitlist is one indexed read.
  product_id   uuid not null references public.products (id) on delete cascade,
  variant_id   uuid not null references public.product_variants (id) on delete cascade,

  is_notified  boolean not null default false,
  notified_at  timestamptz,

  -- Null for a guest. Only there so a signed-in customer can see and cancel
  -- their own sign-ups; the email is what is written to either way.
  user_id      uuid references auth.users (id) on delete cascade,

  constraint waitlist_notified_consistent check (is_notified = (notified_at is not null))
);

-- One live sign-up per address per variant. Partial, so a notified row does
-- not block signing up again the next time it sells out.
create unique index if not exists waitlist_one_live_per_variant
  on public.waitlist (lower(email), variant_id)
  where not is_notified;

create index if not exists waitlist_pending_idx
  on public.waitlist (variant_id)
  where not is_notified;

create index if not exists waitlist_user_idx
  on public.waitlist (user_id)
  where user_id is not null;

-- product_id always matches the variant's product — never trusted from the
-- caller, so the two columns cannot disagree.
create or replace function public.waitlist_set_product()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select v.product_id into new.product_id
    from public.product_variants v
   where v.id = new.variant_id;
  return new;
end;
$$;

drop trigger if exists waitlist_set_product on public.waitlist;
create trigger waitlist_set_product
  before insert or update of variant_id on public.waitlist
  for each row execute function public.waitlist_set_product();

-- ------------------------------------------------------------------- RLS ----
alter table public.waitlist enable row level security;

drop policy if exists "users read their own waitlist entries" on public.waitlist;
create policy "users read their own waitlist entries"
  on public.waitlist for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "users cancel their own waitlist entries" on public.waitlist;
create policy "users cancel their own waitlist entries"
  on public.waitlist for delete
  to authenticated
  using (user_id = auth.uid());

comment on table public.waitlist is
  'Back-in-stock sign-ups per variant. Server-written only; notified rows are kept.';

-- -------------------------------------------------- carry stock_alerts over --
-- Every alert whose variant still exists, pending and notified alike, so the
-- history survives. Safe to re-run.
insert into public.waitlist (created_at, email, product_id, variant_id, is_notified, notified_at, user_id)
select a.created_at, lower(btrim(a.email)), p.id, v.id, a.notified_at is not null, a.notified_at, a.user_id
  from public.stock_alerts a
  join public.products p on p.slug = a.product_id
  join public.product_variants v
    on v.product_id = p.id
   and v.size = a.size
   and v.color = a.color
 where not exists (
   select 1 from public.waitlist w
    where w.variant_id = v.id
      and lower(w.email) = lower(a.email)
      and w.created_at = a.created_at
 )
on conflict do nothing;

comment on table public.stock_alerts is
  'SUPERSEDED by public.waitlist (0031). Kept for history; nothing writes or reads it any more.';

-- ------------------------------------------------ the sweep reads waitlist --
-- Same signature and result shape as before (email, product slug, size,
-- colour), so app/api/cron/sweep needs no change. Locks only the waitlist
-- rows it claims (`for update of wl`) — never the variant rows, which
-- checkout decrements.
create or replace function public.claim_restock_alerts(p_limit integer default 100)
returns table (email text, product_id text, size text, color text)
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update public.waitlist w
       set is_notified = true,
           notified_at = now()
     where w.id in (
       select wl.id
         from public.waitlist wl
         join public.product_variants v on v.id = wl.variant_id
        where not wl.is_notified
          and v.stock > 0
        limit p_limit
        for update of wl skip locked
     )
    returning w.email, w.variant_id
  )
  select c.email, p.slug, v.size, v.color
    from claimed c
    join public.product_variants v on v.id = c.variant_id
    join public.products p on p.id = v.product_id;
$$;

revoke all on function public.claim_restock_alerts(integer)
  from public, anon, authenticated;

comment on function public.claim_restock_alerts(integer) is
  'Claims waitlist sign-ups whose variant now has stock. Safe to run concurrently.';
