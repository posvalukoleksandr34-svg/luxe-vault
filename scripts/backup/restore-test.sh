#!/usr/bin/env bash
# Weekly proof that the newest backup can actually be restored.
# docs/security/phase-1-backups.md.
#
# A backup nobody has restored is a hope, not a backup. This takes the newest
# database backup, checks it is recent, decrypts it, restores it into a
# throwaway Postgres, and compares every table's row count with the manifest
# written at backup time. It fails — and the workflow alerts — when:
#
#   - there is no backup, or the newest is older than BACKUP_MAX_AGE_HOURS
#     (a nightly job that quietly stopped is caught here within a week)
#   - the file does not decrypt, or its checksum is not the one recorded
#   - a table is missing from the restore, or came back empty or short
#
# Required:  BACKUP_BUCKET  BACKUP_S3_ACCESS_KEY_ID  BACKUP_S3_SECRET_ACCESS_KEY
#            BACKUP_AGE_IDENTITY  RESTORE_DB_URL (a DISPOSABLE database)
# Optional:  BACKUP_MAX_AGE_HOURS (default 30)  BACKUP_S3_ENDPOINT
#            BACKUP_S3_REGION  BACKUP_S3_PROVIDER  PG_IMAGE  RCLONE_IMAGE

set -euo pipefail
. "$(dirname "$0")/common.sh"

require BACKUP_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY \
  BACKUP_AGE_IDENTITY RESTORE_DB_URL

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export PGURL=$RESTORE_DB_URL

# ---------------------------------------------------------- newest backup --
latest=$(rclone_run "$work" lsf "backup:$BACKUP_BUCKET/db" --files-only --include '*.manifest.json' | sort | tail -n 1)
[ -n "$latest" ] || fail "No database backup found in $BACKUP_BUCKET/db."
stamp=${latest%.manifest.json}
log "Newest backup: $stamp"

rclone_run "$work" copyto "backup:$BACKUP_BUCKET/db/$stamp.manifest.json" /work/manifest.json
rclone_run "$work" copyto "backup:$BACKUP_BUCKET/db/$stamp.dump.age" /work/dump.age

created=$(jq -r .created_at "$work/manifest.json")
age_hours=$(( ( $(date -u +%s) - $(date -u -d "$created" +%s) ) / 3600 ))
max_hours=${BACKUP_MAX_AGE_HOURS:-30}
[ "$age_hours" -le "$max_hours" ] ||
  fail "The newest backup is $age_hours hours old (limit $max_hours). Is the nightly backup workflow failing?"

# ------------------------------------------------------------ decrypt + verify --
( umask 077; printf '%s\n' "$BACKUP_AGE_IDENTITY" > "$work/identity.txt" )
age -d -i "$work/identity.txt" -o "$work/db.dump" "$work/dump.age" ||
  fail "The backup does not decrypt with BACKUP_AGE_IDENTITY."
rm -f "$work/identity.txt" "$work/dump.age"

[ "$(sha256sum "$work/db.dump" | cut -d' ' -f1)" = "$(jq -r .dump_sha256 "$work/manifest.json")" ] ||
  fail "Checksum mismatch: the dump is not the file that was backed up."

# -------------------------------------------------------------------- restore --
# A plain Postgres is not a Supabase project: its roles and extensions have to
# exist before the dump's grants and column types can be recreated. Extensions
# only Supabase ships (pg_graphql, supabase_vault, ...) fail here harmlessly —
# the row counts below are the verdict, not a clean log.
log "Preparing the throwaway database"
{
  for role in anon authenticated service_role authenticator supabase_admin \
    supabase_auth_admin supabase_storage_admin dashboard_user; do
    printf "do \$\$ begin create role %s nologin; exception when duplicate_object then null; end \$\$;\n" "$role"
  done
  jq -r '.extensions[] | "create schema if not exists \"\(.schema)\";\ncreate extension if not exists \"\(.name)\" with schema \"\(.schema)\";"' "$work/manifest.json"
} > "$work/prepare.sql"
pg_run "$work" sh -c 'psql "$PGURL" -X -q -f /work/prepare.sql' > "$work/prepare.log" 2>&1 || true

log "Restoring"
pg_run "$work" sh -c 'pg_restore --no-owner --dbname="$PGURL" /work/db.dump' > "$work/restore.log" 2>&1 || true
# `schema "public" already exists` is every restore into a fresh database.
grep 'pg_restore: error' "$work/restore.log" | grep -v 'schema "public" already exists' > "$work/errors.log" || true
errors=$(wc -l < "$work/errors.log")
if [ "$errors" -gt 0 ]; then
  echo "::warning::pg_restore reported $errors errors (Supabase-only objects are expected here); the first ones:"
  head -n 15 "$work/errors.log"
fi

# --------------------------------------------------------------------- verdict --
pg_run "$work" sh -c 'psql "$PGURL" -X -q -t -A -v ON_ERROR_STOP=1 -f /scripts/manifest.sql' > "$work/restored.json"

# Counts are taken just after the dump, so a busy table may have a few more
# rows in the manifest than in the dump. Short by 10% or more on a table of
# 50+ rows, or empty where rows were expected, is a broken backup.
problems=$(jq -r --slurpfile got "$work/restored.json" '
  .tables | to_entries[]
  | .key as $table | .value as $want | ($got[0].tables[$table]) as $have
  | select($have == null or ($want > 0 and $have == 0) or ($want >= 50 and $have < $want * 0.9))
  | "\($table): expected ~\($want) rows, restored \($have // "no table")"
' "$work/manifest.json")

tables=$(jq '.tables | length' "$work/manifest.json")
rows=$(jq '[.tables[]] | add // 0' "$work/restored.json")
summary="Backup $stamp ($age_hours h old): $tables tables, $rows rows restored, $errors pg_restore errors."
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$summary" >> "$GITHUB_STEP_SUMMARY"

if [ -n "$problems" ]; then
  printf '%s\n' "$problems" >&2
  fail "Restore test FAILED. $summary"
fi
log "Restore test passed. $summary"
