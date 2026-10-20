-- The refund system's database guarantees (0059): case creation and its
-- per-unit quantity check, compare-and-set case changes, the over-refund
-- guard, settlement from the ledger, immutability of the ledger and the audit
-- trail, and idempotent restocking. One transaction, rolled back.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.check(p_name text, p_got boolean, p_detail text) returns void
language plpgsql as $$ begin
  if not p_got then raise exception 'FAIL %: %', p_name, p_detail; end if;
  raise notice 'PASS %', p_name;
end $$;

-- Runs a statement and answers the error message it raised, or 'OK'.
create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$ begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlerrm;
end $$;

-- A paid order: 2 coats at 300 + 1 scarf at 99.99, 20.00 discount, 15.00
-- shipping → total 694.99.
create or replace function pg_temp.mk_order(p_no text, p_pay text default 'paid') returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.orders (order_number, lookup_token, customer_name, customer_phone, address_line,
                             subtotal, discount, shipping_cost, total, payment, status, payment_status, payment_provider, payment_id,
                             shipped_at, delivered_at)
  values (p_no, 'tok-' || p_no, 'DB Test', '+41000000000', 'Teststrasse 1, 8000 Zurich',
          699.99, 20, 15, 694.99, 'Карта онлайн', 'delivered', p_pay::public.payment_status, 'stripe', 'pi_' || p_no,
          now() - interval '6 days', now() - interval '2 days')
  returning id into v_id;
  insert into public.order_items (order_id, product_id, name, unit_price, size, color, qty) values
    (v_id, 'dbtest-coat', 'Coat', 300, 'M', 'Black', 2),
    (v_id, 'dbtest-scarf', 'Scarf', 99.99, 'M', 'Black', 1);
  return v_id;
end $$;

create or replace function pg_temp.item(p_order uuid, p_product text) returns uuid
language sql as $$ select id from public.order_items where order_id = p_order and product_id = p_product $$;

create or replace function pg_temp.mk_case(p_order uuid, p_items jsonb, p_key text default null, p_no text default null) returns uuid
language sql as $$
  select public.create_refund_case(
    jsonb_build_object('order_id', p_order, 'claim_type', 'changed_mind', 'requested_resolution', 'return_and_refund',
                       'case_number', coalesce(p_no, 'RC-T' || substr(md5(random()::text), 1, 6)),
                       'submission_key', p_key, 'comment', 'db test'),
    p_items,
    '{"actor_type":"customer","actor_label":"customer"}'::jsonb)
$$;

create temp table t (k text primary key, v uuid);
insert into t values ('o1', pg_temp.mk_order('LV-DBF001'));
insert into t values ('coat', pg_temp.item((select v from t where k = 'o1'), 'dbtest-coat'));
insert into t values ('scarf', pg_temp.item((select v from t where k = 'o1'), 'dbtest-scarf'));

-- ------------------------------------------------------------ case creation
insert into t values ('c1', pg_temp.mk_case((select v from t where k = 'o1'),
  jsonb_build_array(jsonb_build_object('order_item_id', (select v from t where k = 'coat'), 'qty', 1)), 'sub-1'));

select pg_temp.check('a case is created in state requested',
  (select state from public.return_requests where id = (select v from t where k = 'c1')) = 'requested', 'wrong state');
select pg_temp.check('the line snapshots its unit price in minor units',
  (select unit_price_minor from public.return_request_items where case_id = (select v from t where k = 'c1')) = 30000, 'not 30000');
select pg_temp.check('the legacy status column follows the state',
  (select status::text from public.return_requests where id = (select v from t where k = 'c1')) = 'pending', 'not pending');
select pg_temp.check('creation is audited',
  exists (select 1 from public.refund_case_events where case_id = (select v from t where k = 'c1') and action = 'case.created'), 'no event');

select pg_temp.check('the same submission key returns the same case',
  pg_temp.mk_case((select v from t where k = 'o1'),
    jsonb_build_array(jsonb_build_object('order_item_id', (select v from t where k = 'coat'), 'qty', 1)), 'sub-1')
  = (select v from t where k = 'c1'), 'a second case was filed');

-- The second coat can be claimed separately; a third cannot exist.
insert into t values ('c2', pg_temp.mk_case((select v from t where k = 'o1'),
  jsonb_build_array(jsonb_build_object('order_item_id', (select v from t where k = 'coat'), 'qty', 1))));
select pg_temp.check('two open cases on one order are allowed for different units',
  (select count(*) from public.return_requests where order_id = (select v from t where k = 'o1')) = 2, 'not two');

select pg_temp.check('a unit cannot be claimed twice',
  pg_temp.try(format($q$select pg_temp.mk_case(%L, '[{"order_item_id":"%s","qty":1}]'::jsonb)$q$,
    (select v from t where k = 'o1'), (select v from t where k = 'coat'))) like '%QTY_EXCEEDS_AVAILABLE%',
  'third coat accepted');
select pg_temp.check('a line from another order is refused',
  pg_temp.try(format($q$select pg_temp.mk_case(%L, '[{"order_item_id":"%s","qty":1}]'::jsonb)$q$,
    pg_temp.mk_order('LV-DBF002'), (select v from t where k = 'coat'))) like '%ITEM_NOT_IN_ORDER%',
  'foreign line accepted');
select pg_temp.check('a zero quantity is refused',
  pg_temp.try(format($q$select pg_temp.mk_case(%L, '[{"order_item_id":"%s","qty":0}]'::jsonb)$q$,
    (select v from t where k = 'o1'), (select v from t where k = 'scarf'))) like '%INVALID_QTY%',
  'zero accepted');

-- --------------------------------------------------------- compare-and-set
select pg_temp.check('a change on a stale version matches nothing',
  (select count(*) from public.refund_case_apply((select v from t where k = 'c2'), 99, null,
     '{"state":"under_review"}'::jsonb, '{"action":"case.review_started"}'::jsonb)) = 0, 'stale version applied');
select pg_temp.check('a change from a state the case is not in matches nothing',
  (select count(*) from public.refund_case_apply((select v from t where k = 'c2'), 0, array['approved'],
     '{"state":"refund_processing"}'::jsonb, '{"action":"refund.initiated"}'::jsonb)) = 0, 'wrong from-state applied');
select pg_temp.check('a line change for another case is refused, and takes the case change with it',
  pg_temp.try(format($q$select public.refund_case_apply(%L, 0, array['requested'],
     jsonb_build_object('state', 'under_review', 'items', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'qty_received', 1))),
     '{"action":"return.received"}'::jsonb)$q$, (select v from t where k = 'c2'))) like '%ITEM_NOT_IN_CASE%'
  and (select state = 'requested' and version = 0 from public.return_requests where id = (select v from t where k = 'c2')),
  'partial change applied');
select pg_temp.check('a valid change applies once and bumps the version',
  (select version from public.refund_case_apply((select v from t where k = 'c2'), 0, array['requested'],
     '{"state":"rejected","decision_note":"Outside the window"}'::jsonb,
     '{"action":"case.rejected","actor_type":"staff","actor_label":"Manager"}'::jsonb)) = 1, 'version not 1');
select pg_temp.check('the change is audited with both states',
  exists (select 1 from public.refund_case_events where case_id = (select v from t where k = 'c2')
           and action = 'case.rejected' and from_state = 'requested' and to_state = 'rejected'), 'no event');
select pg_temp.check('a rejected claim gives its unit back',
  pg_temp.try(format($q$select pg_temp.mk_case(%L, '[{"order_item_id":"%s","qty":1}]'::jsonb)$q$,
    (select v from t where k = 'o1'), (select v from t where k = 'coat'))) = 'OK', 'unit still held');

-- --------------------------------------------------------- over-refund guard
create or replace function pg_temp.reserve(p_order uuid, p_case uuid, p_amount bigint, p_key text) returns uuid
language sql as $$
  select (public.reserve_refund_transaction(jsonb_build_object(
    'order_id', p_order, 'case_id', p_case, 'amount_minor', p_amount, 'provider', 'stripe',
    'payment_reference', 'pi_test', 'idempotency_key', p_key, 'reason', 'db test', 'source', 'case',
    'initiated_by_label', 'Manager'))).id
$$;

-- Approval is not payment, and payment needs one.
select pg_temp.check('money cannot be reserved for a case that is not approved',
  pg_temp.try(format('select pg_temp.reserve(%L, %L, 100, %L)', (select v from t where k = 'o1'), (select v from t where k = 'c1'), 'k-unapproved')) like '%CASE_NOT_APPROVED%',
  'reserved for an unapproved case');
update public.return_requests set approved_amount_minor = 30000 where id = (select v from t where k = 'c1');
select pg_temp.check('an approved amount alone, without the approved state, is not enough',
  pg_temp.try(format('select pg_temp.reserve(%L, %L, 100, %L)', (select v from t where k = 'o1'), (select v from t where k = 'c1'), 'k-unapproved2')) like '%CASE_NOT_APPROVED%',
  'reserved for a case still under review');
update public.return_requests set state = 'approved' where id = (select v from t where k = 'c1');

select pg_temp.check('a refund larger than the case approved is refused',
  pg_temp.try(format('select pg_temp.reserve(%L, %L, 30001, %L)', (select v from t where k = 'o1'), (select v from t where k = 'c1'), 'k-over')) like '%REFUND_EXCEEDS_APPROVED%',
  'over-approval reserved');

insert into t values ('tx1', pg_temp.reserve((select v from t where k = 'o1'), (select v from t where k = 'c1'), 30000, 'k-1'));
select pg_temp.check('the same idempotency key reserves nothing twice',
  pg_temp.reserve((select v from t where k = 'o1'), (select v from t where k = 'c1'), 30000, 'k-1') = (select v from t where k = 'tx1'), 'second row');
select pg_temp.check('a second refund while one is in flight is refused',
  pg_temp.try(format('select pg_temp.reserve(%L, null, 100, %L)', (select v from t where k = 'o1'), 'k-2')) like '%REFUND_IN_FLIGHT%',
  'concurrent reservation');

-- ------------------------------------------------------------- settlement
select public.settle_refund_transaction(jsonb_build_object('transaction_id', (select v from t where k = 'tx1'),
  'status', 'succeeded', 'provider_refund_id', 're_test_1'));
select pg_temp.check('a succeeded refund updates the order summary from the ledger',
  (select refunded_amount = 300 and payment_status = 'partially_refunded' from public.orders where id = (select v from t where k = 'o1')),
  (select refunded_amount::text || ' ' || payment_status from public.orders where id = (select v from t where k = 'o1')));
select pg_temp.check('the case carries its settled amount',
  (select refunded_amount_minor from public.return_requests where id = (select v from t where k = 'c1')) = 30000, 'not 30000');

-- A replayed webhook changes nothing.
select public.settle_refund_transaction(jsonb_build_object('transaction_id', (select v from t where k = 'tx1'),
  'status', 'succeeded', 'provider_refund_id', 're_test_1'));
select pg_temp.check('a replayed settlement does not count twice',
  (select refunded_amount from public.orders where id = (select v from t where k = 'o1')) = 300, 'double counted');

-- Everything left, then one rappen more.
insert into t values ('tx2', pg_temp.reserve((select v from t where k = 'o1'), null, 39499, 'k-3'));
select pg_temp.check('nothing beyond the paid total can be reserved',
  pg_temp.try(format('select pg_temp.reserve(%L, null, 1, %L)', (select v from t where k = 'o1'), 'k-4')) like '%REFUND_IN_FLIGHT%'
  or pg_temp.try(format('select pg_temp.reserve(%L, null, 1, %L)', (select v from t where k = 'o1'), 'k-4')) like '%REFUND_EXCEEDS_BALANCE%',
  'reserved past the total');
select public.settle_refund_transaction(jsonb_build_object('transaction_id', (select v from t where k = 'tx2'), 'status', 'succeeded', 'provider_refund_id', 're_test_2'));
select pg_temp.check('the full amount refunded marks the order refunded',
  (select payment_status = 'refunded' and status = 'refunded' and refunded_amount = 694.99 from public.orders where id = (select v from t where k = 'o1')),
  (select payment_status || ' ' || status || ' ' || refunded_amount from public.orders where id = (select v from t where k = 'o1')));
select pg_temp.check('a fully refunded order refuses any further reservation',
  pg_temp.try(format('select pg_temp.reserve(%L, null, 1, %L)', (select v from t where k = 'o1'), 'k-5')) like '%ORDER_NOT_REFUNDABLE%',
  'reserved on a refunded order');

-- The card network bounces the second refund after it succeeded.
select public.settle_refund_transaction(jsonb_build_object('transaction_id', (select v from t where k = 'tx2'),
  'status', 'failed', 'failure_code', 'expired_or_canceled_card'));
select pg_temp.check('a refund that fails after succeeding is taken off the summary',
  (select refunded_amount = 300 and payment_status = 'partially_refunded' and status = 'delivered'
     from public.orders where id = (select v from t where k = 'o1')),
  (select refunded_amount || ' ' || payment_status || ' ' || status from public.orders where id = (select v from t where k = 'o1')));

select pg_temp.check('an unpaid order cannot be refunded',
  pg_temp.try(format('select pg_temp.reserve(%L, null, 100, %L)', pg_temp.mk_order('LV-DBF003', 'pending_payment'), 'k-6')) like '%ORDER_NOT_REFUNDABLE%',
  'unpaid refunded');

insert into t values ('o4', pg_temp.mk_order('LV-DBF004'));
select pg_temp.check('a refund larger than the paid total is refused',
  pg_temp.try(format('select pg_temp.reserve(%L, null, 69500, %L)', (select v from t where k = 'o4'), 'k-7')) like '%REFUND_EXCEEDS_BALANCE%',
  'reserved past the total');
select pg_temp.check('exactly the paid total can be reserved',
  pg_temp.try(format('select pg_temp.reserve(%L, null, 69499, %L)', (select v from t where k = 'o4'), 'k-8')) = 'OK',
  'the full total was refused');

-- ------------------------------------------------- refunds made elsewhere
-- A refund made in the Stripe dashboard on order o4 (which already has 69499
-- reserved in flight above — so use a fresh order).
insert into t values ('o5', pg_temp.mk_order('LV-DBF005'));
create or replace function pg_temp.external(p_order uuid, p_ref text, p_amount bigint) returns uuid
language sql as $$
  select (public.record_external_refund(jsonb_build_object(
    'order_id', p_order, 'provider', 'stripe', 'payment_reference', 'pi_test5', 'provider_refund_id', p_ref,
    'amount_minor', p_amount, 'status', 'succeeded', 'actor_label', 'stripe'))).id
$$;
insert into t values ('ex1', pg_temp.external((select v from t where k = 'o5'), 're_ext_1', 10000));
select pg_temp.check('a refund made outside the console is recorded and summarised',
  (select refunded_amount = 100 and payment_status = 'partially_refunded' from public.orders where id = (select v from t where k = 'o5')),
  (select refunded_amount || ' ' || payment_status from public.orders where id = (select v from t where k = 'o5')));
select pg_temp.check('the same outside refund reported twice is recorded once',
  pg_temp.external((select v from t where k = 'o5'), 're_ext_1', 10000) = (select v from t where k = 'ex1')
  and (select refunded_amount from public.orders where id = (select v from t where k = 'o5')) = 100, 'double counted');
select pg_temp.external((select v from t where k = 'o5'), 're_ext_2', 99999999);
select pg_temp.check('an outside refund is capped at what was left, never past the total',
  (select refunded_amount = 694.99 and payment_status = 'refunded' from public.orders where id = (select v from t where k = 'o5')),
  (select refunded_amount || ' ' || payment_status from public.orders where id = (select v from t where k = 'o5')));
select pg_temp.check('nothing is recorded once the order is fully refunded',
  pg_temp.try(format($q$select pg_temp.external(%L, 're_ext_3', 100)$q$, (select v from t where k = 'o5'))) like '%NOTHING_TO_RECORD%',
  'recorded past the total');

-- ------------------------------------------------------- ledger immutability
select pg_temp.check('a refund amount cannot be edited',
  pg_temp.try(format('update public.refund_transactions set amount_minor = 1 where id = %L', (select v from t where k = 'tx1'))) like '%cannot be changed%',
  'amount edited');
select pg_temp.check('a refund cannot move backwards',
  pg_temp.try(format($q$update public.refund_transactions set status = 'pending' where id = %L$q$, (select v from t where k = 'tx1'))) like '%not a valid refund state change%',
  'succeeded -> pending allowed');
select pg_temp.check('a refund cannot be deleted',
  pg_temp.try(format('delete from public.refund_transactions where id = %L', (select v from t where k = 'tx1'))) like '%cannot be deleted%',
  'deleted');

-- ------------------------------------------------------------- audit trail
select pg_temp.check('an audit event cannot be edited',
  pg_temp.try($q$update public.refund_case_events set reason = 'x' where id = (select min(id) from public.refund_case_events)$q$) like '%append-only%',
  'edited');
select pg_temp.check('an audit event cannot be deleted',
  pg_temp.try($q$delete from public.refund_case_events where id = (select min(id) from public.refund_case_events)$q$) like '%append-only%',
  'deleted');

-- ------------------------------------------------------------- retention
-- The trail and the ledger leave only with the records they describe.
insert into public.refund_case_events (actor_type, actor_label, action, created_at)
values ('system', 'db test', 'test.ancient', now() - interval '6 years');
select pg_temp.check('an audit event past the retention period can be removed',
  pg_temp.try($q$delete from public.refund_case_events where action = 'test.ancient'$q$) = 'OK', 'old row kept');
insert into t values ('o6', pg_temp.mk_order('LV-DBF006'));
insert into t values ('tx6', pg_temp.reserve((select v from t where k = 'o6'), null, 100, 'k-retention'));
select pg_temp.check('a refund cannot be deleted on its own while its order exists',
  pg_temp.try(format('delete from public.refund_transactions where id = %L', (select v from t where k = 'tx6'))) like '%cannot be deleted%', 'deleted');
delete from public.orders where id = (select v from t where k = 'o6');
select pg_temp.check('an order deleted at the end of its retention period takes its refunds with it',
  not exists (select 1 from public.refund_transactions where id = (select v from t where k = 'tx6')), 'ledger row survived');

-- ---------------------------------------------------------------- restock
create temp table t_stock as
  select v.stock from public.product_variants v join public.products p on p.id = v.product_id
   where p.slug = 'dbtest-coat' and v.size = 'M' and v.color = 'Black';
insert into t values ('ri', (select id from public.return_request_items where case_id = (select v from t where k = 'c1')));

select pg_temp.check('an uninspected line cannot be restocked',
  pg_temp.try(format('select public.restock_return_item(%L, 1)', (select v from t where k = 'ri'))) like '%NOT_RESTOCKABLE%', 'restocked');
update public.return_request_items set qty_received = 1, inspection_outcome = 'accepted' where id = (select v from t where k = 'ri');
select public.restock_return_item((select v from t where k = 'ri'), 1);
select public.restock_return_item((select v from t where k = 'ri'), 1);
select pg_temp.check('restocking the same target twice adds the unit once',
  (select v.stock from public.product_variants v join public.products p on p.id = v.product_id
    where p.slug = 'dbtest-coat' and v.size = 'M' and v.color = 'Black') = (select stock + 1 from t_stock), 'stock wrong');
select pg_temp.check('more than was received cannot be restocked',
  pg_temp.try(format('select public.restock_return_item(%L, 2)', (select v from t where k = 'ri'))) like '%INVALID_RESTOCK_QTY%', 'over-restocked');
update public.return_request_items set inspection_outcome = 'damaged' where id = (select v from t where k = 'ri');
select pg_temp.check('a damaged line is not restockable',
  pg_temp.try(format('select public.restock_return_item(%L, 1)', (select v from t where k = 'ri'))) like '%NOT_RESTOCKABLE%', 'restocked damaged');

-- ------------------------------------------------------------------ access
select pg_temp.check('browser roles cannot read refund cases',
  not has_table_privilege('authenticated', 'public.return_requests', 'select')
  or not exists (select 1 from pg_policies where tablename = 'return_requests'), 'readable');
select pg_temp.check('browser roles cannot run the refund functions',
  not has_function_privilege('authenticated', 'public.reserve_refund_transaction(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.settle_refund_transaction(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.create_refund_case(jsonb, jsonb, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_external_refund(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.restock_return_item(uuid, integer)', 'execute'), 'executable');

rollback;
