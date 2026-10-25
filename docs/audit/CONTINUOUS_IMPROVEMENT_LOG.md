# Continuous improvement log

One entry per completed task, newest first. Owner actions live in
[OWNER_APPROVAL_CHECKLIST.md](OWNER_APPROVAL_CHECKLIST.md); the ranked queue
and working notes in [CONTINUOUS_IMPROVEMENT_BACKLOG.md](CONTINUOUS_IMPROVEMENT_BACKLOG.md).

Test results are what was actually run, on the branch, against the local
stand: production build (`next build` + `next start`), real Postgres 16 with
PostgREST, a fake Stripe. Nothing here was deployed, migrated in production,
paid, refunded or emailed.

---

## CI-8 · Admin → Stock: a failed load is not an empty warehouse (2026-10-25)

**Problem.** The stock page ignored a failed answer (`if (!res.ok) return`)
and had no handler for a network failure, so an error looked like a shop
with no products: "0 positions, 0 units" and an empty table. Staff could
take that at face value (re-enter stock, import a file against what they
believe is an empty list).

**Change.** `components/admin/inventory-manager.tsx`: a failed first load
shows an alert ("Не удалось загрузить остатки. Данные не изменились…") with
"Повторить" instead of the table; a failed reload after a save keeps the
list on screen and shows a toast. The list is requested with
`cache: 'no-store'`. Same red alert style as the customers page.

**Tests (real results).** Production build, signed in as admin with TOTP
(`adm/inventory-fail.js`) 3/3: GET answered 500 → the alert with Повторить,
no "Позиций" table; Повторить → the real list; no uncaught errors. Admin
end-to-end suite (`adm/e2e.js`, including the stock edits, conflict and
import paths) 70/70. Typecheck, lint, build clean.

**Remaining (looked at, not changed).** Support inbox and the notification
bell keep what is on screen on a failed refresh and toast/stay silent; on a
failed first load they can show their empty state. Lower stakes (no data is
written from those views); left in the backlog.

---

## CI-7 · Saved cards: a Stripe or network failure is not "no saved cards" (2026-10-25)

**Problem.** The same fault as CI-6, one layer deeper. `GET
/api/account/cards` caught any Stripe error and answered `{ cards: [] }`, and
the card list in Account → Address book showed "No saved cards" for that and
for a failed request alike: a customer with saved cards was told they had
none whenever Stripe or the connection hiccuped. A failed remove showed the
toast "Could not place the order" (the wrong string).

**Why it mattered.** A customer told their card is gone may add it again or
lose trust in the payment page; the wrong toast text made a remove failure
look like a checkout failure.

**Change.**
- `app/api/account/cards/route.ts`: a Stripe failure while listing answers
  502 `{ error }` and is logged (message only, no card data). Unchanged: no
  Stripe configured or no Stripe customer → `{ cards: [] }` (that really is
  "none").
- `components/saved-cards.tsx`: a non-OK answer or a network failure shows
  `LoadError` ("Could not load your saved cards", Try again) instead of the
  empty text; a failed remove shows "That did not work. Check your connection
  and try again".
- `lib/ui-strings.ts`: new `cards.loadFailed` (five languages, formal
  German); CI-6's `address.actionFailed` renamed `common.actionFailed`, now
  shared by both lists.

**Tests (real results).** Browser on the production build, signed in as a
test customer with a Stripe customer id (`cards-fail.js`) 7/7: against the
stand's fake Stripe, which does not answer payment-method listings, the API
answers 502 (before: an empty list) and the page shows the error, not "No
saved cards"; offline retry keeps the error; Try again with a working answer
shows the card; DELETE answered 500 → the toast above, card still listed; no
uncaught errors. Addresses test (CI-6) 5/5 again after the string rename.
Unit suites: security 152/152, store 78/78, refunds 61/61, assistant
105/105. Typecheck, lint, production build clean.

**Limitations.** Tested against a fake Stripe, not Stripe itself. The list
is fetched again on each open; there is no cached copy to show while Stripe
is down.

---

## CI-6 · Saved addresses: a network failure is not "no addresses" (2026-10-25)

**Problem.** In Account → Address book a failed load (offline, timeout,
server error) rendered the empty state "No saved addresses yet", telling
the customer their addresses were gone, although `LoadError` exists for
exactly this. A save that never got an answer threw an unhandled rejection
with no message; "Remove" and "Make default" ignored error responses and
network failures, so the click silently did nothing.

**Change.** `components/saved-addresses.tsx`: load failures set
`loadFailed` and show `LoadError` ("Could not load your addresses", with
Try again) instead of the empty state; a failed save keeps the form and
shows "Could not save the address"; a failed remove/make-default shows a
toast ("That did not work. Check your connection and try again"). Two new
strings in five languages (German formal, as the rest of the site).

**Tests.** Browser on the production build, signed in as a test customer
(`addresses-fail.js`) 5/5: load aborted → the error with retry, not the
empty state; Try again → the list; DELETE answered 500 → toast, address
still listed and still in the database; no uncaught errors.

---

## CI-5 · Checkout no longer flashes "Your cart is empty" (2026-10-25)

**Problem.** The saved cart is read in the browser after hydration; the
server renders every page with an empty cart. `/checkout` decided on that
empty cart, so its server HTML said "Your cart is empty" and every customer
arriving with a full basket saw that message before the checkout appeared
(measured: h1 sequence "Your cart is empty" → "Checkout"; on a slow
connection the wrong message was all they saw until the JavaScript ran).
The real checkout `<main>` also lacked `id="main"`, so the skip link led
nowhere on that page.

**Change.** The store exposes `cartReady` (set in the same layout effect
that restores the cart). Until then `/checkout` renders a neutral frame with
the page title, the breadcrumb/back-link spaces and a pulsing form/summary
skeleton (`aria-busy`), in the real page's container so nothing jumps; then
the form, or the empty state for a genuinely empty cart. `id="main"` added
to the checkout's main element.

**Tests.** Production build: with a saved cart the h1 sequence is only
"Checkout" and the server HTML no longer contains "Your cart is empty"
(it contains the title and `aria-busy`); with no cart the empty state
still appears. Checkout browser flow (lost response, second press) 6/6;
storefront smoke 16/16 twice (a first run had one toast check fail on a
fixed 1.2 s wait at the stand's ~5 fps; the harness now waits on the
condition); store unit tests 78/78; typecheck, lint clean.

---

## CI-4 · State pages have a page heading (2026-10-25)

**Problem.** A browser crawl of the storefront (22 routes × 1280/390 px) found
pages with no `h1`: the 404 page (every language), the empty checkout and
"order not found". Their only title was a `<p>`, so screen-reader users
navigating by heading, and search engines, found no page heading.

**Change.** `EmptyState` takes `asHeading` (1 or 2) and renders its title as
that heading with the same classes (Tailwind's reset keeps the look). Used
by `NotFoundView`, the empty checkout and the order-not-found state.

**Tests.** On the production build: exactly one `h1` on `/nonexistent-page`,
`/it/pagina-inesistente`, `/checkout` (empty) and `/order/LV-NOPE00`;
screenshot of the Italian 404 at 390 px unchanged in appearance.

**Crawl notes (not changed).** Image 500/400 responses came from the stand
(no outbound network for Unsplash images; `example.invalid` test data), not
from the site. `/cart` has no page (the cart is a drawer); nothing links to
it. `/account` and `/checkout` tabs show the site's default title.

---

## CI-3 · The cart shows what the order charges (one item capped at 20) (2026-10-25)

**Problem.** The server takes at most 20 of one item per order and silently
cut any line above that (`lib/server/order-drafts.ts`). The cart, however,
let a line grow to the full stock (e.g. 30 of 60): the basket and checkout
summary showed 30 and their total, the order was created for 20 and charged
for 20. A reload also cut the saved cart to 20 without a word.

**Change.** One constant, `MAX_LINE_QTY = 20` (`lib/cart-limits.ts`), used by
the server clamp, the saved-cart reader and the cart itself:
`addToCart` and `updateCartQty` stop at the lower of stock and 20; the
message names the reason ("Up to 20 pcs. of one item per order" — new
string `cart.maxPerLine` in ru/en/it/fr/de — versus "Only N pcs. available"
when stock is the limit); the cart line's + is disabled at the cap with the
same explanation.

**Tests (real results).** Browser on the production build (`qty-cap.js`) 6/6:
three adds of 10 with 60 in stock stop at 20 with the cap message (not "only
60"), + disabled with the note, the order placed from that cart has exactly
the cart's quantity, no page errors. Storefront smoke 16/16; unit suites
green; typecheck and lint clean.

**Limitations.** The product page's own quantity picker still allows up to
10 per press; the cart refuses the excess with the message above.

---

## CI-2 · Email bounces and spam complaints stop optional mail (2026-10-25)

**Problem.** No handler for Resend's delivery events existed
(PRODUCTION_READINESS_REPORT C-9). A hard-bounced or complaining address kept
receiving review requests and newsletters, which damages the sending
domain's reputation, and it blocked turning review requests on (OA-12).

**Change.**
- `POST /api/email/webhook` (`app/api/email/webhook/route.ts`), verified with
  Resend's Svix signature (`svix-id`/`svix-timestamp`/`svix-signature`,
  HMAC-SHA256 with `RESEND_WEBHOOK_SECRET`, five-minute window against
  replays, constant-time compare, several signatures accepted for rotation).
  No secret: every delivery refused (503). Bad signature: 401 and a
  `webhook_signature_invalid` security event.
- `lib/server/email-events.ts`: `email.bounced` (unless `bounce.type` is
  Transient) → `email_suppressions` reason `bounced`; `email.complained` →
  reason `unsubscribed`; both also set `newsletter_subscribers.unsubscribed_at`.
  Idempotent (Resend may deliver twice). The review-request worker already
  refuses suppressed addresses. Order and payment emails are unaffected.
- CSRF exemption list names the endpoint (server-to-server, signed);
  `.env.example`, `docs/review-requests.md`, OA-12 and C-9 updated. No
  migration needed: 0060 already allows these reasons.

**Tests (real results).** Unit `tests/security/email-events.test.ts` 9/9
(signature: valid, rotated, tampered body/id/timestamp, wrong key, stale,
future, malformed headers; event parsing). On the stand with a test secret
(`email-webhook-suite.js`) 11/11: bounce recorded and lower-cased, repeat
idempotent, complaint unsubscribes from the newsletter, transient bounce and
other events ignored, forged/replayed/unsigned deliveries 401 with nothing
written. Without the secret: 503, nothing written.

**Limitations.** Inactive until Resend is configured (OA-12). Tested against
locally signed payloads in Resend's documented format, not against Resend
itself.

---

## CI-1 · One order per checkout attempt (2026-10-25)

**Problem.** If the answer to "Continue to payment" was lost after the order
had been created (a dropped connection, a phone going to sleep), the customer
saw an error and pressed again. That made a second unpaid order: a second
48-hour stock reservation (items shown sold out to others), a second use of a
limited coupon and a second confirmation email. Recorded as a known gap in
`PROJECT_IMPROVEMENT_LOG.md` ("Order creation has no server-side idempotency
key").

**Why it mattered.** Stock held for nothing, confusing duplicate orders for
the customer and for staff, coupons exhausted early.

**Change.**
- Migration `0061_order_idempotency.sql`: a server-only table keyed by the
  SHA-256 of a per-attempt key (row level security on, no grants, no
  policies).
- `lib/server/order-idempotency.ts`: claim before anything is priced or
  reserved (the primary key makes it atomic), record the order number once
  it exists, release the key if no order was made. A claim with no order for
  2 minutes belongs to a request that died and may be taken over.
- `app/api/orders/route.ts`: a resend of an attempt whose order exists gets
  that order back (200, `replayed: true`, no email, no coupon use, no
  reservation); a resend while the first request is still working gets 409
  `ORDER_IN_PROGRESS` with `Retry-After: 2`. Missing key, malformed key, or
  0061 not applied: exactly the previous behaviour.
- `components/checkout-flow.tsx`: one random key per attempt, kept while the
  details are unchanged; on "in progress" it waits 1.5 s and asks again (at
  most twice, to stay inside the order rate limit).
- Retention: keys older than 7 days are deleted by the daily sweep.
- `scripts/security/verify-production.sql` and the DB test runner know 0061.

**Tests (real results).**
- Unit: `tests/store/order-idempotency.test.ts` 3/3; all suites: security
  143/143, store 78/78, refunds 61/61, assistant 105/105. Typecheck and lint
  clean; production build OK.
- DB: `tests/db/order_idempotency.sql` 8/8 (atomic claim, hash-only check
  constraint, RLS, no grants, no policies).
- API on the stand (`idem-suite.js`, outside the repo) 21/21: without 0061
  two sends make two orders (old behaviour, unchanged); with 0061 a resend
  returns the same order with its lookup token, one order, stock reserved
  once; two simultaneous sends make one order (201 + 409 in progress); a
  refused attempt frees its key; a live claim answers 409, a dead one is
  taken over.
- Browser (`idem-browser.js`) 6/6: the first press's response is cut after
  the server created the order; the second press sends the same key, gets
  the order back (200), one order in the database, and checkout moves on to
  payment.

**Limitations.** Until 0061 is applied in production (OA-19) nothing changes
live. If the server dies between creating the order and recording the key, a
retry after 2 minutes can still create a second order (the old behaviour, in
a much narrower window). The order rate limit (10 / 10 min per IP) counts
replays too.

**Follow-up.** None required beyond OA-19.
