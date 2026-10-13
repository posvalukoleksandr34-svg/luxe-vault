# Findings — audit of 2026-10-12, remediation rounds 2026-10-13 (2 and 3)

Every finding below was confirmed against the code, a disposable database or
the GitHub Actions history. None is copied from an earlier report without
being re-checked; the 2026-10-13 round re-ran every earlier check before
changing anything (TEST_REPORT.md). Earlier audits (`docs/security/*`,
`docs/compliance/audit-2026-10-04.md`) remain valid; where one of their open
items is still open it is listed again with today's evidence.

**Priority:** P0 drop everything · P1 before next release · P2 this month · P3 backlog.
**Severity:** Critical · High · Medium · Low · Informational.
**Status:**

- **FIXED AND VERIFIED:** the behaviour was reproduced, changed, and shown fixed by tests. "Isolated" means a local production build against a disposable Postgres and stand-ins for Stripe and NOWPayments, not production.
- **FIXED, VERIFICATION BLOCKED.**
- **PARTIALLY FIXED.**
- **NOT FIXED.**
- **NOT APPLICABLE.**
- **REQUIRES EXTERNAL ACCESS:** a dashboard, a production secret, a migration to apply, or a lawyer.

**Production:** the 2026-10-12 fixes (AUD-03 to AUD-17) are deployed (`d8a18cf`/`db36302`). The 2026-10-13 fixes (round 2: AUD-09, 18, 22–26; round 3: AUD-20, 27–32) are in the working tree of the branch, uncommitted, awaiting approval. Nothing from either round has run in production.

## Summary

| ID | P | Severity | Title | Status |
|---|---|---|---|---|
| [AUD-01](#aud-01) | P1 | High | Offsite backups never ran; the workflows reported "success" every night | PARTIALLY FIXED: scripts verified end to end in isolation; production backups REQUIRE EXTERNAL ACCESS |
| [AUD-02](#aud-02) | P1 | Critical (legal) | Sale of replica / designer-inspired goods: trade-mark and payment-provider exposure | REQUIRES EXTERNAL ACCESS (legal) |
| [AUD-03](#aud-03) | P2 | Medium | Customer could cancel a refunded or partly refunded order, or one already shipped | FIXED AND VERIFIED (isolated; deployed) |
| [AUD-04](#aud-04) | P2 | Medium | Rate limiter failed open on the password, token and payment endpoints | FIXED AND VERIFIED (isolated; deployed) |
| [AUD-05](#aud-05) | P2 | Medium | A set-but-invalid `ADMIN_TOTP_SECRET` silently turned admin MFA off | FIXED AND VERIFIED (isolated; deployed) |
| [AUD-06](#aud-06) | P2 | Medium | Admin could permanently delete paid and refunded orders | FIXED AND VERIFIED (isolated; deployed) |
| [AUD-07](#aud-07) | P2 | Medium | A refund asked for twice (two tabs, two staff) was paid twice | PARTIALLY FIXED in production (a race window remained: AUD-32); complete in the working tree |
| [AUD-08](#aud-08) | P2 | Medium | No CI on pull requests or main; actions pinned by tag | FIXED AND VERIFIED (green on `main`); required checks REQUIRE EXTERNAL ACCESS |
| [AUD-09](#aud-09) | P2 | Medium | Unpaid orders hold stock indefinitely (inventory can be reserved without paying) | FIXED AND VERIFIED (isolated); live once migration 0056 is applied |
| [AUD-10](#aud-10) | P2 | Medium | Burned admin credentials in git history; rotation not confirmed | REQUIRES EXTERNAL ACCESS |
| [AUD-11](#aud-11) | P3 | Low | Admin "cancelled" on an unpaid order kept its units reserved and its PaymentIntent open | FIXED AND VERIFIED (isolated; deployed) |
| [AUD-12](#aud-12) | P3 | Low | No server-side bound on lines per order | FIXED AND VERIFIED (isolated; deployed) |
| [AUD-13](#aud-13) | P3 | Low | Card-payment route returned Stripe's raw error text to the browser | FIXED AND VERIFIED (isolated; deployed) |
| [AUD-14](#aud-14) | P3 | Low | Admin dashboard and newsletter pages relied on the middleware alone | FIXED AND VERIFIED (isolated; deployed) |
| [AUD-15](#aud-15) | P3 | Low | Order-tracking and admin sign-in pages told search engines "index, follow" | FIXED AND VERIFIED (isolated; deployed) |
| [AUD-16](#aud-16) | P3 | Low | Two workflows called the abandoned-cart cron every hour | FIXED AND VERIFIED (isolated; deployed) |
| [AUD-17](#aud-17) | P3 | Low | Dependency advisories (build tooling) | PARTIALLY FIXED (1 of 12; the other 11 need major upgrades — re-checked 2026-10-13) |
| [AUD-18](#aud-18) | P2 | Medium | Product-scoped coupons discount the whole basket; collection scoping ignored | FIXED AND VERIFIED (isolated); live once migration 0057 is applied |
| [AUD-19](#aud-19) | P3 | Informational | Migrations 0005 and 0026 cannot be re-run on top of the full set | NOT FIXED (documented; CI checks 0027+) |
| [AUD-20](#aud-20) | P2 | Medium | `search_products` callable with the public key, unbounded: a 210 000-character query cost ~2 s of CPU per call | FIXED AND VERIFIED (isolated); live once migration 0058 is applied |
| [AUD-21](#aud-21) | P3 | Informational | External configuration this audit could not see | REQUIRES EXTERNAL ACCESS |
| [AUD-22](#aud-22) | P2 | Medium | A refund whose outcome Stripe did not confirm could be issued again | FIXED AND VERIFIED (isolated) |
| [AUD-23](#aud-23) | P2 | Medium | Backup scripts could report or accept a backup that was not whole | FIXED AND VERIFIED (isolated) |
| [AUD-24](#aud-24) | P3 | Low | No reconciliation between Stripe and the orders | FIXED AND VERIFIED (isolated; not run against real Stripe) |
| [AUD-25](#aud-25) | P3 | Low | A product marked unavailable (without stock tracking) could be bought by a crafted request | FIXED AND VERIFIED (isolated) |
| [AUD-26](#aud-26) | P3 | Low | Security-relevant events left no searchable trace | FIXED AND VERIFIED (unit) |
| [AUD-27](#aud-27) | P2 | Medium | Reservation sweep: one database error stopped the run, and a failed restock was never retried (units lost silently) | FIXED AND VERIFIED (unit; isolated end to end) |
| [AUD-28](#aud-28) | P3 | Low | Stripe webhook error responses carried internal error text | FIXED AND VERIFIED (isolated) |
| [AUD-29](#aud-29) | P3 | Low | Backup scripts had no tests in the repository; restore failures were not named | FIXED AND VERIFIED (41 tests in CI; 14 fail on the deployed scripts) |
| [AUD-30](#aud-30) | P3 | Low | Nothing stopped server-only code or a secret from reaching the browser bundle | FIXED AND VERIFIED (CI check, with a negative test) |
| [AUD-31](#aud-31) | P3 | Low | Admin access is one shared password; the second factor is optional when unset | NOT FIXED (design; documented) — TOTP REQUIRES EXTERNAL CONFIGURATION |
| [AUD-32](#aud-32) | P2 | Medium | Two refund presses racing could still both be paid (a window left by AUD-07) | FIXED AND VERIFIED (unit; isolated end to end) |

Verified as holding (no finding): see [What holds](#what-holds) at the end.

---

## AUD-01

**Offsite backups never ran; the workflows reported "success" every night**

| | |
|---|---|
| Priority / severity | P1 · High |
| Component | GitHub Actions `offsite-backup.yml`, `backup-restore-test.yml`; `scripts/backup/*` |
| Evidence | Latest runs on `main` (GitHub API, 2026-10-12): Offsite backup run `38231772561` concluded **success** with the *Back up* step **skipped**; Backup restore test run `38254657685` concluded **success** with *Restore and verify* **skipped**. The same on every listed run, 2026-09-28 → 2026-10-12. |
| Impact | No offsite copy of the database, Storage media or repository exists, and no restore has ever been tested, while the Actions tab showed green. |
| Root cause | An unconfigured run only printed `::warning::` and skipped the rest. |
| Remediation | 2026-10-12: an unconfigured run ends red and alerts (deployed). 2026-10-13: the scripts themselves were hardened and proven (AUD-23). **Still required, by the owner:** the bucket, keys and `backups` environment (`docs/security/phase-1-backups.md`), then one manual run of each workflow (MANUAL_ACTIONS_REQUIRED.md §2). |
| Tests | Isolated, on the real scripts and images: backup of a synthetic database → encrypted upload to a local S3 endpoint (rclone `serve s3`) → size-verified → restore into a throwaway Postgres 17 → all 38 tables, 120/120 synthetic orders back; plus seven failure cases (AUD-23). |
| Verification | Scripts: FIXED AND VERIFIED (isolated). Production backups: REQUIRES EXTERNAL ACCESS — none exist yet. **No claim is made that production is backed up.** |

## AUD-02

**Sale of replica / designer-inspired goods: trade-mark and payment-provider exposure**

| | |
|---|---|
| Priority / severity | P1 · Critical (legal / commercial, not a code defect) |
| Component | Catalogue, copy, payment providers |
| Evidence | `lib/ui-strings.ts:587, 977-980, 1162-1166, 1179` (store and product copy: "Premium replica apparel & accessories", replica badge, authenticity notes); `lib/content/home.ts:28`; product `brand` field shows third-party designer names (`components/products/product-detail.tsx:565-586`). Already raised as CRITICAL in `docs/compliance/audit-2026-10-04.md` §0; still open. |
| Impact | Disclosing "replica" does not make the sale lawful: selling goods that imitate protected marks or designs can infringe trade-mark and design rights and customs rules in Switzerland and the EU, whatever the label says. Separately, Stripe's restricted-business terms exclude counterfeit or IP-infringing goods; if Stripe considers the catalogue in scope it can close the account and hold funds. NOWPayments' terms should be checked the same way. |
| Root cause | Business model. |
| Remediation | IP lawyer review of the catalogue, the brand field, product names and imagery **before further sales**; written confirmation from Stripe (and NOWPayments) that the catalogue is acceptable. This audit made no change to the catalogue or copy. |
| Tests | — |
| Verification | NEEDS LEGAL. Not a legal opinion. |

## AUD-03

**Customer could cancel a refunded or partly refunded order, or one already shipped**

| | |
|---|---|
| Priority / severity | P2 · Medium |
| Component | Orders — customer self-service |
| Files | `lib/server/orders-store.ts` `cancelOrder` (was: `.neq('status','cancelled').neq('payment_status','paid')`), `app/api/orders/[id]/cancel/route.ts` (was: refused only `paid` and `confirming`), `components/account-orders.tsx` `isUnpaid` (was: `paymentStatus !== 'paid'`) |
| Evidence | Reproduced on the unmodified build (`17eb2c9`) against Postgres + PostgREST: a delivered crypto order whose payment NOWPayments reported `refunded` → `POST /api/orders/…/cancel` **200**; the row became `cancelled / expired / restocked`; the shelf went **5 → 6** (a delivered unit back on sale). Same for `partially_refunded` (200) and for an unpaid order already `shipped` (200). The account page listed such orders as **unpaid**, with "Pay now" and "Cancel". |
| Impact | Inventory inflated by units that left the warehouse, so the next customer can buy stock that does not exist. The order's payment record rewritten from "refunded / partly refunded" to "expired" (for a partial refund the shop still holds money the record no longer shows). The promo-code use returned. Card orders were protected by accident: Stripe refuses to cancel a captured PaymentIntent. |
| Root cause | The cancel path did not use the payment state machine (`lib/payment-state.ts`) that every other payment write uses; "unpaid" was defined as "not exactly `paid`". |
| Remediation | One rule, `cancellationRefusal()` in `lib/payment-state.ts`: cancellable only when no money arrived (`null / pending_payment / failed / expired`), none is in flight (not `confirming`) and nothing shipped (`pending / processing`). The route answers 409 otherwise; `cancelOrder` enforces the same rule **inside its UPDATE** (`cancellationFilter()`), so a webhook landing in between cannot be overwritten. `isUnpaid` now uses `hasReceivedMoney()`. |
| Tests | `tests/security/order-integrity.test.ts` (6 cases, incl. filter ↔ rule equivalence). End to end: 12 checks (audit suite §F-01) — fail on `17eb2c9`, pass on this branch. |
| Verification | FIXED · VERIFIED in the local harness. |

## AUD-04

**Rate limiter failed open on the password, token and payment endpoints**

| | |
|---|---|
| Priority / severity | P2 · Medium |
| Component | `lib/server/rate-limit.ts` |
| Evidence | `checkLimit` caught every limiter error and returned `allowed: true` for every bucket. Reproduced on `17eb2c9` with `check_rate_limit` made unavailable: admin login answered **401** (a free password guess, unthrottled), order lookup **200**, coupon validation **200**, card payment start reached the order check. |
| Impact | Whenever the limiter cannot be consulted (function missing, PostgREST schema cache stale, the RPC failing on its own), the admin password, the order-lookup tokens, coupon codes and card numbers (card testing through `payment.start`) can be guessed at full speed. |
| Root cause | A deliberate, global fail-open policy, sensible for browsing but not for credential and payment surfaces. |
| Remediation | Per-bucket `failClosed`: `admin.login`, `auth.recovery`, `order.lookup`, `coupon.validate`, `payment.start`, `support.read` answer **503 + Retry-After: 30** while the limiter is down. Browsing and checkout volume controls (`search`, `cart.validate`, `order.create`, …) stay fail-open, as before. Each fail-closed endpoint depends on the same database, so when the database is down it could not have succeeded anyway. |
| Tests | `tests/security/rate-limit.test.ts` (3). End to end: 8 checks (audit suite, limiter section). |
| Verification | FIXED · VERIFIED locally. |

## AUD-05

**A set-but-invalid `ADMIN_TOTP_SECRET` silently turned admin MFA off**

| | |
|---|---|
| Priority / severity | P2 · Medium |
| Component | `lib/server/admin-totp.ts` |
| Evidence | `secret()` returned `null` both for "not set" and for a value that is not base32 or shorter than 80 bits; `isTotpConfigured()` was then `false` and `checkTotp()` answered `'unconfigured'`, so the login route signed in on the password alone. A typo (a `0` for an `O`, a pasted `otpauth://` URL) disabled the second factor without any sign in the UI. |
| Impact | The owner believes the console has MFA when it does not. |
| Remediation | Three states: off / invalid / ready. **Invalid fails closed:** the form still asks for a code and sign-in answers **503**, with the reason in the server log, until the secret is fixed or removed. |
| Tests | `tests/security/admin-totp.test.ts` (3). End to end with an invalid secret: GET → `mfa: true`; correct password → **503**; wrong password → 401. |
| Verification | FIXED · VERIFIED locally. **Deployment caveat:** if production currently has an *invalid* `ADMIN_TOTP_SECRET`, admin sign-in will answer 503 after this deploy until it is corrected (`scripts/admin-totp-setup.mjs`). Deployed 2026-10-12: sign in once to confirm. "Вход временно недоступен" means the secret is invalid. |

## AUD-06

**Admin could permanently delete paid and refunded orders**

| | |
|---|---|
| Priority / severity | P2 · Medium |
| Component | `DELETE /api/admin/orders/[id]`, `lib/server/orders-store.ts` `deleteOrder` |
| Evidence | Reproduced on `17eb2c9`: `DELETE` on `paid`, `partially_refunded`, `refunded` and `confirming` orders → **200**, rows gone. |
| Impact | Destroys the record of a payment: bookkeeping that must be retained, the row later refund / dispute / early-fraud-warning webhooks look the payment up by (they then report "matched no order"), and what Stripe is reconciled against. One click, no undo. |
| Remediation | Delete only orders where no money arrived and none is in flight — enforced inside the DELETE. Otherwise **409** with "cancel and refund instead"; the admin toast shows the server's reason. Unpaid and test orders can still be deleted. |
| Tests | End to end: 7 checks (audit suite §F-04). |
| Verification | FIXED · VERIFIED locally. Behaviour change for staff: paid test orders can no longer be deleted from the console. |

## AUD-07

**A refund asked for twice was paid twice**

| | |
|---|---|
| Priority / severity | P2 · Medium |
| Component | `lib/server/stripe.ts` `refundPayment`, `POST /api/admin/orders/[id]/refund`, `components/admin/orders-manager.tsx` |
| Evidence | `stripe.refunds.create` was called without an idempotency key of the shop's own (stripe-node adds a random one per request, for its network retries only) and nothing serialized refunds of one payment. Reproduced on `17eb2c9` with two simultaneous identical `POST …/refund {amount: 100}` — two tabs, two members of staff: **two** Stripe refunds (`re_fake_1`, `re_fake_2`). Stripe's own "not more than the remainder" check does not stop two partial refunds that both fit. Within one tab the button is disabled while a refund runs, so a plain double-click was already covered. |
| Impact | Money paid out twice. |
| Root cause | No idempotency and no concurrency control on the one route where money leaves. |
| Remediation | Three layers. (1) **One refund per ledger state:** the first request claims `refund:<payment>:<Stripe's refunded total>:<our recorded total>:<amount>` (plus a 10-minute window, so a claim left by a crash cannot block the order for good) in the existing `stripe_events` ledger; a concurrent duplicate is told a refund is already under way. (2) The same state is the **Stripe idempotency key**, so two requests that both got past (1) still produce one refund. (3) **Stale screen:** the console sends the refunded total it is showing (`expectedRefunded`); the route answers 409 when the order has moved on, so a second tab cannot repeat a refund that already happened. A deliberate further refund, on a fresh screen, is a new state and goes through. A claim is released when Stripe rejects the refund. |
| Tests | Unit (2). End to end (§F-05): simultaneous pair → one Stripe refund, the other told it is under way (or handed the same refund); key deterministic; CHF 100 recorded once; stale screen → 409 and no refund; deliberate second → new refund, CHF 200 recorded. |
| Verification | FIXED · VERIFIED against a Stripe stand-in that honours `Idempotency-Key` like the real API. Not exercised against Stripe test mode (no keys in this environment). Stripe keeps a key's outcome for 24 h: an identical retry of a refund Stripe *rejected* gets the same error within that time — change the amount or wait. **2026-10-13: incomplete** — two presses can interleave so that neither defence applies (AUD-32, fixed in the working tree). |

## AUD-08

**No CI on pull requests or main; actions pinned by tag**

| | |
|---|---|
| Priority / severity | P2 · Medium (open since `docs/security/README.md` F6) |
| Evidence | `.github/workflows/` had only scheduled jobs; nothing ran typecheck, lint, tests, build, a secret scan, a dependency audit or the migrations on a change. `actions/checkout@v4` by tag in three workflows. |
| Remediation | `.github/workflows/ci.yml`: typecheck, lint, unit/security tests, production build with placeholder public env only; gitleaks over the full history (binary pinned by version **and** SHA-256); `npm audit` (blocks on critical, reports high); every migration applied to an empty Postgres 17 plus `scripts/ci/check-access.sql` (RLS on every table, `search_path` on every SECURITY DEFINER function, no browser-callable definer function outside a reviewed allow-list, no policy on server-only tables, no browser write policy on orders/stock/catalogue, no RLS-bypassing view, private buckets private). All `uses:` pinned to commit SHAs; `permissions: contents: read`; `.github/dependabot.yml` keeps pins and npm patches current. `.gitleaksignore` lists the four known historical fingerprints (AUD-10) by fingerprint only. |
| Tests | Locally: typecheck, lint, 96 unit tests, build, gitleaks (history + tree: no leaks), migration script on an empty database (55 applied, 29 re-applied, rules hold) and three negative tests (RLS off, `place_order` granted to anon, an UPDATE policy on `orders`) — each caught. |
| Verification | FIXED · VERIFIED on GitHub: all four jobs green on `main` at `d8a18cf`. The first run, on `af5943b`, caught a generated file missing from fresh checkouts; fixed with `next typegen`. Owner: make the four jobs required checks on `main` (Settings → Branches). |

## AUD-09

**Unpaid orders hold stock indefinitely**

| | |
|---|---|
| Priority / severity | P2 · Medium |
| Component | `place_order` (0012) takes units at order creation; nothing released them for an unpaid order but a manual cancellation. Also: a Stripe `payment_intent.canceled` marks the order `expired` WITHOUT restocking, so those held stock too. |
| Evidence | Every order is prepaid and created `pending_payment` with its units taken; guest checkout allowed; `order.create` 10 / 10 min per address; before AUD-12 no line limit. No code path released the units of an unpaid order. |
| Impact | Anyone could mark products sold out without paying, indefinitely; ordinary abandoned checkouts hid stock from real buyers. |
| Remediation | Migration `0056_unpaid_order_reservations.sql`: `orders.payment_session_at` and the read-only, service-role-only `expirable_unpaid_orders(hold, grace, ceiling, limit)`. `lib/server/reservations.ts` releases what it names: card orders have their PaymentIntent **cancelled at Stripe first** — succeeded/processing → left for the webhook; Stripe unreachable → not released, retried — then the guarded `cancelOrder()` restocks (idempotent), returns the promo use and writes `expired`, without a customer email. Policy: **48 h hold** (the one reminder, sent 2 h–~26 h, can still be acted on), **60 min grace** after a payment was started (`payment_session_at`, stamped by both payment routes), **72 h ceiling** after which the grace no longer applies; configurable and bounded (`RESERVATION_*`, `.env.example`). Never touched: paid, refunded, partly refunded, `confirming`, shipped. Late crypto payments: the webhook re-takes the units or alerts (`reclaim_order_stock`, verified). Hourly via `/api/cron/reservations` (bearer `CRON_SECRET`, `?dry=1` to preview, order numbers only in the answer, alerts on Stripe errors), nightly via the sweep. |
| Tests | DB (`tests/db/reservations.sql`, 10): exactly the lapsed orders are named; paid/settling/shipped/refunded never; a customer paying now is not interrupted; the ceiling ends the grace; double release restocks once; a payment after release re-takes the units; not callable by browser roles. Concurrency (`tests/db/concurrency.sh`): two sweeps releasing the same order restock once; two customers for the last unit — one order, stock 0. Unit (4, policy bounds). End to end (audit suite 2, 18): cron auth, dry run changes nothing, card/crypto release, Stripe-processing and Stripe-unreachable orders untouched, second run releases nothing, payment start stamps the grace. **Reproduced on the deployed code** (`db36302`, 2026-10-13): the same suite section fails. The cron route is 404, lapsed orders stay `pending`, and the stock does not move (13 → 13). |
| Verification | FIXED AND VERIFIED (isolated). **Live only after migration 0056 is applied** (until then the endpoint answers 503 "Apply migration 0056" and the hourly job is red — by design). First run will release every currently lapsed unpaid order: run `?dry=1` first (MANUAL_ACTIONS_REQUIRED.md §3). |
| Limitation | The hold is a business rule chosen here (48 h) for the owner to confirm or change. |

## AUD-10

**Burned admin credentials in git history; rotation not confirmed**

| | |
|---|---|
| Priority / severity | P2 · Medium |
| Evidence | gitleaks 8.28.0 over all 211 reachable commits: 4 findings, all `scripts/verify-security.mjs:29-30` in commits `6916cd4` (the plain values) and `c6cd794` (their SHA-256 digests, still at HEAD by design, used to detect reuse). Known since `docs/security/hardening-2026-09-29.md`. No other secret pattern found in history or the working tree. Values are not reproduced here. |
| Impact | Anyone with read access to the repository, ever, has the old admin password and session secret. Harmless only if production uses different values. |
| Remediation | Owner: confirm `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` in Vercel are not those values; if in doubt, rotate both (this signs every admin out). History is not rewritten; rotation is the fix. |
| Verification | OPEN · rotation NOT VERIFIED (production secrets are not visible to this audit, by design). |

## AUD-11

**Admin "cancelled" on an unpaid order kept its units reserved and its PaymentIntent open**

| | |
|---|---|
| Priority / severity | P3 · Low |
| Files | `app/api/admin/orders/[id]/route.ts` (PATCH) |
| Evidence | On `17eb2c9`: PATCH `{status: 'cancelled'}` on an unpaid card order → status `cancelled` but payment still `pending_payment`, `restocked_at` empty, shelf unchanged, PaymentIntent still confirmable. The customer's own cancel button did all of these. |
| Impact | Units stay reserved for an order that will never ship (AUD-09); the customer can still pay a cancelled order. |
| Remediation | Unpaid, unshipped orders cancelled by staff go through the customer path: PaymentIntent cancelled first (409 if Stripe says it was captured), then `cancelOrder`. Paid orders keep the plain status change; their stock follows the refund. |
| Tests | End to end: 5 checks (§F-08). |
| Verification | FIXED · VERIFIED locally. |

## AUD-12

**No server-side bound on lines per order**

| | |
|---|---|
| Priority / severity | P3 · Low |
| Files | `lib/server/order-drafts.ts` |
| Evidence | On `17eb2c9` a 51-line order passed validation (it failed later only on stock). The browser cart caps at 50 lines (`lib/cart-storage.ts` `MAX_ITEMS`). |
| Remediation | `MAX_ORDER_LINES = 50`, the cart's own cap: 400 "Too many items". |
| Tests | Unit (2), end to end (1). |
| Verification | FIXED. No change for any customer using the site. |

## AUD-13

**Card-payment route returned Stripe's raw error text to the browser**

| | |
|---|---|
| Priority / severity | P3 · Low |
| Files | `app/api/payments/stripe/intent/route.ts` (catch block) |
| Evidence | `return NextResponse.json({ error: message }, { status: 502 })` with Stripe's message. Stripe's "Invalid API Key provided" error quotes the end of the key; other messages name customer and object ids. |
| Remediation | Generic `STRIPE_UNAVAILABLE`; the detail stays in the server log and the existing Telegram alert. The checkout shows its own translated text either way. |
| Verification | FIXED (code review; covered by build/typecheck). |

## AUD-14

**Admin dashboard and newsletter pages relied on the middleware alone**

| | |
|---|---|
| Priority / severity | P3 · Low (defence in depth) |
| Files | `app/admin/page.tsx`, `app/admin/newsletter/page.tsx` |
| Evidence | Every `/api/admin/*` handler calls `requireAdmin()` (checked: 46 handlers in 29 route files; login/logout are public by design), and `/admin/orders`, `/promocodes`, `/returns`, `/settings` call `isAdminRequest()`. The dashboard and the newsletter page did not; the dashboard renders configuration gaps (environment variable names). Data still came from guarded APIs. |
| Remediation | Both pages call `isAdminRequest()` and redirect. |
| Tests | End to end: 6 checks (pages render with a session, redirect without). A middleware bypass cannot be reproduced on Next 15.5.27, so the guard itself is verified by review. |
| Verification | FIXED. |

## AUD-15

**Order-tracking and admin sign-in pages told search engines "index, follow"**

| | |
|---|---|
| Priority / severity | P3 · Low |
| Evidence | `/order/LV-…` and `/admin/login` rendered `<meta name="robots" content="index, follow">` (robots.txt disallows both, but a disallowed URL can still be indexed from links). `/checkout`, `/account`, `/cart/*` were already `noindex`. |
| Remediation | Segment layouts with `robots: { index: false, follow: false }` (the pages are client components). |
| Verification | FIXED. |

## AUD-16

**Two workflows called the abandoned-cart cron every hour**

| | |
|---|---|
| Priority / severity | P3 · Low |
| Evidence | `abandoned-cart-reminders.yml` and `abandoned-carts-cron.yml`, both named "Abandoned-cart reminders", both at `17 * * * *`, both succeeding on `main`. The endpoint's claims prevent double emails; the calls were still doubled. |
| Remediation | Kept `abandoned-carts-cron.yml` (concurrency group, retries, the documented www host); moved the Telegram failure report into it; removed the other. |
| Verification | FIXED. |

## AUD-17

**Dependency advisories**

| | |
|---|---|
| Priority / severity | P3 · Low |
| Evidence | `npm audit` (2026-10-12): 12 (3 moderate, 9 high, 0 critical) → after this change 11 (3 moderate, 8 high, 0 critical). All remaining are build-time tooling: `braces`/`micromatch`/`fast-glob`/`chokidar` via `tailwindcss` 3 and `eslint-config-next`; `postcss-selector-parser` via `tailwindcss` 3. None ships in the server or browser bundle. No patched release within range (`npm audit fix --force` would downgrade `eslint-config-next` to 14 — do not). |
| Remediation | `source-map-js` 1.2.1 → 1.2.2 (GHSA-68fv-2mgg-jv7q), lockfile only, one entry. Remaining: Tailwind 4 and ESLint 9 (flat config) migrations as separate changes. CI blocks on critical. |
| Re-check 2026-10-13 | `npm audit`: still 11 (3 moderate, 8 high, 0 critical). `npm audit fix --dry-run` (no `--force`) would change 66 lockfile entries and leave all 11, so it was not applied. Every remaining fix is a major upgrade (Tailwind 4; `eslint-config-next` 16, or a downgrade to 14). |
| Verification | PARTIALLY FIXED. |

## AUD-18

**Product-scoped coupons discounted the whole basket; collection scoping was ignored**

| | |
|---|---|
| Priority / severity | P2 · Medium (raised from P3 Low after reproduction: one SQL edit away from real loss) |
| Component | `redeem_coupon` (0015); `lib/server/coupons.ts`, `order-drafts.ts`, `/api/coupons/validate`, `lib/store.tsx` |
| Evidence | Reproduced on the 0015 function (disposable DB): a "10 % off `dbtest-coat`" code on a 599.99 basket → **60.00** (10 % of everything); a code restricted to the `dbtest-coats` collection on a basket holding only a bag → **ok, 50.00**. No admin screen sets either column today. |
| Impact | Any restricted code would discount unrelated products; collection restrictions did nothing. |
| Remediation | Migration `0057_coupon_line_scope.sql` replaces the function: with a restriction, the caller passes the basket as `p_lines` (slug + qty); the function prices each line from `products.price` itself, keeps lines listed in `product_slugs` or belonging to a `collection_slugs` collection, and sizes the discount on that subtotal (percent: `round(…, 2)` half away from zero; fixed: capped at the eligible subtotal). No eligible line, a restriction naming nothing that exists, or a restricted code called without lines → `NOT_APPLICABLE` (fails closed). Unrestricted codes unchanged. All three callers send lines; against a database without 0057 the app retries the old signature. |
| Tests | DB (`tests/db/coupons.sql`, 21): unrestricted, product-restricted, collection-restricted, mixed basket, quantities, price-in-request ignored, qty clamp, rounding (33.33 % of 99.99 → 33.33), expiry, minimum (and boundary), zero and negative subtotal, preview vs commit, usage limit, unknown code, invalid configuration. Concurrency: four simultaneous redemptions of a single-use code → exactly one. End to end (3): preview 189.00 not 199.00; order discount 189.00 on 1990.00; basket without the product → `NOT_APPLICABLE`. Re-reproduced 2026-10-13 on a fresh database with migrations 0001–0055 from `db36302`: 60.00 and 50.00 as above. |
| Verification | FIXED AND VERIFIED (isolated). Live once migration 0057 is applied. |

## AUD-19

**Migrations 0005 and 0026 cannot be re-run on top of the full set**

| | |
|---|---|
| Priority / severity | P3 · Informational |
| Evidence | Applying all 55 migrations to an empty database succeeds. Re-applying, 0005 and 0026 fail: their seed rows use an `ON CONFLICT` target that later migrations replaced. Every migration from 0027 onwards re-applies cleanly. |
| Impact | None for production (applied once, long ago). A rebuild from scratch must run them in order once — which CI now does. |
| Verification | Documented; CI checks re-runnability from 0027. |

## AUD-20

**`search_products` callable with the public key, unbounded**

| | |
|---|---|
| Priority / severity | P2 · Medium (raised from Informational on 2026-10-13, after the reproduction below) |
| Component | `supabase/migrations/0045_search_products_fix.sql` (`search_products`); `app/api/search/route.ts` |
| Evidence | Reproduced on a database built from the deployed migrations (0001–0055), 60 matching products: `p_limit` 1 000 000 → 60 rows; `NULL` → 60 (no limit); `-5` → `ERROR: LIMIT must not be negative`; `has_function_privilege('anon', …)` → true. A query of 70 000 short words (`repeat('ab ', 70000)`) ran **~2 s of CPU and then raised `stack depth limit exceeded`**. |
| Root cause | The function trusted its caller for the limit and the query length, and was granted to `anon` and `authenticated`, although its only caller is `/api/search` with the service role. |
| Impact | Anyone with the public key could call it through PostgREST directly — around `/api/search`, its rate limit and its CDN cache — and load the database at will. No data exposure: it returns slugs of public products. |
| Remediation | Migration `0058_search_products_limits.sql`: same signature and results; limit clamped to 1..50 (NULL → 24); query trimmed and cut to 100 characters; EXECUTE revoked from `public`, `anon`, `authenticated`, granted to `service_role`. `scripts/ci/check-access.sql` no longer allow-lists it, so re-granting it fails CI; `scripts/security/verify-production.sql` reports it until 0058 is applied. |
| Tests | DB (`tests/db/search.sql`, 17): clamps (huge, NULL, negative, zero, default, misspelling pass), long and many-word queries (8 ms instead of 2 s + error), SQL and broken search syntax as text, result columns, privileges for `anon`/`authenticated`/`service_role`. Negative: re-granting to `anon` makes `check-access.sql` exit 3. End to end (`audit-suite3`): `/api/search` still answers with results; the anon key is refused at PostgREST; the service role gets at most 50 rows. |
| Verification | FIXED AND VERIFIED (isolated; Postgres 16 and 17). **Live only after migration 0058 is applied.** |
| Limitations | `pg_trgm` stays in whichever schema it was installed in (moving it is a separate change). |

## AUD-21

**External configuration this audit could not see**

NOT VERIFIED. Each needs the owner, in the provider's dashboard:

- Vercel: plan (Hobby is non-commercial under Vercel's terms, `docs/security/README.md` F8); production env vars marked Sensitive; preview deployments not using production secrets.
- Netlify: `netlify.toml` and `@netlify/plugin-nextjs` are still in the repo; whether a Netlify site exists with production secrets (F11).
- Supabase: plan and backup retention; Auth protections (CAPTCHA, leaked-password protection, rate limits, MFA for staff accounts); network restrictions; that migrations 0001–0055 are all applied (`scripts/security/verify-production.sql`).
- Stripe: account is in **live** or **test** mode as intended; webhook endpoint subscribed to all seven handled events incl. `radar.early_fraud_warning.created` and `charge.dispute.created`; Radar rules; restricted API key.
- Cloudflare: WAF managed rules, rate-limit rules, Access in front of `/admin`, TLS Full (strict). The origin lock and headers **are** verified live (see What holds).
- GitHub: branch protection on `main`, secret scanning and push protection, 2FA for all collaborators.
- MFA on every console (Vercel, Supabase, Cloudflare, GitHub, Stripe, registrar, email).

## AUD-22

**A refund whose outcome Stripe did not confirm could be issued again**

| | |
|---|---|
| Priority / severity | P2 · Medium |
| Component | `lib/server/stripe.ts` `refundPayment` |
| Evidence | After AUD-07, a failed `refunds.create` released the per-ledger claim whatever the failure. A timeout or connection reset can follow a refund Stripe DID create; Stripe's ledger then moves, so a retry computes a new idempotency key and is a second refund. |
| Impact | Double refund after a network blip. |
| Remediation | `isAmbiguousStripeFailure()`: no answer, `StripeConnectionError`, `StripeAPIError` or any 5xx → the claim is **kept** for its window and the admin is told the refund may have gone through and to check Stripe; the `charge.refunded` webhook records it if it happened. Definite refusals (4xx, 429) still release. |
| Tests | Unit (2). End to end with Stripe answering 500 (stripe-node itself retries with the same key): the admin sees "may have gone through"; pressing again is blocked and **no further request reaches Stripe**; all attempts Stripe saw carried one key; the order records no refund. **Reproduced on the deployed code** (`db36302`, 2026-10-13): after the Stripe 500 the admin sees "An unknown error occurred", and a second press reaches Stripe again (3 → 6 requests). |
| Verification | FIXED AND VERIFIED (isolated, Stripe stand-in). Not exercised against Stripe test mode. |

## AUD-23

**Backup scripts could report or accept a backup that was not whole**

| | |
|---|---|
| Priority / severity | P2 · Medium |
| Component | `scripts/backup/backup.sh`, `restore-test.sh`, `common.sh`; `offsite-backup.yml` |
| Evidence | Code review of the scripts as they were: no check that the dump is a readable archive or holds the shop's tables; uploads not verified against what was sent; Storage buckets not configured → `::warning::` and a green run; the restore test would restore into any URL (including a Supabase one) and a manifest with no tables would pass every check vacuously. |
| Remediation | Dump must be non-empty, readable by `pg_restore --list` and contain `public.orders`; every upload is size-verified in the bucket (`upload_verified`); missing media settings fail the run unless `BACKUP_SKIP_MEDIA=true` is set deliberately (workflow passes the variable); the restore test refuses Supabase URLs and manifests without `public.orders`, and reports its duration. Nothing deletes or overwrites earlier backups (unchanged). |
| Tests | Isolated, real scripts, `postgres:17` and `rclone/rclone:1.68.2` images: **happy path** — backup exit 0, three objects uploaded and verified, restore-test exit 0, 38 tables / 359 rows / 120 of 120 orders restored, 34 s end to end (the restore step itself 3 s); **failure paths, all exit 1 with a specific error** — destination unset; wrong credentials (nothing left in the bucket); tampered artifact (does not decrypt); manifest checksum mismatch; empty database (refused before upload); media not configured; Supabase restore target refused. Logs checked: no credential, age key or connection string. |
| Tests (round 3) | In the repository now: `tests/backup/run.sh` (AUD-29), 41 checks, run by CI. **On the deployed scripts (`db36302`) 14 of them fail**: empty, unreadable and orders-less dumps were uploaded; a truncated upload passed; missing media exited 0; a Supabase restore target was accepted; a manifest listing no tables passed vacuously. |
| Verification | FIXED AND VERIFIED (isolated). Production run: REQUIRES EXTERNAL ACCESS (AUD-01). |

## AUD-24

**No reconciliation between Stripe and the orders**

| | |
|---|---|
| Priority / severity | P3 · Low |
| Component | new `lib/payment-reconciliation.ts` (pure), `lib/server/reconciliation.ts`, `GET /api/admin/reconciliation?days=N` |
| Evidence | Discrepancies surfaced only when a webhook failed loudly; nothing compared the two ledgers. |
| Remediation | Admin-only, read-only report over 1–90 days (≤ 1000 intents): money Stripe took that an order does not show, orders marked paid Stripe did not take, amount/currency mismatches (in the charged currency), refunds on one side only, succeeded payments no order carries. Order numbers, payment ids and minor-unit amounts only. It never corrects anything. |
| Tests | Unit (9 scenarios). End to end: 401 without a session; report flags `paid_not_recorded` and a paid order missing in Stripe, does not flag a matching order, changes nothing. |
| Verification | FIXED AND VERIFIED (isolated). Not run against the real Stripe account (no access; MANUAL_ACTIONS_REQUIRED.md §6). |

## AUD-25

**A product marked unavailable could be bought by a crafted request**

| | |
|---|---|
| Priority / severity | P3 · Low |
| Component | `lib/server/order-drafts.ts` `repriceItems`, `app/api/orders/route.ts` |
| Evidence | For a product without variant rows (untracked stock), only the storefront hid the button when the admin tagged it `out_of_stock`; neither `repriceItems` nor `place_order` checked the tag. |
| Remediation | Refused at repricing; the order route answers `409 OUT_OF_STOCK` with the product, which the checkout already names to the customer. |
| Tests | End to end (1): untracked product tagged `out_of_stock` → 409, no order. **Reproduced on the deployed code** (`db36302`, 2026-10-13): the same request creates the order (201). |
| Verification | FIXED AND VERIFIED (isolated). |

## AUD-26

**Security-relevant events left no searchable trace**

| | |
|---|---|
| Priority / severity | P3 · Low |
| Component | new `lib/server/security-events.ts`; admin login, rate limiter, both webhooks, three cron routes |
| Evidence | Failed admin logins returned 401 with no log line; 429s, forged webhooks and cron probes were silent or free text. |
| Remediation | One JSON line per event (`{"security_event":"admin_login_failed",…}`): `admin_login_failed`, `admin_login_refused_config`, `rate_limited`, `rate_limiter_unavailable`, `webhook_signature_invalid`, `cron_unauthorized`. Fixed field names; the address only as a keyed 16-hex hash (repeats countable, not reversible); never secrets, tokens or emails. Alert thresholds: `docs/security/incident-response.md`. |
| Tests | Unit: JSON with known fields only, no raw IP, same source → same hash. |
| Verification | FIXED AND VERIFIED (unit). Alerting on these lines needs a log drain (REQUIRES EXTERNAL ACCESS). |

---

## AUD-27

**Reservation sweep: one database error stopped the run, and a failed restock was never retried**

| | |
|---|---|
| Priority / severity | P2 · Medium |
| Component | `lib/server/reservations.ts`, `lib/server/orders-store.ts` (`cancelOrder`, `restoreStock`), `app/api/cron/reservations/route.ts`, `app/api/cron/sweep/route.ts` |
| Evidence | Code review of round 2's sweep. (1) The release loop had no per-order error handling: a database error on one order threw out of the loop, the remaining lapsed orders waited for the next run, and the response did not say which had been done. (2) `cancelOrder` sets `cancelled` and then calls `restore_order_stock` without failing on error. When that call failed, the order was cancelled, its units were off the shelf with no order holding them, and nothing ever looked again: the sweep only lists *pending* orders. (3) Neither case was reported. |
| Root cause | The release treated "cancel" and "restock" as one step that cannot half-fail. |
| Impact | Inventory silently under-counted after a database blip; one bad order could stall the release of all others behind it. |
| Remediation | Each order is handled on its own and lands in exactly one list: `released`, `paymentInFlight`, `providerError`, `changed`, `failed` (the database refused: unchanged, retried next run) or `restockFailed` (cancelled, units not yet back). Each run first finds orders **this sweep** cancelled (`cancelled_reason` "Reservation expired:…", `payment_status` expired) whose `restocked_at` is still empty and puts their units back (`restockRepaired`). `restore_order_stock` is atomic and idempotent, so this cannot double-count. Orders cancelled any other way are never auto-restocked, because an older cancellation may predate `restocked_at`. `failed` or `restockFailed` → Telegram alert **and HTTP 500**, so the hourly workflow turns red. `cancelOrder` now reports `restockFailed`, and any cancellation whose restock fails alerts. |
| Tests | Unit (9, injected dependencies): card and crypto release; a payment that succeeds or processes during cleanup is left alone; Stripe unreachable or unconfigured; a concurrent change; a database error on the 2nd of 3 orders (1 and 3 still released); a restock that fails twice and is repaired on the third run, units back exactly once; repeated runs; dry run; unmigrated, off and listing failure. End to end (`audit-suite3`, real Postgres, failures injected with a temporary trigger): HTTP 500 with `failed` and `restockFailed` named, the healthy order released in the same run; after the fault is removed, HTTP 200, the failed order released and the restock repaired, all three units back exactly once; a third run changes nothing; an order cancelled by hand is not auto-restocked. |
| Verification | FIXED AND VERIFIED (unit; isolated end to end). Live with round 2's 0056. |
| Limitations | A failed restock after a customer or console cancellation is alerted but not auto-repaired: a person corrects it in Admin → Inventory. |

## AUD-28

**Stripe webhook error responses carried internal error text**

| | |
|---|---|
| Priority / severity | P3 · Low |
| Component | `app/api/payments/stripe/webhook/route.ts` |
| Evidence | The 400 (bad signature) returned the Stripe SDK's message; the 500 returned the thrown error's message, e.g. a database error. Stripe stores response bodies and shows them in its dashboard. |
| Remediation | Generic bodies: `Invalid signature` and `Webhook processing failed`. The detail goes to the server log, which already carried it, and to the Telegram alert. Status codes are unchanged, so Stripe's retry behaviour is the same. |
| Tests | End to end (`audit-suite3`): a forged signature gets exactly `{"error":"Invalid signature"}`. On the deployed build it returns the SDK's "No signatures found matching the expected signature for payload. Are you passing the raw request body…". Payments suite (status codes only) still passes. |
| Verification | FIXED AND VERIFIED (isolated). |

## AUD-29

**Backup scripts had no tests in the repository; restore failures were not named**

| | |
|---|---|
| Priority / severity | P3 · Low |
| Component | `scripts/backup/restore-test.sh`; `tests/backup/` (new); `.github/workflows/ci.yml` |
| Evidence | Round 2 proved the scripts with a harness outside the repository, which CI could not run. `restore-test.sh` failed with only an exit code when the bucket could not be listed, a download failed, or the manifest was not JSON. |
| Remediation | (1) `tests/backup/run.sh` runs the real scripts with stub `docker` and `age` (`tests/backup/stubs/`), emulating `pg_dump`, `pg_restore`, `psql` and `rclone` against a temporary directory as the bucket. No network, no database, no key. CI runs it ("Backup script tests"). (2) `restore-test.sh` names each failure: "Could not list…", "Could not download…", "not valid JSON". |
| Tests | 41 checks, stable over repeated runs:<br>• **Backup:** happy path; nothing plaintext in the bucket; encrypted to both recipients; manifest records checksum and counts; no secret in the logs; missing destination, database URL or key; `pg_dump` failing; empty, unreadable and orders-less dumps refused before upload; failed and truncated uploads; media unconfigured (fails, after the database is safe); media configured (all four buckets).<br>• **Restore:** a good backup restores; no backup; Supabase and pooler targets refused without printing the password; unlistable bucket; failed download; stale backup; modified file; wrong key; checksum mismatch; manifest with no public tables, without `public.orders`, or not JSON; a short restore names the table.<br>• **Against the deployed scripts:** 14 of the 41 fail (AUD-23). |
| Verification | FIXED AND VERIFIED (repository tests). |
| Limitations | The stubs do not encrypt and do not upload. Real encryption, upload and restore were proven on 2026-10-13 with the real tools in isolation (AUD-23), and are proven in production only by the workflows, once configured (AUD-01). |

## AUD-30

**Nothing stopped server-only code or a secret from reaching the browser bundle**

| | |
|---|---|
| Priority / severity | P3 · Low |
| Component | `scripts/ci/check-client-bundle.sh` (new); `.github/workflows/ci.yml` |
| Evidence | The current bundle is clean: client components import server modules for types only. But no check would catch a regression such as a `'use client'` file importing `lib/server/*`. |
| Remediation | After `next build`, CI fails if `.next/static` reads any non-public variable from `.env.example` (`.NAME`, `["NAME"]`), or contains a Stripe secret, restricted or webhook key, a Supabase service-role JWT or a private-key block. Only file names are printed. Admin help texts that merely name a variable are allowed. |
| Tests | Clean on the final build (36 names, 5 shapes, 233 files). Negative: a planted `r.env.SUPABASE_SERVICE_ROLE_KEY`, an `env["STRIPE_SECRET_KEY"]` and a `whsec_…` string each fail it (exit 1); a help text naming `RESEND_API_KEY` does not. |
| Verification | FIXED AND VERIFIED. |

## AUD-31

**Admin access is one shared password; the second factor is optional when unset**

| | |
|---|---|
| Priority / severity | P3 · Low |
| Component | `lib/server/admin-auth.ts`, `lib/server/admin-totp.ts`, `app/api/admin/login/route.ts` |
| Evidence | One `ADMIN_PASSWORD` for everyone, held in the environment and compared as constant-time SHA-256 digests. There are no per-person accounts, so there is no per-person revocation or audit trail beyond IP and user agent in `admin_sessions`. With `ADMIN_TOTP_SECRET` unset, the password alone signs in (a warning is logged in production). |
| What holds (verified) | Sessions are HMAC-signed with expiry, bound to the password (rotating it ends all sessions) and revocable server-side. Tampered, expired, malformed and secret-less tokens are refused (unit). An invalid TOTP secret blocks sign-in (AUD-05). Sign-in is rate-limited and fails closed. Failures name neither factor. The cookie is `__Host-`, HttpOnly, Secure, SameSite=Lax (unit test added in round 3). |
| Why not changed | Making the second factor mandatory, or moving to per-person accounts, changes how the owner signs in. An unannounced switch could lock the owner out of production. The brief rules out an unsafe authentication migration. A slow password hash would add nothing while the password lives in the environment rather than in a stored hash table. |
| Remediation | Owner: set `ADMIN_TOTP_SECRET` (MANUAL_ACTIONS_REQUIRED.md §4) and keep the password long and unique (§5). Later, as its own change: per-person accounts (e.g. Supabase Auth with an admin role and enforced MFA). |
| Verification | NOT FIXED (design decision; documented). Production TOTP: REQUIRES EXTERNAL CONFIGURATION. |

## AUD-32

**Two refund presses racing could still both be paid**

| | |
|---|---|
| Priority / severity | P2 · Medium (money leaves twice) |
| Component | `lib/server/stripe.ts` (`refundPayment`), `app/api/admin/orders/[id]/refund/route.ts`, `lib/server/refund-order.ts` |
| Evidence | The round-1 suite's F-05 ("two simultaneous identical refund requests → ONE refund") **failed on the round-2 code** on 2026-10-13 (40/45): Stripe created two refunds, with keys `refund:pi_au_paid:0:0:10000` and `refund:pi_au_paid:10000:0:10000`. The same test had passed in three earlier runs: the outcome depends on timing. |
| Root cause | AUD-07's defences each look at one moment. The route's stale-screen check reads the ORDER; the claim and the idempotency key are built from Stripe's ledger read a few milliseconds later. When press B checks the order before press A has recorded its refund, but reads Stripe after A's refund exists, B passes the stale-screen check, sees a moved Stripe ledger, and so gets a new claim and a new key. That is a second refund. |
| Impact | A double refund of the requested amount, from two tabs or two staff pressing within the same fraction of a second. It is admin-only, but it is real money. |
| Remediation | `refundPayment` compares the two ledgers before claiming. If Stripe's refunded total is ahead of what the order records (`stripeLedgerAhead`), nothing is refunded and the admin is told to refresh and check Stripe. The cause is either a refund being recorded right now, or one made in the Stripe dashboard that the `charge.refunded` webhook has not synced yet. When the ledgers agree, a deliberate further refund proceeds as before. Converted payments allow rounding drift of 0.1 % of the charge (at least 2 minor units). |
| Tests | Unit (3): racing presses refused; agreeing ledgers allowed; conversion rounding tolerated, a real refund not. End to end, deterministic (`audit-suite3`): Stripe's charge shows CHF 100 refunded that the order does not → refused, with nothing sent to Stripe; once the order records it → the deliberate refund goes through. On the deployed build (`db36302`) the same check refunds again. **Stress, 30 rounds of two presses 0–39 ms apart, each on a fresh order: 15 of 30 double refunds without the fix (both presses HTTP 200), 0 of 30 with it.** With the fix, the ledger check stopped the second press 13 times, the claim 8 times and the stale-screen check 9 times. F-05 passes on the final build. |
| Verification | FIXED AND VERIFIED (unit; isolated end to end). Not against Stripe test mode. |
| Limitations | On a converted payment, a racing refund smaller than the tolerance could still slip through. While a dashboard refund is unsynced, console refunds of that order wait (the safe direction). |

## What holds

Checked and found sound (evidence in `TEST_REPORT.md`):

- **Database access (all 58 migrations, Postgres 16 and 17, Supabase grants emulated; re-checked 2026-10-13 and in CI as `tests/db/rls.sql`, 20 denials, plus `search.sql` and `rate_limits.sql`):**
  - RLS is on for all 35 public tables.
  - Every SECURITY DEFINER function sets `search_path`. After 0058 the browser can call only two of them, `set_default_address` and `review_eligibility`, and both scope to `auth.uid()`. `search_products` is service-role only (AUD-20).
  - Live probes as `authenticated` and `anon` were all refused or affected 0 rows: writing protected profile columns (`stripe_customer_id`, `welcome_sent_at`), touching another user's rows, inserting orders, approved reviews or other users' notifications, calling `place_order`, `redeem_coupon` or `restore_order_stock`, and reading coupons, payment blocks or admin sessions.
  - The private buckets have no policies.
- **Payments:** prices, shipping, tax and discounts are recomputed server-side from the catalogue (`repriceItems`). Stripe amounts are integer minor units from the stored order. The webhook verifies the signature over the raw body, de-duplicates on the event id and checks amount and currency against the order. A payment state machine sits inside every UPDATE. A refund never exceeds Stripe's remainder. NOWPayments IPNs are re-verified against the provider API. (Audit 2026-10-04, re-run today: payments suite 33/33.)
- **Authorization:**
  - All 46 `/api/admin/*` handlers (29 route files) call `requireAdmin()`.
  - Customer order, ticket and payment routes authorize by session owner or by a constant-time lookup token, and answer 404 for "not yours".
  - The support assistant's order tool only sees the requester's orders.
- **Rate limiting:** `check_rate_limit` counts atomically. A limit of 3 allows exactly 3, then refuses with a `Retry-After`; subjects and buckets are independent; the window resets; and 10 simultaneous requests against a limit of 5 give exactly 5 allowed and 10 counted (`tests/db/rate_limits.sql`, `concurrency.sh`). A forged `CF-Connecting-IP` without the edge secret, or with a wrong, partial or padded one, cannot mint new buckets, and callers with no address share one bucket (unit).
- **CSRF, sessions, headers:**
  - The Fetch-Metadata/Origin guard has exact-path exemptions only.
  - Admin sessions are HMAC-signed, expire, and are revocable at the edge.
  - Cookies use `__Host-`.
  - The nonce CSP on checkout and admin has no `unsafe-eval`.
- **Live site (GitHub Actions "Security check (live)", 2026-10-12 15:36 UTC, exit 0 = zero failed checks):**
  - The origin lock refuses direct `*.vercel.app` requests, including forged `Host` and guessed edge secrets.
  - Security headers are present: HSTS for 2 years, `frame-ancestors 'none'`, `object-src 'none'`.
  - The admin API refuses requests without a session and with a forged cookie, and refuses the `x-middleware-subrequest` bypass.
  - Both webhooks refuse unsigned or forged calls.
  - Cross-site POST is refused.
  - The order lookup returns nothing for a guessed token.
  - The image optimiser refuses foreign hosts and the metadata address.
- **SEO:**
  - Missing pages answer 404 to browsers and Googlebot (status matrix).
  - Product pages carry a canonical URL, hreflang en/it/fr/de/x-default, Product/Offer/Breadcrumb structured data, and noindex on private pages.
  - The sitemap and robots.txt are consistent.
