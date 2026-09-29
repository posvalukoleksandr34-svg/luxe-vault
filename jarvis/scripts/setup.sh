#!/usr/bin/env bash
# First-time setup: creates .env with generated secrets, detects your timezone, optionally asks for
# the Anthropic key and your domain. Safe to re-run: existing values are kept.
#
#   ./scripts/setup.sh                 interactive
#   ./scripts/setup.sh --yes           non-interactive (local HTTP, keys added later in the UI)
#   ./scripts/setup.sh --domain jarvis.example.com --anthropic-key sk-ant-...
set -euo pipefail
cd "$(dirname "$0")/.."

YES=0; DOMAIN=""; AKEY=""; PROFILES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) YES=1 ;;
    --domain) DOMAIN="$2"; shift ;;
    --anthropic-key) AKEY="$2"; shift ;;
    --profiles) PROFILES="$2"; shift ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
  shift
done

command -v docker >/dev/null || { echo "Docker is required: https://docs.docker.com/engine/install/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required"; exit 1; }

[ -f .env ] || cp .env.example .env
chmod 600 .env

rand() { openssl rand -hex "${1:-24}"; }
fernet() { openssl rand -base64 32 | tr '+/' '-_'; }
get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- ; }
set_kv() {  # set_kv KEY VALUE — replace or append, keeping everything else
  local k="$1" v="$2"
  if grep -qE "^$k=" .env; then
    python3 - "$k" "$v" <<'PY'
import sys, re
k, v = sys.argv[1], sys.argv[2]
p = ".env"
s = open(p).read()
s = re.sub(rf"(?m)^{re.escape(k)}=.*$", lambda m: f"{k}={v}", s, count=1)
open(p, "w").write(s)
PY
  else
    echo "$k=$v" >> .env
  fi
}
ensure() { [ -n "$(get "$1")" ] || set_kv "$1" "$2"; }

ensure POSTGRES_PASSWORD "$(rand 24)"
ensure JARVIS_MASTER_KEYS "$(fernet)"
ensure SANDBOX_TOKEN "$(rand 32)"
ensure JARVIS_METRICS_TOKEN "$(rand 32)"
ensure RESTIC_PASSWORD "$(rand 32)"
ensure JARVIS_TELEGRAM_WEBHOOK_SECRET "$(rand 24)"
ensure WHATSAPP_VERIFY_TOKEN "$(rand 16)"
ensure GRAFANA_ADMIN_PASSWORD "$(rand 12)"

# timezone of this machine
if [ "$(get JARVIS_TIMEZONE)" = "UTC" ] || [ -z "$(get JARVIS_TIMEZONE)" ]; then
  TZ_DETECTED=$( (timedatectl show -p Timezone --value 2>/dev/null) || cat /etc/timezone 2>/dev/null || true)
  [ -z "$TZ_DETECTED" ] && [ -L /etc/localtime ] && TZ_DETECTED=$(readlink /etc/localtime | sed 's#.*/zoneinfo/##')
  [ -n "$TZ_DETECTED" ] && set_kv JARVIS_TIMEZONE "$TZ_DETECTED"
fi

if [ $YES -eq 0 ]; then
  [ -z "$DOMAIN" ] && read -r -p "Domain for HTTPS (empty = local http://localhost): " DOMAIN || true
  if [ -z "$AKEY" ] && [ -z "$(get ANTHROPIC_API_KEY)" ]; then
    read -r -s -p "Anthropic API key (empty = add later in Settings): " AKEY || true; echo
  fi
fi
if [ -n "$DOMAIN" ]; then
  set_kv JARVIS_SITE_ADDRESS "$DOMAIN"
  set_kv JARVIS_PUBLIC_URL "https://$DOMAIN"
fi
[ -n "$AKEY" ] && set_kv ANTHROPIC_API_KEY "$AKEY"
[ -n "$PROFILES" ] && set_kv COMPOSE_PROFILES "$PROFILES"

mkdir -p backups infrastructure/monitoring
get JARVIS_METRICS_TOKEN > infrastructure/monitoring/metrics_token
chmod 600 infrastructure/monitoring/metrics_token

cat <<MSG

✓ .env ready (secrets generated, timezone $(get JARVIS_TIMEZONE)).

  Store these two in your password manager — they are needed to restore backups:
    JARVIS_MASTER_KEYS and RESTIC_PASSWORD   (grep them from .env)

Next:
  docker compose up -d
  docker compose logs api | grep "SETUP CODE"     # one-time code to create the owner account
  open $(get JARVIS_PUBLIC_URL)
MSG
