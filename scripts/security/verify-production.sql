-- Read-only security report for the production database.
-- Paste into Supabase → SQL editor → Run. Changes nothing.
--
-- Every row is one check: status is OK or PROBLEM, with what to do.
-- Dashboard edits (a policy added by hand, RLS switched off) are what this
-- catches that the migrations in the repository cannot show.

with
tables as (
  select c.relname as tbl, c.relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
checks as (
  -- 1. RLS on every table in public.
  select 'RLS enabled on public.' || tbl as check_name,
         case when rls then 'OK' else 'PROBLEM' end as status,
         case when rls then '' else 'alter table public.' || tbl || ' enable row level security;' end as action
  from tables

  -- 2. Migrations 0047 / 0048 applied.
  union all
  select 'migration 0047: admin_sessions exists',
         case when to_regclass('public.admin_sessions') is not null then 'OK' else 'PROBLEM' end,
         'apply supabase/migrations/0047_admin_sessions.sql'
  union all
  select 'migration 0048: customers cannot UPDATE orders',
         case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'orders' and cmd in ('UPDATE', 'ALL') and not ('service_role' = any (roles))) then 'OK' else 'PROBLEM' end,
         'apply supabase/migrations/0048_close_direct_customer_writes.sql'
  union all
  select 'migration 0048: no direct inserts into support_tickets',
         case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'support_tickets' and cmd in ('INSERT', 'ALL')) then 'OK' else 'PROBLEM' end,
         'apply 0048'
  union all
  select 'migration 0048: no direct inserts into return_requests / site_reviews',
         case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('return_requests', 'site_reviews') and cmd in ('INSERT', 'ALL')) then 'OK' else 'PROBLEM' end,
         'apply 0048'
  union all
  select 'migration 0048: customers may update only notifications.is_read',
         case when not exists (
           select 1 from information_schema.column_privileges
           where table_schema = 'public' and table_name = 'notifications'
             and grantee in ('authenticated', 'anon') and privilege_type = 'UPDATE' and column_name <> 'is_read'
         ) then 'OK' else 'PROBLEM' end,
         'apply 0048'
  union all
  select 'migration 0049: admin_totp_steps exists (admin two-factor replay guard)',
         case when to_regclass('public.admin_totp_steps') is not null then 'OK' else 'PROBLEM' end,
         'apply supabase/migrations/0049_admin_totp.sql'
  union all
  select 'migration 0050: profiles.birth_date removed (data minimisation)',
         case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'birth_date') then 'OK' else 'PROBLEM' end,
         'apply supabase/migrations/0050_drop_birth_date.sql'
  union all
  select 'migration 0051: newsletter double opt-in (pending status, confirmed_at)',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'newsletter_subscribers' and column_name = 'confirmed_at') then 'OK' else 'PROBLEM' end,
         'apply supabase/migrations/0051_newsletter_double_opt_in.sql — sign-ups are refused until it is'
  union all
  select 'migration 0052: product reviews need a delivered order containing the product',
         case when exists (select 1 from pg_trigger where tgname = 'reviews_require_purchase' and tgrelid = 'public.reviews'::regclass and tgenabled <> 'D')
               and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reviews' and policyname = 'users review their delivered orders')
              then 'OK' else 'PROBLEM' end,
         'apply supabase/migrations/0052_verified_buyer_reviews.sql — product reviews are refused until it is'
  union all
  select 'migration 0055: issued app codes switched off',
         -- to_jsonb: parses even before 0043 added the column (then: OK).
         case when exists (select 1 from public.coupons c where to_jsonb(c) ->> 'source' = 'app_welcome' and c.active)
              then 'PROBLEM' else 'OK' end,
         'apply supabase/migrations/0055_retire_referrals_and_app_codes.sql — app codes already issued still redeem until it is'
  union all
  select 'migration 0054: subcategory cover images (categories.image_url)',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'categories' and column_name = 'image_url') then 'OK' else 'PROBLEM' end,
         'apply supabase/migrations/0054_category_images.sql — covers cannot be saved until it is'
  union all
  select 'migration 0053: card fraud guard (order_payment_risk, payment_blocks)',
         case when to_regclass('public.order_payment_risk') is not null and to_regclass('public.payment_blocks') is not null then 'OK' else 'PROBLEM' end,
         'apply supabase/migrations/0053_payment_fraud_guard.sql — failed-attempt lockout is off until it is'
  union all
  select 'migration 0052: one product review per customer per product',
         case when to_regclass('public.reviews_one_per_user_product_idx') is not null then 'OK' else 'PROBLEM' end,
         'apply supabase/migrations/0052_verified_buyer_reviews.sql'
  union all
  select 'migration 0056: unpaid reservations expire (expirable_unpaid_orders)',
         case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'expirable_unpaid_orders') then 'OK' else 'PROBLEM' end,
         'apply supabase/migrations/0056_unpaid_order_reservations.sql — preview first: /api/cron/reservations?dry=1'
  union all
  select 'migration 0057: product/collection coupons apply to their lines only (redeem_coupon takes p_lines)',
         case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'redeem_coupon' and pg_get_function_identity_arguments(p.oid) like '%p_lines%') then 'OK' else 'PROBLEM' end,
         'apply supabase/migrations/0057_coupon_line_scope.sql'
  union all
  select 'migration 0058: search_products is service-role only',
         case when not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'search_products' and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) then 'OK' else 'PROBLEM' end,
         'apply supabase/migrations/0058_search_products_limits.sql'
  union all
  select 'migration 0059: refund cases and ledger (refund_transactions, return_requests.case_number)',
         case when to_regclass('public.refund_transactions') is not null and to_regclass('public.refund_case_events') is not null
               and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'return_requests' and column_name = 'case_number')
              then 'OK' else 'PROBLEM' end,
         'apply supabase/migrations/0059_refund_cases.sql — refund screens and Stripe refund webhooks fail until it is'
  union all
  select 'migration 0059: one ledger row per Stripe refund (unique provider refund id)',
         case when to_regclass('public.refund_transactions_provider_refund_key') is not null then 'OK' else 'PROBLEM' end,
         'apply supabase/migrations/0059_refund_cases.sql'
  union all
  select 'migration 0060: review requests (review_requests, email_suppressions, claim_review_requests)',
         case when to_regclass('public.review_requests') is not null and to_regclass('public.email_suppressions') is not null
               and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'claim_review_requests')
              then 'OK' else 'PROBLEM' end,
         'apply supabase/migrations/0060_review_requests.sql'
  union all
  select 'migration 0061: one order per checkout attempt (order_idempotency)',
         case when to_regclass('public.order_idempotency') is not null then 'OK' else 'PROBLEM' end,
         'apply supabase/migrations/0061_order_idempotency.sql'
  union all
  select 'migration 0062: product publication and sale rights (listing_status, product_rights)',
         case when exists (select 1 from information_schema.columns
                            where table_schema = 'public' and table_name = 'products' and column_name = 'listing_status')
               and to_regclass('public.product_rights') is not null
              then 'OK' else 'PROBLEM' end,
         'apply supabase/migrations/0062_product_publication.sql — until then the storefront sells nothing'
  union all
  select 'products readable by the public key: published only',
         case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'products'
                                 and cmd in ('SELECT', 'ALL') and coalesce(qual, '') !~ 'listing_status')
              then 'OK' else 'PROBLEM' end,
         'a select policy on products lets the public key read drafts: apply 0062, or drop that policy'

  -- 3. Write policies that apply to anon (role anon, or PUBLIC — which
  --    includes anon). Fine only when every row they allow must belong to
  --    auth.uid(): for an anonymous caller that is NULL, so no row matches.
  union all
  select 'anon write policy: ' || tablename || ' / ' || policyname,
         case when (cmd = 'INSERT' or coalesce(qual, '') ~ 'auth\.uid\(\)')
                and (cmd = 'DELETE' or with_check is null or with_check ~ 'auth\.uid\(\)')
                and (cmd <> 'INSERT' or coalesce(with_check, '') ~ 'auth\.uid\(\)')
              then 'OK' else 'PROBLEM' end,
         case when (cmd = 'INSERT' or coalesce(qual, '') ~ 'auth\.uid\(\)')
                and (cmd = 'DELETE' or with_check is null or with_check ~ 'auth\.uid\(\)')
                and (cmd <> 'INSERT' or coalesce(with_check, '') ~ 'auth\.uid\(\)')
              then 'scoped to auth.uid(): an anonymous caller matches no row'
              else 'review: it lets a caller who is not signed in write rows' end
  from pg_policies
  where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and ('anon' = any (roles) or 'public' = any (roles))

  -- 4. SECURITY DEFINER functions callable by anon. They bypass RLS, so each
  --    must do its own checks. The ones below were read and are scoped; any
  --    other — a new one, or one added in the dashboard — is reported.
  union all
  select 'security definer callable by anon: ' || p.proname,
         case when p.prorettype = 'trigger'::regtype
                or p.proname in ('review_eligibility', 'set_default_address')
              then 'OK' else 'PROBLEM' end,
         case when p.prorettype = 'trigger'::regtype then 'trigger function, not callable over the API'
              when p.proname = 'search_products' then 'apply migration 0058: it makes search_products service-role only, with bounded limits'
              when p.proname = 'review_eligibility' then 'reviewed: reads only the caller''s own orders and reviews (auth.uid())'
              when p.proname = 'set_default_address' then 'reviewed: changes only the caller''s own addresses (auth.uid())'
              else 'read it: it must check auth.uid() itself, or: revoke execute on function public.' || p.proname || ' from anon, public;' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE')

  -- 5. Privileged tables must not be readable by anon/authenticated at all.
  union all
  select 'no customer access to public.' || t,
         case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then 'OK' else 'PROBLEM' end,
         'server-only table: drop its policies'
  from unnest(array['admin_sessions', 'admin_totp_steps', 'rate_limits', 'stripe_events', 'order_payment_risk', 'payment_blocks',
                    -- 0059: staff, refund policy, ledger and case records; 0060: review requests.
                    'admin_staff', 'refund_policies', 'refund_transactions', 'refund_case_evidence', 'refund_case_messages',
                    'refund_case_events', 'refund_risk_assessments', 'refund_approvals', 'refund_notifications',
                    'review_requests', 'email_suppressions',
                    -- 0061: checkout attempt keys; 0062: sale rights records.
                    'order_idempotency', 'product_rights']) as t
  where to_regclass('public.' || t) is not null
)
select status, check_name, action
from checks
order by (status = 'OK'), check_name;
