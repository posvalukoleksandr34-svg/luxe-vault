# Owner approval checklist

Re-verified on **2026-11-04** against `main` = `7a43f8c` and this round's
branch. It supersedes `docs/audit/OWNER_APPROVAL_CHECKLIST.md` (2026-10-24),
which is now historical. Evidence and test results are in
[PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md); procedures
are in [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md).

**What "verified" means here.** The live site and the production database were
not reachable from the audit environment (the proxy refused
`www.luxe-vault.store`, HTTP 403). Production facts below come only from:
- the GitHub Actions logs of the scheduled jobs, which call the live site;
- the weekly live security check, which also calls it;
- the GitHub API.

Anything else about production is marked **PRODUCTION_STATE_UNVERIFIED**.

**Nothing on this list was done by the audit.** Nothing was:
- deployed, migrated or rotated;
- charged or refunded;
- emailed or published.

No item is marked done without evidence.

**Status values:**

| Status | Meaning |
|---|---|
| `FIXED_AND_VERIFIED` | Fixed and verified. |
| `FIXED_NOT_DEPLOYED` | Fixed in code, not yet merged or deployed. |
| `STILL_OPEN` | Still open. |
| `OWNER_ACTION_REQUIRED` | Needs the owner's action. |
| `LEGAL_REVIEW_REQUIRED` | Needs a qualified lawyer. |
| `PROVIDER_CONFIRMATION_REQUIRED` | Needs a payment provider's written confirmation. |
| `PRODUCTION_STATE_UNVERIFIED` | The production state could not be seen from here. |
| `STALE_FINDING` | The finding no longer applies. |

**Who signs.** Only two items need someone other than the owner to sign:
- OA-01, OA-25, OA-26 and OA-27 need qualified professionals (a lawyer, a
  tax adviser);
- OA-02 needs the payment providers' written confirmation.

Everything else is the owner's own decision, or a configuration only the
owner can reach.

## Order of work

1. **OA-01, OA-25, OA-02.** Can the assortment and the business model be sold
   at all? If not, nothing below matters yet.
2. **OA-03.** Six orders where Stripe may hold a customer's money while the
   shop shows them unpaid.
3. **OA-04, OA-05, OA-13.** Credentials, the second factor, branch
   protection.
4. **OA-06, OA-07.** Backups, and a restore that has actually succeeded.
5. **OA-11, OA-30.** Apply the migrations; merge and deploy this round.
6. **OA-23, OA-20, OA-26, OA-27, OA-28.** Seller identity, the product
   review, tax, privacy and supplier facts.
7. **OA-08, OA-09, OA-10, OA-15, OA-17.** Provider configuration, a sandbox
   payment and refund, alerts, a smoke test, the hosting plan.
8. **OA-24.** Open sales: last, and only when everything marked "blocks
   launch" is done.

---

## Business, legal and product legitimacy

### OA-01: Legal review of the assortment and the "replica" statements
- **Status:** `LEGAL_REVIEW_REQUIRED`, re-verified 2026-11-04.
- **Evidence.** The shop calls its goods replicas and "designer-inspired" in
  several places:
  - `app/legal/_content/terms.ts` §2: "premium replicas, not authentic
    branded goods";
  - `lib/content/imprint.ts`: "replicas and designer-inspired items";
  - the footer tagline;
  - the "Replica" tag on every product card (`lib/ui-strings.ts`
    `product.replicaTag`);
  - the site keywords.

  Migration 0062 allows publication on only two grounds:
  - an original design without third-party marks;
  - authorised resale of genuine goods.

  A product cannot be both a replica and one of those. Either the copy is
  wrong for every published product, or no product can truthfully be
  published.
- **Why it matters.** Selling goods that copy protected marks or designs is
  infringement whatever the disclaimer. Providers close accounts for it, and
  customs seize such goods.
- **Action.**
  1. A qualified IP and consumer-law lawyer (Switzerland, and the EU if you
     sell there) reviews the actual products, photos and copy.
  2. If the goods are replicas of protected designs, they must not be sold:
     do not publish them, and do not re-word "replica" as "inspired".
  3. If the goods are original or genuine, counsel approves new wording.
     The copy above is then changed with your explicit authorisation.
- **Where.** Off-platform, with counsel.
- **Evidence of completion.** A written opinion on file covering the brands,
  images, wording and price claims. Any copy changes are merged.
- **Blocks launch:** yes.

### OA-25: Reconcile the stated business model with the real one
- **Status:** `LEGAL_REVIEW_REQUIRED` (new, 2026-11-04).
- **Evidence.** The two halves of the repository describe different
  businesses.
  - `terms.ts` §1 and §3 describe a **private sale** (Privatverkauf):
    - "not a business";
    - "items sold from a personal collection";
    - "packed and posted by hand by one person";
    - a warranty limited under Art. 199 OR.
  - `lib/fulfilment.ts` describes supplier fulfilment:
    - a **supplier lead time of 20–35 days** ("ordering the item and
      quality-checking it");
    - product-level delivery windows "because dropshipped lines ship on their
      supplier's schedule".
- **Why it matters.** Repeated sales of goods bought in for resale are
  commercial trading.
  - The "private sale" framing would then be false.
  - The warranty limitation may not hold.
  - VAT, consumer-law and seller-disclosure duties differ.
- **Action.**
  1. Decide what the business actually is, with counsel:
     - who sells, as a private person or a business;
     - where the goods come from;
     - who ships, and who handles returns.
  2. Rewrite terms, refunds, privacy, the Imprint and the checkout copy
     accordingly, in all languages. Have them reviewed; do not machine-translate
     them and present them as approved.
- **Where.** Off-platform; then a code change to the `app/legal/_content/*`
  and `lib/content/*` files.
- **Evidence of completion.** The reviewed texts are merged, and match
  `lib/fulfilment.ts` and the supplier contracts (OA-28).
- **Blocks launch:** yes.

### OA-02: Payment providers accept this business and these products
- **Status:** `PROVIDER_CONFIRMATION_REQUIRED`, unchanged.
- **Why it matters.** Stripe's restricted-business list covers counterfeit and
  IP-infringing goods. A provider that disagrees can close the account and hold
  the balance.
- **Action.** Write to Stripe Support (and NOWPayments, if crypto will be
  offered). Include the real catalogue, the site and the business model
  (OA-25).
- **Where.** Stripe Dashboard → Help; NOWPayments support.
- **Evidence of completion.** A written answer from each provider, filed with
  the date and what was described to them.
- **Blocks launch:** yes.

### OA-20: Review every product's right to be sold; publish only those
- **Status:** `OWNER_ACTION_REQUIRED` and `PRODUCTION_STATE_UNVERIFIED`.
- **Evidence.**
  - The gate exists and is tested: 21 database checks, plus 14 new ones for
    the audit trail (0065).
  - Whether 0062 is applied in production, and what is published, cannot be
    seen from here.
- **Why it matters.** Only products you may lawfully sell should be on sale.
- **Action.**
  1. After OA-01, go through Admin → Товары → each product → «Продажа».
  2. Record the basis and a document reference **you can produce**: an
     invoice, a contract or a design file.
  3. Publish only those products. Leave everything else as a draft.
- **Where.** The admin console.
- **Evidence of completion.**
  - Each published product has a rights record.
  - With 0065 applied, its «История продажи» shows who published it, when,
    and on which basis.
  - `/admin/launch` shows the published count.
- **Blocks launch:** yes.

### OA-23: Seller identity for the Imprint
- **Status:** `PRODUCTION_STATE_UNVERIFIED`.
- **Evidence.** The Imprint shows only the values that are configured.
  **Since this round the shop also refuses new orders while they are missing**
  (`lib/sales-gate.ts`).
- **Why it matters.** Swiss law (UWG art. 3(1)(s)) requires an online seller's
  identity and postal address.
- **Action.** In Vercel → Settings → Environment Variables (all environments):
  1. set `NEXT_PUBLIC_SELLER_NAME`, `_STREET`, `_POSTCODE`, `_CITY` and
     `_RESPONSIBLE`, plus `_UID` if you have one;
  2. use real values, matching OA-25;
  3. redeploy.
- **Evidence of completion.** `/legal/imprint` shows the full identity, and
  `/admin/launch` "Реквизиты продавца" reads "В порядке".
- **Blocks launch:** yes.

### OA-26: VAT and tax obligations
- **Status:** `LEGAL_REVIEW_REQUIRED` (accountant; new, 2026-11-04).
- **Evidence.** Prices, invoices (`lib/server/invoice`) and the checkout show
  no VAT. `lib/fulfilment.ts` exports a `TAX_RATE`. Whether Swiss VAT
  registration, import VAT or EU OSS/IOSS duties apply depends on turnover,
  where the goods are, and where customers are.
- **Action.** An accountant determines registration and invoicing duties for
  the real model (OA-25). Any code change follows from their written advice.
- **Evidence of completion.** The written advice on file; prices and invoices
  changed if required.
- **Blocks launch:** yes.

### OA-27: Privacy and data processing
- **Status:** `LEGAL_REVIEW_REQUIRED` (new, 2026-11-04).
- **Evidence.**
  - Processors used by the code: Supabase, Vercel, Stripe, NOWPayments, Resend,
    Google (Gemini, for the AI assistant; Places, for address autocomplete),
    Telegram (for alerts), Cloudflare (Turnstile and the edge) and Google
    Analytics (only after consent).
  - A privacy policy exists (`app/legal/_content/privacy.ts`). Consent is
    implemented for analytics and marketing.
  - Retention runs daily (`lib/server/retention.ts`).
- **Action.** Counsel checks that the privacy notice lists every processor, the
  transfers outside CH and EU, and the retention periods; that a processing
  agreement (DPA) is in place with each processor; and whether an EU
  representative is needed (GDPR art. 27) if you sell to the EU without an
  establishment there.
- **Evidence of completion.** Signed or accepted DPAs filed; the privacy notice
  updated and merged if required.
- **Blocks launch:** yes, for sales to the EU.

### OA-28: Supplier relationship and delivery estimates
- **Status:** `OWNER_ACTION_REQUIRED` (new, 2026-11-04).
- **Evidence.**
  - The checkout quotes 20–35 supplier days plus shipping (`lib/fulfilment.ts`).
  - Order handling is manual: the admin sets the status and the tracking
    number, and the customer is notified.
  - There is no supplier API.
- **Action.** Confirm in writing with each supplier:
  - real lead times;
  - quality checks;
  - who handles returns and defects;
  - that the goods are what OA-01 allows.

  Adjust the delivery figures in `lib/fulfilment.ts` (or per product in the
  admin) to what the contracts support.
- **Evidence of completion.** The contracts are on file, and the quoted
  windows match them.
- **Blocks launch:** yes.

## Money and orders

### OA-03: Six orders where Stripe and the shop may disagree
- **Status:** `STILL_OPEN`, re-verified 2026-11-04.
- **Evidence.** Every reservation sweep since 2026-10-21 reports
  `"candidates":6,"paymentInFlight":6`. The latest is the run of 2026-11-04
  at 06:35 UTC, step "Call /api/cron/reservations".

  The sweep never cancels these orders. For each, Stripe says the payment is
  `succeeded` or `processing`, while the shop still shows the order unpaid.
- **Why it matters.**
  - Customers may have been charged and never served.
  - The cause (webhook delivery, the secret, an amount mismatch) may affect
    new orders too.
- **Action.** For each order:
  1. Open Admin → Продажи → Сверка платежей (it re-checks Stripe itself).
  2. Compare with Stripe → Payments, and with Developers → Webhooks → Event
     deliveries.
  3. Decide: record the payment ("paid, not recorded" has a button that
     re-verifies with Stripe first), or refund it (OA-09 rules apply).
  4. Write down the cause.
- **Evidence of completion.**
  - The next sweep reports `"paymentInFlight":0`.
  - `/admin/launch` "Неоплаченные заказы старше 72 часов" reads 0.
  - A note per order with Stripe's status and the decision taken.
- **Blocks launch:** yes.

### OA-08: Stripe webhook endpoint and its events
- **Status:** `PRODUCTION_STATE_UNVERIFIED`.
- **Evidence.**
  - The live check of 2026-11-02 shows the endpoint answers 400 to an
    unsigned call, so a secret is set.
  - The event subscriptions cannot be seen from here.
  - **Since this round, card payment is offered only when both
    `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set.**
- **Action.** Stripe → Developers → Webhooks → the endpoint
  `https://www.luxe-vault.store/api/payments/stripe/webhook` → Events. Confirm
  that every one of these is subscribed:
  - `payment_intent.succeeded`, `.processing`, `.payment_failed` and
    `.canceled`;
  - `charge.refunded`;
  - `refund.created`, `.updated` and `.failed`;
  - `charge.refund.updated`;
  - `radar.early_fraud_warning.created`;
  - `charge.dispute.created`.
- **Evidence of completion.** A screenshot of the event list. Recent
  deliveries return 2xx.
- **Blocks launch:** yes.

### OA-09: Sandbox payment and refund, then one controlled live one
- **Status:** `STILL_OPEN`.
- **Evidence.** Every automated test used local stand-ins. The live Stripe
  path has never been exercised by a test.
- **Action.**
  1. On a Vercel **preview** with Stripe **test** keys and
     `SALES_ENABLED=true` in the Preview scope:
     1. order;
     2. pay with a test card;
     3. check the order turns "paid";
     4. refund from Admin → Возвраты;
     5. check the order turns "refunded".
  2. Then, with your approval, one small live order, paid and fully refunded
     by you.
- **Evidence of completion.** The order numbers, the PaymentIntent and refund
  IDs, and the final states.
- **Blocks launch:** yes.

### OA-16: Crypto payments (NOWPayments)
- **Status:** `FIXED_NOT_DEPLOYED` (code); the decision is `OWNER_ACTION_REQUIRED`.
- **Evidence.**
  - The live check of 2026-11-02 shows the crypto webhook answers 503 "not
    configured".
  - Before this round, checkout still offered crypto and created an order
    that could not be paid or confirmed.
  - **Now crypto is offered only when both `NOWPAYMENTS_API_KEY` and
    `NOWPAYMENTS_IPN_SECRET` are set.** The server refuses crypto orders
    otherwise (`PAYMENT_METHOD_UNAVAILABLE`).
- **Action.** Decide whether crypto is wanted. If yes: set both variables,
  get OA-02 from NOWPayments, and make one test payment.
- **Evidence of completion.** The decision recorded; if enabled, one confirmed
  test payment.
- **Blocks launch:** no; crypto stays off.

## Security

### OA-04: Rotate credentials published in git history, and review the rest
- **Status:** `OWNER_ACTION_REQUIRED` and `PRODUCTION_STATE_UNVERIFIED`.
- **Evidence.**
  - An admin password and session secret were committed in `a3aae8f` and
    `6916cd4`. The repository is public, so treat them as published.
  - The console compares only those two values (by SHA-256) and shows a red
    banner if either is still in use.
  - It cannot see whether the other secrets were ever exposed.
- **Action.**
  1. In Vercel, set a new `ADMIN_PASSWORD` and
     `ADMIN_SESSION_SECRET=$(openssl rand -hex 32)`.
  2. Redeploy.
  3. Review the full list in [PRODUCTION_RUNBOOK.md § Secret rotation](PRODUCTION_RUNBOOK.md#secret-rotation),
     and rotate any secret that was ever pasted into a chat, an issue, a
     screenshot or a log.
- **Evidence of completion.**
  - `/admin/launch` "Учётные данные админки…" reads "В порядке".
  - An old session cookie gets 401.
  - Rotation dates are recorded.
- **Blocks launch:** yes.

### OA-05: Admin second factor (TOTP) and its recovery
- **Status:** `PRODUCTION_STATE_UNVERIFIED`.
- **Evidence.** From the next deploy, the weekly live check prints the state
  (`## 6. Launch state`), and `/admin/launch` shows it.
- **Action.**
  1. Run `node scripts/admin-totp-setup.mjs` on your own computer.
  2. Set `ADMIN_TOTP_SECRET` in Vercel and redeploy.
  3. Write down where the backup of the secret is kept and who can reset it
     (in `docs/security/incident-response.md`).
- **Evidence of completion.** `GET /api/admin/login` answers `{"mfa":true}`,
  and a sign-in with a code works.
- **Blocks launch:** yes.

### OA-13: Protect `main`; secret scanning and push protection
- **Status:** `STILL_OPEN`, re-verified 2026-11-04. The GitHub API lists
  `main` as `"protected": false`.
- **Action.**
  1. GitHub → Settings → Branches → add a rule for `main` that requires these
     checks:
     - "Typecheck, lint, unit tests, build";
     - "Migrations and database tests";
     - "Secret scan";
     - "Dependency audit".
  2. Settings → Code security: turn on secret scanning and push protection.
- **Evidence of completion.** The rule is visible, and a PR with a red check
  cannot be merged.
- **Blocks launch:** yes.

## Data, backups and operations

### OA-06: Offsite backups, and a restore test that succeeds
- **Status:** `STILL_OPEN`, re-verified 2026-11-04.
- **Evidence.**
  - "Offsite backup" has failed every day; the latest run is 2026-11-04 at
    09:49 UTC. The error: "Offsite backup is NOT configured
    (SUPABASE_DB_URL is empty)".
  - "Backup restore test" failed on 2026-11-02 with "The restore test is NOT
    configured" (`BACKUP_AGE_IDENTITY` and `BACKUP_BUCKET` empty).
  - **No offsite backup has ever been taken, and no restore has ever been
    verified.**
- **Action.**
  1. Follow `docs/security/phase-1-backups.md`:
     - a bucket with Object Lock;
     - an age key pair, with the private key kept offline;
     - the GitHub `backups` environment, restricted to `main`.
  2. Run both workflows manually. Never restore into production.
- **Evidence of completion.**
  - Both runs are green.
  - The restore summary reads "Restore test passed … N tables, M rows".
  - `/admin/launch` shows both checks as "В порядке" (it reads GitHub's own
    record of the runs).
- **Blocks launch:** yes.

### OA-07: Supabase's own backups as the interim safety net
- **Status:** `PRODUCTION_STATE_UNVERIFIED`.
- **Action.** Supabase → Database → Backups: note the retention period and the
  latest backup date, and download one manual backup now.
- **Evidence of completion.** A dated note or screenshot.
- **Blocks launch:** yes, until OA-06 is done.

### OA-10: Scheduled jobs and failure alerts
- **Status:** partly `STILL_OPEN`, re-verified 2026-11-04.
- **Evidence.**
  - `CRON_SECRET` works: every cron step answered HTTP 200 on 2026-11-04.
  - The "hourly" schedule actually runs about every 3–6 hours (runs at
    01:38, 09:39, 17:53 and 23:28 on 2026-11-03).
  - `INTERNAL_API_SECRET` is empty in the backup jobs. Their Telegram failure
    alerts were skipped silently; from this round those steps print a warning
    instead.
- **Action.**
  1. Set the same `INTERNAL_API_SECRET` in GitHub → Settings → Secrets and
     variables → Actions, and in Vercel.
  2. Decide whether the 3–6 hour cadence is acceptable. If not, use Vercel Cron
     (a paid plan) or an external scheduler.
- **Evidence of completion.** A deliberately failed manual run produces a
  Telegram message, and the decision is recorded.
- **Blocks launch:** yes (a backup failure must reach you).

### OA-11: Migrations applied to production
- **Status:** `PRODUCTION_STATE_UNVERIFIED`.
- **Evidence.**
  - The cron answers prove 0056, 0059 and 0060 are applied.
  - Nothing visible from here proves 0057, 0058 or 0061–0065.
  - On a fresh database, every migration (0001–0065) applies twice cleanly,
    and `verify-production.sql` returns 108/108 OK.
- **Action.**
  1. Supabase → SQL Editor: run `scripts/security/verify-production.sql`. It
     is read-only.
  2. For each `PROBLEM` row, apply the named migration with your approval,
     then re-run the script.
  3. The new one is **0065** (the sale-state audit trail). It is additive and
     server-only, and the app works without it.
- **Evidence of completion.** Every row reads `OK`, and `/admin/launch` lists
  every migration as "В порядке".
- **Blocks launch:** yes (0062 at least; the others are strongly recommended).

### OA-12: Review-request emails
- **Status:** `OWNER_ACTION_REQUIRED`, unchanged. Sending is `disabled`
  (cron output, 2026-11-04).
- **Action.** Decide the consent basis. Configure the Resend bounce and
  complaint webhook before enabling.
- **Blocks launch:** no.

### OA-17: The hosting plan allows commercial use
- **Status:** `PRODUCTION_STATE_UNVERIFIED`.
- **Action.** Vercel → Settings → Billing: confirm a plan that permits
  commercial use. Check that preview deployments do not get production
  secrets, or live payment keys in particular.
- **Evidence of completion.** The plan name, and the scope of each secret.
- **Blocks launch:** yes.

### OA-18: Old Actions logs with order numbers (optional)
- **Status:** `OWNER_ACTION_REQUIRED`, unchanged.
- **Blocks launch:** no.

## Release

### OA-30: Merge and deploy this round
- **Status:** `FIXED_NOT_DEPLOYED`.
- **What changes in production when it is deployed:**
  - **The shop stops taking new orders and payments until `SALES_ENABLED=true`
    is set.** That is deliberate (OA-24). Paid orders, webhooks, refunds,
    returns, reconciliation and support are unaffected.
  - Crypto is offered only when it can be confirmed.
  - Card payment is offered only when the webhook secret is set.
  - `/admin/launch` appears.
  - Publishing and withdrawing are audited once 0065 is applied.
- **Action.** Review the PR, merge it, and check the Vercel deployment.
- **Evidence of completion.** CI is green, the deployment is "Ready", and
  OA-15 passes.
- **Blocks launch:** yes.

### OA-15: Production smoke test after the deploy
- **Status:** `STILL_OPEN`.
- **Action.**
  1. Run GitHub Actions → "Security check (live)".
  2. Then in a browser: home, a product, the cart, the checkout (it should
     say orders are not being accepted), admin sign-in, `/admin/launch`.
- **Evidence of completion.** The live check reports "0 failed". Its "Launch
  state" section shows MFA and the gate.
- **Blocks launch:** yes.

### OA-29: Dependency pull requests and stale branches
- **Status:** `OWNER_ACTION_REQUIRED` (new, 2026-11-04).
- **Evidence.**
  - Dependabot PR #34 (27 minor and patch updates) is green on CI as of
    2026-11-02.
  - #11 and #12 are major bumps of GitHub Actions, open since 2026-10-12.
  - #4 and #5 are old feature branches.
  - `npm audit` reports 20 moderate advisories and no high ones (dev-tooling
    chains: eslint and postcss).
- **Action.** Merge #34 after reading its changelog summary. Test and merge
  #11 and #12, or close them. Close #4 and #5 if obsolete.
- **Blocks launch:** no.

### OA-24: Open sales (last)
- **Status:** `OWNER_ACTION_REQUIRED` (new, 2026-11-04). The shop is closed by
  default from the deploy of OA-30 onward.
- **Why it matters.** Taking money is a business decision. It is taken once
  every blocking item above is done, not as a side effect of a deploy.
- **Action.**
  1. Set `SALES_ENABLED=true` in Vercel (Production), then redeploy.
  2. The seller identity (OA-23) must also be complete, or the shop stays
     closed.
- **Evidence of completion.**
  - `/admin/launch` "Приём заказов и оплат" reads "В порядке".
  - The live check shows "shop takes orders".
  - One controlled order goes through.
- **Blocks launch:** this item *is* the launch.

## Historical items folded into the above

| Old item | Now |
|---|---|
| OA-14 (merge PR #28) | `STALE_FINDING`: merged 2026-10-24. |
| OA-19, OA-21, OA-22 (apply 0061, 0063, 0064) | Part of OA-11. |
