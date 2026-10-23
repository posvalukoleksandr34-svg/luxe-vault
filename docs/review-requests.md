# Post-delivery review requests

One email per delivered order: "How was your purchase?", sent a configurable
time (48 h by default) after the **confirmed delivery**, with a link that lets
the customer rate that order's products without signing in.

**Off by default.** Requests are created and wait in the queue; nothing is
emailed until the owner turns sending on in **Admin → Запросы отзывов**.

## Files

| Part | Where |
|---|---|
| Schema | `supabase/migrations/0060_review_requests.sql`: `review_requests`, `email_suppressions`, `claim_review_requests()` |
| Rules (pure, unit-tested) | `lib/review-requests.ts`: settings schema, schedule, back-off, `decide()` |
| Scheduling and reconciliation | `lib/server/review-requests/schedule.ts` |
| Worker | `lib/server/review-requests/worker.ts` |
| Link token | `lib/server/review-requests/tokens.ts` |
| What a link may do | `lib/server/review-requests/links.ts` |
| Admin queries and actions | `lib/server/review-requests/admin.ts` |
| Settings storage | `lib/server/review-requests/settings.ts` (`store_settings` key `review_requests`) |
| Email | `lib/server/emails/review-request.ts` (en, ru, it, fr, de) |
| Cron | `app/api/cron/review-requests/route.ts`, run hourly by `.github/workflows/abandoned-carts-cron.yml` |
| Customer pages | `app/review/[token]` and `app/[locale]/review/[token]`, plus `/unsubscribe`; APIs `app/api/review-requests/{submit,unsubscribe}` |
| Admin | `app/admin/review-requests`, `components/admin/review-requests/`, `app/api/admin/review-requests/**` |
| Tests | `tests/store/review-requests.test.ts`, `tests/db/review_requests.sql`, `tests/db/concurrency.sh` (claim race) |

## How delivery is detected

The clock is `orders.delivered_at`. The `orders_stamp_status` trigger writes
it the first time an order is set to `delivered` and never moves it. Shipped,
out-for-delivery and estimated dates are never used.

There are two ways in, and both are idempotent because `order_id` is unique:

1. **Event.** `setOrderStatus()` in `lib/server/orders-store.ts` calls
   `onOrderDelivered()` (fire-and-forget) when an order becomes `delivered`.
   A failure there never affects the status change.
2. **Reconciliation.** Every cron run creates a request for any delivered
   order (within the stale window) that has none, for example when the event
   was missed or the status was set directly in the database. It also:
   - **moves `scheduled_at`** when an order's `delivered_at` was corrected;
   - applies a changed delay to requests not yet attempted.

**Split shipments.** The shop sends one parcel per order. There is no
shipment table and no carrier API, so "every item delivered" and "the order
delivered" are the same event. If partial shipments are ever introduced, the
rule should become "schedule from the last item's delivery". That would be a
change to `scheduleForOrder()` and the `delivered_at` source.

## Who is asked, and when not

The worker decides again, from fresh data, just before each send
(`decide()`). The checks run in this order:

| Check | Result |
|---|---|
| Order cancelled | not sent (`order_cancelled`) |
| Order or payment fully refunded | `order_refunded` |
| Order no longer `delivered` | `not_delivered` |
| Fraud flag on the order (`order_payment_risk.fraud_flag`) | `fraud_flag` |
| Guest order | `guest_order`. Reviews belong to an account (0052), so the link could not lead to a review |
| Missing or unusable email (no CR/LF, commas, brackets) | `no_valid_email` |
| Address on `email_suppressions` (unsubscribed) | `unsubscribed` |
| Consent mode `marketing_consent` and no confirmed newsletter subscription | `no_marketing_consent` |
| Customer already reviewed every product in the order | `already_reviewed` |
| Delivery older than `staleAfterDays` | `stale`. Prevents a flood after downtime or after the feature is switched on |
| Another request went to this customer within `cooldownDays` | **deferred** (`next_attempt_at`), not dropped, unless the deferral passes the stale limit |

**Not selective.** An open complaint, a partial refund or a low previous
rating does **not** stop a request. Asking only happy customers would be
selective solicitation of reviews.

Other safeguards:

- **Unexpected states** are logged, for example a delivered order without
  `delivered_at`.
- **Disabled** means requests wait. The worker returns `disabled` and
  suppresses nothing.

## Sending, retries, concurrency

- **Claiming.** `claim_review_requests(limit)` takes due rows with
  `FOR UPDATE SKIP LOCKED` and marks them `sending`. Two runs at once never
  take the same row. This is proven in `tests/db/concurrency.sh` and by three
  simultaneous cron calls in the e2e run.
- **Crash recovery.** A `sending` row whose claim is older than 30 minutes
  goes back to `scheduled` with the same attempt number. Its resend carries
  the same Resend `Idempotency-Key`
  (`review-request/{id}/{nonce}/{attempt}`), so if the provider already
  accepted it, nothing new is delivered.
- **Writes after a claim** are conditional on `status = 'sending'`, so a
  request staff cancelled meanwhile is not overwritten.
- **Failures:**

  | Failure | Handling |
  |---|---|
  | Network error, 429, 5xx, 401/403 (our key or domain) | retry with back-off: 15 min × 2ⁿ⁻¹, capped at 12 h |
  | 400, 404, 409, 422 | permanent: `failed` |
  | `attempts ≥ maxAttempts` | `failed` |
  | Unexpected database error | the row goes back to the queue with back-off; the run answers 500 and alerts Telegram |

- **Non-blocking.** All of this runs in the cron route, never in a customer
  or admin request.

## The link

- **Token.** The token is HMAC-SHA256(`REVIEW_LINK_SECRET`, falling back to
  `SUPABASE_SERVICE_ROLE_KEY`; `lv-review-link:{id}:{nonce}`), in base64url
  (43 chars, 256 bits).
  - **Only its SHA-256 hash is stored.** A leaked database row is not a
    working link.
  - **Expiry.** It expires `linkValidDays` (60) after sending.
  - **Retries.** A staff retry draws a new nonce, so older links stop
    working.
- **What it unlocks.** The product names of that one order, reviewing them
  as that order's account, and the opt-out. Nothing else: no address, no
  amounts, no other orders, no sign-in.
- **Reviews.** They go through the normal rules:
  - the 0052 trigger checks purchase and delivery;
  - one review per account and product;
  - a review is written as `pending` and published only if the automatic
    moderation passes it.

  The user and order always come from the token, never from the request
  body.
- **The link stops working** when the order is no longer the account's
  delivered order, for example when it was cancelled afterwards.
- **Keeping the token out of third-party hands:**
  - review URLs are treated as secrets (`lib/sensitive-url.ts`): scrubbed
    from analytics and logs, served with `Referrer-Policy: strict-origin`;
  - the pages are `noindex` and disallowed in `robots.txt`.
- **Unsubscribe:**
  - POST only: link scanners must not unsubscribe people;
  - the email's `List-Unsubscribe` header uses RFC 8058 one-click;
  - the unsubscribe link works for 12 months after sending;
  - it suppresses the address case-insensitively and cancels its waiting
    requests.

## Configuration

Settings are edited in the admin (owner only) and validated on the server.

| Setting | Default | Range |
|---|---|---|
| `enabled` | `false` | |
| `delayHours` | 48 | 1–720 |
| `consentMode` | `marketing_consent` | `marketing_consent`, `existing_customer` |
| `cooldownDays` | 7 | 0–90 |
| `staleAfterDays` | 30 | 3–180, must be later than the delay |
| `maxAttempts` | 5 | 1–10 |
| `linkValidDays` | 60 | 7–365 |

Environment variables (names only; values live in Vercel and GitHub):

| Variable | Needed | Use |
|---|---|---|
| `RESEND_API_KEY` | yes, to send | existing Resend provider; sender `orders@luxe-vault.store` |
| `CRON_SECRET` | yes | protects `/api/cron/review-requests` (GitHub secret too) |
| `REVIEW_LINK_SECRET` | optional | separate HMAC key for links; falls back to the service-role key. Rotating it invalidates outstanding links |
| `REVIEW_TEST_RECIPIENTS` | optional | comma-separated addresses the admin "send test" may use, in addition to the shop's own address and `EMAIL_TEST_RECIPIENT` |
| `EMAIL_DELIVERY=test` | for staging | nothing reaches a customer (logged, or redirected to `EMAIL_TEST_RECIPIENT`); the admin shows that a "sent" request was test mode |

## Consent: a decision for the owner

- **`marketing_consent`** (default) emails only customers with a confirmed
  newsletter subscription. It is the safe choice everywhere.
- **`existing_customer`** emails every eligible customer who has not opted
  out. Swiss UWG art. 3(1)(o), and comparable EU rules (ePrivacy art. 13(2)),
  allow this for the shop's own customers **only if** they were told at
  checkout that they can object, and every email offers the opt-out.

The checkout does not carry that notice today. Before switching to
`existing_customer`:

1. add the notice;
2. update the privacy policy (section 3, which currently states the consent
   basis);
3. get legal confirmation.

The admin asks the owner to confirm this before the switch.

## Admin

**Admin → Запросы отзывов** (`/admin/review-requests`). Actions are recorded
in the refund audit trail (`refund_case_events`, actions `review_request*`).
What each role can do:

| Role | Can |
|---|---|
| Every role | see the list, figures and preview |
| Manager | retry, cancel, send a test email |
| Owner | change settings |

The page shows:

- **Settings**, the on/off switch and a status banner (mail not configured,
  test mode, defaults in force).
- **Figures:** counts by status, sent in 30 days, reviews through links, and
  conversion (sent requests that led to at least one review).
- **The list:** filter by status, order or customer, product and date. Each
  row shows the times (in the browser's time zone), attempts, last error and
  reason.
- **Actions:**
  - **Retry** a failed or cancelled request. It goes back to the queue, and
    the worker still decides whether it may go.
  - **Cancel** a request that has not gone out.
- **Preview** in every language.
- **Test email.** It goes only to `testRecipients()` and never to a typed
  address. It is limited to 5 per hour, and its links are inert.

## Retention

Each cron run deletes requests 12 months after they were sent. A request
that was never sent is deleted 12 months after it was created. The opt-out
list (`email_suppressions`) is kept so nobody is asked again. This matches
the privacy policy, section 5.

## Not done / limitations

- **No bounce or complaint webhook from Resend.** Hard bounces are not
  automatically added to `email_suppressions` (reason `bounced` exists for
  when it is wired). The provider's 4xx at send time is handled.
- **Guest orders are not asked** (see above).
- **Untested against the real provider.** The live Resend send path for this
  email was exercised only against a local fake. Send one test from the admin
  after deploying.

## How to test locally

- **Unit:** `npm run test:store`
- **Database:** `DATABASE_URL=… scripts/ci/verify-migrations.sh && scripts/ci/db-tests.sh`
  against a disposable Postgres.
- **End to end:** run against a production build with a fake Resend. The
  harness used for this feature intercepts `api.resend.com` in-process, so no
  email can leave the machine. It covers:
  - detection, duplicate events, reconciliation, corrected dates;
  - the disabled state, suppression rules, cooldown and stale limit;
  - retries and permanent failures, crash recovery, concurrent runs;
  - link security, expiry, unsubscribe;
  - admin RBAC and filters, test sends, retention.
