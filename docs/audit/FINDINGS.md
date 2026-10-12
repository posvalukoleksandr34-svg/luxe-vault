# Findings — audit of 2026-10-12

Every finding below was confirmed against the code, a disposable database or
the GitHub Actions history. None is copied from an earlier report without
being re-checked. Earlier audits (`docs/security/*`,
`docs/compliance/audit-2026-10-04.md`) remain valid; where one of their open
items is still open it is listed again with today's evidence.

**Priority:** P0 drop everything · P1 before next release · P2 this month · P3 backlog.
**Severity:** Critical · High · Medium · Low · Informational.
**Status:** FIXED (code in this branch, tested) · PARTLY FIXED · OPEN · NEEDS OWNER/LEGAL.

## Summary

| ID | P | Severity | Title | Status |
|---|---|---|---|---|
| [AUD-01](#aud-01) | P1 | High | Offsite backups never ran; the workflows reported "success" every night | PARTLY FIXED (now fails loudly); configuration is the owner's |
| [AUD-02](#aud-02) | P1 | Critical (legal) | Sale of replica / designer-inspired goods: trade-mark and payment-provider exposure | NEEDS LEGAL |
| [AUD-03](#aud-03) | P2 | Medium | Customer could cancel a refunded or partly refunded order, or one already shipped | FIXED |
| [AUD-04](#aud-04) | P2 | Medium | Rate limiter failed open on the password, token and payment endpoints | FIXED |
| [AUD-05](#aud-05) | P2 | Medium | A set-but-invalid `ADMIN_TOTP_SECRET` silently turned admin MFA off | FIXED |
| [AUD-06](#aud-06) | P2 | Medium | Admin could permanently delete paid and refunded orders | FIXED |
| [AUD-07](#aud-07) | P2 | Medium | A refund asked for twice (two tabs, two staff) was paid twice | FIXED |
| [AUD-08](#aud-08) | P2 | Medium | No CI on pull requests or main; actions pinned by tag | FIXED (workflow added; make it required) |
| [AUD-09](#aud-09) | P2 | Medium | Unpaid orders hold stock indefinitely (inventory can be reserved without paying) | PARTLY FIXED (AUD-12); NEEDS OWNER decision |
| [AUD-10](#aud-10) | P2 | Medium | Burned admin credentials in git history; rotation not confirmed | OPEN (owner) |
| [AUD-11](#aud-11) | P3 | Low | Admin "cancelled" on an unpaid order kept its units reserved and its PaymentIntent open | FIXED |
| [AUD-12](#aud-12) | P3 | Low | No server-side bound on lines per order | FIXED |
| [AUD-13](#aud-13) | P3 | Low | Card-payment route returned Stripe's raw error text to the browser | FIXED |
| [AUD-14](#aud-14) | P3 | Low | Admin dashboard and newsletter pages relied on the middleware alone | FIXED |
| [AUD-15](#aud-15) | P3 | Low | Order-tracking and admin sign-in pages told search engines "index, follow" | FIXED |
| [AUD-16](#aud-16) | P3 | Low | Two workflows called the abandoned-cart cron every hour | FIXED |
| [AUD-17](#aud-17) | P3 | Low | Dependency advisories (build tooling) | PARTLY FIXED (1 of 12) |
| [AUD-18](#aud-18) | P3 | Low | Product-scoped coupons discount the whole basket; collection scoping ignored | OPEN (latent) |
| [AUD-19](#aud-19) | P3 | Informational | Migrations 0005 and 0026 cannot be re-run on top of the full set | OPEN (documented) |
| [AUD-20](#aud-20) | P3 | Informational | `search_products` RPC callable with the public key, unbounded limit | OPEN |
| [AUD-21](#aud-21) | P3 | Informational | External configuration this audit could not see | NOT VERIFIED |

Verified as holding (no finding): see [What holds](#what-holds) at the end.

---

## AUD-01

**Offsite backups never ran; the workflows reported "success" every night**

| | |
|---|---|
| Priority / severity | P1 · High |
| Component | GitHub Actions: `offsite-backup.yml`, `backup-restore-test.yml` |
| Files | `.github/workflows/offsite-backup.yml:50-60`, `.github/workflows/backup-restore-test.yml:48-58` |
| Evidence | Latest runs on `main` (GitHub API, 2026-10-12): Offsite backup run `38231772561` — conclusion **success**, steps *Back up* **skipped**, *checkout* skipped. Backup restore test run `38254657685` — **success**, *Restore and verify* **skipped**. The same holds for every run listed (2026-09-28 → 2026-10-12). |
| Impact | There is no offsite copy of the database, the Storage media or the repository, and no restore has ever been tested. The green check mark in the Actions tab says the opposite. If the Supabase project is lost, deleted or encrypted, recovery depends entirely on Supabase's own backups, whose plan, retention and restorability were not verified (AUD-21). |
| Root cause | When the secrets are missing, the "Check configuration" step only printed `::warning::` and skipped the rest, so the job ended green. |
| Remediation | **Code (this branch):** an unconfigured run now ends **red** with `::error::` and posts the existing Telegram failure alert. **Owner:** create the bucket, keys and the `backups` environment as in `docs/security/phase-1-backups.md`, then run both workflows by hand and confirm the restore test passes. Until then, also confirm Supabase's own backup plan and download a manual `pg_dump` (Supabase dashboard → Database → Backups). |
| Tests | Workflow YAML parsed; logic reviewed. The new failure path takes effect after merge to `main`. |
| Verification | Code: done. Backups: **NOT VERIFIED — do not exist yet.** |
| Limitation | No claim is made that any backup works. A restore must be tested into a throwaway project, never into production. |

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
| Verification | FIXED · VERIFIED locally. **Deployment caveat:** if production currently has an *invalid* `ADMIN_TOTP_SECRET`, admin sign-in will answer 503 after this deploy until it is corrected (`scripts/admin-totp-setup.mjs`). Check before merging: if the live sign-in form does **not** ask for a 6-digit code while the variable is set, it is invalid. |

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
| Verification | FIXED · VERIFIED against a Stripe stand-in that honours `Idempotency-Key` like the real API. Not exercised against Stripe test mode (no keys in this environment). Stripe keeps a key's outcome for 24 h: an identical retry of a refund Stripe *rejected* gets the same error within that time — change the amount or wait. |

## AUD-08

**No CI on pull requests or main; actions pinned by tag**

| | |
|---|---|
| Priority / severity | P2 · Medium (open since `docs/security/README.md` F6) |
| Evidence | `.github/workflows/` had only scheduled jobs; nothing ran typecheck, lint, tests, build, a secret scan, a dependency audit or the migrations on a change. `actions/checkout@v4` by tag in three workflows. |
| Remediation | `.github/workflows/ci.yml`: typecheck, lint, unit/security tests, production build with placeholder public env only; gitleaks over the full history (binary pinned by version **and** SHA-256); `npm audit` (blocks on critical, reports high); every migration applied to an empty Postgres 17 plus `scripts/ci/check-access.sql` (RLS on every table, `search_path` on every SECURITY DEFINER function, no browser-callable definer function outside a reviewed allow-list, no policy on server-only tables, no browser write policy on orders/stock/catalogue, no RLS-bypassing view, private buckets private). All `uses:` pinned to commit SHAs; `permissions: contents: read`; `.github/dependabot.yml` keeps pins and npm patches current. `.gitleaksignore` lists the four known historical fingerprints (AUD-10) by fingerprint only. |
| Tests | Locally: typecheck, lint, 96 unit tests, build, gitleaks (history + tree: no leaks), migration script on an empty database (55 applied, 29 re-applied, rules hold) and three negative tests (RLS off, `place_order` granted to anon, an UPDATE policy on `orders`) — each caught. |
| Verification | FIXED in code. **NOT VERIFIED on GitHub** until the workflow first runs. Owner: make the four jobs required checks on `main` (Settings → Branches). |

## AUD-09

**Unpaid orders hold stock indefinitely**

| | |
|---|---|
| Priority / severity | P2 · Medium |
| Component | `place_order` (0012) takes stock at order creation; nothing releases it for an unpaid order except a cancellation |
| Evidence | Every order is prepaid (`requiresPrepayment` → true) and is created as `pending_payment` with its units taken. The sweep releases promo-code holds after 48 h (`release_stale_coupon_holds`, 0043) and sends one reminder (2 h–7 d, 0019), but never releases stock. Guest checkout is allowed; `order.create` allows 10 orders / 10 min per address. Before AUD-12 an order had no line limit. |
| Impact | Anyone can mark products sold out without paying: 10 orders × 50 lines × 20 units per 10 minutes per IP address, and it stays that way until staff cancel the orders by hand. Ordinary abandoned checkouts also hide stock from real buyers. |
| Remediation | Partly: AUD-12 bounds one order. **Owner decision needed** on a reservation window, e.g. "an unpaid card order releases its units after 24 h". The building blocks exist: cancel the PaymentIntent, then `cancelOrder` (restock + coupon release, now state-machine safe), and `reclaim_order_stock` already handles a payment that lands after release. Not implemented here because it changes a business rule (how long a customer can pay later). |
| Verification | NEEDS OWNER decision. |

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
| Verification | PARTLY FIXED. |

## AUD-18

**Product-scoped coupons discount the whole basket; collection scoping ignored**

| | |
|---|---|
| Priority / severity | P3 · Low (latent) |
| Files | `redeem_coupon` (0015/0043): `NOT_APPLICABLE` only checks that the basket *contains* a listed product; the discount is computed on the whole subtotal. `collection_slugs` is stored but never read. |
| Impact | None today: no admin screen sets either column. If scoping is ever set by SQL, "10 % off product X" discounts everything in the basket. |
| Remediation | Before exposing scoping: compute the discount on the eligible lines' subtotal (pass per-line amounts to the function) and implement or drop `collection_slugs`. |
| Verification | OPEN. |

## AUD-19

**Migrations 0005 and 0026 cannot be re-run on top of the full set**

| | |
|---|---|
| Priority / severity | P3 · Informational |
| Evidence | Applying all 55 migrations to an empty database succeeds. Re-applying, 0005 and 0026 fail: their seed rows use an `ON CONFLICT` target that later migrations replaced. Every migration from 0027 onwards re-applies cleanly. |
| Impact | None for production (applied once, long ago). A rebuild from scratch must run them in order once — which CI now does. |
| Verification | Documented; CI checks re-runnability from 0027. |

## AUD-20

**`search_products` RPC callable with the public key, unbounded limit**

| | |
|---|---|
| Priority / severity | P3 · Informational |
| Evidence | SECURITY DEFINER, executable by `anon`; `p_limit` unchecked. It returns slugs and ranks of public products only. |
| Impact | A caller with the (public) anon key can ask for every product in one request and make the database rank the whole catalogue: cost, not exposure. |
| Remediation | Clamp `p_limit` (e.g. `least(p_limit, 50)`) in the next search migration. `pg_trgm` installed in `public` (Supabase's linter flags it) can move to `extensions` at the same time. |
| Verification | OPEN. |

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

---

## What holds

Checked and found sound (evidence in `TEST_REPORT.md`):

- **Database access (Postgres 16, all 55 migrations, Supabase grants emulated):**
  - RLS is on for all 35 public tables.
  - All 28 SECURITY DEFINER functions set `search_path`. The three that the browser can call (`search_products`, `set_default_address`, `review_eligibility`) scope to public data or to `auth.uid()`.
  - Live probes as `authenticated` and `anon` were all refused or affected 0 rows: writing protected profile columns (`stripe_customer_id`, `welcome_sent_at`), touching another user's rows, inserting orders, approved reviews or other users' notifications, calling `place_order`, `redeem_coupon` or `restore_order_stock`, and reading coupons, payment blocks or admin sessions.
  - The private buckets have no policies.
- **Payments:** prices, shipping, tax and discounts are recomputed server-side from the catalogue (`repriceItems`). Stripe amounts are integer minor units from the stored order. The webhook verifies the signature over the raw body, de-duplicates on the event id and checks amount and currency against the order. A payment state machine sits inside every UPDATE. A refund never exceeds Stripe's remainder. NOWPayments IPNs are re-verified against the provider API. (Audit 2026-10-04, re-run today: payments suite 33/33.)
- **Authorization:**
  - All 46 `/api/admin/*` handlers (29 route files) call `requireAdmin()`.
  - Customer order, ticket and payment routes authorize by session owner or by a constant-time lookup token, and answer 404 for "not yours".
  - The support assistant's order tool only sees the requester's orders.
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
