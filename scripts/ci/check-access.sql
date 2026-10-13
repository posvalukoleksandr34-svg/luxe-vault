-- Database-wide access rules, checked after every migration has been applied
-- (scripts/ci/verify-migrations.sh). Each block raises — failing the run —
-- when a migration breaks a rule. Add to an allow-list only with a comment
-- saying why the exception is safe.
\set ON_ERROR_STOP on

-- 1. Row Level Security on every table in `public`. The API roles hold table
--    grants by default (Supabase), so a table without RLS is world-readable
--    and world-writable through the REST API with the public anon key.
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if bad is not null then raise exception 'RLS is off on: %', bad; end if;
end $$;

-- 2. Every SECURITY DEFINER function pins its search_path, so a caller cannot
--    shadow a table or operator it uses with one of their own.
do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if bad is not null then raise exception 'SECURITY DEFINER without a fixed search_path: %', bad; end if;
end $$;

-- 3. SECURITY DEFINER functions bypass RLS. Only these may be called by the
--    browser's roles, each because it checks the caller itself:
--      set_default_address  acts only on rows where user_id = auth.uid()
--      review_eligibility   answers for auth.uid() only
--    Trigger functions are not callable as RPC and are skipped.
--    search_products was on this list until 0058, which made it service-role
--    only (its sole caller is /api/search); re-granting it now fails here.
do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.prorettype <> 'trigger'::regtype
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
     and p.proname not in ('set_default_address', 'review_eligibility');
  if bad is not null then raise exception 'SECURITY DEFINER functions callable by anon/authenticated: % (revoke, or allow-list with a reason)', bad; end if;
end $$;

-- 4. Server-only tables: written and read by the service role alone. No
--    policy may open them to the browser's roles.
do $$
declare bad text;
begin
  select string_agg(distinct tablename, ', ') into bad
    from pg_policies
   where schemaname = 'public'
     and tablename in ('admin_sessions', 'admin_totp_steps', 'rate_limits', 'stripe_events', 'coupons',
                       'payment_blocks', 'order_payment_risk', 'abandoned_carts', 'newsletter_subscribers',
                       'newsletter_campaigns', 'support_tickets', 'support_messages', 'account_credits',
                       'referrals', 'referral_codes', 'referral_clicks', 'referral_settings');
  if bad is not null then raise exception 'Policies on server-only tables: %', bad; end if;
end $$;

-- 5. No policy lets a browser role WRITE orders, their items, payments or
--    stock: every money-bearing write goes through the server.
do $$
declare bad text;
begin
  select string_agg(tablename || ':' || cmd, ', ') into bad
    from pg_policies
   where schemaname = 'public'
     and tablename in ('orders', 'order_items', 'product_variants', 'products', 'categories', 'collections', 'store_settings')
     and cmd <> 'SELECT';
  if bad is not null then raise exception 'Browser-role write policies on server-owned tables: %', bad; end if;
end $$;

-- 6. Views run with their owner's rights unless security_invoker is set, i.e.
--    they bypass RLS. Allowed: product_review_stats (aggregates of APPROVED
--    reviews only — counts and averages, no rows).
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm')
     and not coalesce('security_invoker=true' = any (c.reloptions), false)
     and c.relname not in ('product_review_stats');
  if bad is not null then raise exception 'Views that bypass RLS: %', bad; end if;
end $$;

-- 7. Buckets holding customers' files stay private (signed URLs only).
do $$
declare bad text;
begin
  select string_agg(id, ', ') into bad from storage.buckets
   where id in ('support-attachments', 'returns') and public;
  if bad is not null then raise exception 'Private buckets made public: %', bad; end if;
end $$;

select 'access rules hold' as result;
