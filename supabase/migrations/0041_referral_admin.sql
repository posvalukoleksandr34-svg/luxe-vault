-- ============================================================================
-- 0041_referral_admin.sql
-- ============================================================================
-- The referral programme, run from /admin/referrals (migration 0036 built the
-- programme itself).
--
--   referral_settings    ONE row: the friend's discount and the referrer's
--                        reward. Replaces the NEXT_PUBLIC_REFERRAL_* env vars
--                        as the source of truth; those remain the fallback
--                        while this migration is not applied.
--
--   referrals.paid_out_at / payout_note
--                        a reward the shop has actually handed over. Rewards
--                        are paid BY HAND (bank transfer, TWINT…) and then
--                        marked here — there is no automated payout.
--
--   account_credits      gains the reason 'referral_payout': a negative row
--                        written when a reward is marked paid, so the
--                        customer's balance is what the shop still OWES them
--                        and the ledger stays append-only.
--
-- Changing the settings affects what happens NEXT — the discount on orders
-- placed after the change, the reward for payments confirmed after it. A
-- reward already credited keeps the amount it was credited with
-- (referrals.reward_amount), because that is the amount the customer was told.
--
-- Access: server only, through the service role, like the rest of 0036.
-- ============================================================================

create table if not exists public.referral_settings (
  -- A single row, enforced: the key can only ever be true.
  id                       boolean primary key default true check (id),
  friend_discount_percent  integer not null default 10
                             check (friend_discount_percent between 1 and 50),
  referrer_reward_amount   numeric(12,2) not null default 50
                             check (referrer_reward_amount between 0 and 1000),
  updated_at               timestamptz not null default now()
);

insert into public.referral_settings (id) values (true) on conflict (id) do nothing;

alter table public.referral_settings enable row level security;

-- ------------------------------------------------------------------ payouts

alter table public.referrals
  add column if not exists paid_out_at  timestamptz,
  add column if not exists payout_note  text check (payout_note is null or char_length(payout_note) <= 200);

create index if not exists referrals_payout_queue_idx
  on public.referrals (rewarded_at)
  where status = 'reward_paid' and paid_out_at is null;

alter table public.account_credits drop constraint if exists account_credits_reason_check;
alter table public.account_credits
  add constraint account_credits_reason_check
  check (reason in ('referral_reward', 'referral_reversal', 'referral_payout'));

/**
 * Marks a credited reward as handed over. One statement under one lock, and
 * idempotent: the ledger's unique (referral_id, reason) index means a double
 * click writes one payout row. Returns
 *   'paid'         done now
 *   'already'      it had been marked before
 *   'not_payable'  no such referral, or its reward is not credited (the
 *                  friend has not paid yet, or the order was refunded)
 */
create or replace function public.mark_referral_paid_out(
  p_referral_id uuid,
  p_note        text
)
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
   where id = p_referral_id
   for update;

  if not found or v_row.status <> 'reward_paid' then
    return 'not_payable';
  end if;
  if v_row.paid_out_at is not null then
    return 'already';
  end if;

  update public.referrals
     set paid_out_at = now(),
         payout_note = nullif(btrim(coalesce(p_note, '')), ''),
         updated_at  = now()
   where id = v_row.id;

  if v_row.reward_amount > 0 then
    insert into public.account_credits (user_id, amount, reason, referral_id)
    values (v_row.referrer_id, -v_row.reward_amount, 'referral_payout', v_row.id)
    on conflict do nothing;
  end if;
  return 'paid';
end;
$$;

revoke all on function public.mark_referral_paid_out(uuid, text) from public, anon, authenticated;
