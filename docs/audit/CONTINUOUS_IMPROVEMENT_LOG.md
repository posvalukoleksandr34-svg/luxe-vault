# Continuous improvement log

One entry per completed task, newest first. Owner actions live in
[OWNER_APPROVAL_CHECKLIST.md](OWNER_APPROVAL_CHECKLIST.md); the ranked queue
and working notes in [CONTINUOUS_IMPROVEMENT_BACKLOG.md](CONTINUOUS_IMPROVEMENT_BACKLOG.md).

Test results are what was actually run, on the branch, against the local
stand: production build (`next build` + `next start`), real Postgres 16 with
PostgREST, a fake Stripe. Nothing here was deployed, migrated in production,
paid, refunded or emailed.

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
