#!/usr/bin/env bash
# Nightly offsite backup. Setup and restore: docs/security/phase-1-backups.md.
#
# Three things leave the building, each encrypted BEFORE it is uploaded:
#
#   db/     pg_dump of the public, auth and storage schemas, encrypted with
#           age, next to a plaintext manifest (row counts, extensions) that
#           the weekly restore test checks the restored copy against
#   media/  every Storage bucket, through an rclone crypt remote
#   code/   a git bundle of every branch and tag, encrypted with age
#
# Nothing here deletes or overwrites an earlier backup: media is `copy`, not
# `sync`, so a file deleted or encrypted by an attacker upstream is not
# deleted here, and the bucket's Object Lock stops the key doing it anyway.
#
# Required:  SUPABASE_DB_URL  BACKUP_AGE_RECIPIENTS  BACKUP_BUCKET
#            BACKUP_S3_ACCESS_KEY_ID  BACKUP_S3_SECRET_ACCESS_KEY
# Optional:  BACKUP_S3_ENDPOINT  BACKUP_S3_REGION  BACKUP_S3_PROVIDER
#            SUPABASE_S3_ENDPOINT  SUPABASE_S3_REGION  SUPABASE_S3_ACCESS_KEY_ID
#            SUPABASE_S3_SECRET_ACCESS_KEY  BACKUP_MEDIA_PASSPHRASE  (media)
#            BACKUP_STORAGE_BUCKETS  PG_IMAGE  RCLONE_IMAGE
#            BACKUP_SKIP_MEDIA=true  (an explicit decision not to back up the
#            Storage buckets; without it, missing media settings FAIL the run)
#
# Exit status is the truth: non-zero whenever any part that should have been
# backed up was not, and every uploaded file is checked in the bucket.

set -euo pipefail
. "$(dirname "$0")/common.sh"

require SUPABASE_DB_URL BACKUP_AGE_RECIPIENTS BACKUP_BUCKET \
  BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY

stamp=$(date -u +%Y%m%dT%H%M%SZ)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export PGURL=$SUPABASE_DB_URL

# One -r per recipient, so a backup can be opened by the CI key the restore
# test uses AND by an offline key that never touches GitHub.
age_args=()
for recipient in $BACKUP_AGE_RECIPIENTS; do age_args+=(-r "$recipient"); done

# ------------------------------------------------------------------ database --
log "Dumping the database"
pg_run "$work" sh -c 'pg_dump "$PGURL" --format=custom --schema=public --schema=auth --schema=storage --file=/work/db.dump'
# An archive pg_restore cannot read, or one without the shop's tables, is not
# a backup — caught here rather than on the day it is needed.
[ -s "$work/db.dump" ] || fail "pg_dump produced an empty file."
pg_run "$work" sh -c 'pg_restore --list /work/db.dump' > "$work/toc.txt" ||
  fail "The dump is not a readable pg_dump archive."
grep -q 'TABLE public orders ' "$work/toc.txt" ||
  fail "The dump has no public.orders table: wrong database, or a broken dump."
rm -f "$work/toc.txt"
pg_run "$work" sh -c 'psql "$PGURL" -X -q -t -A -v ON_ERROR_STOP=1 -f /scripts/manifest.sql' > "$work/contents.json"

jq --arg stamp "$stamp" \
  --arg created "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg sha "$(sha256sum "$work/db.dump" | cut -d' ' -f1)" \
  --argjson bytes "$(stat -c %s "$work/db.dump")" \
  '{stamp: $stamp, created_at: $created, dump_sha256: $sha, dump_bytes: $bytes} + .' \
  "$work/contents.json" > "$work/$stamp.manifest.json"

# auth.users holds password hashes and every table holds customer PII: the
# dump never exists outside this runner unencrypted.
age "${age_args[@]}" -o "$work/$stamp.dump.age" "$work/db.dump"
rm -f "$work/db.dump"

# The dump first, the manifest last: the restore test looks for manifests, so
# a run that dies halfway never leaves a manifest pointing at nothing.
upload_verified "$work" "$stamp.dump.age" "backup:$BACKUP_BUCKET/db/$stamp.dump.age"
upload_verified "$work" "$stamp.manifest.json" "backup:$BACKUP_BUCKET/db/$stamp.manifest.json"
log "Database: $(jq -r '[.tables[]] | add' "$work/$stamp.manifest.json") rows in $(jq -r '.tables | length' "$work/$stamp.manifest.json") tables"

# --------------------------------------------------------------------- media --
if [ -n "${SUPABASE_S3_ACCESS_KEY_ID:-}" ] && [ -n "${BACKUP_MEDIA_PASSPHRASE:-}" ]; then
  require SUPABASE_S3_ENDPOINT SUPABASE_S3_SECRET_ACCESS_KEY
  export RCLONE_CONFIG_SUPABASE_TYPE=s3
  export RCLONE_CONFIG_SUPABASE_PROVIDER=Other
  export RCLONE_CONFIG_SUPABASE_ENDPOINT=$SUPABASE_S3_ENDPOINT
  export RCLONE_CONFIG_SUPABASE_REGION=${SUPABASE_S3_REGION:-us-east-1}
  export RCLONE_CONFIG_SUPABASE_ACCESS_KEY_ID=$SUPABASE_S3_ACCESS_KEY_ID
  export RCLONE_CONFIG_SUPABASE_SECRET_ACCESS_KEY=$SUPABASE_S3_SECRET_ACCESS_KEY
  export RCLONE_CONFIG_SUPABASE_FORCE_PATH_STYLE=true

  export RCLONE_CONFIG_MEDIA_TYPE=crypt
  export RCLONE_CONFIG_MEDIA_REMOTE="backup:$BACKUP_BUCKET/media"
  RCLONE_CONFIG_MEDIA_PASSWORD=$(printf '%s' "$BACKUP_MEDIA_PASSPHRASE" | rclone_run "$work" obscure -)
  export RCLONE_CONFIG_MEDIA_PASSWORD

  for bucket in ${BACKUP_STORAGE_BUCKETS:-product-images newsletter-images returns support-attachments}; do
    log "Copying Storage bucket $bucket"
    rclone_run "$work" copy "supabase:$bucket" "media:$bucket" --stats-one-line --stats=0 -v
  done
elif [ "${BACKUP_SKIP_MEDIA:-}" = "true" ]; then
  echo "::warning::Storage buckets were NOT backed up (BACKUP_SKIP_MEDIA=true)."
else
  # Recorded now, reported at the end: the database and code backups still
  # run, but the job must not end green with the product photos missing.
  media_missing=1
fi

# ---------------------------------------------------------------------- code --
if git rev-parse --git-dir > /dev/null 2>&1; then
  log "Bundling the git repository"
  git bundle create "$work/repo.bundle" --all
  age "${age_args[@]}" -o "$work/$stamp.bundle.age" "$work/repo.bundle"
  upload_verified "$work" "$stamp.bundle.age" "backup:$BACKUP_BUCKET/code/$stamp.bundle.age"
fi

if [ "${media_missing:-0}" = 1 ]; then
  fail "Database and code backed up as $stamp, but the Storage buckets were NOT: set SUPABASE_S3_ACCESS_KEY_ID and BACKUP_MEDIA_PASSPHRASE, or BACKUP_SKIP_MEDIA=true to skip them on purpose."
fi
log "Backup $stamp complete in $SECONDS s"
