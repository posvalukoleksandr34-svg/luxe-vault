# Test report — audit of 2026-10-12 and remediation rounds of 2026-10-13

All results below were produced in this session. Nothing is estimated. Sections 1–6 are the 2026-10-12 audit; **§R2** is the first 2026-10-13 round; **§R3**, at the end, is the code-only remediation round, run on the final working tree.

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

After the merge and the production deploy of `d8a18cf`, the same workflow was run again (run `38298169074`). It concluded **success**, and the run carries no failure or warning annotations from the checks.

CI on GitHub, after the merge:

- On `af5943b`: migrations, secret scan and dependency audit passed. The typecheck failed on the fresh checkout (generated `next-env.d.ts` missing).
- That failure was reproduced in a clean clone and fixed with `next typegen`.
- On `d8a18cf`: **all four jobs passed**.

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
- **CI** (`ci.yml`) runs unit tests, the build and migration checks, not the end-to-end suites.
- **Out of scope:** load, concurrency at scale and performance (Core Web Vitals) were not measured. A full accessibility audit was not repeated (axe runs inside the Size Finder suite only).
- **Live site:** no production endpoint was exercised directly from this environment (it cannot reach the live domain); live evidence is the workflow result above.

---

# R2 — remediation round, 2026-10-13

Run on the final working tree: `db36302` plus the uncommitted round-2 changes. All results are from 2026-10-13, between 04:00 and 05:00 UTC.

**Four kinds of evidence, kept apart:**

- **Automated:** the repository's own checks; CI runs the same commands.
- **Static:** scans that read code and history without running it.
- **Isolated integration:** the production build against disposable databases and local stand-ins. The harness lives outside the repository.
- **External / manual:** production, dashboards and real providers. **None was done.** See the last table.

**Environment:**

- Node 22.22.2.
- The disposable Postgres cluster is **16.13**. CI's image is `postgres:17`, and the migration and database checks were also run on a local **17.11** container.
- PostgREST 12.2.3.
- Docker images `postgres:17` and `rclone/rclone:1.68.2`.
- Stand-ins for Stripe (honours `Idempotency-Key`), NOWPayments, Supabase Auth and S3 (`rclone serve s3`).

## R2.1 Automated checks (the repository's commands)

Database URLs are disposable local databases. The CI scripts refuse Supabase URLs.

| Check | Command | Exit | Result |
|---|---|---|---|
| Typecheck | `npm run typecheck` | 0 | 0 errors |
| Lint | `npx next lint` | 0 | "No ESLint warnings or errors" |
| Unit and security tests | `npm run test:security` | 0 | **114 tests: 114 pass**, 0 fail, 0 skipped, 0 todo (96 before this round; 18 new in `tests/security/reservations-reconciliation.test.ts`) |
| Migrations, PG 16.13 | `DATABASE_URL=… scripts/ci/verify-migrations.sh` | 0 | **57** applied to an empty database; **31** (0027 onwards) re-applied idempotently; "access rules hold" |
| Database tests, PG 16.13 | `DATABASE_URL=… scripts/ci/db-tests.sh` | 0 | **60 PASS, 0 FAIL**: `rls.sql` 20, `coupons.sql` 21, `reservations.sql` 10, `concurrency.sh` 9 |
| Both, PG 17.11 (CI's image) | the same two scripts against a `postgres:17` container | 0 / 0 | 57 applied, 31 re-applied, access rules hold; **60 PASS, 0 FAIL** |
| Concurrency, repeated | `tests/db/concurrency.sh`, twice more | 0, 0 | 9/9 and 9/9 (3 of 3 runs identical) |
| RLS negative test | a permissive `UPDATE` policy on `orders` for `authenticated`, then `psql -f tests/db/rls.sql` | **3** (expected) | `FAIL a customer cannot mark an order paid: got 1, expected one of {denied,0}`. After dropping the policy: exit 0. |
| Production build | `next build` (placeholder public env only) | 0 | — |

The concurrency races:

| Race | Racers | Result |
|---|---|---|
| Last unit | 2 customers | exactly 1 order, the other `INSUFFICIENT_STOCK`; stock ends at 0, never negative |
| Same order number submitted twice | 2 | created once; stock taken once |
| Release | 2 sweeps releasing the same order | restocked once |
| Single-use code | 4 redemptions | exactly 1 wins; `times_used = 1` |

All racers start together on an advisory lock.

## R2.2 Static checks

| Check | Command | Exit | Result |
|---|---|---|---|
| Secret scan, working tree | gitleaks 8.28.0 `dir --redact` over a copy of every tracked and untracked, non-ignored file | 0 | **0 findings** |
| Secret scan, history | `git fetch --unshallow`, then gitleaks `git --redact` over all **217 commits** | 0 | **0** with `.gitleaksignore`. In a scratch clone without it: **4**, all `generic-api-key` in `scripts/verify-security.mjs` at `6916cd4` and `c6cd794`, the known burned admin credentials (AUD-10). Nothing new. |
| Diff review | `git diff` plus the untracked files, searched for key, token, private-key and e-mail patterns | — | Only synthetic addresses on the reserved `.test` domain (`a@rls.test`, `b@rls.test`). Test-only values are labelled as such (`cron-secret-for-tests`). |
| Dependencies | `npm audit` | 1 | **11**: 3 moderate, 8 high, 0 critical. Unchanged from 2026-10-12; all build tooling (Tailwind 3, `eslint-config-next` and their globbing dependencies). `package.json` and the lockfile are untouched this round. |

## R2.3 Isolated integration: the final build

Production build of the final tree (exit 0), served by `next start` behind the local edge proxy.

| Suite | Mode | Result |
|---|---|---|
| Audit suite, round 1 (AUD-03…AUD-16) | integration | **45 / 45** |
| Audit suite, round 2 (AUD-09, 18, 22, 24, 25) | integration | **31 / 31** |
| Payments (state machine, webhooks, admin session) | integration | **33 / 33** |
| Integration (account deletion, retention, newsletter, …) | integration | **24 / 24** |
| Card-fraud guard | integration | **35 / 35** |
| Referral switch-off (API) | integration | **20 / 20** |
| Security (headers, CSP, CSRF, admin session, tokens) | fake | **47 / 47** |
| Server-side pricing | fake | **17 / 17** |
| 404 status and hydration | fake | **29 / 29** |
| Size Finder (browser, with axe) | fake | **106 / 106** (second attempt; see below) |
| Referral switch-off (browser) | fake | **13 / 13** |
| Status matrix (browser and Googlebot) | fake | 9 real pages 200; **11 / 11** missing pages 404 |
| `noindex` on `/order/*`, `/admin/login`, `/checkout`, `/account` | fake | all four `noindex, nofollow` |

**Round-2 audit suite, by section:**

| Section | Checks |
|---|---|
| Reservation expiry | 18: cron locked (401 ×2); dry run names exactly the lapsed orders and changes nothing; the real run cancels the card order at Stripe first; both lapsed orders released and 2 units back; orders inside the hold, mid-payment, paid, or with the payment processing at Stripe left alone; Stripe unreachable leaves the order to the next run; reason recorded; a second run releases nothing; a payment start stamps `payment_session_at` |
| Coupon scoping | 3: preview and order both 189.00 (10 % of the coat line), not 199.00; a basket without the coat gets `NOT_APPLICABLE` |
| Unavailable product | 1: 409 `OUT_OF_STOCK`, no order |
| Ambiguous refund | 4, with Stripe answering 500: the admin sees "may have gone through"; a second press is blocked and Stripe receives nothing more; every attempt carried one key; no refund recorded |
| Reconciliation | 5: 401 without a session; flags `paid_not_recorded` and `recorded_not_paid`; ignores a matching order; changes nothing |

**Two harness defects, not code defects, found while reading the results:**

- **Size Finder, first attempt.** The batch's in-memory Supabase stand-in came up without `FINDER_FIXTURES=1` in its environment (checked in `/proc/<pid>/environ`). The fixture product `giacca-esaurita` was absent, so the suite crashed at check 61 with a Playwright timeout after 60 passes. The stand-in was restarted with the variable, which was confirmed in its environment and by the product answering. The re-run gave **106 / 106**. The same failure, with the same cause, happened on 2026-10-12.
- **The batch summary's `exit=` values are meaningless.** The line was built as `"$(basename …) exit=$?"`, and the command substitution resets `$?`. The pass/fail counts come from grep and are correct. Every suite's own final line was checked instead ("all passed" or "N passed, 0 failed"). Exit codes quoted elsewhere in this section come from commands that read `$?` first.

## R2.4 Isolated integration: the defects reproduced on the deployed code

The deployed commit `db36302` was extracted with `git archive` into a scratch directory, built (exit 0), and run against the same database and stand-ins.

| Check | On `db36302` | On the final tree |
|---|---|---|
| Round-2 audit suite | **11 pass, 20 fail** | 31 / 31 |
| …reservations | cron route 404; lapsed orders stay `pending`; stock 13 → 13 | released; 13 → 15 |
| …ambiguous refund | "An unknown error occurred"; the second press reached Stripe again (3 → 6 requests) | blocked; 3 → 3 |
| …unavailable product | **201**, order created | 409 |
| …reconciliation | route 404 | report |
| …coupon | `NOT_APPLICABLE`: the old caller sends no lines, so the new function refuses rather than over-discounts. This shows the rollback direction is safe. | 189.00 |

The coupon over-discount itself was reproduced on a fresh database with migrations 0001–0055 from `db36302` plus the test fixture, calling the deployed five-argument `redeem_coupon`:

| Code | Basket | Deployed function | Correct |
|---|---|---|---|
| 10 % off `dbtest-coat` | coat 300 + scarf 99.99 + bag 200 = 599.99 | `ok=t discount=60.00` | 30.00 |
| 25 % off the `dbtest-coats` collection | a bag only, 200 | `ok=t discount=50.00` | `NOT_APPLICABLE` |

`expirable_unpaid_orders` does not exist on that schema.

## R2.5 Isolated integration: backups

Harness: `scripts/backup/backup.sh` and `restore-test.sh` unmodified, run against:

- a synthetic source database (`backup_src`, 120 synthetic orders);
- an age key generated for the test;
- an S3 endpoint served by `rclone serve s3` into a local directory;
- a throwaway `postgres:17` container as the restore target.

All runs 2026-10-13, 04:24–04:30 UTC.

| Case | Exit | Message / result |
|---|---|---|
| Happy path: backup | 0 | three objects uploaded and size-verified: `db/<stamp>.dump.age`, `db/<stamp>.manifest.json`, `code/<stamp>.bundle.age` |
| Happy path: restore test | 0 | "Restore test passed … 38 tables, 359 rows restored, 0 pg_restore errors, 3s". `public.orders` in the target: **120** of 120. Whole run 34 s. |
| No destination | 1 | `BACKUP_BUCKET is not set` |
| Wrong storage credentials | 1 | `Upload of <stamp>.dump.age to the backup bucket failed.`; 0 objects left in the bucket |
| Tampered file (1 byte) | 1 | `The backup does not decrypt with BACKUP_AGE_IDENTITY.` |
| Manifest checksum altered | 1 | `Checksum mismatch: the dump is not the file that was backed up.` |
| Empty database | 1 | `The dump has no public.orders table: wrong database, or a broken dump.`; 0 objects uploaded |
| Media not configured, no `BACKUP_SKIP_MEDIA` | 1 | names the missing settings and the deliberate opt-out; database and code were uploaded first |
| Restore target is a Supabase URL | 1 | `RESTORE_DB_URL looks like a Supabase project. The restore test needs a DISPOSABLE database.` |
| Logs | — | grep of every log for the test storage secret, the age private key and the restore password: 0 matches |

**This proves the scripts, not production.** No production backup exists (AUD-01).

## R2.6 External and manual verification: none performed

| Item | Status |
|---|---|
| Production deploy of this round | Not done: uncommitted by instruction |
| Migrations 0056 / 0057 on production | Not done: needs authorisation |
| Stripe test mode (refunds, reconciliation) | Not done: no keys in this environment |
| Live site | Last checked 2026-10-12 after `db36302` (run `38298169074`, green). This round has not run there. |
| New CI step on GitHub | Not run: nothing pushed. Reproduced locally on PG 17.11 (R2.1). |
| Dashboards, a real backup, legal review | Owner; see MANUAL_ACTIONS_REQUIRED.md |

## R2 limitations

- The end-to-end harness (gateway, stand-ins, suites) is still outside the repository. CI runs the unit tests, build, migration checks and database tests, not the HTTP suites.
- The Stripe stand-in models Stripe's documented behaviour. stripe-node's own retries (same key) were observed against it, not against Stripe.
- No load testing, no Core Web Vitals, no full accessibility re-audit.

---

# R3 — code-only remediation round, 2026-10-13

Run on the final working tree: `db36302` plus rounds 2 and 3, uncommitted. Between 05:30 and 06:45 UTC.

**Environment:**

- The container restarted at 05:36. The disposable Postgres cluster (16.13) was started again from its data directory; nothing else was carried over.
- Postgres 17.11 ran in a throwaway `postgres:17` container, CI's image.
- Same stand-ins as §R2.

**Four kinds of evidence, kept apart:**

- **Automated:** repository commands; CI runs the same ones.
- **Static:** scans.
- **Isolated integration:** the production build against disposable databases and stand-ins. The harness is outside the repository.
- **External:** none performed.

## R3.1 Automated checks (the repository's commands, final tree)

| Check | Command | Exit | Result |
|---|---|---|---|
| Typecheck | `npm run typecheck` | 0 | 0 errors. The first attempt in this round exited 2 because two new tests spread a `Set`; fixed with `Array.from`. |
| Lint | `npx next lint` | 0 | No warnings or errors |
| Unit and security tests | `npm run test:security` | 0 | **133 tests: 133 pass**, 0 fail, 0 skipped, 0 todo. That is 114 before this round plus 19 new. |
| Backup script tests | `tests/backup/run.sh` | 0 | **41 PASS, 0 FAIL** (twice, identical) |
| Migrations, PG 16.13 | `DATABASE_URL=… scripts/ci/verify-migrations.sh` | 0 | **58** applied to an empty database; **32** (0027 onwards) re-applied idempotently; "access rules hold" |
| Database tests, PG 16.13 | `DATABASE_URL=… scripts/ci/db-tests.sh` | 0 | **89 PASS, 0 FAIL**: `rls.sql` 20, `coupons.sql` 21, `reservations.sql` 10, `search.sql` 17, `rate_limits.sql` 9, `concurrency.sh` 12 |
| Both, PG 17.11 | the same two scripts against `postgres:17` | 0 / 0 | 58 applied, 32 re-applied, access rules hold; **89 PASS, 0 FAIL** |
| Rate-limit race, repeated | `tests/db/concurrency.sh` ×3 | 0 ×3 | 5 of 10 allowed, 10 counted, every time |
| Production build | `next build` (placeholder public env only) | 0 | — |
| Browser bundle | `scripts/ci/check-client-bundle.sh` | 0 | "Client bundle clean: 36 server-only variable names and 5 secret shapes checked in 233 files." |

New unit tests (19):

- **Reservation release (9):** every order lands in exactly one list; a database error on one order; a restock that fails twice, then is repaired exactly once; payments in flight; Stripe unreachable or unconfigured; repeated runs; dry run; unmigrated, off and listing failure.
- **Refund ledger race (3):** see AUD-32.
- **Admin authentication (2):** a missing or blank password fails closed, an empty guess is refused; cookie attributes.
- **Edge and IP (3):** a wrong, partial or padded edge secret; no secret configured; X-Forwarded-For / X-Real-IP parsing.
- **Rate-limit subjects (2):** no-address callers share one bucket; a forged CF-Connecting-IP cannot mint buckets.

**Negative tests (each made on purpose, each caught):**

| Planted fault | Result |
|---|---|
| `grant execute on search_products to anon`, then `check-access.sql` | exit 3: `SECURITY DEFINER functions callable by anon/authenticated: search_products`; exit 0 after revoking |
| A client chunk reading `r.env.SUPABASE_SERVICE_ROLE_KEY` | bundle check exit 1 |
| A client chunk reading `e.env["STRIPE_SECRET_KEY"]`, and a `whsec_…` string | both reported, exit 1 |
| A client chunk with only a help text naming `RESEND_API_KEY` | exit 0 (allowed, as intended) |
| A rate-limit test that raised on refusal | showed only 5 increments: the refused requests' increments rolled back. Rewritten so each worker commits its decision, as an HTTP request does. |

## R3.2 Static checks

| Check | Command | Exit | Result |
|---|---|---|---|
| Secret scan, working tree | gitleaks 8.28.0 `dir --redact` over every tracked and untracked, non-ignored file | 0 | 0 findings |
| Secret scan, history | `gitleaks git --redact`, all **217** commits (clone unshallowed) | 0 | 0 with `.gitleaksignore`. Without it, the same 4 known lines (AUD-10). |
| Dependencies | `npm audit` | 1 | **11**: 3 moderate, 8 high, 0 critical. Unchanged. |
| Compatible fixes | `npm audit fix --dry-run` (no `--force`) | 1 | Would change 66 lockfile entries and leave all 11; not applied. `package.json` and `package-lock.json` are byte-identical to `HEAD`. |
| Diff review | see R3.6 | — | — |

## R3.3 Isolated integration: the final build

Built once (exit 0), then each suite in turn. Exit codes are now read from `$?` before anything else (the §R2 defect).

| Suite | Mode | Exit | Result |
|---|---|---|---|
| Audit suite, round 1 (AUD-03…16, including F-05, the refund race) | integration | 0 | **45 / 45** |
| Audit suite, round 2 | integration | 0 | **31 / 31** |
| Audit suite, round 3 (new) | integration | 0 | **19 / 19** |
| Payments | integration | 0 | **33 / 33** |
| Integration | integration | 0 | **24 / 24** |
| Card-fraud guard | integration | 0 | **35 / 35** |
| Referral switch-off (API) | integration | 0 | **20 / 20** |
| Security | fake | 0 | **47 / 47** |
| Pricing | fake | 0 | **17 / 17** |
| 404 and hydration | fake | 0 | **29 / 29** |
| Size Finder (browser, axe) | fake | 0 | **106 / 106** (third attempt; see below) |
| Referral switch-off (browser) | fake | 0 | **13 / 13** |
| Status matrix | fake | 0 | 9 real pages 200; **11 / 11** missing pages 404 |
| `noindex` on 4 private pages | fake | — | all `noindex, nofollow` |
| **Refund race stress** (new) | integration | 0 | **30 / 30, 0 double refunds.** The second press was stopped by the new ledger check 13 times, the claim 8 and the stale-screen check 9. |

**Round-3 suite, by section:**

| Section | Checks |
|---|---|
| Search | 4: `/api/search?q=cappotto` returns results, not degraded; the anon key at PostgREST is refused; the service role with limit 1 000 000 gets ≤ 50 rows; a 9 000-character query is answered |
| Webhook body | 1: a forged signature gets exactly `{"error":"Invalid signature"}` |
| Refund ledger ahead | 3: refused with the explanation; nothing sent to Stripe; allowed once the order catches up |
| Reservation sweep failures | 10, with a temporary trigger in the disposable database. HTTP 500; `failed` and `restockFailed` named; the healthy order released in the same run; one unit back. After recovery: 200, the failed order released, the restock repaired, all three units back exactly once; a third run changes nothing. |
| Repair scope | 1: an order cancelled by hand, never restocked, is not touched |

**Harness defects found and fixed while reading the results:**

- **Size Finder, attempts 1 and 2.** The batch's fixture check printed `FINDER_FIXTURES=0 product=0`.
  - **Cause 1:** the integration gateway also listens on :54321. The fixture backend was started before the gateway was stopped, so it could not bind, and the fake-mode starter launched one without fixtures. This is the same failure as on 2026-10-12 and in §R2; the cause is now known.
  - **Cause 2:** with fixtures in place, the page was still served from `.next/server/route-cache`, cached when the product did not exist. Next.js answered with the stale page and regenerated it in the background.
  - The harness now stops the gateway first and clears the route cache. The third attempt, with fixtures verified in the process environment and by the API, passed **106 / 106**.
- **A stray file from the new backup test.** The first, still-failing version of `tests/backup/run.sh` edited a manifest path that was empty when no backup existed, and so wrote an empty `.tmp` in the repository root (05:49). It was removed. Manifest edits now go through a helper that only writes inside the test's temporary directory and fails the test when there is no manifest. Re-run: 41 / 41 on the final scripts, 27 / 14 on the deployed ones, no stray files.
- **Stress, second run.** Reusing the first run's payment ids hit that run's still-valid 10-minute refund claims: both presses were correctly refused (0 refunds). The run now uses fresh ids each time.

## R3.4 The defects reproduced on the code before the change

| What | Code | Result |
|---|---|---|
| **AUD-32**, refund race: round-1 F-05 | round-2 tree (before the fix), first batch of this round | **40 / 45**: Stripe created 2 refunds, keys `refund:pi_au_paid:0:0:10000` and `refund:pi_au_paid:10000:0:10000` |
| **AUD-32**, stress | the final tree with only the new check removed, built separately | **15 of 30 double refunds** (both presses HTTP 200) |
| AUD-32, AUD-28, AUD-27 (round-3 suite) | deployed `db36302` build | **5 pass, 14 fail**: the webhook returns the SDK's message; a refund goes through while Stripe's ledger is ahead; the reservation route does not exist (404) |
| **AUD-20**, search | fresh database, migrations 0001–0055 from `db36302` | limit 1 000 000 → 60 rows; NULL → 60; −5 → `LIMIT must not be negative`; anon and authenticated can execute; 70 000 words → ~2 s CPU, then `stack depth limit exceeded`. After 0058: 8 ms, 0 rows. |
| AUD-20, `tests/db/search.sql` | same database | stops at the negative limit (`LIMIT must not be negative`) |
| **AUD-23/29**, backup scripts | `scripts/backup/*` from `db36302` with the new tests | **27 pass, 14 fail**: empty, unreadable and orders-less dumps uploaded; a truncated upload accepted; media missing → exit 0; Supabase and pooler restore targets accepted; manifest with no public tables, or without `public.orders`, accepted; unnamed failures |
| **AUD-27** | round-2 code | Established by reading the code: the loop had no per-order error handling, and nothing listed cancelled-but-unrestocked orders. The round-2 code was not kept as a separate build, so no red run is shown. |

## R3.5 External and manual verification: none performed

| Item | Status |
|---|---|
| Commit, push, deploy | Not done: forbidden by the brief |
| Migrations 0056, 0057, 0058 on production | Not done: needs authorisation |
| Stripe test mode | Not run: no keys in this environment |
| New CI steps on GitHub ("Backup script tests", bundle check, the new database tests) | Not run on GitHub: nothing pushed. Reproduced locally with the same commands, and on PG 17. |
| Live site, dashboards, backups in production, legal | Owner; MANUAL_ACTIONS_REQUIRED.md |

## R3.6 Final diff review

- **Changed or new files:** listed in REMEDIATION_LOG.md "Round 3". No file outside the brief's scope (code, tests, migrations, scripts, configuration, CI, docs).
- **`package.json` and `package-lock.json`:** unchanged.
- **Secret-like patterns** searched in the diff and the untracked files: only test-only values labelled as such (`test-only-…` in `tests/backup/run.sh`, `cron-secret-for-tests`), placeholders in comments, and synthetic `.test` / `.invalid` addresses.
- **Migration edits:** no migration already applied to production was changed; 0058 is a new forward migration.

## R3 limitations

- **The end-to-end harness** (gateway, stand-ins, the HTTP and browser suites, the stress test) is outside the repository. CI runs the unit, backup, database and bundle checks, not the HTTP suites.
- **The backup tests use stubs**, so they prove the scripts' logic, not real encryption, upload or restore. Those were proven in isolation in §R2.5 and are proven in production only once the workflows are configured.
- **No load testing**, no Core Web Vitals, and no full accessibility re-audit.
