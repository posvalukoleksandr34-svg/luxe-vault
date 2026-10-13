#!/usr/bin/env bash
# The database tests (tests/db) against a database scripts/ci/verify-migrations.sh
# has just built: access denials, coupon scoping, reservation expiry, search
# bounds, rate-limit counting, and the races only concurrent sessions can show. DISPOSABLE databases only.
#
#   DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres scripts/ci/db-tests.sh
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to a disposable Postgres}"
case "$DATABASE_URL" in *supabase.co*|*supabase.com*|*pooler*) echo "Refusing: DATABASE_URL looks like a Supabase project." >&2; exit 2;; esac
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
psql_() { psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

psql_ -f "$ROOT/tests/db/_fixture.sql"
for t in rls coupons reservations search rate_limits; do
  echo "→ tests/db/$t.sql"
  # NOTICE lines carry the PASS results; a FAIL raises and stops the run.
  psql_ -f "$ROOT/tests/db/$t.sql" 2>&1 | sed -n 's/.*NOTICE:  //p'
  [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "tests/db/$t.sql FAILED" >&2; exit 1; }
done
echo "→ tests/db/concurrency.sh"
"$ROOT/tests/db/concurrency.sh"
