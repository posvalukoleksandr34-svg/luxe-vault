# Remediation log — audit of 2026-10-12

Branch `claude/admiring-albattani-xgdcm5`, based on `main` at `17eb2c9`. Merged to `main` and deployed to production on 2026-10-12 at the owner's request (`d8a18cf`; Vercel production deploy succeeded).
No migration was added. No secret was read, printed or rotated. No real money
moved: every payment test ran against a local Stripe stand-in.

Each entry: what changed, where, why, how it was verified, and what it means
for the people using the shop.

## Code

### 1. Cancellation follows the payment state machine — AUD-03

- `lib/payment-state.ts`:
  - `hasReceivedMoney()`.
  - `cancellationRefusal()`, the one rule: no money arrived, none in flight, nothing shipped.
  - `cancellationFilter()`, the same rule as a PostgREST filter.
- `lib/server/orders-store.ts` `cancelOrder`: the guard is now `status in (pending, processing)` plus `cancellationFilter()`, inside the UPDATE.
- `app/api/orders/[id]/cancel/route.ts`: refuses with 409 and a specific message for each reason.
- `components/account-orders.tsx` `isUnpaid`: an order whose money arrived (including refunded or partly refunded) is no longer listed as unpaid, so it shows no "Pay now" or "Cancel".
- Verified:
  - Unit tests: 6.
  - End to end: 12 checks, which fail on `17eb2c9` and pass here.
- User-visible: a customer can no longer cancel an order that was paid (even if later refunded) or that has shipped. Unpaid, unshipped orders cancel exactly as before.

### 2. Fail-closed rate limits on guessing surfaces — AUD-04

- `lib/server/rate-limit.ts`:
  - Per-bucket `failClosed`, set on `admin.login`, `auth.recovery`, `order.lookup`, `coupon.validate`, `payment.start` and `support.read`.
  - `temporarilyUnavailable()` answers 503 with `Retry-After: 30`.
  - `failsClosed()` for tests.
- Verified:
  - Unit tests: 3.
  - End to end: 8 checks, with the limiter function removed from the database. They fail on `17eb2c9` and pass here; browsing stays up.
- User-visible: only while the limiter is broken, those six endpoints answer "try again shortly" instead of working without limits.

### 3. Invalid TOTP secret fails closed — AUD-05

- `lib/server/admin-totp.ts`: `secretState()` has three states (off, invalid, ready).
  - An invalid secret keeps the code field on the form.
  - `checkTotp()` throws, so the login route answers 503 and logs why.
- Verified:
  - Unit tests: 3.
  - End to end with an invalid secret: the form asks for a code, the correct password gets 503, and a wrong password gets 401.
- **Before deploying:** confirm that the live sign-in form asks for a 6-digit code (a valid secret), or that `ADMIN_TOTP_SECRET` is not set at all. Otherwise the console will refuse sign-in until the secret is fixed.

### 4. Paid orders cannot be deleted — AUD-06

- `lib/server/orders-store.ts` `deleteOrder`:
  - The delete is guarded with `cancellationFilter()` inside the DELETE.
  - It returns `deleted`, `not_found` or `has_payment`.
  - It selects `payment_status` because PostgREST 12 applies an `or` filter on a mutation to the returned columns.
- `app/api/admin/orders/[id]/route.ts` DELETE answers 409 with a reason.
- `components/admin/orders-manager.tsx`: the toast shows the server's reason.
- Verified: 7 end-to-end checks. PostgREST rejected the first version (a 500), and that was caught by the suite.
- User-visible (staff): orders that took money stay on record; cancel and refund them instead.

### 5. Refunds cannot be paid twice — AUD-07

- `lib/server/stripe.ts`:
  - `refundIdempotencyKey()` builds a key from the payment, both ledgers and the amount.
  - `refundPayment()` claims that state in `stripe_events` (with a 10-minute window) before calling Stripe, passes the same state as Stripe's idempotency key, and releases the claim if Stripe rejects the refund.
  - It takes the order's recorded refund total.
- `lib/server/refund-order.ts` passes `order.refundedAmount`.
- `app/api/admin/orders/[id]/refund/route.ts`: optional `expectedRefunded`; answers 409 when the screen is stale.
- `components/admin/orders-manager.tsx` sends `expectedRefunded`.
- Verified:
  - Unit tests: 2.
  - End to end: 6 checks.
  - The first design, a ledger-only key, passed one run and failed the next, because the second request arrived after the first refund had moved Stripe's ledger. That is why the claim and the stale-screen check were added.
- User-visible (staff): a refund pressed on an out-of-date screen asks for a refresh.

### 6. Staff cancellation of unpaid orders releases them — AUD-11

- `app/api/admin/orders/[id]/route.ts` PATCH, for `cancelled` on an unpaid, unshipped order:
  - the Stripe PaymentIntent is cancelled first (409 if Stripe says it was captured);
  - then `cancelOrder()` runs: stock back, promo use back, payment `expired`.
  - Every other status change is unchanged.
- Verified: 5 end-to-end checks.

### 7. Order line bound — AUD-12

- `lib/server/order-drafts.ts`: `MAX_ORDER_LINES = 50`, the cart's own limit; above it the server answers 400.
- Verified: unit tests (2) and an end-to-end check.

### 8. No Stripe error text in responses — AUD-13

- `app/api/payments/stripe/intent/route.ts`: the response is a generic `STRIPE_UNAVAILABLE`, and the detail is logged.
- Verified: typecheck and build. The checkout already shows its own translated messages.

### 9. Defence in depth on two admin pages — AUD-14

- `app/admin/page.tsx` and `app/admin/newsletter/page.tsx` call `isAdminRequest()` and redirect otherwise.
- Verified: 6 end-to-end checks.

### 10. `noindex` on private pages — AUD-15

- New `app/order/[id]/layout.tsx` and `app/admin/login/layout.tsx`.
- Verified against the production build: both now render `noindex, nofollow`.

## CI/CD and repository

### 11. CI workflow — AUD-08

- New `.github/workflows/ci.yml` with four jobs:
  - typecheck, lint, tests and build;
  - gitleaks over the full history;
  - dependency audit;
  - migrations on an empty Postgres 17, plus the access rules.
- New `scripts/ci/verify-migrations.sh`.
  - It refuses a Supabase URL.
  - It re-applies every migration from 0027 onwards to prove they can be re-run.
- New `scripts/ci/check-access.sql` with 7 rules.
- New `.github/dependabot.yml`.
- New `.gitleaksignore`: the 4 known historical fingerprints only (AUD-10).
- `scripts/verify-security.mjs`: `// gitleaks:allow` on the two lines that hold SHA-256 digests of the burned credentials. Those lines exist to detect reuse.
- `actions/checkout` is pinned to a commit SHA in `security-check.yml`, `offsite-backup.yml` and `backup-restore-test.yml`.
- Verified locally:
  - typecheck, lint and the 96 unit tests;
  - the build;
  - gitleaks (no leaks after the allow-list);
  - the migration script: 55 migrations applied, 29 re-applied, the rules hold, and 3 negative tests are caught.
- First run on `main` (`af5943b`): migrations, secret scan and dependency audit passed; the typecheck failed on a fresh checkout. `next-env.d.ts`, which declares image modules, is generated and git-ignored. Fixed with `npx next typegen` before the typecheck (`d8a18cf`), after reproducing the failure in a clean clone. CI on `d8a18cf`: **all jobs green**.
- Dependabot opened PRs at once, including major npm versions, although the config comment promised otherwise. Fixed: npm majors ignored, minor and patch grouped.

### 12. Backups fail loudly when not configured — AUD-01

- `offsite-backup.yml` and `backup-restore-test.yml`: an unconfigured run ends red with `::error::`, and the existing Telegram alert fires.
- **Consequence after merge:** both workflows turn red, nightly and weekly, until the owner configures them. That is intended.

### 13. One abandoned-cart scheduler — AUD-16

- Removed `.github/workflows/abandoned-cart-reminders.yml`.
- Its Telegram failure step moved into `abandoned-carts-cron.yml`.

### 14. Dependency — AUD-17

- `package-lock.json`: `source-map-js` 1.2.1 → 1.2.2 (GHSA-68fv-2mgg-jv7q), one entry.
- `package.json` is unchanged and the package manager is unchanged.

### 15. Test tooling

- `tests/loader.mjs` resolves `next/server` and `next/cache` (Next ships them without ESM exports).
- New `tests/security/order-integrity.test.ts`, `rate-limit.test.ts` and `admin-totp.test.ts`.

## Not changed (decisions for the owner)

- **AUD-09:** how long an unpaid order may hold stock. This is a business rule.
- **AUD-02:** catalogue and copy, pending legal review.
- **AUD-18:** coupon scoping, latent.
- **AUD-20:** search RPC limit; for the next search migration.
- Next.js, React, Tailwind and ESLint versions: no framework upgrade in this change.


---

# Round 2 — 2026-10-13

On top of `db36302` (`main`, deployed). **Uncommitted**: per the brief, nothing was committed or pushed. Nothing deployed, no production system touched, no secret read or rotated. Every check below ran against disposable databases, local containers and stand-ins.

Each entry gives the finding, the files, the change, the rationale, the tests and their outcome, and the risk that remains.

### R2-1. Reservation expiry for unpaid orders — AUD-09

- **Files:**
  - `supabase/migrations/0056_unpaid_order_reservations.sql` (new);
  - `lib/server/reservations.ts` (new);
  - `app/api/cron/reservations/route.ts` (new);
  - `lib/server/orders-store.ts`: `cancelOrder(…, { notify })` and `markPaymentSessionStarted()`;
  - `app/api/cron/sweep/route.ts`;
  - `.github/workflows/abandoned-carts-cron.yml`;
  - `.env.example`.
- **Change:**
  - Lapsed unpaid orders (48 h hold, 60 min grace after a payment start, 72 h ceiling) are released hourly and nightly.
  - Card PaymentIntents are cancelled at Stripe first.
  - Nothing paid, settling, refunded or shipped is touched.
  - The release goes through the state-machine-guarded `cancelOrder` and the idempotent `restore_order_stock`.
- **Rationale:** stock could be held forever without paying, and orders whose Stripe PaymentIntent was cancelled kept their units too.
- **Tests:**
  - `tests/db/reservations.sql`: 10/10.
  - `tests/db/concurrency.sh`: release race and last-unit race, 9/9 overall.
  - Unit: 4 policy tests and the cron authentication test.
  - Audit suite 2, reservations and payment-start grace: 18/18.
- **Remaining risk:**
  - The 48 h hold is a business choice for the owner.
  - Nothing runs in production until 0056 is applied.
  - The first run cancels every currently lapsed unpaid order, so preview it with `?dry=1`.

### R2-2. Coupon line scoping — AUD-18

- **Files:**
  - `supabase/migrations/0057_coupon_line_scope.sql` (new);
  - `lib/server/coupons.ts` (`lines`, plus a fallback to the old signature);
  - `lib/server/order-drafts.ts`;
  - `app/api/coupons/validate/route.ts`;
  - `lib/store.tsx`.
- **Change:**
  - A restricted code is sized on its eligible lines, which the database prices.
  - `collection_slugs` is now enforced.
  - Any invalid or unverifiable restriction answers `NOT_APPLICABLE`.
- **Rationale:** reproduced on 0015. A 10 % coat code took 60.00 off a 599.99 basket instead of 30.00, and a collection-restricted code applied outside its collection.
- **Tests:**
  - `tests/db/coupons.sql`: 21/21.
  - Concurrency: single use, four racers, exactly one wins.
  - Audit suite 2, §coupons: 3/3.
- **Remaining risk:** there is no admin UI for restrictions, and none is needed for this fix.

### R2-3. Ambiguous refund failures keep their claim — AUD-22

- **Files:** `lib/server/stripe.ts` (`isAmbiguousStripeFailure`; `refundPayment`).
- **Change:** a timeout, a connection error or a Stripe 5xx keeps the per-ledger claim and tells the admin to check Stripe. Definite refusals still release the claim.
- **Rationale:** a retry after a refund that succeeded but went unconfirmed would see a moved ledger, get a new key, and be a second refund.
- **Tests:**
  - Unit: 2.
  - Audit suite 2, §refund: 4/4. With Stripe answering 500, the second press reaches Stripe zero times, and every attempt carried one key.
- **Remaining risk:** not exercised against Stripe test mode.

### R2-4. Payment reconciliation — AUD-24

- **Files:**
  - `lib/payment-reconciliation.ts` (new, pure);
  - `lib/server/reconciliation.ts` (new);
  - `app/api/admin/reconciliation/route.ts` (new, admin only, read-only).
- **Tests:**
  - Unit: 9 scenarios.
  - Audit suite 2, §reconciliation: 5/5.
- **Remaining risk:** never run against the real account (MANUAL_ACTIONS_REQUIRED.md §6).

### R2-5. Truthful backup scripts — AUD-01, AUD-23

- **Files:**
  - `scripts/backup/common.sh` (`upload_verified`);
  - `scripts/backup/backup.sh`;
  - `scripts/backup/restore-test.sh`;
  - `.github/workflows/offsite-backup.yml` (`BACKUP_SKIP_MEDIA`);
  - `docs/security/phase-1-backups.md`.
- **Change:**
  - The dump is validated before upload.
  - Uploads are size-verified.
  - Missing media fails the run unless skipped deliberately.
  - The restore test refuses Supabase targets and empty manifests, and reports its duration.
- **Tests (isolated, real scripts and images):** the happy path (backup, then an isolated restore with 120/120 orders back) plus 7 failure paths, each exit 1 with a specific error (all re-run 2026-10-13 04:24–04:30 UTC). No secret appeared in any log.
- **Remaining risk:** production backups do not exist until the owner configures them.

### R2-6. Unavailable products — AUD-25

- **Files:** `lib/server/order-drafts.ts`, `app/api/orders/route.ts`.
- **Change:** a product tagged `out_of_stock` is refused at repricing, answering 409 `OUT_OF_STOCK`.
- **Tests:** audit suite 2: 1/1.

### R2-7. Security events — AUD-26

- **Files:**
  - `lib/server/security-events.ts` (new);
  - `app/api/admin/login/route.ts`;
  - `lib/server/rate-limit.ts`;
  - both webhooks;
  - the three cron routes;
  - `docs/security/incident-response.md` (new runbook).
- **Tests:** unit 1/1 (JSON shape, no raw IP, a stable hash).
- **Remaining risk:** alerting needs a log drain.

### R2-8. Database tests in CI

- **Files:**
  - `tests/db/_fixture.sql`, `rls.sql`, `coupons.sql`, `reservations.sql`, `concurrency.sh` (new);
  - `scripts/ci/db-tests.sh` (new; refuses Supabase URLs);
  - `.github/workflows/ci.yml` (new step after the migrations).
- **Tests:**
  - 60/60 on a freshly migrated database, on Postgres 16.13 and on 17.11 (CI's `postgres:17` image, run locally).
  - The concurrency script was repeated 3× with stable results.
  - Negative check: a permissive UPDATE policy on `orders` makes `rls.sql` fail.
- **Remaining risk:** the new CI step has not run on GitHub yet, because nothing is pushed. The local run on the same image makes a surprise unlikely, but it is not proof.

### R2-9. Housekeeping

- `.env.example`: documents the reservation settings, and that an invalid `ADMIN_TOTP_SECRET` blocks sign-in.
- `.env.example` and `app/api/cron/abandoned-carts/route.ts`: references to the removed workflow corrected.

# Round 3 — 2026-10-13 (code-only remediation brief)

On top of round 2, in the same working tree. **Uncommitted**: nothing committed, pushed, deployed or migrated; no production system, provider dashboard, real payment or customer notification touched. Every check ran against disposable Postgres databases (16.13 and a 17.11 container), local stand-ins and temporary directories.

Each entry is reproduced on the code before the change wherever a test could show it.

### R3-1. `search_products` bounded and made service-role only — AUD-20

- **Files:**
  - `supabase/migrations/0058_search_products_limits.sql` (new);
  - `scripts/ci/check-access.sql` (allow-list tightened);
  - `scripts/security/verify-production.sql` (reports it until 0058 is applied);
  - `tests/db/search.sql` (new);
  - `scripts/ci/db-tests.sh`.
- **Change:**
  - Limit clamped to 1..50, with NULL meaning 24.
  - Query trimmed and cut to 100 characters.
  - EXECUTE only for `service_role`, which is what `/api/search` uses.
  - Same signature and results for the storefront.
- **Rationale:** reproduced on 0001–0055:
  - unbounded and NULL limits;
  - a negative limit raised an error;
  - `anon` could call it, around the route's rate limit;
  - a 70 000-word query cost ~2 s of CPU, then raised "stack depth limit exceeded".
- **Tests:**
  - `search.sql`: 17.
  - Negative: re-granting to `anon` fails `check-access.sql` (exit 3).
  - End to end (`audit-suite3`): the route still answers, the anon key is refused, and the service role gets at most 50 rows.
- **Remaining risk:** live only after 0058 is applied.

### R3-2. Reservation sweep: per-order isolation, visible failures, restock repair — AUD-27

- **Files:**
  - `lib/server/reservations.ts` (injectable dependencies, `failed`, `restockFailed`, `restockRepaired`);
  - `lib/server/orders-store.ts` (`cancelOrder` reports `restockFailed`; `restoreStock` alerts on failure);
  - `app/api/cron/reservations/route.ts` (HTTP 500 and an alert on database failures);
  - `app/api/cron/sweep/route.ts`;
  - `.github/workflows/abandoned-carts-cron.yml` (error text).
- **Change:**
  - Each order is handled on its own.
  - A failed cancellation is listed and retried.
  - A cancelled-but-not-restocked order, from this sweep only, is restocked on the next run.
  - `restore_order_stock` is idempotent.
- **Rationale:** one database error stopped the whole run, and a failed restock lost units silently and permanently.
- **Tests:**
  - Unit: 9.
  - End to end (`audit-suite3`): faults injected with a temporary trigger. HTTP 500 names them; after recovery, everything is released and repaired exactly once.
- **Remaining risk:** a failed restock after a customer or console cancellation is alerted, not auto-repaired.

### R3-3. Refunds: no second refund while Stripe's ledger is ahead of the order — AUD-32

- **Files:** `lib/server/stripe.ts` (`stripeLedgerAhead`, check in `refundPayment`).
- **Change:** a refund is refused while Stripe shows more refunded than the order records.
- **Rationale:** the round-1 suite's F-05 reproduced a double refund on the round-2 code: two keys, `…:0:0:10000` and `…:10000:0:10000`.
- **Tests:**
  - Unit: 3.
  - End to end: deterministic (`audit-suite3`), plus F-05 re-run on the final build.
- **Remaining risk:** see AUD-32 (conversion tolerance); not run against Stripe test mode.

### R3-4. Generic webhook error bodies — AUD-28

- **Files:** `app/api/payments/stripe/webhook/route.ts`.
- **Change:** the 400 and 500 bodies are generic; the detail stays in the log and the alert. Status codes are unchanged.
- **Tests:** end to end, exact body `{"error":"Invalid signature"}`; payments suite unchanged.

### R3-5. Backup scripts tested in the repository — AUD-29 (and AUD-23 evidence)

- **Files:**
  - `tests/backup/run.sh`, `tests/backup/stubs/docker`, `tests/backup/stubs/age` (new);
  - `scripts/backup/restore-test.sh` (named failures: listing, download, invalid manifest JSON);
  - `.github/workflows/ci.yml` ("Backup script tests").
- **Tests:** 41, stable over repeated runs. On the deployed scripts (`db36302`) 14 of them fail.
- **Remaining risk:** the stubs neither encrypt nor upload; production backups still do not exist (AUD-01).

### R3-6. Browser bundle checked for server-only code and secrets — AUD-30

- **Files:** `scripts/ci/check-client-bundle.sh` (new), `.github/workflows/ci.yml`.
- **Tests:**
  - Clean on the final build.
  - Planted reads of `SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY`, and a `whsec_` string, each fail it.
  - An admin help text that names a variable does not.

### R3-7. Rate limiting and authentication: tests for what already held

- **Files:**
  - `tests/db/rate_limits.sql` (new: thresholds, retry-after, independent subjects and buckets, window reset, zero window, no browser access);
  - `tests/db/concurrency.sh` (10 simultaneous requests against a limit of 5 → exactly 5 allowed, 10 counted);
  - `tests/security/edge-lock.test.ts` and `rate-limit.test.ts` (forged, partial or padded edge secrets cannot mint buckets; X-Forwarded-For parsing; callers with no address share a bucket);
  - `tests/security/admin-session.test.ts` (missing or blank password fails closed; cookie attributes);
  - `lib/server/admin-auth.ts` (`adminSessionCookieOptions`, one definition of the cookie);
  - `app/api/admin/login/route.ts`.
- **Rationale:** these behaviours were correct but unpinned by tests.
- **Remaining risk:** the admin model itself (AUD-31) is unchanged by design.

### R3-8. Checked and not changed

- **`npm audit fix` (non-force), dry run:** 66 lockfile changes, 0 of the 11 advisories fixed, so not applied (AUD-17).
- **Workflows:**
  - all actions pinned to SHAs;
  - least-privilege `permissions`;
  - no `pull_request_target`;
  - backup secrets only in the `backups` environment.
- **Admin password:** compared as constant-time SHA-256 digests of an environment value, rate-limited and failing closed. A slow hash would add nothing without a stored hash (AUD-31).
- **API limits:** every user-controlled `limit`/`days`/`ids` parameter found is clamped server-side (notifications 1–100, reconciliation 1–90 days, lookup 50 ids, returns 1–500).
