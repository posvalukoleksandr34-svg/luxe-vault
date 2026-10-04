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
                or p.proname in ('search_products', 'can_review', 'set_default_address')
              then 'OK' else 'PROBLEM' end,
         case when p.prorettype = 'trigger'::regtype then 'trigger function, not callable over the API'
              when p.proname = 'search_products' then 'reviewed: returns public catalogue slugs only'
              when p.proname = 'can_review' then 'reviewed: reads only the caller''s own orders (auth.uid())'
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
  from unnest(array['admin_sessions', 'admin_totp_steps', 'rate_limits', 'stripe_events']) as t
  where to_regclass('public.' || t) is not null
)
select status, check_name, action
from checks
order by (status = 'OK'), check_name;
