# Project improvement log

Running record of the autonomous improvement rounds: what changed, what was
verified and how, what is still open. Earlier audits live in `docs/audit/`
(findings AUD-01…32) and the refund system in `docs/refunds/README.md`.

## Store readiness round (2026-10-25)

Findings and their status are in `docs/audit/STORE_READINESS_AUDIT.md`. Owner
items are OA-20 to OA-23 in `docs/audit/OWNER_APPROVAL_CHECKLIST.md`.

- **Sale rights (0062).**
  - Products are drafts until the owner publishes them with a rights record
    (own design or authorised resale, a reference, a confirmation).
  - Every public read path, and the cart, order and payment routes, see
    published products only.
  - The shop sells nothing until 0062 is applied and products are reviewed.
- **Prices (0063).** A strike-through price comes only from prices actually
  charged; typed old prices are ignored.
- **Publishing.** An incomplete product cannot be published, or saved
  incomplete while on sale.
- **Payments.**
  - The success page tells the truth: paid, processing (it refreshes itself),
    declined, incomplete, cancelled.
  - `/admin/reconciliation` lists Stripe/order discrepancies.
  - For "paid in Stripe, not recorded" the owner can apply Stripe's status.
    The server re-fetches the intent and runs the webhook's own code
    (`lib/server/stripe-payment-apply.ts`).
  - Short or wrong-currency payments are mismatches, never "paid".
- **Catalogue.**
  - Department → category from the database only. Nothing empty in public
    navigation, and empty pages are `noindex`.
  - Names, order and an optional department description (0064) are editable
    in the admin.
  - Labels are keyed per department.
  - "Newest" sorts by date added.
- **SEO and trust.**
  - The "limited drops" claim is gone.
  - The sitemap refreshes hourly as a backstop.
  - Seller identity is listed for the owner (OA-23).
- **Verified** on the local stand: see §8 of the audit document. Production is
  not deployed, migrated or tested.

## Admin console: audit and improvement round (2026-10-23)

Findings, ranked, and the changes are in `docs/admin-console.md`. In short:

- **Integrity:**
  - Saving a product no longer overwrites stock sold while the form was open
    (compare-and-set via `stockBase`, `lib/stock-sync.ts`). The stock page does
    the same (`expectedStock`).
  - Order status saves carry `expectedStatus` and are refused (409) if the
    order moved on.
- **Safety:**
  - Order status changes are staged with an explicit save. Cancelling and
    "refunded" ask once more and say what they do.
  - Refunds, product deletion and the remaining deletions use one confirmation
    dialog that states the consequences.
  - The product editor guards unsaved edits (close, Escape, reload). It
    validates name and price inline and never saves a CHF 0 product by
    accident.
  - Analytics and the cookie banner are off under `/admin`.
- **Workflows:**
  - One grouped navigation on every admin page, with counts of what waits; a
    drawer on phones.
  - The dashboard leads with "Требует внимания", counted from the database.
  - Orders have a "К отправке" tab, a period filter, filters kept in the
    address, refresh, and cards on phones.
  - The product list has filters, sort, `?edit=` / `?new=`, and readable slugs
    for new products.
  - Customers link to their orders.
- **Consistency:**
  - Shared page header, confirmation dialog and error toasts (announced, kept
    longer).
  - One neutral palette and typeface for the console via `data-admin-shell`.
- **No schema change, no migration.**

### Tests run this round (real results)

| Check | Result |
|---|---|
| `npm run typecheck`, `npx next lint` | clean |
| `test:store` | 53/53 (14 new in `tests/store/admin-console.test.ts`) |
| `test:security` | 138/138 |
| `test:refunds` | 61/61 |
| `test:assistant` | 105/105 |
| `scripts/ci/check-client-bundle.sh` | clean |
| Production build | OK |
| Admin end-to-end on the production build (real Postgres + PostgREST): API, browser at 1280 px and 390 px | 70/70 on the final build, and on the three builds before it |
| Regression: review-request e2e | 100/100 |
| Regression: refund integration | 107/107 |
| Regression: product-review suite | 82/82 |
| Storefront smoke (home, catalogue, product, add to cart, checkout, cookie banner) at 1280 px and 390 px | 16/16 |

The admin e2e covers:

- stock conflicts: product save and the stock page;
- order status conflicts;
- server validation;
- staged status with confirmation;
- the unsaved-changes guard and Escape;
- inline validation;
- delete confirmation;
- readable slugs;
- no analytics in the console, against a shop control page built with a test
  GA id, all requests intercepted;
- no sideways scroll on nine admin pages at 390 px;
- the phone drawer and order cards.

Not run: `scratchpad/price-suite.js`. It was written for an older harness with
a fake Supabase (`/__state`) and does not run against the current one. The
checkout pricing code was not changed this round.

## Post-delivery review requests (2026-10-23)

The full design is in `docs/review-requests.md`; the owner steps are in `docs/audit/MANUAL_ACTIONS_REQUIRED.md` §0a.

What was added:

- **Migration 0060:**
  - `review_requests`, one per order;
  - `email_suppressions`;
  - `claim_review_requests()`, which uses SKIP LOCKED.
- **Scheduling:** a request is scheduled from the confirmed delivery (`orders.delivered_at`).
  - The delivery event schedules it, and an hourly reconciliation catches missed events and corrected dates.
  - The default delay is 48 h, configurable.
- **The worker** runs in `/api/cron/review-requests`, hourly:
  - it re-checks eligibility just before sending;
  - retries back off exponentially; permanent failures stop;
  - a crashed send is recovered with the same idempotency key;
  - it never sends after the stale limit.
- **The email:** branded, in en/ru/it/fr/de, with:
  - a "Leave a review" button and a fallback link;
  - a one-click unsubscribe (RFC 8058).
- **The tokenized review page:**
  - only the hash of the token is stored, and the link expires;
  - the user and order come from the token;
  - reviews go through the existing moderation.
- **Admin page:** settings, figures, a filtered list, retry and cancel, preview, and an allow-listed test send. RBAC uses the staff roles.
- **Privacy policy (ru/en/it)** updated. Retention is 12 months and is enforced by the cron.
- **Off by default.** Requests wait until the owner turns sending on.

Tests (real results):

| Test | Result |
|---|---|
| `npm run test:store` | 39/39, including 33 new |
| `test:security` | 138/138 |
| `test:refunds` | 61/61 |
| `test:assistant` | 105/105 |
| `scripts/ci/verify-migrations.sh` + `db-tests.sh` on Postgres 16 | all PASS, including 21 new review-request checks and a 4-worker claim race |
| End to end on the production build, real Postgres + PostgREST, fake Resend | 100/100 |
| Refund e2e regression | 107/107 |
| Product-review e2e regression | 82/82 |
| typecheck, lint, client-bundle check | clean |

Browser check: the review page at 390 and 1280 px and the admin page showed no overflow and no console errors.

Not done:

- the Resend bounce webhook;
- review requests for guest orders;
- a live send through Resend: only the local fake was exercised.

## Round 4 (2026-10-22)

### Done

| # | Issue | Change | Verified by |
|---|---|---|---|
| 1 | **Dashboard revenue was wrong.** It summed every non-cancelled order, so unpaid, failed and expired orders counted as revenue. Refunds were not subtracted. The average order divided by all orders, cancelled ones included. A failed load showed CHF 0 as if real. | Figures are computed on the server over all orders, in rappen (`lib/admin-metrics.ts`, `lib/server/admin-metrics.ts`, `GET /api/admin/metrics`). Revenue = settled payments minus refunds; average = paid orders only. New: last 30 days, refunded total, paid-but-unshipped and awaiting-payment counts. Load failures are shown. | `npm run test:store`: 6 tests. Browser check against the harness DB (see Tests). |
| 2 | **Customer "spent" counted unpaid orders.** The 5000-row read had no order, so the subset was arbitrary. | Only settled payments count (the same `isSettled` rule as revenue), newest first. | Same |
| 3 | **Silent load failures** in admin Customers and Reviews: a failed request looked like "no customers / no reviews". | Explicit error states. | typecheck, lint |
| 4 | Checkout: a failed card re-pricing after a currency change was swallowed. | Shows the existing "payment unavailable" toast. | typecheck |
| 5 | **Critical advisory in Next.js 15.5.27** (GHSA-2464-fhr4-w9xw, unauthenticated RCE in the Image Optimization API with SVG; also GHSA-p3m5-59mp-jv5r, a Server Actions DoS). | Upgraded to 15.5.28 (patch release, published 2026-10-14). Only `next` and `@next/*` change in the lockfile. `dangerouslyAllowSVG` was already `false`. | `npm audit`: critical 0 (was 1). Build, all suites (see Tests). |
| 6 | Without migration 0059 every refund route failed with an opaque 500. Migrations are applied by hand, so the code can be live first. | `lib/server/refunds/schema.ts`: staff routes (through `requireStaff` and `/me`) answer 503 naming the migration; customer routes answer "temporarily unavailable" with no internals. | Harness: table renamed away → 503s, then restored → 200 |
| 7 | The order screen and the refunds console showed refusal codes ("STAFF_REQUIRED") verbatim. | They show the server's sentence; the order screen says where to confirm identity. | Harness (browser) |
| 8 | The tracking page said nothing about a **partial** refund. | Amount and timeframe in all 5 languages. | Harness (browser, en + de, 390px) |
| 9 | Staff could refund from the order screen while a refund case for the same order was open; `orders.return_status` was never shown. | The order row links to the order's cases; the order-screen refund warns when one is open. | Harness (browser) |
| 10 | The dashboard downloaded up to 2000 full orders to show five. | `/api/admin/orders?limit=` and the dashboard asks for 5. | Harness |
| 11 | **Operator alerts repeated all day.** Alert deduplication was in memory only, so every serverless cold start reset it; LV-VNJXDF re-alerted every few hours. | `reportCriticalError` also checks a database bucket (`alert.dedupe`): the same alert at most once per 6 h across instances. It fails open, so an alert is never swallowed when the limiter is down. | Harness with intercepted Telegram: 7/7, including across a cold start and with the limiter unavailable |
| 12 | The FAQ "How do I start a return?" described the old support-ticket route. | It now points to the order's "Request a refund" button and the "Returns & claims" section, with the support topic for guest orders. 5 languages; topic names checked against the support form. | `test:assistant` 105/105 |
| 14 | **Admin selected items failed WCAG AA contrast** (gold ink on gold tint, 4.29–4.36:1). Affected: navigation, order tabs, inventory, product form, promo codes, newsletter, support, refund badges and buttons. | The label uses the foreground colour; the tint marks the selection. Customer pages unchanged (no violation measured there). | axe WCAG 2.2 AA: 9 admin/customer pages × 2 widths → 0 violations (was 4); 11 storefront pages × 2 widths → 0 |
| 13 | `MANUAL_ACTIONS_REQUIRED.md` still said the 10-13 changes were uncommitted and had nothing on 0059. | New §0: migration 0059, Stripe events, staff accounts, policy, test refund, deploying the Next.js fix. §1 marked done. | — |

### Checked, no change needed

* **Delivery disputes** (`lib/refunds/delivery.ts`). Inside the window, no tracking, confirmed loss, conflicting events, delivered, and inconclusive are all distinguished, and each one leads to advice for a person, never a decision.
* **Raw HTML.** Only JSON-LD is rendered as raw HTML, and `serializeJsonLd` escapes `<`, `>`, `&`.
* **Indexes** cover the new queries: orders by date, cases and ledger rows by order.
* **Account deletion** keeps refund cases (`user_id` is set to null), consistent with order retention.
* **No dead controls:** no empty `onClick` handlers or `href="#"` links.

* **Mutating API routes.** Every public route is rate-limited; every admin route calls `requireAdmin` (plus `requireStaff` for refunds).
* **Product deletion.** Order lines keep their own name and price, and `order_items.product_id` is not a foreign key, so deleting a product cannot break orders.

### Open / needs the owner

* **Merge this branch** to get the Next.js 15.5.28 security fix live.

* Migration `0059_refund_cases.sql` must be applied in Supabase. Until then, refund features on the live site return errors. Not visible from here.
* Live Stripe is unverified (refunds, reservation cancel). See `docs/refunds/README.md`.
* AUD-02 (legal), AUD-10 (credential rotation), AUD-31 (TOTP) remain owner actions.

### Known limitations / next candidates

* Order creation has no server-side idempotency key. A retried submit can create a duplicate unpaid order, which holds stock until the 48 h reservation sweep releases it. No money is at risk. Fixing it needs a migration.
* Build tooling advisories (eslint-config-next 14, tailwind 3 chain) need major upgrades (AUD-17).
* One intermittent React #418 hydration warning (see Tests). A targeted reproduction (64 account-page loads, signed in and out, 8 sections) gave 0 errors.
* The store's exchange-rate effect can run twice on a page whose language dictionary suspends: one extra `/api/rates` request whose result is discarded. Harmless; noted.

### Tests run this round (real results)

| What | Result |
|---|---|
| `npm run typecheck`, `next lint` | clean |
| `test:store` / `test:security` / `test:refunds` / `test:assistant` | 6 / 138 / 61 / 105 pass |
| Harness: dashboard figures vs SQL, API + browser at 1280/390 | 15/15 |
| Harness: round-4 checks (no-0059 503s, partial refund on tracking page, readable refusals) | 10/10 |
| Harness: order screen ↔ refund cases, dashboard `?limit` | 9/9 |
| Harness: refund integration / refund UI | 107/107, 12/12. The UI suite timed out once on one navigation; it did not reproduce and its re-run passed. |
| Earlier regression suites (payments, fraud, security, prices, hydration/404, size finder, no-referral, old integration) | all pass: 33, 35, 47, 17, 29, 106, 20+13, 24 |
| Same regression suites on **Next 15.5.28** | identical results. One React #418 (hydration) in `noref-ui` at 1280px did not reproduce in 3 reruns (13/13 each): intermittent, most likely time-dependent text, not caused by the upgrade. |
| axe (WCAG 2.2 AA) | admin + refund pages 0 violations (was 4); storefront pages 0 |
| Harness UI suite, made robust | `networkidle` waits replaced with element waits; the cookie banner accepted in admin contexts. Both were test artefacts: the pages finish loading in ~3 s with no open requests. 12/12. |
| Older audit suites | 13 expectations superseded by design. 9 are order-screen refunds that now require personal staff confirmation (403 STAFF_REQUIRED). 4 are reservations whose PaymentIntent does not exist at Stripe, now released (PR #24). |

The harness suites live outside the repository: real Postgres + PostgREST, a fake Stripe, and the production build.
