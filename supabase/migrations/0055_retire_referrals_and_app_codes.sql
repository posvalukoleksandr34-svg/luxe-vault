-- The referral programme and the installed app's personal promo code are
-- switched off (October 2026).
--
-- The code no longer offers either: no referral links, codes, invites or
-- discounts; no app code in the account, no admin pages for them. This
-- migration does the part only the database can — the app codes customers
-- were already given stop working at checkout. redeem_coupon() (0015) answers
-- INACTIVE for them, exactly as for any code the admin switches off.
--
-- Nothing is deleted. The referral tables (0036, 0041) stay as the record of
-- what was earned and paid out; the retired codes stay in `coupons`, so the
-- orders that used them still point at a real row.
--
-- To honour codes already issued until they expire instead, skip statement 1
-- (or undo it later with:
--   update public.coupons set active = true where source = 'app_welcome';).
--
-- Deploy order: either. Idempotent; safe to re-run.

do $$
begin
  -- 1. App codes already issued: switched off. `source` arrived with 0043;
  --    without it there are no app codes to retire.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'coupons' and column_name = 'source'
  ) then
    update public.coupons set active = false where source = 'app_welcome' and active;
  end if;

  -- 2. The app-code terms the admin had saved: marked off, so the row says
  --    what the site does. (Nothing reads it any more.)
  if to_regclass('public.store_settings') is not null then
    update public.store_settings
       set value = jsonb_set(value, '{enabled}', 'false'::jsonb, true),
           updated_at = now()
     where key = 'app_welcome_code'
       and coalesce((value ->> 'enabled')::boolean, true);
  end if;
end $$;
