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
