# Product reviews: verified buyers only — 2026-10-05

A product review can be written only by a signed-in customer who has a
**delivered** order containing that product, and only **once per product**.
Migration [`0052_verified_buyer_reviews.sql`](../../supabase/migrations/0052_verified_buyer_reviews.sql)
must be applied for reviews to work at all; until it is, the page shows no
form and the API accepts nothing.

"Delivered" is the order status that counts. Orders run pending → processing →
shipped → delivered; there is no separate "completed" status. A paid order
that is still on its way does not count yet.

## What was wrong

| Severity | Finding | Fix |
|---|---|---|
| MEDIUM | **Any delivered order let a customer review any product.** 0004's insert policy checked that the order was the customer's own and delivered, never that it contained the product. Through the public REST API, someone who had bought a scarf could post a "verified purchase" review of a coat. Reproduced on Postgres 16 against the old policy. | The insert policy and a new trigger both require an order of the reviewer's, delivered, containing this product. |
| LOW | **One review per order, not per product.** The unique index was (customer, product, order), so buying an item twice allowed two reviews. | Unique (customer, product). |
| LOW | **Customers could write `status` and `created_at` directly** (the policy forced `pending`, but `created_at` could be backdated). | Column-level grant: customers may insert only `user_id, product_id, order_id, rating, comment`. |
| LOW | **Submitting never worked.** The API did not send `user_id` (NOT NULL, no default), so every insert failed and every buyer was told they were not eligible. | The API sends the signed-in user's id. |

## How it is enforced

1. **API** (`app/api/products/[slug]/reviews/route.ts`): `review_eligibility()`
   reads the customer's own order history in the database. Nothing in the
   request body (an order id, a user id, a flag) is used to decide it.
   - `401 SIGN_IN_REQUIRED`: no session
   - `403 NOT_VERIFIED_BUYER`: no delivered order of theirs contains the product
   - `409 ALREADY_REVIEWED`: they have already reviewed it (pending, published or rejected)
   - `400`: malformed body, or a rating other than a whole number 1–5
   - `201`: accepted as `pending`
   - `503`: the database could not be asked. The API fails closed.
2. **RLS**: the insert runs as the customer, so the policy
   "verified buyers review products they received" asks the same question.
3. **Trigger** `reviews_require_purchase`: asks it of every writer, the
   service role included. No admin tool, import or future endpoint can create a
   review without the purchase. Moderation (status changes) is unaffected, and
   a purged order leaves its review with `order_id` null.
4. **Unique index** `reviews_one_per_user_product_idx`.

The migration stops, having changed nothing, if a customer already has two
reviews of one product. The operator then chooses which one to keep.

## What the product page shows

Below the reviews (`components/products/product-reviews.tsx`), according to
the server's answer:

| Visitor | Shown |
|---|---|
| Not signed in | "Accedi per lasciare una recensione": opens sign-in |
| Signed in, no delivered order with the product | "Solo gli acquirenti verificati possono recensire questo prodotto", plus a line saying a review is possible once such an order is delivered |
| Already reviewed | "Hai già recensito questo prodotto" |
| Verified buyer | The form: no stars pre-selected, a rating is required |

All four are translated for en / it / fr / de (and ru). If the server's
answer changes while the form is open (session expired, a review sent from
another tab), the page switches to the matching state.

## Tests

These run against `next build` + `next start`, through the edge proxy, on real
Postgres 16 + PostgREST (scratch harness, not in the repo):

- **Database (33)**, calling the REST API directly around the application:
  - non-buyer;
  - someone else's order, or someone else's user id;
  - own order of another product;
  - not yet delivered, or cancelled;
  - self-approval or backdating;
  - no session;
  - second review, including from a second order;
  - service role without a purchase, or moving a review to another product;
  - moderation still works;
  - order purge;
  - the migration's duplicate guard.
- **API (30):**
  - every status code above;
  - CSRF;
  - an order id in the body is ignored;
  - two concurrent submissions → one 201, one 409, one row;
  - `Cache-Control: private, no-store`;
  - approved reviews listed with first name only, pending ones neither listed nor counted.
- **Browser (26):**
  - each state in it, plus en/fr/de;
  - the sign-in link opens sign-in;
  - an empty submit asks for a rating;
  - a submitted review is stored as pending;
  - the 409 switch;
  - the empty-state layout;
  - axe: no violations in the review area;
  - no console errors.

## Still open

- **No admin screen moderates product reviews.** The admin "Reviews" tab
  moderates store testimonials (`site_reviews`). A product review stays
  `pending`, and invisible, until its `status` is set to `approved`, for now
  in the Supabase table editor (`reviews`).
