# Refunds and returns

How a customer asks for their money back, how staff decide, and how the money
actually moves. Everything below describes code in this repository. "Tested"
means a test in this repository or in the local harness exercised it. Nothing
here has been run against live Stripe or the production database.

| Part | Where |
|---|---|
| Schema, ledger, state guard, retention rules | `supabase/migrations/0059_refund_cases.sql` |
| Pure rules (no I/O): money, calculator, eligibility, state machine, risk, delivery, policy, permissions, customer copy | `lib/refunds/` |
| Services: cases, workflow, ledger, Stripe, webhooks, notifications, audit, sweep | `lib/server/refunds/`, `lib/server/refund-order.ts`, `lib/server/staff.ts` |
| Customer API | `app/api/refunds/…`, `app/api/orders/[id]/refund-request` |
| Staff API | `app/api/admin/refunds/…`, `app/api/admin/orders/[id]/refund` |
| Staff console | `/admin/returns`, `/admin/returns/[id]`, `/admin/returns/policy`, `/admin/returns/staff` |
| Customer UI | Account → Orders ("Request a refund"), Account → Returns |
| Scheduled work | `/api/cron/refunds` (hourly), `/api/cron/sweep` (nightly) |

## How it fits together

```
customer / staff ──► API route ──► requireAdmin + requireStaff(permission)   (staff)
                                   session + order ownership                 (customer)
                     │
                     ▼
              workflow.ts ──► state-machine.ts: may THIS actor do THIS from THIS state?
                     │        calculator.ts: what is owed, in integer rappen
                     ▼
         refund_case_apply()  ── compare-and-set on the case version, one transaction:
                     │           state, items, approval, event row
                     ▼
   approve ≠ pay.  initiate_refund ─► reserve_refund_transaction()   (row lock on the order)
                                       │ never over the paid total, never over the approved amount,
                                       │ one refund in flight per order
                                       ▼
                                    Stripe refunds.create  (idempotency key lv_refund:<tx>:<attempt>,
                                       │                    metadata.refund_tx_id)
                                       ▼
                                    settle_refund_transaction()  ← API answer, webhook, or hourly check
                                       rebuilds orders.refunded_amount and the case totals from the ledger
```

* **Money** is always integer minor units (rappen). The order total is CHF.
  When the card was charged in EUR or USD, the refund is converted at the rate
  the payment was made at, rounding half up. The refund that completes the
  order takes whatever Stripe still holds, so rounding never leaves a cent
  behind and never overshoots.
* **The ledger** (`refund_transactions`) is the only record of money moving.
  `orders.refunded_amount` and the case totals are summaries rebuilt from it.
  Rows are append-only apart from status settlement; a database trigger
  refuses edits and deletes.
* **Every client value is advisory.** Amounts, lines and states sent by a
  browser are recomputed or checked on the server. The customer never sends
  an amount at all.

## Case states

```
requested ─► under_review ─┬─► awaiting_customer_info ─► (customer answers) ─► under_review
                           ├─► awaiting_return_shipment ─► return_in_transit ─► return_delivered
                           │                                         └──────────► awaiting_inspection
                           ├─► approved ─► refund_processing ─► refunded | partially_refunded
                           │      └─► resolved   (replacement, reshipment, manual payout)
                           └─► rejected ─► (appeal) ─► under_review
any open state ─► cancelled | expired | disputed
expired, cancelled, rejected ─► (reopen) ─► under_review
```

Terminal states: `partially_refunded, refunded, resolved, rejected, cancelled,
expired`. A closed case still accepts notes, findings, evidence, inspection
and restocking, so the record can be completed after the money has moved.

Transitions, generated from `lib/refunds/state-machine.ts` (the database
enforces the same `from` list through `refund_case_apply`):

| Command | Who | Permission | From | To | Money | Stock |
|---|---|---|---|---|---|---|
| `provide_info` | customer | — | awaiting_customer_info | under_review | | |
| `add_return_tracking` | customer | — | awaiting_return_shipment | return_in_transit | | |
| `withdraw` | customer | — | requested, under_review, awaiting_customer_info, awaiting_return_shipment | cancelled | | |
| `appeal` | customer | — | rejected | under_review | | |
| `customer_message` | customer | — | every open state | — | | |
| `start_review` | staff | case.triage | requested | under_review | | |
| `request_info` | staff | case.triage | requested, under_review, awaiting_inspection | awaiting_customer_info | | |
| `authorize_return` | staff | case.decide | requested, under_review | awaiting_return_shipment | | |
| `record_return_shipped` | staff | case.return | awaiting_return_shipment | return_in_transit | | |
| `mark_return_delivered` | staff | case.return | awaiting_return_shipment, return_in_transit | return_delivered | | |
| `receive_return` | staff | case.return | awaiting_return_shipment, return_in_transit, return_delivered | awaiting_inspection | | |
| `record_inspection` | staff | case.return | awaiting_inspection, under_review, approved, refund_processing, and the closed money states | under_review once every item is inspected | | yes |
| `restock` | staff | case.return | as `record_inspection` | — | | yes |
| `approve` | staff | case.decide | requested, under_review, awaiting_inspection | approved, or waits for a second approval | | |
| `second_approve` | staff | refund.second_approve | as `approve` | approved | | |
| `withdraw_approval` | staff | case.decide | …, approved | under_review | | |
| `reject` | staff | case.decide | any state before approval | rejected | | |
| `initiate_refund` | staff | refund.execute | approved | refund_processing | yes | |
| `record_manual_refund` | staff | refund.execute | approved | refunded / partially_refunded | yes | |
| `check_refund` | staff | refund.execute | approved, refund_processing | — | yes | |
| `mark_resolved` | staff | case.decide | approved | resolved | | |
| `cancel` | staff | case.decide | any state before approval | cancelled | | |
| `reopen` | staff | case.decide | expired, cancelled, rejected | under_review | | |
| `resolve_dispute` | staff | case.decide | disputed | under_review | | |
| `assign`, `escalate`, `de_escalate`, `send_message`, `update_investigation`, `reassess_risk` | staff (escalate, reassess also system) | see code | open states | — | | |
| `add_note`, `record_evidence`, `record_finding` | staff | case.note / case.triage / case.decide | any | — | | |
| `wait_for_delivery`, `end_delivery_wait` | staff, system | case.triage | requested, under_review | under_review | | |
| `expire` | system | — | awaiting_customer_info, awaiting_return_shipment | expired | | |
| `settle` | provider, system | — | refund_processing, refunded, partially_refunded | from the ledger | yes | |
| `mark_disputed` | provider, staff | case.decide | open states | disputed | | |

Unit tests in `tests/refunds/` check the table's invariants:

* a customer command never moves money, decides, or touches stock;
* every staff command needs a permission;
* money moves only with `refund.execute`;
* closed cases accept only the commands listed above.

## Fraud prevention

* **Explainable, configurable, advisory.** `lib/refunds/risk.ts` scores a case
  from 13 rules (repeat non-delivery claims, many recent requests, prior
  refunds of the same item, claims contradicting the shop's own records,
  duplicate return tracking, duplicate evidence, and others). Every rule's
  weight and on/off switch is in the policy. Each assessment is stored with
  its reasons, the engine version and the policy version.
* **No personal characteristics.** The engine is never given name,
  nationality, address, language or age.
* **One signal is never enough.** A case is high only when at least two
  different rules fire, and each weight is capped below the high threshold.
  Missing data does not fire a rule.
* **High risk means a person looks first.** Nothing is ever refused
  automatically. High risk requires a written justification to approve, and
  optionally a second approver.
* **Customers never see risk.** Customer API responses are built by
  `customer-view.ts`, which has no risk, finding or internal-note fields.
* **Non-delivery is investigated, not assumed.** There is no carrier API.
  Tracking evidence is either typed in by staff from the carrier's page, with
  the time they looked, or derived from the shop's own dispatch record. A
  field nobody provided shows as "not available" and is never filled in.
  "Delivered" on a tracking page is a signal, not proof. The recommendation in
  `lib/refunds/delivery.ts` is advice with reasons; staff can decide
  otherwise with a recorded reason.
* **Splitting does not dodge the second approval.** The threshold is measured
  against the order's whole refund exposure:
  `committedMinor` (refunded + in flight) + what other open cases are approved
  to pay + this approval. The order-screen refund uses the same sum.

## Payment integration

* **Stripe** (card payments): real `refunds.create` calls through the SDK.
  * Approval and execution are separate commands, permissions and audit
    events.
  * Retries reuse the same idempotency key per attempt.
  * When Stripe's answer is lost (timeout, 5xx), the ledger row stays
    `unknown`. The hourly check looks the refund up by `metadata.refund_tx_id`
    and only submits again after 10 quiet minutes with no refund found, up to
    3 attempts.
  * A reservation is cancelled only when Stripe confirms there is no refund.
* **Webhooks** (`/api/payments/stripe/webhook`):
  * `refund.created`, `refund.updated`, `refund.failed` and
    `charge.refund.updated` settle ledger rows;
  * `charge.refunded` also picks up refunds made in the Stripe dashboard and
    records them as `external`, exactly once;
  * `charge.dispute.created` marks the case disputed.
  * Events are deduplicated by event id.
* **NOWPayments** (crypto): no refund API exists. Staff pay out by hand and
  record it with `record_manual_refund` (amount, reference, note). The system
  never claims a crypto refund went through Stripe.
* **Fraud guard:** an early fraud warning on an unshipped, paid order refunds
  automatically. This existing behaviour is kept, and now goes through the
  same ledger with one idempotency key per order.

## Security

* **Two layers for staff.** `requireAdmin()` checks the existing admin login
  with TOTP. `requireStaff(permission)` checks which person is acting.
  * Personal passphrases are stored with scrypt (N=32768).
  * 5 wrong passphrases lock the account for 15 minutes.
  * The bind rate limit fails closed.
  * Roles nest: viewer ⊂ agent ⊂ manager ⊂ owner.
* **Customers** reach only their own orders and cases. Another customer's
  case number is answered as "not found". Photo paths must sit under the
  customer's own upload prefix.
* **CSRF:** the shop's existing middleware guard (`lib/server/csrf.ts`)
  refuses cross-site writes, based on `Sec-Fetch-Site` and `Origin`, before
  any handler runs. Rate limits apply: `refunds.read`, `refunds.write`,
  `admin.staff_bind`.
* **Uploads:** the declared type must match the file's magic bytes, and files
  are capped at 4 MB. They are stored in private buckets and served only
  through short-lived signed URLs after an access check.
* **CSV export** neutralises spreadsheet formulas.
* **Audit:** every command writes a `return_request_events` row with actor,
  role, before/after and correlation id. The table is append-only; the only
  delete allowed is the 5-year retention purge.

## Testing

| Suite | Command | Result on this branch |
|---|---|---|
| Rules (calculator, eligibility, state machine, risk, delivery, policy, staff passphrases, currency, CSV, filters, copy) | `npm run test:refunds` | 61 pass |
| Database (ledger caps, CAS, guards, retention, four concurrent refunds) | `scripts/ci/db-tests.sh` | 142 PASS lines, 0 failed |
| Fresh database, all migrations, access rules | `scripts/ci/verify-migrations.sh` | 59 applied, "access rules hold" |
| Typecheck, lint, production build | `npx tsc --noEmit`, `npx next lint`, `npx next build` | clean |
| Existing suites | `npm run test:security`, `npm run test:assistant` | 133 and 105 pass |

CI runs the first three suites.

Two more suites ran **only in a local harness**, outside the repository: real
Postgres and PostgREST, a stand-in for Supabase auth and storage, a fake
Stripe API, and the production build behind the edge proxy.

* **Integration, 107 checks**, covering:
  * access and IDOR;
  * every claim type;
  * Stripe success, pending, decline, 5xx and lost answers;
  * reconciliation, webhooks and dashboard refunds;
  * EUR conversion;
  * dual approval, including split refunds;
  * manual payouts, inspection and restock, notifications, retention.
* **Browser (Playwright), 12 checks**: the customer dialog and request page
  at 390 and 1280 px, and the staff console and case page.

## Configuration required

Names only. Values belong in Vercel or the Supabase dashboard, never in the
repository.

1. **Apply migration `0059_refund_cases.sql`.** It adds the tables, functions,
   triggers and the private `refund-evidence` bucket. It is additive:
   * existing returns are kept and mapped onto the new states, and a trigger
     keeps the old `status` column in step;
   * refunds already on orders get one `backfill` ledger row each.
2. **Environment variables:**
   * already used by the shop: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
     `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
     `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `RESEND_API_KEY`, `CRON_SECRET`;
   * optional, for staff alerts in Telegram: `TELEGRAM_BOT_TOKEN`,
     `TELEGRAM_CHAT_ID`.
3. **Stripe webhook.** Add these events to the existing endpoint
   `/api/payments/stripe/webhook`:
   * `refund.created`, `refund.updated`, `refund.failed`;
   * `charge.refund.updated`, `charge.refunded`;
   * `charge.dispute.created`.

   Keep `radar.early_fraud_warning.created` and the `payment_intent.*` events.
4. **Scheduler.** The GitHub workflow `abandoned-carts-cron.yml` calls
   `/api/cron/refunds` hourly. It needs the repository secret `CRON_SECRET`,
   and the variable `SITE_URL` if the shop is not on the default domain.
5. **Staff accounts.** Until an owner exists, the shared admin login acts as
   owner and is shown as "Администратор (общий вход)". Create personal
   accounts under Админ → Возвраты → Сотрудники, starting with an owner.
   Shared-login mode cannot give a second approval.
6. **Policy.** Review Админ → Возвраты → Политика. Dual approval is **off**
   by default (`secondApprovalMinor: null`), because a second approver who
   does not exist would block every large refund. Turn it on once two people
   can approve. Each save creates a new policy version; cases keep the
   version they were opened under.

## Remaining issues and decisions for the owner

* **No carrier API.** Swiss Post tracking needs a business contract. Until
  then, delivery evidence is staff-entered and labelled as such.
* **Crypto refunds are manual.** NOWPayments has no refund API.
* **Record keeping vs privacy policy.** Swiss CO art. 958f asks for 10 years
  of business records. The privacy policy promises order deletion after 5
  years, and the refund ledger is deleted with the order. Which period
  applies is a legal decision. Changing it is one retention constant plus the
  policy text.
* **The automatic fraud-guard refund** on early fraud warnings is kept as it
  was. Turn it off if every refund must be a human decision.
* **Privacy text in fr/de** falls back to English for the new returns
  paragraphs, as the rest of those pages does.
* **Local-only suites.** The integration and browser suites are not in CI;
  they need the harness stand-ins. **The live Stripe path is unverified.**
  Test a small real refund in Stripe test mode, then live, after deploying.
* **Shared-login mode** has no per-person accountability. The journal shows
  "общий вход" until personal accounts exist.
