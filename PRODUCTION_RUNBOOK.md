# Production runbook

How to operate Luxe Vault as it is implemented today (2026-11-04). Each
section names the code or the document behind it. Where a step needs an
account only the owner holds (Vercel, Supabase, Stripe, GitHub), it says so.
Nothing here has been run against production by the audit.

Architecture in one paragraph:
- **Hosting.** Next.js 15 (App Router) on **Vercel**, region `dub1`
  (`vercel.json`), behind Cloudflare. The origin refuses requests that do not
  come through the edge (`middleware.ts`, `EDGE_ORIGIN_SECRET`).
- **Data.** **Supabase**: Postgres with RLS, Auth and Storage. The migrations
  are in `supabase/migrations/` and are applied by hand.
- **Payments.** **Stripe**: an embedded PaymentElement, and a webhook with an
  idempotent event ledger. **NOWPayments** for crypto, offered only when fully
  configured.
- **Email.** **Resend**.
- **Alerts.** **Telegram**.
- **Scheduled work.** GitHub Actions:
  - `abandoned-carts-cron.yml`: reminders, the reservation sweep, the refund
    jobs and review requests;
  - `offsite-backup.yml`;
  - `backup-restore-test.yml`;
  - `security-check.yml`.

  Plus one daily Vercel cron (`/api/cron/sweep`).

`netlify.toml` is present, but production runs on Vercel. Do not deploy the
same environment to two hosts.

---

## 1. Deployment

1. Work on a branch and open a PR. CI must pass (`.github/workflows/ci.yml`):
   - typecheck, lint, unit tests and build;
   - migrations and database tests;
   - the secret scan;
   - the dependency audit.
2. **Migrations come first and are manual.** If the PR adds one:
   1. Read it.
   2. Apply it in Supabase → SQL Editor (production only with the owner's
      approval).
   3. Run `scripts/security/verify-production.sql`. It is read-only and must
      report every row `OK`.

   Every migration is written so that the old and new code both work with and
   without it. Apply the migration first, then deploy.
3. Merge to `main`. Vercel builds and deploys `main` to production
   automatically.
4. After the deploy:
   1. Run GitHub Actions → "Security check (live)" → Run workflow. It must
      report "0 failed". Its section 6 shows the admin MFA and sales-gate
      state.
   2. Open `/admin/launch` and check that nothing new is "Блокирует запуск".
5. Environment variables live in Vercel → Settings → Environment Variables.
   They are listed in `.env.example`. Changing a variable needs a redeploy;
   `NEXT_PUBLIC_*` values are compiled into the build.

### Opening and closing sales (launch gate)

The gate is in `lib/sales-gate.ts`. In production builds, new orders and
payments are accepted only while **both** of these hold:
- `SALES_ENABLED=true`;
- the seller identity (`NEXT_PUBLIC_SELLER_*`) is complete.

| To | Do | Then |
|---|---|---|
| Open | Set `SALES_ENABLED=true` (Production scope) and redeploy | Only after OWNER_APPROVAL_CHECKLIST.md. |
| Close (an emergency, a legal hold, an incident) | Remove `SALES_ENABLED`, or set it to anything but `true`, and redeploy | New orders and payment starts answer 503 `SALES_CLOSED`; the checkout says orders are not being accepted. |

Closing never touches money already moved. Webhooks, refunds, returns,
reconciliation, order pages and support keep working.

A Vercel preview is a production build too. To test a sandbox checkout there,
set `SALES_ENABLED=true` in the Preview scope, with **test** Stripe keys only.

## 2. Rollback

- **Application.** Vercel → Deployments → choose the last good production
  deployment → "Promote to Production" (instant; no rebuild).
- **Migrations are forward-only.** Do not run down-migrations against
  production. The code tolerates a missing migration, so rolling the app back
  never requires undoing one. If a migration itself is the problem:
  1. stop writes (close sales, above);
  2. take a backup (§3);
  3. fix it forward with a new migration.
- **Configuration.** Revert the variable in Vercel and redeploy. Keep a dated
  note of every production variable change.

## 3. Backups

What runs (`docs/security/phase-1-backups.md`):

| Workflow | When | What it does |
|---|---|---|
| `offsite-backup.yml` | nightly | `pg_dump` of the production database, plus the Storage media, encrypted with age, uploaded to a separate S3-compatible bucket with Object Lock and retention. |
| `backup-restore-test.yml` | weekly | Restores the newest backup into a throwaway Postgres and checks tables and rows. |

**Status on 2026-11-04: neither is configured.** Every run fails at "Check
configuration". There is no offsite backup and no verified restore (OA-06).
Until they work, Supabase's own backups are the only ones (OA-07).

Where to see the state:
- `/admin/launch`, which reads the last successful run of each workflow from
  GitHub;
- GitHub → Actions.

A green backup run does not prove recoverability; only a green restore test
does.

When a backup fails:
- The run is red, and GitHub emails the owner.
- A Telegram alert is sent only if `INTERNAL_API_SECRET` is set in GitHub and
  in Vercel; without it, the step logs a warning (OA-10).
- Fix the cause and re-run the workflow manually. Check the restore test the
  following week.

## 4. Restore

Follow `docs/security/phase-1-backups.md` § "Restoring for real".
1. **Never restore into the production project.** Restore into a NEW Supabase
   project.
2. Fetch the chosen backup and decrypt it with the OFFLINE age key. Verify the
   checksum.
3. Restore in this order: `auth` data first, then `public`, then the media
   into Storage.
4. Re-apply migration 0001's triggers (it is idempotent).
5. Point a preview deployment at the new project and check it:
   - order counts;
   - a few orders against Stripe;
   - the products.
6. Switch production only after that check: change the Supabase URL and keys
   in Vercel, then redeploy.

## 5. Payment reconciliation

The tools:
- the console: Admin → Продажи → Сверка платежей (`/admin/reconciliation`);
- the API: `GET /api/admin/reconciliation?days=30`;
- the code: `lib/server/reconciliation.ts`.

The console compares orders with Stripe's PaymentIntents and lists each
discrepancy, with what it means:
- **`paid_not_recorded`.** Stripe succeeded; the order is unpaid. The button
  re-fetches the intent from Stripe. It records the payment only if:
  - the intent succeeded;
  - it belongs to this order;
  - it paid the full amount in the order's currency.

  It then runs the webhook's own code: stock, the Telegram slip and the
  receipt, each once only.
- **`amount_mismatch` / `currency_mismatch`.** No button. Decide with the
  customer: refund, or a manual adjustment.
- **`processing_not_recorded`.** The bank has not settled yet. Wait.

Nothing is ever marked unpaid from a button. The hourly reservation sweep
(`/api/cron/reservations`) reports `paymentInFlight`: orders it may not cancel
because their payment succeeded or is processing. Each also raises one
Telegram alert. `/admin/launch` counts unpaid orders older than 72 hours.

**Open item:** six such orders since 2026-10-21 (OA-03).

## 6. Refunds and returns

- **Customers** request a return from their order page. The request becomes a
  refund case (`docs/refunds/README.md`, migration 0059). The case moves
  through states and evidence before any money moves.
- **The owner and staff** work in Admin → Возвраты:
  - approve or decline;
  - for a refund, Stripe is called with an idempotency key, and the ledger
    (`refund_transactions`) records it;
  - `charge.refunded` and `refund.*` webhooks, plus the hourly
    `/api/cron/refunds` check, settle the final state.
- **Partial refunds** set `partially_refunded`. A refund can never exceed what
  was paid; the ledger and the database guards check.
- **Crypto refunds** are manual. Pay back through the wallet and record it in
  the case. No automatic crypto refund exists.

Live refunds move real money. A test refund belongs in Stripe test mode on a
preview (OA-09).

## 7. Order fulfilment

The process is manual. There is no supplier API; the supplier lead time is
in `lib/fulfilment.ts`.
1. Admin → Заказы, tab «К отправке»: paid orders not yet shipped.
2. Order the item from the supplier. Inspect it when it arrives.
3. Set the status to `processing`, then to `shipped` with the courier and
   tracking number (the console checks a number's minimum length; enter one
   for every parcel). The customer is notified.
4. Set `delivered` when the carrier confirms delivery.

The shop never marks an order shipped or delivered by itself. Every status
change is the admin's, saved with `expectedStatus`, so two tabs cannot
overwrite each other.

| Situation | What to do |
|---|---|
| Lost or late parcel | Contact the carrier. Tell the customer through Support. If it cannot be delivered, refund through a case. |
| Item unavailable from the supplier | Tell the customer, then refund in full or cancel. Cancelling an unpaid order returns its stock; for a paid one, refund first. |

## 8. Incident response

Full procedures: `docs/security/incident-response.md`. It covers:
- A: credential exposure;
- B: unauthorised admin access;
- C: payment discrepancies;
- D: incorrect refunds;
- E: inventory;
- F: database loss;
- G: failed backups;
- H: customer-data exposure.

First moves:
1. **Stop the bleeding.** Close sales (§1). For suspected admin compromise,
   rotate `ADMIN_SESSION_SECRET` (it signs every admin out) and
   `ADMIN_PASSWORD`.
2. **Preserve evidence.** Vercel logs: search `security_event`. Supabase logs.
   Stripe events.
3. **Assess customer impact.** For personal data, Swiss nFADP and the GDPR may
   require notifying the authority and the people affected. Involve counsel
   (OA-27).

## 9. Secret rotation

Where each secret lives, and what rotating it does. Never paste a value into
an issue, a chat, a log or a commit.

| Secret | Where | Effect of rotating it |
|---|---|---|
| `ADMIN_PASSWORD` | Vercel | New sign-in password. |
| `ADMIN_SESSION_SECRET` | Vercel | Every admin session is signed out. |
| `ADMIN_TOTP_SECRET` | Vercel; a backup offline | Re-enrol the authenticator (`scripts/admin-totp-setup.mjs`). |
| `SUPABASE_SERVICE_ROLE_KEY`, anon key | Supabase → API, then Vercel | Rotate the JWT secret in Supabase, then update both keys. |
| `SUPABASE_DB_URL` (database password) | Supabase → Database; GitHub `backups` environment | Backups use it. |
| `STRIPE_SECRET_KEY` | Stripe → API keys (roll), then Vercel | Rotate with zero downtime: Stripe keeps the old key alive for a set time. |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → roll secret, then Vercel | Redeploy promptly; until then, events fail and Stripe retries them. |
| `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET` | NOWPayments dashboard, then Vercel | — |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Resend, then Vercel | — |
| `CRON_SECRET` | Vercel **and** GitHub secrets (the same value) | A mismatch makes the cron jobs answer 401. |
| `INTERNAL_API_SECRET` | Vercel **and** GitHub (the same value) | Needed for workflow alerts. |
| `EDGE_ORIGIN_SECRET` | Cloudflare (header rule) **and** Vercel | Change both together, or the site answers 404. |
| `TELEGRAM_BOT_TOKEN` | @BotFather, then Vercel | — |
| `PAYMENT_FRAUD_SECRET` | Vercel | Fraud-guard hashes restart. |
| `GEMINI_API_KEY`, `GOOGLE_PLACES_API_KEY` | Google Cloud, then Vercel | — |
| `CLOUDFLARE_TURNSTILE_SECRET_KEY` | Cloudflare, then Vercel | — |
| Backup keys (`BACKUP_*`, age keys) | GitHub `backups` environment; the age private key offline | A new age recipient applies to new backups only; keep the old private key while old backups exist. |

The values committed in `a3aae8f` and `6916cd4` (the admin password and
session secret) are public. Treat them as burned (OA-04). `/admin/launch`
flags them if they are still in use.

## 10. Monitoring and alerts

| Signal | Where it shows |
|---|---|
| Application errors | Telegram "errors" topic (`lib/monitoring/alert.ts`), the Vercel logs, and browser error reports sent to `/api/monitoring`. |
| JS chunks that did not download | Telegram as `Chunk load failed (network)` (optionally `· <part>`), sent only when one automatic reload did not fix it (`lib/chunk-error.ts`). Usually a visitor's connection. Many at once, right after a deploy, point at the CDN or the deploy instead. |
| Stuck payments | `paymentInFlight` in the hourly sweep, one Telegram alert per order, `/admin/launch`. |
| Webhook failures | Stripe → Webhooks → Event deliveries; `webhook_signature_invalid` security events. |
| Failed backups or restore tests | A red workflow, GitHub's email, Telegram (needs `INTERNAL_API_SECRET`), `/admin/launch`. |
| Failed scheduled jobs | A red "Abandoned-cart reminders" run, plus Telegram. |
| Email failures | Resend → Logs; bounces and complaints recorded by `/api/email/webhook`. |
| Authentication abuse | `admin_login_failed` and `rate_limited` security events in the Vercel logs (one JSON line each, with a hashed source). |
| Live configuration | Weekly "Security check (live)": headers, the origin lock, endpoints refusing without credentials, MFA, the sales gate. |
| Fulfilment | Admin → Обзор «Требует внимания»: orders to ship, refunds waiting, support waiting, low stock. |

No alert carries card data, secrets or full customer details. Order numbers
appear in Telegram and the Vercel logs only, never in the public Actions logs.
