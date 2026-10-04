# Security audit — 2026-10-04

Follows [hardening-2026-09-29.md](hardening-2026-09-29.md) and the
[compliance audit](../compliance/audit-2026-10-04.md). Scope: dependencies,
the origin lock, credentials, both payment providers and the payment state
machine, admin auth, CSRF, Supabase, CSP/headers, and a general sweep.

## 1. Fixed

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | HIGH | **NOWPayments IPN trusted on signature alone.** A validly signed IPN set the status it carried. An IPN has no timestamp or nonce, so an old one (e.g. "expired") could be replayed, and nothing checked that the payment was for this order's amount, currency or coin. | The IPN is now a trigger. After the HMAC check the webhook re-reads the payment from NOWPayments' API (`getPayment`) and applies it only if the provider's record matches the order whose current `payment_id` it is: same order id, `price_currency` CHF, `price_amount` = stored order total, the coin the order was created for (`cryptoPaymentMismatch`). "Paid" also needs `actually_paid` ≥ the quote less 0.5 % (`cryptoFullyPaid`); otherwise `confirming` plus an operator alert. Provider unreachable → 503 (NOWPayments retries). Mismatch / unknown payment → 200 + alert, order untouched. |
| 2 | HIGH | **Paid orders could be un-paid.** `setPaymentStatus` deliberately let `failed` / `expired` through on a paid order, and NOWPayments' `refunded` was mapped to `failed`. Together with #1, a replayed IPN could flip a paid order back. | One payment state machine (`lib/payment-state.ts`), enforced *inside* each UPDATE as a PostgREST filter on the current status, so concurrent deliveries cannot race past it. Unsettled states only from unsettled; `paid` from anything but a refund; refunds only after money arrived. `refunded` maps to `refunded`. Also applied to `adoptPaymentIntent`, `setOrderPaymentSession` and `recordRefund`. |
| 3 | MEDIUM | **A new payment session could replace a paid/refunded or in-flight one.** The Stripe intent and crypto resume routes checked only `paid`; the write had no guard, so a race could overwrite `payment_id` and orphan the real payment. | Both routes refuse paid, partially refunded and refunded orders up front; crypto also refuses `confirming`. The write itself only attaches to an order whose status is still null / pending / failed / expired, and answers 409 otherwise. The client secret is never returned in that case. |
| 4 | MEDIUM | **Manual refund on an unpaid order** completed the return request before failing. | `isPaymentTransitionAllowed(order.paymentStatus, 'refunded')` is checked first → 409. |
| 5 | MEDIUM | **Origin lock failed open.** A production deploy without `EDGE_ORIGIN_SECRET` served everything on `*.vercel.app`, around Cloudflare's WAF and rate limits, and only logged it. | **Fail-closed:** Vercel production without the secret answers 503, except `/api/cron/*` (still `CRON_SECRET`). `EDGE_ORIGIN_LOCK=off` is the explicit, logged break-glass. Secrets shorter than 32 characters are logged. Local dev and previews are unaffected. |
| 6 | MEDIUM | **`/_next/image` bypassed the origin lock.** It was excluded from the middleware matcher. | Matched for the origin lock only; nothing else in the middleware runs for it. |
| 7 | LOW | **Re-login left the old admin session valid.** Signing in again overwrote the cookie but did not revoke the previous token, so a copied old cookie lived on for up to 8 h. | The login route revokes a valid session already presented in the cookie before issuing a new one. |
| 8 | LOW | **IPN canonicalisation and `__proto__`.** `sortKeysDeep` built a plain `{}`, so a `"__proto__"` key in a payload became a prototype assignment and vanished from the signed canonical form. | Null-prototype objects: the key is kept and signed like any other. |
| 9 | LOW | **Dependency hygiene.** Next 15.5.26; `eslint` 8.49.0 below the `^8.57` peer that `@typescript-eslint` 8 (via eslint-config-next 15) requires. | `next`, `eslint-config-next`, `@next/swc-wasm-nodejs` → 15.5.27; `eslint` → 8.57.1. `package.json` and the lockfile are in sync (`npm ci` clean, `npm install` a no-op). |

Reviewed and unchanged, because they hold:
- **Stripe webhook:** raw-body signature with 5-minute tolerance, event-id ledger, amount and currency checked against the order, late `failed` / `processing` ignored. The state machine now also backs this in the database.
- **Admin:** `requireAdmin()` in every admin handler and page, not just middleware. Sessions are HMAC-signed with expiry and server-side revocation, plus TOTP with a replay guard. The cookie is `__Host-`, HttpOnly, Secure, SameSite=Lax.
- **CSRF:** Fetch-Metadata/Origin check for every non-GET. Only the two webhooks and `/api/csp-report` are exempt, by exact path.
- **Supabase:** RLS on; the service-role client is `server-only` and imported by no client file; order access is by lookup token with `safeEqual`.
- **CSP:** strict nonce CSP on `/checkout` and `/admin`, no `unsafe-eval`. `frame-ancestors`, `object-src`, `base-uri`, `form-action` and HSTS are set.
- **General sweep:**
  - admin search input is sanitised before PostgREST `or()`;
  - the auth callback `next` is validated and origin-prefixed (no open redirect);
  - upload paths are server-generated;
  - no CORS headers;
  - logs scrub tokens (`lib/sensitive-url.ts`).

## 2. Credentials

All refs and the working tree were scanned for provider key formats (Stripe, Supabase/JWT, AWS, GitHub, Google, OpenAI/Anthropic, Resend, Telegram, private keys). There were **no matches**. `.env` is git-ignored; `.env.example` holds placeholders only.

The admin password and session-secret literals once committed as code
fallbacks (removed in 6916cd4) are still in history. **Treat them as burned.**
The same goes for anything listed in the 2026-09-29 report. Rotate
`ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` if they were ever equal to those
values; rotating either signs every admin out.

A production build with marker values for every server secret contained none of them anywhere in `.next/`. No client chunk references a server-secret variable name.

## 3. Tests

- `npm run test:security`: 31 unit tests (node:test).
  - the state-machine table;
  - IPN signature (incl. `__proto__`), provider/order mismatch, underpayment;
  - CSRF;
  - origin-lock states and header check;
  - admin token expiry/tamper/rotation;
  - URL scrubbing.
- HTTP suites against `next build` + `next start`, real Postgres 16 + PostgREST, and a fake NOWPayments API (in a scratch harness, not in the repo):
  - payments (33): forged and mismatched IPNs, underpayment, provider down, replay/duplicate/10× concurrent, no downgrade after paid or refund, Stripe stale-timestamp replay, amount/currency mismatch, late events, new sessions refused for paid orders, expired / never-issued admin tokens;
  - origin lock under `VERCEL_ENV=production` (16): no secret → 503, with secret → 403/200, `/_next/image`, cron exempt, break-glass, local `next start`;
  - re-login revokes the old session (5);
  - existing security (47), TOTP (14), CSP (16), integration (24) and price suites.

## 4. Remaining risks

| Risk | Severity | Note |
|---|---|---|
| `braces` ≤ 3.0.3 advisory (GHSA-vfj7-8cjw-p6xm). npm counts it as 9 "high" through tailwindcss, chokidar, fast-glob, micromatch and eslint-config-next. | LOW in practice | Build/lint tooling only, not in the server or client bundle. It needs attacker-controlled glob patterns; ours come from repo config. **No patched braces exists.** `npm audit fix --force` would downgrade eslint-config-next to 14.x — do not run it. Re-check monthly. |
| `eslint` 8 is end-of-life | LOW | Dev tooling. Moving to 9 means a flat config; a separate change. |
| Old side branches on Next 13.x | MEDIUM | If Vercel builds previews for them, those previews run vulnerable Next. Delete the branches or disable their previews. |
| Historical credentials in git history | MEDIUM | Rotate as in §2. History is not rewritten; rotation is the fix. |
| Crypto underpayments and payments that match no order need a person | — | Alerted via Telegram (`reportCriticalError`); never applied automatically. |
| `'unsafe-inline'` in `script-src` outside `/checkout` and `/admin` | LOW | Prerendered pages cannot carry a nonce (see the 2026-09-29 report). |
