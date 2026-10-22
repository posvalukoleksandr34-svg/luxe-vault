# Manual actions required

Everything here needs one of three things:

- access this audit does not have: provider dashboards, production secrets, the production database;
- an authorisation it must not give itself: deploying, migrating production, rotating credentials, moving money;
- a professional judgement: legal advice.

Listed in the order they should be done. "Owner" means whoever holds the Vercel, Supabase, Stripe, Cloudflare and GitHub accounts.

---

## 0. Refund system and round 4 (2026-10-20 / 2026-10-22) — do these first

| | |
|---|---|
| Who | Owner |
| What | 1. **Apply `supabase/migrations/0059_refund_cases.sql`** in Supabase → SQL Editor. It only adds things: existing returns are mapped onto the new states, and existing refunds get one `backfill` ledger row each. The code is already on `main`. Until 0059 is applied, refund screens answer "apply migration 0059" (staff) or "temporarily unavailable" (customers), and Stripe refund webhooks fail and are retried by Stripe.<br>2. **Stripe → Developers → Webhooks**, the existing endpoint `/api/payments/stripe/webhook`. Add `refund.created`, `refund.updated`, `refund.failed`, `charge.refund.updated`, `charge.refunded` and `charge.dispute.created`, keeping the events already there.<br>3. Check that the repository secret `CRON_SECRET` exists: the hourly workflow also calls `/api/cron/refunds`.<br>4. **Admin → Возвраты → Сотрудники:** create personal accounts, an owner first. Once an owner exists, refunds (including the order-screen one) need the person to confirm who they are.<br>5. **Admin → Возвраты → Политика:** dual approval is off by default; turn it on once two people can approve.<br>6. Make one small refund in Stripe **test mode**, then a live one. The live Stripe path has never been exercised. |
| Success | The refunds console opens without the "apply migration 0059" banner; a test refund appears in Stripe and the case reads "refunded"; the hourly workflow's "Call /api/cron/refunds" step is green. |
| Also deploy | Branch `claude/admiring-albattani-xgdcm5` (round 4) carries **Next.js 15.5.28**, which fixes a critical advisory in 15.5.27 (GHSA-2464-fhr4-w9xw). Merge it promptly. Details in `PROJECT_IMPROVEMENT_LOG.md`. |

## 1. Approve, commit and deploy the 2026-10-13 changes (rounds 2 and 3) — DONE (merged; migrations 0056–0058 are on `main`)

| | |
|---|---|
| Who | Owner, then Claude on instruction |
| What | Both 2026-10-13 rounds are in the working tree of `claude/admiring-albattani-xgdcm5`, **uncommitted**, as the briefs required. Approve the commit and push, then the merge to `main`. |
| Order | **Migrations 0056, 0057 and 0058 first** (§3), then the merge. Any order is safe: the code without 0056 releases nothing and the hourly job turns red with "Apply migration 0056"; without 0057 the coupon code falls back to the old function; 0058 changes nothing the storefront sees (search keeps working, it only stops the public key calling the function directly). Migrations first avoids the red job. |
| Success | Vercel production deploy succeeds; CI is green on `main`, including the new steps "Database tests", "Backup script tests" and "No server-only code or secrets in the browser bundle". |

## 2. Configure offsite backups and prove one restore — AUD-01, AUD-23

| | |
|---|---|
| Who | Owner (accounts, keys); GitHub Actions (runs) |
| What | Follow `docs/security/phase-1-backups.md`:<br>1. An S3-compatible bucket with Object Lock and a key that can write but not delete.<br>2. An age key pair: the public key becomes `BACKUP_AGE_RECIPIENTS`; the private key is kept offline, plus one copy as `BACKUP_AGE_IDENTITY` for the restore test.<br>3. The `backups` environment, restricted to `main`, with `SUPABASE_DB_URL` (a direct connection, never the pooler) and the bucket secrets.<br>4. Storage credentials plus `BACKUP_MEDIA_PASSPHRASE`, or the variable `BACKUP_SKIP_MEDIA=true` as a deliberate choice.<br>5. Run "Offsite backup", then "Backup restore test", by hand from the Actions tab. |
| Success | Both runs are green, and the restore-test summary reads "Restore test passed. Backup … N tables, M rows restored". `public.orders` in M should match the live order count. Until then, **production has no offsite backup.** |
| Meanwhile | Confirm the Supabase plan's own daily backups and retention (Dashboard → Database → Backups), and download one manual backup. |
| Never | Restore into the production project, or point `RESTORE_DB_URL` at it (the script now refuses Supabase URLs). |

## 3. Apply migrations 0056, 0057 and 0058 to production — AUD-09, AUD-18, AUD-20

| | |
|---|---|
| Who | Owner, in the Supabase SQL editor |
| What | Paste `supabase/migrations/0056_unpaid_order_reservations.sql`, run it, then do the same for `0057_coupon_line_scope.sql` and `0058_search_products_limits.sql`. All three are idempotent and add no data.<br>0057 replaces `redeem_coupon`. Unrestricted codes behave exactly as before.<br>0058 bounds `search_products` and makes it callable by the service role only. The only caller in this repository is `/api/search` (service role). A client outside it calling the function with the public key, if one exists, stops working; the storefront does not. |
| Before relying on 0056 | After the deploy, preview what the first run would release:<br>`curl -H "Authorization: Bearer $CRON_SECRET" "https://www.luxe-vault.store/api/cron/reservations?dry=1"`<br>It lists order numbers only. Every unpaid order older than 48 hours is on it, and the first real run cancels them all, restocking without emailing the customers.<br>If that is not wanted for some of them, mark those paid or cancelled by hand first. To pause, set `RESERVATION_EXPIRY=off` in Vercel. |
| Success | `select count(*) from pg_proc where proname = 'expirable_unpaid_orders'` returns 1.<br>`select pg_get_function_identity_arguments('public.redeem_coupon'::regproc)` ends in `p_lines jsonb`.<br>`select has_function_privilege('anon', 'public.search_products(text, integer)', 'execute')` returns false, and the storefront search still finds products.<br>`scripts/security/verify-production.sql` no longer reports `search_products`.<br>The hourly "Abandoned-cart reminders" run shows "Call /api/cron/reservations" with HTTP 200. |
| Decide | Whether 48 h / 60 min / 72 h suits the shop (`RESERVATION_HOLD_HOURS`, `RESERVATION_GRACE_MINUTES`, `RESERVATION_CEILING_HOURS`). |

## 4. Check admin sign-in and the second factor — AUD-05

| | |
|---|---|
| Who | Owner |
| What | Sign in to `/admin` once. "Вход временно недоступен" means `ADMIN_TOTP_SECRET` is set but invalid: run `node scripts/admin-totp-setup.mjs` on your own computer, set the value in Vercel, and redeploy. If the form does not ask for a 6-digit code, no second factor is configured: set one. |
| Success | Sign-in asks for the code and accepts the authenticator's code. |
| Why it matters | Without `ADMIN_TOTP_SECRET` the shared password alone opens the console (AUD-31). The code cannot make the factor mandatory without risking locking you out. |

## 5. Rotate or confirm the admin credentials — AUD-10

| | |
|---|---|
| Who | Owner |
| What | Old values of the admin password and session secret are in git history (commit `6916cd4` and earlier) and must be treated as public. Confirm the production values differ. If in doubt, generate new ones (`openssl rand -hex 32` for the session secret), set them in Vercel, and redeploy. |
| Effect | Every admin session ends at once. |
| Success | Sign-in works with the new password; an old session cookie gets 401. |
| Not done | Rewriting git history. It would not un-publish anything and would break every clone. |

## 6. Run reconciliation against the real Stripe account — AUD-24

| | |
|---|---|
| Who | Owner (signed in to the admin console) |
| What | Open `/api/admin/reconciliation?days=30`. It is read-only. Each entry in `discrepancies` names an order and a payment to compare in the Stripe dashboard. `recorded_not_paid` for orders older than the window is expected, because Stripe only returns payments created in the window. |
| Success | No discrepancies, or each one explained. Repeat monthly. |

## 7. Legal review of the catalogue — AUD-02

| | |
|---|---|
| Who | A qualified IP and consumer-law lawyer (Switzerland and the EU); the owner |
| Evidence to give them | The catalogue (names, `brand` field, images), the copy in `lib/ui-strings.ts` (the "replica" and "designer-inspired" wording, keys `product.authenticity*` and `checkout.authenticityNote`), `lib/content/home.ts`, and the Terms. |
| Question | Whether, and in which form, these goods may be sold and advertised, including the use of third-party brand names and imagery. |
| Approval needed | Before further listings are published. This audit changed no catalogue content and gives no legal opinion. |

## 8. Payment-provider confirmation — AUD-02

| | |
|---|---|
| Who | Owner, with Stripe and NOWPayments support |
| What | Written confirmation that the catalogue is acceptable under each provider's terms. Stripe's restricted-business terms exclude counterfeit and IP-infringing goods. |
| Why | A provider that disagrees can close the account and hold funds. |
| Success | A written answer on file. |

## 9. Provider dashboards — AUD-21

| Where | Action | Verify |
|---|---|---|
| Stripe → Developers → Webhooks | Endpoint subscribed to all 7 events the handler uses: `payment_intent.succeeded`, `.processing`, `.payment_failed`, `.canceled`, `charge.refunded`, `radar.early_fraud_warning.created`, `charge.dispute.created` | The "Event deliveries" tab shows 2xx |
| Stripe → Radar → Rules | Block when CVC fails; keep "block highest risk" | Rule list |
| Stripe → API keys | Consider a restricted key (PaymentIntents, Customers, PaymentMethods, Refunds, Charges read) | Checkout works in test mode first |
| Supabase → Auth | CAPTCHA, leaked-password protection, rate limits | Settings page |
| Cloudflare | WAF managed rules, rate-limit rules, Access in front of `/admin` | Security → Events |
| Vercel | Plan permits commercial use; env vars marked Sensitive; previews not using production secrets | Project settings |
| Netlify | Delete any site deploying this repo, with its variables; then remove `netlify.toml` and the plugin | No Netlify site exists |
| GitHub → Settings → Branches | Require the CI jobs on `main`; enable secret scanning and push protection; 2FA for every collaborator | A PR with a failing check cannot merge |
| Every console | MFA (Vercel, Supabase, Cloudflare, GitHub, Stripe, registrar, email) | Each account's security page |

## 10. Logs and alerting — AUD-26

| | |
|---|---|
| Who | Owner |
| What | A log drain (Vercel Pro) or a log platform, with alerts on the `security_event` lines. Thresholds are in `docs/security/incident-response.md`. |
| Success | A deliberate wrong admin password produces an `admin_login_failed` line in the platform. |

## 11. Production smoke test after each deploy

| | |
|---|---|
| Who | Owner (browser) and GitHub Actions ("Security check (live)", run it by hand) |
| What | Load the homepage, a product and the cart. Run a checkout in **Stripe test mode only**, or stop at the payment sheet in live mode. Sign in and out of admin. Open `/api/admin/reconciliation?days=1`. |
| Never | A real charge or refund as a test, or test orders against real customer data. |
| Success | The live check is green; each step behaves as expected. |

## 12. Business decisions recorded here, not made by the audit

- **Reservation hold:** 48 h (§3).
- **Paid orders cannot be deleted from the console:** they are cancelled and refunded instead (AUD-06).
- **Major dependency upgrades:** Tailwind 4 and ESLint 9/10 clear the remaining build-tool advisories (AUD-17). Schedule them as their own changes.
