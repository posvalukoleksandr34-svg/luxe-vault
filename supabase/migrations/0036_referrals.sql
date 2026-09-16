-- ============================================================================
-- 0036_referrals.sql
-- ============================================================================
-- "Invite a friend": a personal code per customer, clicks on its link, the
-- friends it brought, and the bonus balance it earns.
--
--   referral_codes   one code per customer (REF-XXXXXX), minted on first view
--   referral_clicks  one row per visit through /r/<code>; no IP, no user agent
--   referrals        one row per invited friend, keyed by their email:
--                      pending       joined through the link, no order yet
--                      order_placed  first order placed with the code
--                      reward_paid   that order was paid; the referrer credited
--                      void          the rewarded order was refunded
--   account_credits  the bonus ledger. The balance is SUM(amount); a reward
--                    and its reversal are separate rows, never an edit.
--
-- Money is in the store's base currency (CHF), like every other amount.
--
-- The state changes that move money are functions, so each is one statement
-- under one lock: grant_referral_reward (on payment), reverse_referral_reward
-- (on cancellation or refund) and attach_referral_order (on order creation).
-- The ledger's unique index on (referral_id, reason) makes a replayed payment
-- webhook credit once, not twice.
--
-- Access: server only, through the service role. RLS is on with no policies
-- on every table here — a policy would let the public key read other
-- customers' referrals or write its own balance.
-- ============================================================================

create table if not exists public.referral_codes (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  code        text not null unique check (code ~ '^REF-[A-HJ-NP-Z2-9]{6}$'),
  created_at  timestamptz not null default now()
);

create table if not exists public.referral_clicks (
  id           bigint generated always as identity primary key,
  referrer_id  uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now()
);

create index if not exists referral_clicks_referrer_idx
  on public.referral_clicks (referrer_id, created_at desc);

create table if not exists public.referrals (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  referrer_id      uuid not null references auth.users (id) on delete cascade,
  -- Null for a friend who checked out as a guest.
  referee_user_id  uuid references auth.users (id) on delete set null,
  referee_email    text not null
                     check (char_length(referee_email) <= 254 and referee_email = lower(referee_email)),

  status           text not null default 'pending'
                     check (status in ('pending', 'order_placed', 'reward_paid', 'void')),
  order_number     text references public.orders (order_number) on delete set null,
  reward_amount    numeric(12,2) not null default 0 check (reward_amount >= 0),
  rewarded_at      timestamptz,

  check (referee_user_id is distinct from referrer_id)
);

-- A friend can be invited once, by one customer.
create unique index if not exists referrals_referee_email_key
  on public.referrals (referee_email);
create unique index if not exists referrals_referee_user_key
  on public.referrals (referee_user_id) where referee_user_id is not null;
create unique index if not exists referrals_order_key
  on public.referrals (order_number) where order_number is not null;
create index if not exists referrals_referrer_idx
  on public.referrals (referrer_id, created_at desc);

create table if not exists public.account_credits (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  amount       numeric(12,2) not null check (amount <> 0),
  currency     text not null default 'CHF',
  reason       text not null check (reason in ('referral_reward', 'referral_reversal')),
  referral_id  uuid references public.referrals (id) on delete set null
);

create index if not exists account_credits_user_idx
  on public.account_credits (user_id, created_at desc);
-- One reward and at most one reversal per referral: replays are no-ops.
create unique index if not exists account_credits_referral_reason_key
  on public.account_credits (referral_id, reason) where referral_id is not null;

alter table public.referral_codes  enable row level security;
alter table public.referral_clicks enable row level security;
alter table public.referrals       enable row level security;
alter table public.account_credits enable row level security;

-- ---------------------------------------------------------------- functions

/**
 * Records a friend's first order against the referral. Reuses the friend's
 * pending row (matched by account, then by email) when it belongs to the same
 * referrer; otherwise creates one. Returns false when the friend is already
 * someone else's referral or has used a referral before.
 */
create or replace function public.attach_referral_order(
  p_referrer_id     uuid,
  p_referee_user_id uuid,
  p_referee_email   text,
  p_order_number    text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_referee_email));
  v_row   public.referrals%rowtype;
begin
  if p_referee_user_id is not null and p_referee_user_id = p_referrer_id then
    return false;
  end if;

  select * into v_row
    from public.referrals
   where (p_referee_user_id is not null and referee_user_id = p_referee_user_id)
      or referee_email = v_email
   order by (referee_user_id = p_referee_user_id) desc nulls last
   limit 1
   for update;

  if found then
    if v_row.referrer_id <> p_referrer_id or v_row.status <> 'pending' then
      return false;
    end if;
    update public.referrals
       set status = 'order_placed',
           order_number = p_order_number,
           referee_user_id = coalesce(referee_user_id, p_referee_user_id),
           updated_at = now()
     where id = v_row.id;
    return true;
  end if;

  insert into public.referrals (referrer_id, referee_user_id, referee_email, status, order_number)
  values (p_referrer_id, p_referee_user_id, v_email, 'order_placed', p_order_number);
  return true;
exception
  when unique_violation then
    -- A concurrent first order by the same friend won the race.
    return false;
end;
$$;

/** Credits the referrer once the friend's order is paid. Idempotent. */
create or replace function public.grant_referral_reward(
  p_order_number text,
  p_amount       numeric
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id          uuid;
  v_referrer_id uuid;
begin
  update public.referrals
     set status = 'reward_paid',
         reward_amount = p_amount,
         rewarded_at = now(),
         updated_at = now()
   where order_number = p_order_number
     and status = 'order_placed'
  returning id, referrer_id into v_id, v_referrer_id;

  if not found then
    return false;
  end if;

  if p_amount > 0 then
    insert into public.account_credits (user_id, amount, reason, referral_id)
    values (v_referrer_id, round(p_amount, 2), 'referral_reward', v_id)
    on conflict do nothing;
  end if;
  return true;
end;
$$;

/**
 * Undoes a referral when its order does not stand:
 *   order_placed → pending  (cancelled or expired before payment: the friend
 *                            can still use the code on a real first order)
 *   reward_paid  → void     (refunded: the bonus is reversed in the ledger)
 * Returns what it did: 'released', 'reversed' or 'none'.
 */
create or replace function public.reverse_referral_reward(p_order_number text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.referrals%rowtype;
begin
  select * into v_row
    from public.referrals
   where order_number = p_order_number
   for update;

  if not found then
    return 'none';
  end if;

  if v_row.status = 'order_placed' then
    update public.referrals
       set status = 'pending', order_number = null, updated_at = now()
     where id = v_row.id;
    return 'released';
  end if;

  if v_row.status = 'reward_paid' then
    if v_row.reward_amount > 0 then
      insert into public.account_credits (user_id, amount, reason, referral_id)
      values (v_row.referrer_id, -v_row.reward_amount, 'referral_reversal', v_row.id)
      on conflict do nothing;
    end if;
    update public.referrals set status = 'void', updated_at = now() where id = v_row.id;
    return 'reversed';
  end if;

  return 'none';
end;
$$;

revoke all on function public.attach_referral_order(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.grant_referral_reward(text, numeric) from public, anon, authenticated;
revoke all on function public.reverse_referral_reward(text) from public, anon, authenticated;
