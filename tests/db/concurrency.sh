#!/usr/bin/env bash
# Races that only real concurrent sessions can show: two customers for the
# last unit, two redemptions of a single-use code, two sweeps releasing the
# same order, the same order submitted twice, ten requests against a rate
# limit of five. Each worker waits on a shared
# advisory lock the main session holds, so all of them start together.
#
#   DATABASE_URL=... tests/db/concurrency.sh     (a DISPOSABLE database)
set -uo pipefail
: "${DATABASE_URL:?}"
DIR=$(cd "$(dirname "$0")" && pwd)
psql_() { psql "$DATABASE_URL" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
fails=0
check() { if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 — expected $3, got $2"; fails=$((fails + 1)); fi; }

psql_ -f "$DIR/_fixture.sql"
cleanup() {
  # The refund ledger refuses deletes by design (0059); a disposable test
  # database lifts that for its own rows only, as the superuser.
  psql_ -c "set session_replication_role = replica; delete from public.refund_case_events where order_id in (select id from public.orders where order_number like 'LV-DBC%'); delete from public.refund_transactions where order_id in (select id from public.orders where order_number like 'LV-DBC%'); set session_replication_role = origin;" >/dev/null
  psql_ -c "delete from public.orders where order_number like 'LV-DBC%'; delete from public.coupons where code like 'DBC-%';" >/dev/null
  psql_ -f "$DIR/_fixture.sql" >/dev/null
}
cleanup

order_json() { # $1 order number
  printf '{"order_number":"%s","user_id":"","lookup_token":"tok-%s","status":"pending","customer_name":"DB Test","customer_email":"","customer_phone":"+41000000000","address_line":"Teststrasse 1, 8000 Zurich","street":"","postal_code":"","city":"","country":"","subtotal":50,"discount":0,"shipping_cost":0,"tax":0,"total":50,"promo":"","coupon_id":"","payment":"Карта онлайн","payment_status":"pending_payment","shipping_type":"standard","delivery_estimate_min":"","delivery_estimate_max":""}' "$1" "$1"
}
ITEMS='[{"product_id":"dbtest-last","name":"Last","image":"","unit_price":50,"size":"M","color":"Black","qty":1}]'

# race N "sql-for-worker-i" → prints one line per worker: ok | error text
race() {
  local n=$1 sql=$2 i
  local out; out=$(mktemp -d)
  # The gate: held by this session until every worker is queued on it.
  (psql "$DATABASE_URL" -X -q -At -c "select pg_advisory_lock(424242); select pg_sleep(1.5); select pg_advisory_unlock(424242);" >/dev/null) &
  local gate=$!
  sleep 0.3
  for i in $(seq 1 "$n"); do
    ( psql "$DATABASE_URL" -X -q -At -v ON_ERROR_STOP=1 \
        -c "select pg_advisory_lock_shared(424242); select pg_advisory_unlock_shared(424242);" \
        -c "$(printf "$sql" "$i")" >/dev/null 2>"$out/$i.err" && echo ok > "$out/$i" || echo err > "$out/$i" ) &
  done
  wait
  for i in $(seq 1 "$n"); do printf '%s %s\n' "$(cat "$out/$i")" "$(head -c 160 "$out/$i.err" | tr '\n' ' ')"; done
  rm -rf "$out"
}

echo "# Two customers, one last unit"
res=$(race 2 "select public.place_order('$(order_json 'LV-DBC00%s')'::jsonb, '$ITEMS'::jsonb);")
check "exactly one order succeeds" "$(grep -c '^ok' <<<"$res")" 1
check "the other is refused for stock" "$(grep -c 'INSUFFICIENT_STOCK' <<<"$res")" 1
check "stock is 0, never negative" "$(psql_ -c "select v.stock from public.product_variants v join public.products p on p.id=v.product_id where p.slug='dbtest-last'")" 0
check "one order exists" "$(psql_ -c "select count(*) from public.orders where order_number like 'LV-DBC00%'")" 1

echo "# The same order submitted twice at once"
cleanup
res=$(race 2 "select public.place_order('$(order_json 'LV-DBC100')'::jsonb, '[{\"product_id\":\"dbtest-coat\",\"name\":\"Coat\",\"image\":\"\",\"unit_price\":300,\"size\":\"M\",\"color\":\"Black\",\"qty\":1}]'::jsonb);")
check "one of the two is created" "$(grep -c '^ok' <<<"$res")" 1
check "the stock is taken once" "$(psql_ -c "select v.stock from public.product_variants v join public.products p on p.id=v.product_id where p.slug='dbtest-coat'")" 49

echo "# Two sweeps release the same order"
check "release race: restock happens once" "$( (race 2 "select public.restore_order_stock('LV-DBC100');" >/dev/null); psql_ -c "select v.stock from public.product_variants v join public.products p on p.id=v.product_id where p.slug='dbtest-coat'")" 50

echo "# Two redemptions of a single-use code"
psql_ -c "insert into public.coupons (code, kind, value, max_redemptions) values ('DBC-ONCE', 'fixed', 5, 1)" >/dev/null
res=$(race 4 "do \$\$ begin if not (select ok from public.redeem_coupon('DBC-ONCE', 100, null, '{}', true, null)) then raise exception 'lost the race'; end if; end \$\$;")
check "exactly one of four wins the last use" "$(grep -c '^ok' <<<"$res")" 1
check "times_used = 1" "$(psql_ -c "select times_used from public.coupons where code='DBC-ONCE'")" 1

echo "# Ten requests at once against a limit of five"
# Each worker commits its own decision, as each HTTP request does: a refusal
# still counts against the budget.
psql_ -c "set client_min_messages = warning; delete from public.rate_limits where bucket = 'dbc.race'; drop table if exists public.dbc_race_results; create table public.dbc_race_results (allowed boolean);" >/dev/null
race 10 "insert into public.dbc_race_results select allowed from public.check_rate_limit('dbc.race', 'one-client', 5, 600);" >/dev/null
check "exactly five are allowed" "$(psql_ -c "select count(*) from public.dbc_race_results where allowed")" 5
check "five are refused" "$(psql_ -c "select count(*) from public.dbc_race_results where not allowed")" 5
check "the counter saw all ten" "$(psql_ -c "select count from public.rate_limits where bucket = 'dbc.race' and subject = 'one-client'")" 10
psql_ -c "delete from public.rate_limits where bucket = 'dbc.race'; drop table public.dbc_race_results;" >/dev/null

echo "# Four refunds of the same order at once"
psql_ -c "insert into public.orders (order_number, lookup_token, customer_name, customer_phone, address_line, subtotal, total, payment, status, payment_status, payment_provider, payment_id) values ('LV-DBC200', 'tok-LV-DBC200', 'DB Test', '+41000000000', 'Teststrasse 1, 8000 Zurich', 500, 500, 'Карта онлайн', 'delivered', 'paid', 'stripe', 'pi_dbc200')" >/dev/null
ORDER200=$(psql_ -c "select id from public.orders where order_number = 'LV-DBC200'")
res=$(race 4 "select public.reserve_refund_transaction(jsonb_build_object('order_id', '$ORDER200', 'amount_minor', 30000, 'provider', 'stripe', 'payment_reference', 'pi_dbc200', 'idempotency_key', 'dbc-race-%s', 'reason', 'race', 'source', 'order_screen', 'initiated_by_label', 'race'));")
check "exactly one of four reserves the refund" "$(grep -c '^ok' <<<"$res")" 1
check "the others are told one is in flight" "$(grep -c 'REFUND_IN_FLIGHT' <<<"$res")" 3
check "the ledger holds one reservation" "$(psql_ -c "select count(*) from public.refund_transactions where order_id = '$ORDER200'")" 1
psql_ -c "select public.settle_refund_transaction(jsonb_build_object('transaction_id', (select id from public.refund_transactions where order_id = '$ORDER200'), 'status', 'succeeded', 'provider_refund_id', 're_dbc200'))" >/dev/null
res=$(race 4 "select public.reserve_refund_transaction(jsonb_build_object('order_id', '$ORDER200', 'amount_minor', 30000, 'provider', 'stripe', 'payment_reference', 'pi_dbc200', 'idempotency_key', 'dbc-race2-%s', 'reason', 'race', 'source', 'order_screen', 'initiated_by_label', 'race'));")
check "none of four can refund past the paid total" "$(grep -c '^ok' <<<"$res")" 0
check "the order never shows more refunded than paid" "$(psql_ -c "select refunded_amount from public.orders where id = '$ORDER200'")" "300.00"

cleanup
echo "== concurrency: $fails failed"
exit "$fails"
