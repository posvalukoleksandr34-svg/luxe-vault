# Project improvement log

Running record of the autonomous improvement rounds: what changed, what was
verified and how, what is still open. Earlier audits live in `docs/audit/`
(findings AUD-01…32) and the refund system in `docs/refunds/README.md`.

## Round 4 (2026-10-22)

### Done

| # | Issue | Change | Verified by |
|---|---|---|---|
| 1 | **Dashboard revenue was wrong.** It summed every non-cancelled order, so unpaid, failed and expired orders counted as revenue. Refunds were not subtracted. The average order divided by all orders, cancelled ones included. A failed load showed CHF 0 as if real. | Figures are computed on the server over all orders, in rappen (`lib/admin-metrics.ts`, `lib/server/admin-metrics.ts`, `GET /api/admin/metrics`). Revenue = settled payments minus refunds; average = paid orders only. New: last 30 days, refunded total, paid-but-unshipped and awaiting-payment counts. Load failures are shown. | `npm run test:store`: 6 tests. Browser check against the harness DB (see Tests). |
| 2 | **Customer "spent" counted unpaid orders.** The 5000-row read had no order, so the subset was arbitrary. | Only settled payments count (the same `isSettled` rule as revenue), newest first. | Same |
| 3 | **Silent load failures** in admin Customers and Reviews: a failed request looked like "no customers / no reviews". | Explicit error states. | typecheck, lint |
| 4 | Checkout: a failed card re-pricing after a currency change was swallowed. | Shows the existing "payment unavailable" toast. | typecheck |

### Checked, no change needed

* **Mutating API routes.** Every public route is rate-limited; every admin route calls `requireAdmin` (plus `requireStaff` for refunds).
* **Product deletion.** Order lines keep their own name and price, and `order_items.product_id` is not a foreign key, so deleting a product cannot break orders.

### Open / needs the owner

* Migration `0059_refund_cases.sql` must be applied in Supabase. Until then, refund features on the live site return errors. Not visible from here.
* Live Stripe is unverified (refunds, reservation cancel). See `docs/refunds/README.md`.
* AUD-02 (legal), AUD-10 (credential rotation), AUD-31 (TOTP) remain owner actions.

### Tests run this round

See the bottom of this file.
