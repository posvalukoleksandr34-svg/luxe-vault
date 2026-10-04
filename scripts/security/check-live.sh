#!/usr/bin/env bash
# Checks the LIVE deployment from outside: origin lock, security headers, and
# that the sensitive endpoints refuse unauthenticated and forged requests.
# Needs no secrets — it only proves that the doors are shut.
#
#   scripts/security/check-live.sh [SITE_URL] [ORIGIN_URL]
#   SITE_URL    default https://www.luxe-vault.store   (through Cloudflare)
#   ORIGIN_URL  default https://luxe-vault-hlb1.vercel.app  (Vercel, direct)
#
# Exit code = number of failed checks. Warnings (⚠) do not fail the run.
# Run by .github/workflows/security-check.yml; see docs/security/hardening-2026-09-29.md.

set -u
SITE="${1:-${SITE_URL:-https://www.luxe-vault.store}}"
ORIGIN="${2:-${ORIGIN_URL:-https://luxe-vault-hlb1.vercel.app}}"
SITE="${SITE%/}"; ORIGIN="${ORIGIN%/}"
fails=0; warns=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1${2:+  — $2}"; fails=$((fails + 1)); [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error::$1 ${2:-}"; }
warn() { echo "WARN  $1${2:+  — $2}"; warns=$((warns + 1)); [ -n "${GITHUB_ACTIONS:-}" ] && echo "::warning::$1 ${2:-}"; }
code() { curl -s -o /dev/null -m 20 -w '%{http_code}' "$@"; }
refused() { [ "$1" -ge 400 ] 2>/dev/null; }

echo "# Site:   $SITE"
echo "# Origin: $ORIGIN"

echo; echo "## 1. The site answers"
s=$(code "$SITE/"); [ "$s" = 200 ] && pass "homepage 200" || fail "homepage" "HTTP $s"

echo; echo "## 2. Security headers"
H=$(curl -s -D - -o /dev/null -m 20 "$SITE/" | tr -d '\r')
h() { printf '%s\n' "$H" | grep -i "^$1:" | head -1 | cut -d' ' -f2-; }
csp=$(h content-security-policy)
[ -n "$csp" ] && pass "Content-Security-Policy present" || fail "Content-Security-Policy missing"
case "$csp" in *unsafe-eval*) fail "CSP allows 'unsafe-eval'";; *) pass "CSP without 'unsafe-eval'";; esac
case "$csp" in *"*.supabase.co"*) fail "CSP still allows every *.supabase.co project" "set NEXT_PUBLIC_SUPABASE_URL for the build";; *) pass "CSP pins Supabase to the project host";; esac
case "$csp" in *"frame-ancestors 'none'"*) pass "CSP frame-ancestors 'none'";; *) fail "CSP frame-ancestors 'none' missing";; esac
case "$csp" in *"object-src 'none'"*) pass "CSP object-src 'none'";; *) fail "CSP object-src 'none' missing";; esac
case "$(h strict-transport-security)" in *max-age=63072000*includeSubDomains*) pass "HSTS 2 years + subdomains";; *) fail "HSTS" "$(h strict-transport-security)";; esac
[ "$(h x-frame-options)" = DENY ] && pass "X-Frame-Options DENY" || fail "X-Frame-Options" "$(h x-frame-options)"
[ "$(h x-content-type-options)" = nosniff ] && pass "X-Content-Type-Options nosniff" || fail "X-Content-Type-Options"
[ "$(h referrer-policy)" = strict-origin-when-cross-origin ] && pass "Referrer-Policy" || fail "Referrer-Policy" "$(h referrer-policy)"
case "$(h permissions-policy)" in *"camera=()"*) pass "Permissions-Policy";; *) fail "Permissions-Policy missing";; esac
[ -z "$(h x-powered-by)" ] && pass "no X-Powered-By" || fail "X-Powered-By present" "$(h x-powered-by)"
# /checkout gets its own per-request policy (middleware.ts): one header only,
# and its script-src runs inline code by nonce/hash, never 'unsafe-inline'.
co=$(curl -s -D - -o /dev/null -m 20 "$SITE/checkout" | tr -d '\r' | grep -i '^content-security-policy:')
co_n=$(printf '%s' "$co" | grep -c . || true)
co_script=$(printf '%s\n' "$co" | head -1 | cut -d' ' -f2- | tr ';' '\n' | sed 's/^ *//' | grep '^script-src ' || true)
if [ "$co_n" -gt 1 ]; then fail "/checkout sends $co_n CSP headers" "the site-wide policy must not apply there (next.config.js)"
elif [ -z "$co_script" ]; then fail "/checkout CSP has no script-src"
else case "$co_script" in
  *"'nonce-"*) case "$co_script" in *"'unsafe-inline'"*) fail "/checkout script-src has a nonce but also 'unsafe-inline'";; *) pass "/checkout: nonce CSP, no 'unsafe-inline' for scripts";; esac;;
  *) warn "/checkout has no nonce CSP" "deploy the nonce-CSP change";;
esac; fi

echo; echo "## 3. Direct origin (must not bypass Cloudflare)"
s=$(code "$ORIGIN/"); refused "$s" && pass "origin / refused (HTTP $s)" || fail "origin / answers directly — the Cloudflare lock is OFF" "HTTP $s; set EDGE_ORIGIN_SECRET + the Transform Rule"
s=$(code -H 'Host: www.luxe-vault.store' "$ORIGIN/"); refused "$s" && pass "origin with forged Host refused (HTTP $s)" || fail "origin with forged Host answers" "HTTP $s"
s=$(code -H 'x-edge-auth: guess' "$ORIGIN/"); refused "$s" && pass "origin with a guessed edge secret refused (HTTP $s)" || fail "guessed edge secret accepted" "HTTP $s"
s=$(code -X POST "$ORIGIN/api/admin/login"); refused "$s" && pass "origin admin login refused (HTTP $s)" || fail "origin admin login reachable" "HTTP $s"
s=$(code "$ORIGIN/_next/image?url=%2Ficon.svg&w=64&q=75"); refused "$s" && pass "origin image optimiser refused (HTTP $s)" || warn "origin image optimiser reachable around Cloudflare" "HTTP $s — add the Vercel Firewall rule (hardening doc §2)"
asset=$(curl -s -m 20 "$SITE/" | grep -o '/_next/static/[^"]*\.js' | head -1)
if [ -n "$asset" ]; then s=$(code "$ORIGIN$asset"); refused "$s" && pass "origin static files refused (HTTP $s)" || warn "origin static files reachable around Cloudflare" "HTTP $s — public content; the Vercel Firewall rule closes it"; fi

echo; echo "## 4. Admin and payment endpoints refuse without credentials"
s=$(code "$SITE/api/admin/orders"); [ "$s" = 401 ] || [ "$s" = 403 ] && pass "admin API without session (HTTP $s)" || fail "admin API without session" "HTTP $s"
forged="__Host-lv_admin_session=$(( $(date +%s) + 3600 )).aaaaaaaaaaaaaaaaaaaaaaaa.0000000000000000000000000000000000000000000000000000000000000000"
s=$(code -H "Cookie: $forged" "$SITE/api/admin/orders"); refused "$s" && pass "admin API with forged cookie refused (HTTP $s)" || fail "forged admin cookie accepted" "HTTP $s"
s=$(code -H 'x-middleware-subrequest: middleware:middleware:middleware:middleware:middleware' "$SITE/api/admin/orders"); refused "$s" && pass "x-middleware-subrequest bypass refused (HTTP $s)" || fail "middleware bypass header accepted" "HTTP $s"
s=$(code -X POST -H 'content-type: application/json' --data '{}' "$SITE/api/payments/stripe/webhook"); [ "$s" = 400 ] && pass "Stripe webhook without signature → 400" || { [ "$s" = 503 ] && fail "Stripe webhook not configured" "HTTP 503 — STRIPE_WEBHOOK_SECRET missing" || fail "Stripe webhook without signature" "HTTP $s"; }
s=$(code -X POST -H 'content-type: application/json' -H 'x-nowpayments-sig: 00' --data '{"payment_id":1,"payment_status":"finished"}' "$SITE/api/payments/crypto/webhook"); refused "$s" && pass "crypto webhook with forged signature refused (HTTP $s)" || fail "crypto webhook accepted a forged signature" "HTTP $s"
s=$(code -X POST -H 'content-type: application/json' -H 'sec-fetch-site: cross-site' -H 'origin: https://evil.example' --data '{}' "$SITE/api/orders"); [ "$s" = 403 ] && pass "cross-site POST refused (CSRF)" || fail "cross-site POST not refused" "HTTP $s"
s=$(code -X POST -H 'content-type: application/json' --data '{"orders":[{"id":"LV-AAAAAA","token":"guess"}]}' "$SITE/api/orders/lookup")
body=$(curl -s -m 20 -X POST -H 'content-type: application/json' --data '{"orders":[{"id":"LV-AAAAAA","token":"guess"}]}' "$SITE/api/orders/lookup")
case "$body" in *'"orders":[]'*|*rror*|*"Too many"*) pass "order lookup with a guessed token returns nothing";; *) fail "order lookup with a guessed token" "$body";; esac

echo; echo "## 5. Image optimiser allow-list"
s=$(code "$SITE/_next/image?url=https%3A%2F%2Fevil.example%2Fx.png&w=64&q=75"); refused "$s" && pass "foreign image host refused (HTTP $s)" || fail "image optimiser proxies foreign hosts" "HTTP $s"
s=$(code "$SITE/_next/image?url=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data&w=64&q=75"); refused "$s" && pass "metadata address refused (HTTP $s)" || fail "image optimiser fetched the metadata address" "HTTP $s"

echo; echo "== $fails failed, $warns warnings"
exit "$fails"
