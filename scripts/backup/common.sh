# Shared by backup.sh and restore-test.sh. Sourced, not executed.
#
# Every tool runs from a pinned container image, so a backup taken today can
# be read by the same pg_restore and rclone tomorrow, whatever the runner has
# installed. Only `age`, `jq` and `docker` are needed on the host.

PG_IMAGE=${PG_IMAGE:-postgres:17}
RCLONE_IMAGE=${RCLONE_IMAGE:-rclone/rclone:1.68.2}
SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

log() { printf '\n==> %s\n' "$*" >&2; }
fail() { printf '::error::%s\n' "$*" >&2; exit 1; }

require() {
  local name
  for name in "$@"; do
    [ -n "${!name:-}" ] || fail "$name is not set (see docs/security/phase-1-backups.md)."
  done
}

# The offsite bucket, as an rclone remote named `backup`, configured entirely
# from the environment so no config file (and no key) is ever written to disk.
export RCLONE_CONFIG_BACKUP_TYPE=s3
export RCLONE_CONFIG_BACKUP_PROVIDER=${BACKUP_S3_PROVIDER:-Other}
export RCLONE_CONFIG_BACKUP_ENDPOINT=${BACKUP_S3_ENDPOINT:-}
export RCLONE_CONFIG_BACKUP_REGION=${BACKUP_S3_REGION:-us-east-1}
export RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID=${BACKUP_S3_ACCESS_KEY_ID:-}
export RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY=${BACKUP_S3_SECRET_ACCESS_KEY:-}
# The CI key is not allowed to create buckets, and should not need to.
export RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET=true

# rclone in a container, with /work mounted and every RCLONE_* variable passed
# through by name (docker reads the values from this shell's environment).
rclone_run() {
  local work=$1; shift
  local env_args=() name
  for name in $(compgen -e | grep '^RCLONE_'); do env_args+=(-e "$name"); done
  docker run --rm -i --network host --user "$(id -u):$(id -g)" \
    "${env_args[@]}" -v "$work:/work" "$RCLONE_IMAGE" "$@"
}

# A command from the Postgres image, with the connection string in $PGURL.
pg_run() {
  local work=$1; shift
  docker run --rm -i --network host --user "$(id -u):$(id -g)" \
    -e PGURL -v "$work:/work" -v "$SCRIPTS_DIR:/scripts:ro" "$PG_IMAGE" "$@"
}
