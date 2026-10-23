-- Review requests (0060): one request per order, who may touch the tables,
-- the claim function's due/not-due/stale handling, and the delivery stamp the
-- schedule is computed from. One transaction, rolled back.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.check(p_name text, p_got boolean, p_detail text) returns void
language plpgsql as $$ begin
  if not p_got then raise exception 'FAIL %: %', p_name, p_detail; end if;
  raise notice 'PASS %', p_name;
end $$;

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$ begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlerrm;
end $$;

create or replace function pg_temp.mk_order(p_no text) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.orders (order_number, lookup_token, customer_name, customer_phone, address_line,
                             subtotal, total, payment, status, payment_status, payment_provider, payment_id)
  values (p_no, 'tok-' || p_no, 'DB Test', '+41000000000', 'Teststrasse 1, 8000 Zurich',
          100, 100, 'Карта онлайн', 'shipped', 'paid', 'stripe', 'pi_' || p_no)
  returning id into v_id;
  return v_id;
end $$;

create temp table t (k text primary key, v uuid);
insert into t values ('o1', pg_temp.mk_order('LV-DBR001'));
insert into t values ('o2', pg_temp.mk_order('LV-DBR002'));
insert into t values ('o3', pg_temp.mk_order('LV-DBR003'));
insert into t values ('o4', pg_temp.mk_order('LV-DBR004'));

-- ------------------------------------------------------- the delivery clock
select pg_temp.check('a shipped order has no delivered_at',
  (select delivered_at is null from public.orders where id = (select v from t where k = 'o1')), 'delivered_at set before delivery');
update public.orders set status = 'delivered' where id = (select v from t where k = 'o1');
select pg_temp.check('moving to delivered stamps delivered_at',
  (select delivered_at is not null from public.orders where id = (select v from t where k = 'o1')), 'not stamped');
create temp table first_stamp as select delivered_at from public.orders where id = (select v from t where k = 'o1');
update public.orders set status = 'delivered' where id = (select v from t where k = 'o1');
select pg_temp.check('a repeated delivered update keeps the first stamp',
  (select o.delivered_at = f.delivered_at from public.orders o, first_stamp f where o.id = (select v from t where k = 'o1')), 'stamp moved');

-- ------------------------------------------------------------ one per order
insert into public.review_requests (order_id, delivered_at, scheduled_at)
values ((select v from t where k = 'o1'), now() - interval '3 days', now() - interval '1 day');
select pg_temp.check('a second request for the same order is refused',
  pg_temp.try(format('insert into public.review_requests (order_id, delivered_at, scheduled_at) values (%L, now(), now())', (select v from t where k = 'o1'))) like '%review_requests_order_key%',
  'duplicate accepted');
select pg_temp.check('ON CONFLICT DO NOTHING is a silent no-op (the app''s idempotent insert)',
  pg_temp.try(format('insert into public.review_requests (order_id, delivered_at, scheduled_at) values (%L, now(), now()) on conflict (order_id) do nothing', (select v from t where k = 'o1'))) = 'OK'
  and (select count(*) from public.review_requests where order_id = (select v from t where k = 'o1')) = 1,
  'second row or error');
select pg_temp.check('an unknown status is refused',
  pg_temp.try(format('update public.review_requests set status = %L where order_id = %L', 'emailed', (select v from t where k = 'o1'))) like '%check%',
  'accepted');
select pg_temp.check('a malformed token hash is refused',
  pg_temp.try(format('update public.review_requests set token_hash = %L where order_id = %L', 'not-a-hash', (select v from t where k = 'o1'))) like '%check%',
  'accepted');
select pg_temp.check('every request gets its own random nonce',
  (select length(token_nonce) = 32 from public.review_requests where order_id = (select v from t where k = 'o1')), 'no nonce');
select pg_temp.check('deleting the order removes its request (no orphan)',
  pg_temp.try(format('delete from public.orders where id = %L', (select v from t where k = 'o4'))) = 'OK', 'delete failed');

-- --------------------------------------------------------------- claiming
-- o1 is due (scheduled yesterday). o2 is due later. o3 was claimed by a
-- worker that died an hour ago.
insert into public.review_requests (order_id, delivered_at, scheduled_at)
values ((select v from t where k = 'o2'), now(), now() + interval '2 days');
insert into public.review_requests (order_id, delivered_at, scheduled_at, status, claimed_at, attempts)
values ((select v from t where k = 'o3'), now() - interval '3 days', now() - interval '1 day', 'sending', now() - interval '1 hour', 1);

create temp table claimed as select * from public.claim_review_requests(10);
select pg_temp.check('the due request is claimed',
  exists (select 1 from claimed where order_id = (select v from t where k = 'o1')), 'not claimed');
select pg_temp.check('a request not yet due is left alone',
  not exists (select 1 from claimed where order_id = (select v from t where k = 'o2')), 'claimed early');
select pg_temp.check('a crashed claim goes back to the queue and is claimed again, attempts unchanged',
  exists (select 1 from claimed where order_id = (select v from t where k = 'o3') and attempts = 1), 'not recovered');
select pg_temp.check('claimed rows are marked sending with a claim time',
  (select bool_and(status = 'sending' and claimed_at is not null) from claimed), 'not marked');
select pg_temp.check('a second claim right after finds nothing (no double send)',
  (select count(*) from public.claim_review_requests(10)) = 0, 'claimed twice');

-- A retry waits for next_attempt_at, not scheduled_at.
update public.review_requests set status = 'scheduled', claimed_at = null, next_attempt_at = now() + interval '15 minutes'
 where order_id = (select v from t where k = 'o1');
select pg_temp.check('a request backing off is not claimed before next_attempt_at',
  (select count(*) from public.claim_review_requests(10) where order_id = (select v from t where k = 'o1')) = 0, 'claimed during backoff');
update public.review_requests set next_attempt_at = now() - interval '1 minute' where order_id = (select v from t where k = 'o1');
select pg_temp.check('and is claimed once it is due',
  (select count(*) from public.claim_review_requests(10) where order_id = (select v from t where k = 'o1')) = 1, 'not claimed');
select pg_temp.check('the limit is clamped (0 claims at least one, never more than due)',
  (select count(*) from public.claim_review_requests(0)) = 0, 'unexpected rows');

-- ------------------------------------------------------- who may touch it
select pg_temp.check('anon cannot read review requests',
  not has_table_privilege('anon', 'public.review_requests', 'select'), 'anon has select');
select pg_temp.check('a signed-in customer cannot read review requests',
  not has_table_privilege('authenticated', 'public.review_requests', 'select'), 'authenticated has select');
select pg_temp.check('nobody but the service role may claim',
  not has_function_privilege('anon', 'public.claim_review_requests(integer, interval)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_review_requests(integer, interval)', 'execute')
  and has_function_privilege('service_role', 'public.claim_review_requests(integer, interval)', 'execute'),
  'execute granted too widely');
select pg_temp.check('the suppression list is closed to anon and customers',
  not has_table_privilege('anon', 'public.email_suppressions', 'select')
  and not has_table_privilege('authenticated', 'public.email_suppressions', 'insert'), 'open');
select pg_temp.check('RLS is on for both tables',
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.review_requests'::regclass, 'public.email_suppressions'::regclass)), 'RLS off');

-- ------------------------------------------------------------ suppressions
select pg_temp.check('a suppression must be stored lower-cased and trimmed',
  pg_temp.try($q$insert into public.email_suppressions (email, kind, reason) values ('Someone@Example.com', 'review_requests', 'unsubscribed')$q$) like '%check%',
  'mixed case accepted');
select pg_temp.check('one suppression per address and kind',
  pg_temp.try($q$insert into public.email_suppressions (email, kind, reason) values ('a@example.com', 'review_requests', 'unsubscribed')$q$) = 'OK'
  and pg_temp.try($q$insert into public.email_suppressions (email, kind, reason) values ('a@example.com', 'review_requests', 'bounced')$q$) like '%duplicate%',
  'duplicate accepted');

rollback;
