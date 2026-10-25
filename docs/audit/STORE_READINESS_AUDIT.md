# Store readiness audit: catalogue, product pages, checkout (2026-10-25)

Scope: the code at `ed4d44e` (`main` = `55101f5`, PR #31, plus a merge
commit). Read before any change:
- `PROJECT_IMPROVEMENT_LOG.md`;
- the audit documents in `docs/audit/`;
- `docs/admin-console.md`;
- the catalogue modules (`lib/types.ts`, `lib/departments.ts`, `lib/data.ts`,
  `lib/server/catalog-store.ts`, `lib/server/catalog-listing.ts`,
  `lib/server/taxonomy.ts`);
- the catalogue, category and product routes and their components;
- cart validation, order drafting, the Stripe intent route and webhook, the
  success page and the reconciliation module;
- migrations 0005, 0026, 0040 and 0061;
- the CI workflow.

Production data could not be read from here (no network access to the live
site or its database). Anything said about what production holds is marked as
inferred.

Findings are ranked within each group. **B** = blocks a lawful launch,
**H** = high, **M** = medium, **L** = low.

## 1. Launch blockers

| # | Rank | Finding | Evidence |
|---|---|---|---|
| S-1 | **B** | **Every saved product is on sale at once; there is no publication or rights state.** The schema has no draft, published or withdrawn status (`docs/admin-console.md`, "Not done"). So nothing can keep a product whose sale rights are unconfirmed out of the catalogue, search, sitemap, cart or checkout. | `lib/server/catalog-store.ts`: every read returns every row. Public read paths: `readCatalog`, `getProductBySlug`, `getProductsBySlugs`, `listProductSlugs`, the `search_products` RPC, `readVariantStock`, and `/api/catalog`. |
| S-2 | **B** | **The shop describes its goods as replicas.** This includes `terms.ts` ("premium replicas, not authentic branded goods"), the footer tagline, the checkout note, a "Replica" tag on every card, and the site description and keywords ("premium replicas", "replica sneakers"). The seed catalogue names a third-party brand ("Gucci … Hoodie"); its images are already gone from `public/images`. The disclosure itself is honest. The problem is the assortment it discloses. | `rg -i replica`; `lib/data.ts`. |
| S-3 | **B** (owner) | Unchanged from the readiness report:<br>• C-1: no offsite backup;<br>• C-2: six orders where Stripe holds a succeeded or processing payment while the order is unpaid;<br>• C-3: burned admin credentials;<br>• OA-01 / OA-02: no lawyer or payment-provider confirmation. | `PRODUCTION_READINESS_REPORT.md` §8. |
| S-4 | **H** | **Strike-through "old prices" have no basis.** `oldPrice` is a free number the admin types. Every seed product carries one with no price history behind it. Swiss and EU price-indication rules tie a reference price to a price actually charged. | `components/products/discount-badge.tsx`; the `products.old_price` column; no price history anywhere. |

## 2. Catalogue structure and data sources

| # | Rank | Finding | Evidence |
|---|---|---|---|
| C-1 | **H** | **Empty departments and categories are shown to customers.**<br>• The side menu, the sidebar and the department cards list every category, including "Coming soon" cards for empty ones.<br>• The sitemap already skips empty ones; the navigation does not.<br>• Migration 0040 created Women, Men and Kids, each with a broad Clothing / Shoes / Accessories set, and left the old clothing/shoes/accessories collections in place.<br>• Production therefore likely shows both sets, with many empty entries. This is inferred: the live data is not visible. | `components/site-menu.tsx` (`categoryTree`), `components/products/subcategory-cards.tsx` ("Coming soon"), `supabase/migrations/0040_gender_departments.sql`. |
| C-2 | M | **Two sources for the taxonomy.** When the database holds no collections, the store and `readTaxonomy` fall back to the hard-coded `CATEGORY_TREE`. That shows categories nobody created, all empty. `DEFAULT_CATEGORY_IMAGES` points at `/images/sneakers.png` and `/images/bag.png`, which do not exist. `SEED_PRODUCTS` is used only by `scripts/seed-catalog.mjs`. | `lib/server/taxonomy.ts`, `lib/store.tsx` (`categoryTree`), `components/admin/collections-manager.tsx`, `ls public/images`. |
| C-3 | M | **Category names and order cannot be edited in the admin.** Only create, delete and the cover image exist. The brief requires editable names, images and order. | `lib/server/catalog-store.ts` (`createCategory`, `deleteCategory`, `updateCategoryImage`), `app/api/admin/categories`. |
| C-4 | M | **Labels are keyed by category slug alone**, although since 0040 a slug is unique only within its department. Two departments with a same-slug category share one label. | `lib/store.tsx` (`categoryLabels`). |
| C-5 | L | **Department pages have no description.** The collections table has no column for one. | `0005_catalog.sql`. |

**Status (2026-10-25, this branch):**
- **C-1 fixed.** The server counts the products on sale (published, sold out
  or not) in each department and category. The menu, the catalogue sidebar,
  the filter chips, the department cards on the homepage and the category
  cards on a department page show only those with at least one. "Coming soon"
  cards are gone. An empty department or category page still answers (links
  do not break) but is `noindex`. A temporarily sold-out product keeps its
  category visible.
- **C-2 fixed.** `CATEGORY_TREE` and `DEFAULT_CATEGORY_IMAGES` are removed;
  the taxonomy comes from the database alone. When the page's own server
  render could not read it, the browser asks `/api/catalog?part=taxonomy`
  once instead of showing invented categories. `SEED_PRODUCTS` stays for
  `scripts/seed-catalog.mjs`, without the third-party-brand entry and without
  typed old prices; seeded products arrive as drafts.
- **C-3 fixed.** The admin renames and reorders departments and categories
  (pencil on each card). Slugs stay fixed, since they are in every link. Each
  card shows "N товаров · в продаже M" and says when it is not shown in the
  shop.
- **C-4 fixed.** Labels are keyed by department and category
  (`categoryLabel(group, slug)`); the bare-slug key keeps the first
  department's name for older callers.
- **C-5 fixed** with migration 0064 (OA-22): an optional short description
  per department, shown under its title and used as its meta description.
- **Kept two levels.** No third level was added. The 0040 "Clothing / Shoes /
  Accessories" categories under each department stay in the database and are
  hidden while empty. The owner can rename, reorder or delete them.

## 3. Catalogue page, filters and sorting

| # | Rank | Finding | Evidence |
|---|---|---|---|
| F-1 | M | **"Newest" sorts by the `isNew` flag, not by date added.** Two new pieces keep an arbitrary order. | `components/products/product-grid.tsx`, the `newest` branch. |
| F-2 | M | **"Biggest discount" sorts on the unverified `oldPrice`** (S-4). | same |
| F-3 | — | URL sync of filters and sort, back/forward and shareable links already exist (`components/products/filter-url-sync.tsx`). Price, size, colour and availability filters exist. Kept. | — |
| F-4 | L | **No popularity sort** — acceptable. If one is added, it must come from paid orders. | — |

**Status:** F-1 fixed (sorted by the date the product was added). F-2 resolved
by S-4: `oldPrice` now comes only from price history, so "biggest discount"
orders by real reductions. The result count says "1 item found", not
"1 items found".

## 4. Product page and cards

| # | Rank | Finding | Evidence |
|---|---|---|---|
| P-1 | **H** | **Nothing checks a product is complete before it is sold.** A product with no image, no description in the shop's languages, no sizes or no price is live as soon as it is saved. The editor validates only the name and price. | `components/admin/product-form.tsx`, `app/api/admin/products/route.ts`. |
| P-2 | M | **The "old price" and discount badge** show whatever was typed (S-4). | `discount-badge.tsx`. |
| P-3 | — | Kept, verified as real data:<br>• the low-stock line ("only N left"), from real variant stock;<br>• reviews, which are verified buyers only (migration 0052);<br>• no countdowns or "N people are viewing" messages exist. | — |

## 5. Cart, payment and orders

Verified in code, no change needed:
- Prices are re-read on the server (`lib/server/order-drafts.ts`).
- Stock is decremented atomically in `place_order()`, so two buyers cannot get
  the same unit.
- Webhook events go through an idempotent ledger (`stripe_events`).
- A payment marks an order paid only for that order's amount and currency.
- Late failures cannot un-pay an order.
- Refunds and partial refunds are separate states (`partially_refunded`).
- The success page never marks anything paid.
- One order per checkout attempt (CI-1).

| # | Rank | Finding | Evidence |
|---|---|---|---|
| O-1 | **H** | **The success page says "processing" for a FAILED or EXPIRED payment.** It also never refreshes, so a payment confirmed two seconds after arrival still reads "processing". | `app/checkout/success/page.tsx`: `paymentStatus === 'paid' ? success : processing`, one fetch. |
| O-2 | **H** | **There is no admin screen for payment reconciliation.** `/api/admin/reconciliation` exists but returns JSON only. That is the tool the owner needs for C-2 (six orders, Stripe paid / shop unpaid). Nothing can apply Stripe's status after an owner checks it. | `app/api/admin/reconciliation/route.ts`; `grep reconciliation components app/admin` → nothing. |
| O-3 | M | **A payment refused for an amount or currency mismatch only raises an alert.** It is one of the possible causes of C-2. The order screen does not show it. | `app/api/payments/stripe/webhook/route.ts` (`chargeMismatch`). |

**Status (2026-10-25, this branch):**
- **O-1 fixed.** `/checkout/success` shows the payment's recorded state:
  - paid: thank-you;
  - pending or confirming: "processing", re-reading every 3 s for up to a
    minute, so it turns to "paid" by itself;
  - failed: "declined";
  - expired: "incomplete";
  - order cancelled: "cancelled", with no payment link.

  A failed lookup shows an error with a retry, not "order not found". The
  analytics purchase event fires for paid orders only. A guest is pointed to
  support, not to an account they do not have.
- **O-2 fixed.** `/admin/reconciliation` ("Сверка платежей", under Продажи)
  lists every discrepancy, with what it means and what to do. One kind,
  `paid_not_recorded`, has a button. `POST /api/admin/reconciliation/apply`
  then:
  - fetches the PaymentIntent from Stripe itself;
  - checks it is `succeeded`;
  - checks it belongs to the named order, and the order is bound to no other
    payment;
  - checks it paid the full amount in the order's currency;
  - runs the webhook's own code, now shared as
    `lib/server/stripe-payment-apply.ts`: the same state machine, stock check,
    Telegram slip and receipt, each once only.

  Applying twice, or a late webhook afterwards, changes nothing. Nothing is
  ever un-paid from a button.
- **O-3 addressed.** An unrecorded payment that is short or in another
  currency is listed as `amount_mismatch` or `currency_mismatch`, never as
  "paid, not recorded", and has no button. A payment still processing at the
  bank is listed as `processing_not_recorded`.
- Payment reminders for unpaid orders skip orders holding a product no longer
  on sale, which cannot be paid (migration 0062).
- The six live orders of C-2 are **not** touched: deciding them is the
  owner's, on the live site, after deploy (OA-03).

## 6. SEO and localisation (to re-verify after the changes)

- Canonical, hreflang, sitemap and JSON-LD are present and were verified in
  CI-10, including localised home titles.
- `ItemList` JSON-LD and the sitemap must list only publicly sold products
  after S-1.
- The site keywords include "premium replicas" and "replica sneakers" (S-2).

## 7. Plan

1. **S-1.** Publication and rights gate:
   - a migration;
   - every public read path;
   - the admin review flow;
   - the product fields required before publishing (P-1);
   - tests.
2. **S-4.** A price-history basis for old prices; no basis, no strike-through.
3. **C-1, C-2, C-4.** Navigation from published products only; one data
   source; labels per department and category.
4. **C-3.** Category name and order editing in the admin.
5. **O-1, O-2.** A truthful success page with a short refresh; an admin
   reconciliation page where the owner decides each discrepancy.
6. **F-1, F-2.** Real date-added sort; the discount sort drops unverified
   prices.
7. SEO and localisation re-check, responsive checks at 320/390/768/1280, full
   test run, report.

**Not done, because it needs the owner or counsel:**
- changing the shop's legal and marketing statements about replicas (S-2);
- applying migrations;
- touching any live order;
- deploying.
