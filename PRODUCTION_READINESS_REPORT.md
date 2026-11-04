# Production readiness report

**Date:** 2026-11-04.
**Baseline:** `main` = `7a43f8c4e026fe3dd5b97ebb5901506776f2c77e`.
**Work branch:** `claude/admiring-albattani-xgdcm5`. The commit is given in the
PR and the handover message.

**Supersedes:** `docs/audit/PRODUCTION_READINESS_REPORT.md` (2026-10-24) and
`docs/audit/STORE_READINESS_AUDIT.md` (2026-10-25), which stay as history.

**Related documents:**
- owner actions: [OWNER_APPROVAL_CHECKLIST.md](OWNER_APPROVAL_CHECKLIST.md);
- procedures: [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md);
- change record: [IMPROVEMENT_LOG.md](IMPROVEMENT_LOG.md);
- compliance map: [docs/compliance/COMPLIANCE_CHECKLIST.md](docs/compliance/COMPLIANCE_CHECKLIST.md).

## 1. Verdict

**C. NOT READY FOR SALES.**

The code is in good shape and fails closed. Real sales must not be enabled:

- **Legitimacy.** The shop's own legal and marketing copy says the goods are
  replicas (`terms.ts`, the Imprint, the footer, the card tag). The only
  lawful publication bases (0062) are an original design or authorised
  resale. Whether the actual inventory can be sold at all is unanswered
  (OA-01, OA-02).
- **Business model.** The terms describe a private sale from a personal
  collection. The code implements supplier fulfilment with a 20–35 day lead
  time (OA-25). Tax and privacy obligations follow from the real model
  (OA-26, OA-27).
- **No recoverable backup.** The offsite backup has failed every night (the
  latest run is 2026-11-04 at 09:49 UTC). No restore has ever succeeded
  (OA-06).
- **Possibly stranded money.** Six orders have been "payment in flight" since
  2026-10-21: Stripe may hold customers' payments for orders the shop shows
  as unpaid (OA-03).
- **Admin security not verified.** Credentials are known from public git
  history, rotation is not evidenced, MFA is not evidenced, and `main` is
  unprotected (OA-04, OA-05, OA-13).

The application is not merely "technically ready, awaiting approval" either.
Several items in the definition of done are unmet: backups, a restore test,
a sandbox payment lifecycle, monitoring alerts.

## 2. What could and could not be verified

| Source | Reachable | Used for |
|---|---|---|
| The repository at `7a43f8c` | yes | Every code finding. |
| GitHub API and Actions logs | yes | Backup and restore runs; cron output (which calls the live site); the live security check; PR and branch state. |
| The live site `www.luxe-vault.store` | **no** (the proxy answered 403) | — |
| The production database, Vercel, Stripe, Supabase dashboards | **no** | — |

So production facts come only from the CI logs. Everything else about
production is "unverified", never assumed.

## 3. Architecture

| Layer | What it is |
|---|---|
| Framework and hosting | Next.js 15 App Router, React 19, on Vercel (`dub1`), behind Cloudflare. The origin is locked by `EDGE_ORIGIN_SECRET` (`middleware.ts`). |
| Data | Supabase Postgres with RLS. The server uses the service role (`lib/supabase/admin.ts`); browsers use the anon key and published data only. Migrations 0001–0065, applied by hand. |
| Storefront | Catalogue, department and category pages, search (`search_products`, 0058), product pages, the cart (local), the checkout (`/checkout`, nonce CSP). Storefront locales: en (default), it, fr and de. Russian is the console's language, and the fifth language of the string tables. |
| Orders | `/api/orders`: server repricing, the atomic `place_order` (stock), the idempotency key (0061), 48 h reservations (0056). |
| Card payments | Stripe PaymentIntent (`/api/payments/stripe/intent`), a webhook with a signature and an idempotent ledger (`stripe_events`), shared apply logic (`lib/server/stripe-payment-apply.ts`), reconciliation (`/admin/reconciliation`). |
| Crypto | NOWPayments (`/api/payments/crypto/*`), IPN signature; offered only when fully configured (this round). |
| Returns and refunds | A refund-case system (0059): states, evidence, a ledger, Stripe refunds with idempotency, staff accounts. |
| Admin | A password (+ optional TOTP) session (`lib/server/admin-*`), middleware and route guards; dashboard, orders, products, the «Продажа» publication gate (0062) with an audit trail (0065), reconciliation, returns, support, reviews, newsletter, settings, launch readiness (this round). |
| Support | Tickets and an AI concierge (Gemini), read-only tools, human handoff (`lib/server/assistant`). |
| Email and alerts | Resend (orders, receipts, support, newsletter with double opt-in; bounce and complaint webhook); Telegram alerts. |
| Scheduled | GitHub Actions: hourly in name (in practice every 3–6 h) reminders, reservations, refunds, review requests; a nightly offsite backup; a weekly restore test; a weekly live security check. A daily Vercel cron runs the sweep. |

## 4. Earlier findings, re-checked 2026-11-04

| Finding | Status | Evidence (2026-11-04) |
|---|---|---|
| S-1: every product on sale, no publication state | `FIXED_AND_VERIFIED` (code) / `PRODUCTION_STATE_UNVERIFIED` (0062 applied?) | 0062 in `main`; 224 DB checks pass on a fresh database. Production migration state not visible. |
| S-2: goods described as replicas | `LEGAL_REVIEW_REQUIRED` | The copy is unchanged; see §1 and OA-01. |
| S-3 / C-1: no offsite backup | `STILL_OPEN` | `offsite-backup.yml` failed 2026-10-31 → 2026-11-04 ("SUPABASE_DB_URL is empty"); the restore test failed 2026-11-02 ("NOT configured"). |
| S-3 / C-2: six orders, Stripe paid or processing, shop unpaid | `STILL_OPEN` | Reservation sweep 2026-11-04 06:35 UTC: `"candidates":6,"paymentInFlight":6`. |
| S-3 / C-3: admin credentials in git history | `OWNER_ACTION_REQUIRED` / `PRODUCTION_STATE_UNVERIFIED` | No evidence of rotation is visible from here. |
| S-4: unbacked strike-through prices | `FIXED_AND_VERIFIED` (code) | 0063 plus `lib/price-reference.ts`; unit and DB tests pass. |
| O-1: success page said "processing" for failures | `FIXED_AND_VERIFIED` (code) | In `main`. |
| O-2: no reconciliation screen | `FIXED_AND_VERIFIED` (code) | `/admin/reconciliation` in `main`. |
| O-3: mismatch refusals invisible | `FIXED_AND_VERIFIED` (code) | Listed as mismatches. |
| C-1 … C-5 (catalogue structure) | `FIXED_AND_VERIFIED` (code) | In `main`. |
| OA-13: `main` unprotected | `STILL_OPEN` | GitHub API: `main` `"protected": false`. |
| OA-16: crypto offered while unconfigured | `FIXED_NOT_DEPLOYED` | The live crypto webhook answers 503 (live check, 2026-11-02); the checkout offered crypto anyway. Fixed this round. |
| OA-10: alerts from workflows | `STILL_OPEN` | `INTERNAL_API_SECRET` empty in the backup jobs (logs of 2026-11-02 and 2026-11-04). |
| Live perimeter (headers, CSP, origin lock, auth refusals) | `FIXED_AND_VERIFIED` | "Security check (live)" on 2026-11-02: 0 failed, 0 warnings. |
| OA-14 (merge PR #28) | `STALE_FINDING` | Merged 2026-10-24. |

## 5. Work completed this round

Problem, change and tests for each item are in `IMPROVEMENT_LOG.md`.

1. **Launch gate (P0).**
   - In production builds the shop takes no new order or payment until both
     hold:
     - the owner sets `SALES_ENABLED=true`;
     - the seller identity is complete.
   - The checkout explains this before the address form.
   - Reminder emails are suspended while closed.
   - Money already moved is never gated: webhooks, refunds, reconciliation
     and returns keep working.
2. **Payment-method truthfulness (P1).**
   - Crypto is offered and accepted only with both the NOWPayments API key and
     the IPN secret.
   - Card payment needs the Stripe webhook secret as well as the key.
   - A refused method reserves nothing.
3. **Publication audit trail (P1, migration 0065).**
   - Append-only events with the basis and reference snapshot, actor and
     reason.
   - Atomic publish and withdraw.
   - A trigger backstop for changes made outside the console.
   - History in the product editor.
4. **Launch readiness console (P1).** `/admin/launch` shows what the
   application can verify itself, including the last successful backup and
   restore from GitHub's record, next to the items only the owner can settle.
5. **Visibility (P2).**
   - Workflow alert steps warn instead of skipping silently.
   - The weekly live check reports MFA and the gate state.
6. **Documentation.** This report, the owner checklist, the runbook, the
   compliance map and the improvement log, all at the root.

## 6. Tests executed (exact results)

All runs are local, on 2026-11-04. Nothing touched production, a real payment
or a real customer.

| Command / suite | Result |
|---|---|
| `npx tsc --noEmit` | clean. The only errors are the `*.webp` module declarations that `next build` generates in `next-env.d.ts`; they are absent before the first build. |
| `npx next lint` | No ESLint warnings or errors. |
| `npm run test:store` | 119 passed, 0 failed (13 new: `sales-gate`, `launch-readiness`). |
| `npm run test:security` | 154 passed, 0 failed. |
| `npm run test:refunds` | 61 passed, 0 failed. |
| `npm run test:assistant` | 105 passed, 0 failed. |
| `scripts/ci/verify-migrations.sh` on a fresh Postgres 16 | All migrations 0001–0065 applied, plus a second pass; "access rules hold". |
| `scripts/ci/db-tests.sh` | 224 checks passed (14 new in `tests/db/listing_events.sql`), 0 failed. |
| `scripts/security/verify-production.sql` on that database | 108 / 108 OK. |
| `next build` (production) | Succeeded. |
| Stand browser: launch gate **closed** | 36 / 36. |
| Stand browser: launch gate **open** | 27 / 27. |
| Stand browser: department pages (previous round's suite) | 59 / 59. |
| Stand browser: storefront regression (home, catalogue, menu, PDP, JSON-LD) | 14 / 14. |
| `npm audit --audit-level=high` | No high or critical advisories. 20 moderate (eslint and postcss tooling chains). |

The **stand** is a disposable local Postgres with every migration and
fixture products, served through a small local PostgREST-compatible shim
(PostgREST could not be downloaded). It has no Stripe, NOWPayments, Resend or
GitHub network access. Consequently:
- the card intent call cannot reach Stripe;
- the backup check reads "unknown";
- the live provider paths are verified only by earlier rounds' fakes and by
  the live CI checks.

**Not run this round:** the previous rounds' full admin, refund and fraud e2e
suites. Their fakes were lost when the container was reset. The code under
them is unchanged, apart from the intent route's added refusals and the
crypto routes' readiness check.

## 7. Remaining findings

| P | Finding | Owner item |
|---|---|---|
| P0 | Assortment legality versus the "replica" copy | OA-01, OA-02 |
| P0 | Business model contradiction (private sale versus supplier fulfilment) | OA-25 |
| P0 | No offsite backup; no verified restore | OA-06, OA-07 |
| P0 | Six orders possibly paid in Stripe and unpaid in the shop | OA-03 |
| P0 | Credentials from public git history; rotation not evidenced | OA-04 |
| P1 | Admin MFA not evidenced | OA-05 |
| P1 | `main` unprotected | OA-13 |
| P1 | Live payment path never exercised by a test (sandbox and controlled live) | OA-08, OA-09 |
| P1 | Failure alerts from workflows not wired (`INTERNAL_API_SECRET`); cron runs every 3–6 h, not hourly | OA-10 |
| P1 | Production migration state unknown (0057, 0058, 0061–0065) | OA-11 |
| P1 | VAT, privacy and DPAs, supplier contracts | OA-26, OA-27, OA-28 |
| P1 | Hosting plan suitability | OA-17 |
| P2 | Order retention of 5 years versus the usual 10-year Swiss bookkeeping duty (if commercial) | `docs/compliance/COMPLIANCE_CHECKLIST.md` |
| P2 | Dependency PRs (#34 green; #11 and #12 major action bumps), 20 moderate dev-tooling advisories | OA-29 |
| P3 | `netlify.toml` alongside Vercel; stale branches | runbook §0, OA-29 |

## 8. Area summaries

**Security.**
- The live perimeter passed on 2026-11-02.
- Admin routes are guarded server-side (middleware plus `requireAdmin` /
  `isAdminRequest`).
- Webhooks are signature-checked.
- CSRF and origin checks, rate limits, the CSP with nonces on the checkout,
  and secret scanning (gitleaks on full history in CI) are all in place.
- Residual risk is configuration, not code: credential rotation, MFA, branch
  protection.

**Payments.**
- Amounts and currency come from the server; webhook processing is idempotent
  (`stripe_events`).
- The success page never marks anything paid. Reconciliation re-fetches from
  Stripe before recording a payment.
- Crypto is now offered only when confirmable.
- The live path is unexercised (OA-09). Six discrepancies are unresolved
  (OA-03).

**Backups and recovery.**
- Workflows exist and fail visibly.
- They are not configured, so nothing has ever been backed up offsite or
  restored.
- `/admin/launch` shows the last successful run of each, from GitHub.

**Legal and commercial.**
- The copy and the code contradict each other on what is sold and by whom.
- Seller identity is unverified (now enforced by the gate).
- Tax, privacy and supplier facts need professionals and the owner.

**Deployment.**
- Vercel deploys `main` automatically; rollback is Vercel's instant promote;
  migrations are manual and forward-only.
- Merging this round **closes the shop to new orders until
  `SALES_ENABLED=true`**. That is intended.

## 9. Independent review (second pass)

| Question | Answer from the code and evidence |
|---|---|
| Can an unauthorised user reach admin functionality? | Not without the session: middleware, route guards and page guards (live check 2026-11-02). **Residual:** password-only if MFA is off; burned values if not rotated (OA-04, OA-05). |
| Can a customer read another customer's data? | RLS plus per-order lookup tokens. The assistant reads only the session's orders or the browser's tokens. DB access tests pass (224 checks). |
| Can an unpaid order become paid? | Only through a signature-verified webhook with a matching amount and currency, or owner reconciliation that re-fetches the intent from Stripe. The success page and the client never set "paid". |
| Can a webhook replay duplicate a financial operation? | No: an idempotent event ledger, and once-only side effects (stock, slip, receipt). |
| Can an unpublished product be bought? | No. The order route reprices from the published catalogue; the intent refuses an order with a product taken off sale (`PRODUCT_UNAVAILABLE`); public reads return published only. |
| Can a product with unverified legal status become public? | Only if the owner records a rights basis and reference for it. That record is the owner's declaration, now audited (0065). The app cannot verify documents; the process (OA-20) must. |
| Can a refund be triggered without authorisation? | Refunds are admin or staff only, through the case system and ledger, idempotent towards Stripe. |
| Can an order get stuck forever? | Unpaid orders are released after 48 h. Orders with a payment in flight are deliberately not released and need a human; they are now counted on `/admin/launch`, alerted, and listed in reconciliation. Six exist (OA-03). |
| Can a backup fail silently? | No longer: red runs, GitHub email, a warning when Telegram is not wired, `/admin/launch`. But backups are not configured at all (OA-06). |
| Can the business recover from a database failure? | **Not demonstrably.** No offsite backup and no successful restore; Supabase's own backups are unverified (OA-07). |
| Can a deploy break production without a rollback? | Instant rollback exists on Vercel. But `main` is unprotected, so a red change can reach production (OA-13). |
| Can the app expose credentials or personal data? | No secret in the tree; gitleaks on full history; public Actions logs print counts only. Alerts carry order numbers but no payment data. |
| Do the legal pages describe the actual business? | **No** (OA-01, OA-25). |
| Can customers understand shipping, returns and payment? | Pages exist in all locales, but their premise (a private sale, hand-posted) does not match the supplier model (OA-25, OA-28). |
| Are all advertised features operational? | Crypto is no longer advertised unless configured. Review requests are disabled. The rest is implemented; live providers are untested end to end (OA-09). |
| Do tests pass only because of mocks? | Provider paths (Stripe, NOWPayments, Resend, GitHub API) are tested against stand-ins or not reachable here. The DB, RLS, gate, publication and UI tests are real. Live behaviour needs OA-09 and OA-15. |
| Unresolved P0 or P1? | Yes; see §7. |

## 10. Definition of done

| Condition | State |
|---|---|
| Production build succeeds | ✅ (local) |
| TypeScript and lint pass | ✅ |
| Relevant unit and integration tests pass | ✅ |
| Critical buyer-journey E2E tests pass | ⚠️ on the stand (gate, checkout to order); the payment step needs Stripe (OA-09) |
| Authentication and authorisation verified | ⚠️ code and live perimeter yes; MFA and rotation unverified |
| Customer data isolation verified | ✅ DB tests |
| Payment lifecycle verified in sandbox | ❌ OA-09 |
| Webhook signatures and idempotency verified | ✅ code, tests and live refusal; ⚠️ live delivery (OA-08) |
| Refund and cancellation logic tested | ✅ unit 61, earlier integration; ❌ live sandbox |
| Database migrations verified | ✅ fresh database; ❌ production (OA-11) |
| Publication restrictions enforced server-side | ✅ |
| No unverified product can become publicly purchasable | ⚠️ only through the owner's own rights declaration (audited) |
| No known compromised secret in use | ❌ unverified (OA-04) |
| Production secrets rotated where required | ❌ OA-04 |
| Admin MFA confirmed | ❌ OA-05 |
| Offsite backups operational | ❌ OA-06 |
| A restore test has succeeded | ❌ OA-06 |
| Monitoring and critical alerts operational | ⚠️ Telegram for app errors and stuck payments (configuration unverified); workflow alerts not wired (OA-10) |
| Fulfilment and notifications verified | ⚠️ manual flow implemented; supplier facts open (OA-28) |
| Legal pages reflect the real business | ❌ OA-01, OA-25 |
| Seller identity complete and verified | ❌ unverified (OA-23), now enforced by the gate |
| Hosting confirmed for commercial use | ❌ OA-17 |
| Owner approval tasks completed | ❌ |
| No unresolved P0 or P1 findings | ❌ |
| Documentation and runbooks complete | ✅ |

## 11. Recommendation

**Do not enable real customers or real payments.** Merge this round (OA-30):
the shop then stays closed by default while the owner works through
`OWNER_APPROVAL_CHECKLIST.md`.

Order of work:
1. Counsel on the assortment and model (OA-01, OA-25), and the providers
   (OA-02).
2. Resolve the six orders (OA-03).
3. Rotate credentials, turn on MFA, protect `main` (OA-04, OA-05, OA-13).
4. Configure backups and get a green restore test (OA-06, OA-07).
5. Apply the migrations; run the sandbox payment and refund (OA-11, OA-09).
6. Seller identity, tax, privacy and suppliers (OA-23, OA-26–28).
7. Only then open sales: `SALES_ENABLED=true` (OA-24).
