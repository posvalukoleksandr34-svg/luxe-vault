#!/usr/bin/env bash
# Tests for scripts/backup/backup.sh and restore-test.sh: every way a backup
# can fail must fail the run with a message saying which, a good backup must
# restore, and no secret may reach the log.
#
# The scripts run unmodified. docker and age are replaced by stubs
# (tests/backup/stubs) that emulate pg_dump, pg_restore, psql and rclone
# against a temporary directory standing in for the bucket. No network, no
# database, no real key: safe anywhere, and quick. What the stubs cannot
# show — real encryption, a real upload, a real restore — is what the
# "Offsite backup" and "Backup restore test" workflows prove when they run.
#
#   tests/backup/run.sh
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
STUBS="$ROOT/tests/backup/stubs"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
fails=0
pass() { echo "PASS $1"; }
flunk() { echo "FAIL $1 — $2"; fails=$((fails + 1)); }

# Test-only values, chosen to be easy to spot if they ever leak into a log.
SECRET_S3=test-only-s3-secret-5f1c0de
SECRET_MEDIA=test-only-media-passphrase-91ab
SECRET_DB_PASSWORD=test-only-db-password-77aa

# A small repository, so `git bundle` has something to bundle.
git -C "$T" init -q repo
git -C "$T/repo" -c user.email=test@example.invalid -c user.name=test commit -q --allow-empty -m init

reset_env() {
  rm -rf "$T/s3" "$T/state"; mkdir -p "$T/s3/test-bucket" "$T/state"
  unset FAKE_PG_DUMP FAKE_UPLOAD FAKE_DOWNLOAD FAKE_LIST FAKE_RESTORE BACKUP_SKIP_MEDIA \
        SUPABASE_S3_ACCESS_KEY_ID SUPABASE_S3_SECRET_ACCESS_KEY SUPABASE_S3_ENDPOINT BACKUP_MEDIA_PASSPHRASE
  export PATH="$STUBS:$ORIGINAL_PATH"
  export FAKE_S3="$T/s3" FAKE_STATE="$T/state"
  export SUPABASE_DB_URL="postgresql://postgres:$SECRET_DB_PASSWORD@db.invalid:5432/postgres"
  export BACKUP_AGE_RECIPIENTS="age1stubci age1stuboffline"
  export BACKUP_AGE_IDENTITY="AGE-SECRET-KEY-STUB-ci"
  export BACKUP_BUCKET=test-bucket BACKUP_S3_ACCESS_KEY_ID=test-access-key BACKUP_S3_SECRET_ACCESS_KEY=$SECRET_S3
  export RESTORE_DB_URL="postgresql://postgres:$SECRET_DB_PASSWORD@127.0.0.1:5999/restore"
  export BACKUP_SKIP_MEDIA=true
}
ORIGINAL_PATH=$PATH

backup() { (cd "$T/repo" && "$ROOT/scripts/backup/backup.sh") > "$T/out.log" 2>&1; }
restore() { "$ROOT/scripts/backup/restore-test.sh" > "$T/out.log" 2>&1; }
objects() { find "$T/s3" -type f | wc -l | tr -d ' '; }

# expect_fail NAME MESSAGE-REGEX COMMAND…
expect_fail() {
  local name=$1 pattern=$2; shift 2
  if "$@"; then flunk "$name" "exited 0"; return; fi
  if grep -qE "::error::.*$pattern" "$T/out.log"; then pass "$name"; else flunk "$name" "no '::error::…$pattern' in: $(grep -m1 '::error::' "$T/out.log" || tail -n1 "$T/out.log")"; fi
}
no_secrets() {
  if grep -qE "$SECRET_S3|$SECRET_MEDIA|$SECRET_DB_PASSWORD|AGE-SECRET-KEY" "$T/out.log"; then flunk "$1" "a secret is in the log"; else pass "$1"; fi
}

# Edits the newest manifest in the fake bucket with a jq filter. Fails the
# test (instead of writing next to the caller) when there is none.
edit_manifest() {
  local m; m=$(ls "$T/s3/test-bucket/db"/*.manifest.json 2>/dev/null | head -n1)
  [ -n "$m" ] || { flunk "setup" "no manifest to edit"; return 1; }
  if [ "$1" = --raw ]; then printf '%s\n' "$2" > "$m"; else jq "$1" "$m" > "$T/manifest.tmp" && mv "$T/manifest.tmp" "$m"; fi
}

echo "# backup.sh"

reset_env
if backup; then pass "a good backup exits 0"; else flunk "a good backup exits 0" "$(tail -n3 "$T/out.log")"; fi
stamp=$(ls "$T/s3/test-bucket/db" | sed -n 's/\.manifest\.json$//p')
[ -f "$T/s3/test-bucket/db/$stamp.dump.age" ] && [ -f "$T/s3/test-bucket/code/$stamp.bundle.age" ] \
  && pass "dump, manifest and code bundle are all in the bucket" || flunk "dump, manifest and code bundle are all in the bucket" "$(find "$T/s3" -type f)"
if grep -rlq 'PGDMP-FAKE' "$T/s3"; then flunk "nothing unencrypted reaches the bucket" "a plaintext dump was uploaded"; else pass "nothing unencrypted reaches the bucket"; fi
grep -q 'age1stubci age1stuboffline' "$T/s3/test-bucket/db/$stamp.dump.age" \
  && pass "encrypted to every recipient (the CI key and the offline key)" || flunk "encrypted to every recipient" "$(sed -n 2p "$T/s3/test-bucket/db/$stamp.dump.age")"
[ "$(jq -r '.tables["public.orders"]' "$T/s3/test-bucket/db/$stamp.manifest.json")" = 120 ] && [ -n "$(jq -r .dump_sha256 "$T/s3/test-bucket/db/$stamp.manifest.json")" ] \
  && pass "the manifest records row counts and the dump's checksum" || flunk "the manifest records row counts and the dump's checksum" "$(cat "$T/s3/test-bucket/db/$stamp.manifest.json")"
no_secrets "no secret in the backup log"

# Same bucket: the backup just taken.
if restore; then pass "the restore test passes on that backup"; else flunk "the restore test passes on that backup" "$(grep -m1 '::error::' "$T/out.log")"; fi
grep -q 'Restore test passed' "$T/out.log" && pass "…and says so" || flunk "…and says so" "$(tail -n1 "$T/out.log")"
no_secrets "no secret in the restore log"

reset_env; unset BACKUP_BUCKET
expect_fail "no destination configured" "BACKUP_BUCKET is not set" backup
reset_env; unset SUPABASE_DB_URL
expect_fail "no database configured" "SUPABASE_DB_URL is not set" backup
reset_env; unset BACKUP_AGE_RECIPIENTS
expect_fail "no encryption key configured" "BACKUP_AGE_RECIPIENTS is not set" backup

reset_env; export FAKE_PG_DUMP=fail
if backup; then flunk "pg_dump failing fails the run" "exited 0"; else pass "pg_dump failing fails the run"; fi
[ "$(objects)" = 0 ] && pass "…and uploads nothing" || flunk "…and uploads nothing" "$(objects) objects"
reset_env; export FAKE_PG_DUMP=empty
expect_fail "an empty dump is refused" "empty file" backup
reset_env; export FAKE_PG_DUMP=garbage
expect_fail "a dump pg_restore cannot read is refused" "not a readable pg_dump archive" backup
reset_env; export FAKE_PG_DUMP=no-orders
expect_fail "a dump without the shop's orders table is refused" "no public.orders table" backup
[ "$(objects)" = 0 ] && pass "…before anything is uploaded" || flunk "…before anything is uploaded" "$(objects) objects"

reset_env; export FAKE_UPLOAD=fail
expect_fail "a failed upload fails the run" "Upload of .* failed" backup
ls "$T/s3/test-bucket/db"/*.manifest.json > /dev/null 2>&1 && flunk "…and leaves no manifest pointing at nothing" "manifest uploaded" || pass "…and leaves no manifest pointing at nothing"
reset_env; export FAKE_UPLOAD=truncate
expect_fail "a truncated upload is caught by the size check" "did not verify" backup

reset_env; unset BACKUP_SKIP_MEDIA
expect_fail "media not configured, and not skipped on purpose, fails the run" "Storage buckets were NOT" backup
ls "$T/s3/test-bucket/db"/*.dump.age > /dev/null 2>&1 && pass "…after the database is safely uploaded" || flunk "…after the database is safely uploaded" "no dump"

reset_env; unset BACKUP_SKIP_MEDIA
export SUPABASE_S3_ACCESS_KEY_ID=test-media-key SUPABASE_S3_SECRET_ACCESS_KEY=$SECRET_S3 SUPABASE_S3_ENDPOINT=https://storage.invalid BACKUP_MEDIA_PASSPHRASE=$SECRET_MEDIA
if backup; then pass "media configured: the run copies every Storage bucket"; else flunk "media configured: the run copies every Storage bucket" "$(grep -m1 '::error::' "$T/out.log")"; fi
[ "$(grep -c '^rclone copy supabase:' "$T/state/calls.log")" = 4 ] && pass "…all four buckets" || flunk "…all four buckets" "$(grep '^rclone copy' "$T/state/calls.log")"
no_secrets "no media passphrase or storage secret in the log"

echo "# restore-test.sh"

reset_env
expect_fail "no backup at all" "No database backup found" restore

reset_env; backup
export RESTORE_DB_URL="postgresql://postgres:$SECRET_DB_PASSWORD@db.abcdefghijkl.supabase.co:5432/postgres"
expect_fail "refuses a Supabase project as the restore target" "DISPOSABLE" restore
export RESTORE_DB_URL="postgresql://postgres.abc:$SECRET_DB_PASSWORD@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"
expect_fail "refuses the Supabase pooler as the restore target" "DISPOSABLE" restore
no_secrets "the refusal does not print the URL's password"

reset_env; backup; export FAKE_LIST=fail
expect_fail "an unreachable bucket is reported as such" "Could not list" restore
reset_env; backup; export FAKE_DOWNLOAD=fail
expect_fail "a failed download is reported" "Could not download" restore

reset_env; backup; edit_manifest '.created_at = "2020-01-01T00:00:00Z"'
expect_fail "a stale newest backup (the nightly job stopped)" "hours old" restore

reset_env; backup; d=$(ls "$T/s3/test-bucket/db"/*.dump.age 2>/dev/null | head -n1)
[ -n "$d" ] && sed -i '4s/^./X/' "$d"
expect_fail "a modified backup does not decrypt" "does not decrypt" restore

reset_env; backup; export BACKUP_AGE_IDENTITY="AGE-SECRET-KEY-STUB-someoneelse"
expect_fail "the wrong key does not decrypt" "does not decrypt" restore

reset_env; backup; edit_manifest '.dump_sha256 = "0000000000000000000000000000000000000000000000000000000000000000"'
expect_fail "a checksum that does not match the manifest" "Checksum mismatch" restore

reset_env; backup; edit_manifest '.tables = {"auth.users": 5}'
expect_fail "a manifest listing no public tables cannot pass vacuously" "lists no public tables" restore
reset_env; backup; edit_manifest 'del(.tables["public.orders"])'
expect_fail "a manifest without public.orders is not the shop's" "has no public.orders" restore
reset_env; backup; edit_manifest --raw 'not json'
expect_fail "a corrupt manifest" "not valid JSON" restore

reset_env; backup; export FAKE_RESTORE=short
expect_fail "a restore that comes back short fails" "Restore test FAILED" restore
grep -q 'public.orders: expected ~120 rows, restored 10' "$T/out.log" && pass "…naming the table" || flunk "…naming the table" "$(grep -m2 'expected' "$T/out.log")"

echo "== backup scripts: $fails failed"
exit "$fails"
