# Test report — audit of 2026-10-12

All results below were produced in this session. Nothing is estimated.

## Environment

- Node 22.22.2, npm, the repository's own lockfile (`npm ci`-equivalent tree).
- Production build: `next build` with placeholder public env only (`NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321`, a dummy anon key), served by `next start` behind a local edge proxy that adds the origin-lock header.
- **Integration mode:** Postgres 16 with all 55 migrations, PostgREST 12.2.3, a small gateway standing in for Supabase's `/auth/v1` (JWTs signed with a local test secret). Stripe and NOWPayments replaced by local stand-ins (the Stripe one honours `Idempotency-Key` like the real API).
- **Fake mode:** an in-memory Supabase stand-in with a fixed catalogue, for the browser suites.
- Playwright with the pre-installed Chromium for browser suites.
- No production system, real account or real key was used. The harness lives outside the repository (as in earlier audits); the unit tests and CI scripts are in it.

## 1. Static checks

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | pass, 0 errors |
| Lint | `npx next lint` | pass, no warnings or errors |
| Unit / security tests | `npm run test:security` | **96 / 96 pass** (80 before this change, 16 new) |
| Production build | `next build` | pass (exit 0) |
| Secret scan, history | gitleaks 8.28.0 (SHA-256 verified), `gitleaks git` over 211 commits | 4 findings before the allow-list, all the known burned credentials (AUD-10); **0** after `.gitleaksignore` |
| Secret scan, working tree | `gitleaks dir` on tracked + untracked files | 2 findings (SHA-256 digests of the burned credentials, kept to detect reuse) → **0** after `gitleaks:allow` |
| Dependencies | `npm audit` | before: 12 (3 moderate, 9 high, 0 critical); after: **11** (3 moderate, 8 high, 0 critical) — all build-time tooling |

New unit tests:

- `tests/security/order-integrity.test.ts` (10):
  - the cancellation rule across every payment and fulfilment status;
  - filter ↔ rule equivalence;
  - `hasReceivedMoney`;
  - order line bound (50 accepted, 51 refused);
  - refund idempotency keys.
- `tests/security/rate-limit.test.ts` (3): the six fail-closed buckets answer 503 with Retry-After; four volume buckets stay open; account-keyed limits behave the same.
- `tests/security/admin-totp.test.ts` (3): off, invalid (form asks, sign-in throws) and valid.

## 2. Migrations on an empty database

`scripts/ci/verify-migrations.sh` against a fresh database (Postgres 16 locally; CI uses 17):

- 55 / 55 migrations applied in order, with Supabase's default grants emulated.
- 29 / 29 migrations from 0027 re-applied without error.
  - 0005 and 0026 are not re-runnable on top of the full set (AUD-19).
- `scripts/ci/check-access.sql`: all 7 rules hold.
- Negative tests, each made on purpose and each caught:
  - RLS disabled on `coupons` → `RLS is off on: coupons`;
  - `EXECUTE` on `place_order` granted to `anon` → `SECURITY DEFINER functions callable by anon/authenticated: place_order`;
  - an UPDATE policy on `orders` for `authenticated` → `Browser-role write policies on server-owned tables: orders:UPDATE`.

## 3. Database access probes

Run with `set role authenticated` (and `anon`), `request.jwt.claim.sub` set to a test user:

| Probe | Result |
|---|---|
| Own profile: set `stripe_customer_id` | refused: `stripe_customer_id is not user-writable` |
| Own profile: set `welcome_sent_at` | refused: `welcome_sent_at is not user-writable` |
| Another user's profile: update | 0 rows |
| Insert an order | refused by RLS |
| Insert an approved review | permission denied |
| Insert a notification for another user | refused by RLS |
| Update own notification's title | permission denied (only `is_read` is writable) |
| RPC `place_order`, `redeem_coupon`, `restore_order_stock` | permission denied |
| Insert an address for another user / move own address to another user | refused by RLS |
| Update `products`, `store_settings`; delete own orders | 0 rows |
| Read `coupons` (one seeded row), `stripe_events`, `rate_limits`, `newsletter_subscribers`, `support_tickets`, `abandoned_carts` as anon and as authenticated | 0 rows |
| Read `admin_sessions`, `admin_totp_steps`, `payment_blocks`, `order_payment_risk` as anon and as authenticated | permission denied |
| Read `orders`, `profiles` as anon | 0 rows |

## 4. End-to-end: the fixes, before and after

Suite: 44 checks over HTTP against the production build, in integration mode.

| Build | Result |
|---|---|
| `17eb2c9` (unmodified `main`) | **21 pass, 23 fail** — every bug reproduced |
| This branch | see §6 (final run) |

What failed on `17eb2c9`, by finding:

- **AUD-03:**
  - A delivered crypto order refunded by IPN → cancel **200**, row `cancelled/expired/restocked`, shelf 5 → 6.
  - Partly refunded → 200.
  - Refunded → 200.
  - Unpaid but shipped → 200.
- **AUD-06:** `DELETE` of paid, partially refunded, refunded and confirming orders → 200 each.
- **AUD-11:** staff "cancelled" on an unpaid order → payment still `pending_payment`, not restocked, PaymentIntent not cancelled.
- **AUD-07:** two simultaneous refunds → two Stripe refunds, each with a random `stripe-node-retry-…` key.
- **AUD-12:** 51 lines → passed validation (stopped later by stock, 409).
- **AUD-04:**
  - Limiter down → admin login 401 (a free guess).
  - Order lookup 200.
  - Coupon validation 200.
  - Card payment start reached the order check.

During development, the suite also caught two defects in the first versions of the fixes, before anything was committed:

- PostgREST 12 rejected the guarded DELETE with `column orders.payment_status does not exist` (an `or` filter on a mutation must name a returned column).
- A ledger-only refund key let a second request through once it arrived after the first refund had reached Stripe's ledger.

Both were fixed, and the suite re-run.

Additional end-to-end check, with an invalid `ADMIN_TOTP_SECRET` (AUD-05):

- `GET /api/admin/login` → `{"mfa":true}`;
- correct password, no code → **503**;
- correct password, any code → **503**;
- wrong password → 401;
- the server log names the cause.

On `17eb2c9`, the same secret would read as "not configured" and the correct password alone would sign in. That is established from the code (`secret()` returned null for both cases), not run.

## 5. Live site

The repository's "Security check (live)" workflow (`scripts/security/check-live.sh`), run on `main` on 2026-10-12 at 15:36 UTC, concluded **success**. The script exits with the number of failed checks, so 0 checks failed. Its log could not be fetched from this environment, so any warnings it printed are unknown.

It covers:

- origin lock (direct, forged Host, guessed secret, admin login, image optimiser);
- security headers;
- admin API without a session, with a forged cookie, and with the middleware-bypass header;
- both webhooks without or with forged signatures;
- cross-site POST;
- guessed order-lookup token;
- image optimiser allow-list.

GitHub Actions history (API, 2026-10-12):

- "Offsite backup" and "Backup restore test" concluded success while their backup and restore steps were **skipped** on every listed run (AUD-01).
- Both abandoned-cart workflows ran hourly (AUD-16).

## 6. Final run — every suite on the final build

Production build of the final code (exit 0), then each suite in turn on that build.

| Suite | Mode | Result |
|---|---|---|
| Audit suite (§4) | integration | **45 / 45** |
| Payments (state machine, webhooks, admin session) | integration | **33 / 33** |
| Integration (account deletion, retention, newsletter, …) | integration | **24 / 24** |
| Card-fraud guard | integration | **35 / 35** |
| Referral / app-code switch-off (API) | integration | **20 / 20** |
| Security (headers, CSP, CSRF, admin session lifecycle, tokens) | fake | **47 / 47** |
| Server-side pricing | fake | **17 / 17** |
| 404 status and hydration | fake | **29 / 29** |
| Size Finder (browser, incl. axe) | fake | **106 / 106** |
| Referral / app-code switch-off (browser) | fake | **13 / 13** |
| Status matrix (browser and Googlebot) | fake | every missing page **404** (11 / 11) |
| `noindex` on `/order/*`, `/admin/login`, `/checkout`, `/account` | fake | all four `noindex, nofollow` |

Two runs needed a second attempt because of the harness, not the code:

- **The security suite (first attempt, before this run).** The in-memory Supabase answered `null` to every RPC, including the rate limiter's. The fail-closed buckets correctly answered 503, so admin login could not proceed. The stand-in now answers the limiter like the real function.
- **The Size Finder suite (first attempt of this run).** The test-fixture backend failed to restart (its port was still held), so a fixture product was missing and the suite stopped at check 60. Restarted properly: 106 / 106. One check in that first attempt also read a circle's colour mid-transition; it passed on the re-run and in the earlier runs.

## Limitations

- **Stripe:** a local stand-in, not Stripe test mode (no test keys in this environment). Idempotency semantics were modelled on Stripe's documented behaviour.
- **The end-to-end harness** (gateway, stand-ins, suites) is not in the repository. Recommended next: a `docker compose` integration harness in CI. Until then CI runs the unit tests, the build and the migration checks only.
- **CI** (`ci.yml`) has been validated locally step by step, but **has not yet run on GitHub**.
- **Out of scope:** load, concurrency at scale and performance (Core Web Vitals) were not measured. A full accessibility audit was not repeated (axe runs inside the Size Finder suite only).
- **Live site:** no production endpoint was exercised directly from this environment (it cannot reach the live domain); live evidence is the workflow result above.
