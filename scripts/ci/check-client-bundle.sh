#!/usr/bin/env bash
# After `next build`: nothing server-only may be in what the browser downloads.
#
# Next.js inlines only NEXT_PUBLIC_* variables into client code; any other
# `process.env.X` left in a client chunk means server code was bundled for the
# browser — the first step to shipping a secret. So this fails when, in
# .next/static:
#
#   * any non-public variable from .env.example is READ there, or
#   * something shaped like a secret does: a Stripe secret or webhook key, a
#     JWT whose payload says "service_role", a private key block.
#
#   scripts/ci/check-client-bundle.sh            (after next build)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
STATIC="$ROOT/.next/static"
[ -d "$STATIC" ] || { echo "No $STATIC — run next build first." >&2; exit 2; }

names=$(grep -oE '^#? ?[A-Z][A-Z0-9_]{3,}=' "$ROOT/.env.example" | sed -E 's/^# ?//; s/=$//' | grep -v '^NEXT_PUBLIC_' | sort -u)
[ -n "$names" ] || { echo "No variable names found in .env.example." >&2; exit 2; }

found=0
while read -r name; do
  # A READ of the variable (process.env.NAME, env["NAME"]), however the
  # minifier renamed `process`. The bare name is allowed: admin help texts
  # say "set RESEND_API_KEY", which is documentation, not a leak.
  if hits=$(grep -rlE -- "(\.|\[[\"'])$name([^A-Za-z0-9_]|\$)" "$STATIC" 2>/dev/null); then
    echo "::error::Server-only variable $name is referenced in client code: ${hits//$'\n'/, }"
    found=1
  fi
done <<< "$names"

# Shapes of secrets. Only file names are printed, never what matched.
patterns=(
  'sk_(live|test)_[A-Za-z0-9]{10,}'
  'rk_(live|test)_[A-Za-z0-9]{10,}'
  'whsec_[A-Za-z0-9]{10,}'
  'InJvbGUiOiJzZXJ2aWNlX3JvbGUi'      # base64 of "role":"service_role" (a Supabase service key)
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
)
for p in "${patterns[@]}"; do
  if hits=$(grep -rlE -- "$p" "$STATIC" 2>/dev/null); then
    echo "::error::Something shaped like a secret is in client code: ${hits//$'\n'/, }"
    found=1
  fi
done

if [ "$found" -eq 0 ]; then
  echo "Client bundle clean: $(echo "$names" | wc -l | tr -d ' ') server-only variable names and ${#patterns[@]} secret shapes checked in $(find "$STATIC" -type f -name '*.js' | wc -l | tr -d ' ') files."
fi
exit "$found"
