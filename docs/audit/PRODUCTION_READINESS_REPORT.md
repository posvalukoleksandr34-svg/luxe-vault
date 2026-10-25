# Production readiness report: audit and remediation, 2026-10-24

Scope: the whole repository at `4a18643` (branch `claude/admiring-albattani-xgdcm5`, PR #28), its GitHub Actions history and settings, and the evidence those runs carry about production. Owner actions: [OWNER_APPROVAL_CHECKLIST.md](OWNER_APPROVAL_CHECKLIST.md). Earlier findings AUD-01…AUD-32: [FINDINGS.md](FINDINGS.md). Each was re-checked where it still applies, and none is repeated as fixed without new evidence.

## 1. Executive summary

**Verdict: the store is not production-ready.**

The code is in good shape:
- Every repository check passes: types, lint, 362 unit tests, 41 backup-script tests, the production build, the browser-bundle secret check, 60 migrations with their access rules, 169 database assertions, and 387 end-to-end checks on a local production build.

Readiness depends on things code cannot settle, and several are confirmed problems, not hypotheses:

1. **There is no offsite backup.** Every nightly run since the fix that stopped it reporting false success has failed, because the `backups` environment holds no secrets or variables at all (job log, 2026-10-24).
2. **Six production orders have a Stripe payment that is `succeeded` or `processing` while the order is still unpaid**, for at least three days. Public Actions logs show the same six on 2026-10-21 and 2026-10-24.
   - The cause is unknown (webhook delivery, configuration, or a refused amount). It needs the Stripe dashboard.
   - Nothing alerted anyone. That gap is now fixed.
3. **The old admin password and session secret are public.** The repository is public and they are in its history. Whether production still uses them cannot be seen from here.
4. **The catalogue openly sells "replicas"**, and the seed data names a third-party brand. Lawyer and payment-provider sign-off are outstanding. This is the largest business risk.
5. **`main` is not branch-protected**, so CI is not required before a merge reaches production.

Fixed in this round (code, tested):
- a high-severity runtime dependency advisory (zod);
- the silent stuck-payment condition, now alerted;
- order numbers printed into public CI logs;
- Dependabot updates blocked by an outdated TypeScript target;
- a production-verification SQL script that did not cover the last five migrations;
- a way for the owner to see, without revealing anything, whether production still uses the burned admin credentials.

Nothing was deployed, migrated, rotated, paid, refunded or emailed.

## 2. Confirmed issues, ranked by severity

"Confirmed" means shown by evidence named in the row. "Fixed" means changed in code and tested here. Production effect follows only after PR #28 is merged and deployed (OA-14).

| # | Severity | Issue | Evidence | Status |
|---|---|---|---|---|
| C-1 | **HIGH** | **No offsite backup exists.** "Offsite backup" has failed every night for 12 nights running (2026-10-13 → 2026-10-24). The 2026-10-24 job log shows `SUPABASE_DB_URL`, `BACKUP_AGE_RECIPIENTS`, `BACKUP_BUCKET`, all S3 credentials and the media settings empty in the `backups` environment. The weekly "Backup restore test" has failed since 2026-10-19; its earlier "success" runs predate the AUD-01 fix and were false. | Actions runs 40074724739 and earlier, step "Check configuration". | NOT FIXED: owner configuration (OA-06, OA-07). It would be CRITICAL if the Supabase plan's own backups (unverified) are also absent. |
| C-2 | **HIGH** | **Six orders: Stripe holds a payment that is succeeded or processing, the order is unpaid, 3+ days.** The hourly reservation sweep lists the same six under `paymentInFlight` on 2026-10-21 07:44 and 2026-10-24 11:10 UTC. "In flight" means Stripe answered `succeeded` or `processing` and so the sweep refused to cancel them. | Actions job logs 119102215878 and 120857212910; `lib/server/stripe.ts` `cancelPaymentIntent`. | Cause NOT VERIFIED (OA-03, OA-08). **Detection FIXED:** see F-2. |
| C-3 | **HIGH** | **Burned admin credentials in public history.** `a3aae8f` (2026-09-04) committed fallback values for `ADMIN_PASSWORD` (20 chars) and `ADMIN_SESSION_SECRET` (36 chars), removed in `9b36bec`. `6916cd4` put them in `scripts/verify-security.mjs`. The repository is public (`visibility: public`). gitleaks finds exactly these four lines. The audit computed the values' SHA-256 without printing them, and they match the digests the repository uses. | git history; GitHub API; gitleaks 8.28.0 without the allowlist. | Exposure CONFIRMED; production use UNVERIFIED. Rotation needs approval (OA-04). **Detection added:** F-6. Not resolved by removing the code literals. |
| C-4 | **HIGH** (advisory rating) | **zod 4.6.5: GHSA-mrhx-c7xc-m3w5**, memory exhaustion on oversized constrained collections. It is reachable at runtime. The customer refund routes parse `z.array(...).max(6)` (`lib/refunds/schemas.ts`, `lib/returns/schema.ts`) and the admin routes parse others. | `npm audit`: 1 high. | **FIXED:** zod 4.6.7. `npm audit --audit-level=high` now exits 0. |
| C-5 | **MEDIUM** | **`main` is unprotected.** `protected: false`, no required checks. CI runs, but a red PR can be merged and deployed. | `GET /repos/…/branches/main`. | NOT FIXED: owner setting (OA-13). |
| C-6 | **MEDIUM** | **Dependency updates blocked.** Dependabot PR #26 (27 minor/patch updates, including zod 4.6.7, stripe and TypeScript 5.9.3) has failed CI since 2026-10-23. With TypeScript 5.9 and `"target": "es5"`, the regex `u` flag fails with TS1501 (26 errors; the CI log shows the first 12). Behind them, with PR #26's @types/node 20.19.43, a Node `Buffer` response body fails the newer DOM typings (1× TS2345). | CI job 120464694403; reproduced locally with TypeScript 5.9.3 and @types/node 20.19.43. | **FIXED:** target `ES2018` and a `Uint8Array` body in the invoice route. Typecheck is clean with both 5.2.2 and 5.9.3 + 20.19.43. PR #26 needs a rebase once PR #28 merges. |
| C-7 | **MEDIUM** | **"Hourly" jobs run every 3–6 hours.** GitHub delays scheduled workflows; runs of "Abandoned-cart reminders" on 2026-10-24 were at 00:49, 05:58 and 11:10. Review requests and reservation release are delayed accordingly. The Vercel daily cron (`/api/cron/sweep`) covers reservations and the refund sweep, not review requests. | Actions run list. | NOT FIXED: platform choice (OA-10 a). |
| C-8 | **MEDIUM** | **GitHub-side failure alerts do not reach Telegram.** `INTERNAL_API_SECRET` was empty in the backup job; the step exits 0 without sending, so a failed backup alerted only by GitHub email. | Job 120815530219 env dump. | NOT FIXED: owner secret (OA-10 b). |
| C-9 | **MEDIUM** | **Email bounces and complaints are not handled.** No Resend webhook handler exists, so hard bounces are not added to `email_suppressions`. This matters once review-request sending is enabled; production shows it `disabled`. | Code search; cron output `"sent":{"status":"disabled"}`. | **Code FIXED 2026-10-25** (`/api/email/webhook`, CI-2 in CONTINUOUS_IMPROVEMENT_LOG.md). Needs Resend configuration and `RESEND_WEBHOOK_SECRET` (OA-12). |
| C-10 | **LOW** | **Order numbers in public CI logs.** The hourly workflow printed the reservation response, including order numbers, into Actions logs, which are public for a public repository. | Job logs cited in C-2. | **FIXED** going forward: counts only (F-3). Old logs remain (OA-18, optional). |
| C-11 | **LOW** | **The production-verification script was out of date.** `scripts/security/verify-production.sql` stopped at 0055, so the owner could not check 0056–0060 or the new server-only tables with it. | File contents. | **FIXED** (F-5), with a negative test. |
| C-12 | **LOW** | **Build-time advisories.** 4 moderate (postcss-selector-parser through tailwindcss 3, tailwindcss-animate). No runtime exposure; the fix is a Tailwind 4 migration (AUD-17). | `npm audit`. | NOT FIXED (scheduled work). |

No CRITICAL issue was confirmed by evidence. C-1 and C-3 become critical if, respectively, the Supabase plan keeps no backups, or production still uses the burned credentials. The audit could not see either.

## 3. Potential issues requiring further investigation

These are not confirmed and are not rated as findings.

| # | Concern | What is known | Who can settle it |
|---|---|---|---|
| P-1 | Cause of C-2 | A missing `payment_intent.succeeded` subscription, a rotated `STRIPE_WEBHOOK_SECRET`, an amount or currency mismatch (the webhook alerts and refuses), or bank payments still `processing` would each produce it. | Owner: Stripe event deliveries (OA-03, OA-08). |
| P-2 | Admin MFA in production | `GET /api/admin/login` answers `{"mfa":true\|false}`; the live site was unreachable from the audit environment. | Owner (OA-05). |
| P-3 | Migrations 0057 and 0058 | 0056, 0059 and 0060 are indirectly confirmed applied: their cron endpoints answer 200, not 503 "apply migration". 0057 and 0058 leave no outside trace. | Owner: `verify-production.sql` (OA-11). |
| P-4 | NOWPayments | The live check on 2026-10-19 got 503 "Crypto payments not configured" from the crypto webhook. Whether checkout offers crypto in that state is unverified. | Owner (OA-16). |
| P-5 | Stripe refund webhooks | The handler processes 11 event types. Whether the endpoint subscribes to the refund and dispute events is unknown. | Owner (OA-08). |
| P-6 | Vercel plan | A daily-only `vercel.json` cron and hourly jobs on GitHub are consistent with the Hobby plan, which does not allow commercial use. | Owner (OA-17). |
| P-7 | Legal and provider eligibility | "Replica" wording throughout; a Gucci-named seed product with images in `public/images/`; "old price" strike-throughs. No conclusion is drawn here. | Lawyer; Stripe and NOWPayments (OA-01, OA-02). |
| P-8 | Stale open PRs | #4 and #5 (owner's, old) and #11, #12 (Dependabot action major bumps) are open. They are not reviewed here. | Owner. |

## 4. Fixes implemented and files changed

| # | Fix | Files | Test evidence |
|---|---|---|---|
| F-1 | zod 4.6.5 → 4.6.7, a patch release (GHSA-mrhx-c7xc-m3w5). | `package.json`, `package-lock.json` (zod entry only) | `npm audit` 0 high; all suites green. |
| F-2 | **Stuck-payment alert.** The reservation sweep keeps Stripe's status for each order it may not cancel (`paymentInFlightStatus`). The cron route then does three things:<br>• writes the disagreement to the platform log on every run;<br>• sends one Telegram alert per order, de-duplicated through the `stripe_events` ledger;<br>• hands the claim back when the message could not be sent, so a later run retries.<br>A `succeeded` payment is called out as money taken for an unpaid order. The order is still never cancelled. | `lib/server/stripe.ts` (`intentStatus`), `lib/server/reservations.ts` (`paymentInFlightStatus`, `paymentInFlightAlert`), `app/api/cron/reservations/route.ts` | Unit: 1 new test and new assertions in an existing one (`tests/security/reservations-reconciliation.test.ts`). On the local stand, an unpaid order 80 h old with a `succeeded` intent:<br>• without Telegram: logged on each run, claim released, order still pending;<br>• with a Telegram stub: exactly 1 message over 3 runs, 1 ledger row. |
| F-3 | The hourly workflow prints **counts only**: arrays become lengths, so no order numbers reach public logs. It falls back to the first 300 bytes when the body is not JSON. | `.github/workflows/abandoned-carts-cron.yml` | jq filter run on a sample and on a non-JSON body; YAML parses. Not yet run on GitHub. |
| F-4 | TypeScript `target` es5 → ES2018 (regex `u` flags); the invoice PDF is returned as a `Uint8Array`. Same bytes, same `Content-Length`. Unblocks Dependabot PR #26. | `tsconfig.json`, `app/api/admin/orders/[id]/invoice/route.ts` | `tsc` clean on 5.2.2 (repo) and on 5.9.3 + @types/node 20.19.43 (PR #26's versions); build OK; admin e2e (invoice route) green. |
| F-5 | `verify-production.sql` covers 0056, 0057, 0058, 0059 (tables, case numbers, unique Stripe refund id) and 0060. It also checks the 11 new server-only tables have no customer policies. Still read-only. | `scripts/security/verify-production.sql` | Fully migrated database: 93/93 OK. Database migrated only to 0055: exactly the seven expected PROBLEM rows (0056–0060 and `search_products`). |
| F-6 | **Burned-credential check.** If `ADMIN_PASSWORD` or `ADMIN_SESSION_SECRET` hashes to a burned value:<br>• the admin dashboard shows a red warning, naming the variable but never the value;<br>• sign-in logs a `security_event: admin_credentials_burned`.<br>Sign-in is **not** refused, because that would change authentication behaviour and could lock the owner out; rotating is OA-04. | `lib/server/burned-credentials.ts` (new), `app/admin/page.tsx`, `app/api/admin/login/route.ts`, `lib/server/security-events.ts`, `tests/security/burned-credentials.test.ts` (new) | 4 unit tests with stand-in digests (the real values are not reproduced in tests). On the stand with test credentials: no banner, dashboard intact. gitleaks clean on the new files. |
| F-7 | This report and the owner checklist. | `docs/audit/PRODUCTION_READINESS_REPORT.md`, `docs/audit/OWNER_APPROVAL_CHECKLIST.md` | n/a |

Nothing in the storefront, checkout, payment logic, database schema, migrations, permissions or the catalogue was changed.

### 4a. Continuous-improvement round, 2026-10-25 (on the branch, not merged or deployed)

Details, tests and limitations per item are in
[CONTINUOUS_IMPROVEMENT_LOG.md](CONTINUOUS_IMPROVEMENT_LOG.md).

| # | Change | Live after |
|---|---|---|
| CI-1 | One order per checkout attempt (idempotency key, migration 0061) | merge + deploy + OA-19 |
| CI-2 | Resend bounce/complaint webhook → `email_suppressions` (closes C-9 in code) | merge + deploy + OA-12 |
| CI-3 | Cart quantity cap matches what the order charges (20 per line) | merge + deploy |
| CI-4 | Page heading on 404, empty checkout, order-not-found | merge + deploy |
| CI-5 | Checkout no longer flashes "Your cart is empty" | merge + deploy |
| CI-6, CI-7 | Address book and saved cards: a failed load is an error with a retry, not "none"; the cards API reports Stripe failures (502) instead of an empty list | merge + deploy |
| CI-8 | Admin stock page: a failed load is an error, not "0 positions" | merge + deploy |
| CI-9, CI-10 | Tab titles (checkout, account, 404, localised homepages); `/cart` opens the cart | merge + deploy |

These were verified on the local stand only (production build, real
Postgres, fake Stripe); GitHub CI runs on pull requests and has not run on
these commits. None of them changes a blocker in section 8.

## 5. Tests run and results

Environment: this cloud container, Node 22.22.2, npm 10.9.7, at `4a18643` plus the changes above.
- Databases: disposable PostgreSQL 16.13. PostgREST 12.2.3.
- Stand-ins, never live providers: local Stripe, Telegram and Resend stand-ins.
- No live provider, no production data, and no network access to production: the egress proxy answered 403.

| Check | Exact command | Result | Detail | Mocks / data |
|---|---|---|---|---|
| Typecheck | `npm run typecheck` | **PASS** | 0 errors (TypeScript 5.2.2) | none |
| Typecheck, Dependabot versions | `node …/typescript@5.9.3/bin/tsc --noEmit -p . --incremental false --typeRoots …/@types@20.19.43` | **PASS** after F-4 | Before: FAIL, 26× TS1501, then 1× TS2345 | none |
| Lint | `npx next lint` | **PASS** | No warnings or errors | none |
| Security unit tests | `npm run test:security` | **PASS** | 143/143 (138 before this round + 5 new) | in-memory fakes |
| Store tests | `npm run test:store` | **PASS** | 53/53 | pure functions |
| Refund rules | `npm run test:refunds` | **PASS** | 61/61 | pure functions |
| Assistant (offline) | `npm run test:assistant` | **PASS** | 105/105 | scripted model, fixtures |
| Assistant (live model) | `npm run test:assistant:live` | **NOT RUN** | Needs a live Gemini key and network; opt-in by design | live provider |
| Backup scripts | `tests/backup/run.sh` | **PASS** | 41 PASS, 0 failed | stubbed docker/age, temp-dir bucket |
| Production build | `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=x NEXT_PUBLIC_GA_MEASUREMENT_ID=G-TESTADMIN0 npx next build` | **PASS** | Exit 0 | placeholder public values |
| Bundle secret check | `scripts/ci/check-client-bundle.sh` | **PASS** | 39 server-only names and 5 secret shapes, 260 files | build output |
| Migrations | `DATABASE_URL=postgresql://postgres@127.0.0.1:55441/audit_ci scripts/ci/verify-migrations.sh` | **PASS** | 60 applied to an empty database; 34 re-applied idempotently; "access rules hold" | disposable local DB |
| Database tests | `DATABASE_URL=… scripts/ci/db-tests.sh` | **PASS** | 169 PASS assertions (RLS, coupons, reservations, search, rate limits, refunds, review requests); concurrency "0 failed" | disposable local DB |
| Dependencies, critical | `npm audit --audit-level=critical` | **PASS** | 0 critical | registry advisories |
| Dependencies, high | `npm audit --audit-level=high` | **PASS** after F-1 | Before: 1 high (zod). After: 0 high, 4 moderate (C-12) | registry advisories |
| Secrets, history | `gitleaks git --redact --no-banner --exit-code 1 .` (v8.28.0, checksum verified) | **PASS** | 256 commits, no leaks beyond the 4 allow-listed fingerprints. Without the allowlist: exactly those 4 (C-3) | full git history |
| Secrets, working tree | `gitleaks dir --redact .` | **PASS** for tracked files | 15 hits, all in the untracked, git-ignored `.next/` build output (per-build keys) | local tree |
| Production verification SQL | `psql … -f scripts/security/verify-production.sql` | **PASS** | 93/93 OK (full); 7 expected PROBLEM rows (to 0055) | disposable local DBs |
| Admin console e2e | `node adm/e2e.js` (harness outside the repo) | **PASS** | 70/70, desktop and 390 px | prod build + local Postgres/PostgREST |
| Storefront smoke | `node adm/store-smoke.js` | **PASS** | 16/16, including checkout layout | as above |
| Review requests e2e | `node rr/e2e.js` | **PASS** | 100/100 | local Resend stand-in |
| Refund integration | `node refunds/integration.js` | **PASS** | 107/107, including bad webhook signature → 400, same event again → duplicate, second delivery not counted twice | local Stripe stand-in |
| Refund UI | `node refunds/ui.js` | **PASS** | 12/12 | as above |
| Product reviews | `node reviews-suite.js` | **PASS** | 82/82 | local DB |
| Payment state machine (crypto) | `node payments-suite.js` | **BLOCKED** | Stops at its first check: the stand's server has no NOWPayments configuration (503) and no NOWPayments stand-in. Stripe paths are covered by `test:security` (payment-state) and the refund integration suite. | n/a |
| Stuck-payment alert e2e | manual, on the stand (§4 F-2) | **PASS** | 3 scenarios as described | local Stripe and Telegram stand-ins |
| Live site check | GitHub Actions "Security check (live)", run 39260384097 (2026-10-19), read from its log | **PASS** (as of 2026-10-19) | 28 PASS, 0 failed: headers, CSP, origin lock, admin/webhook refusals, CSRF, image allow-list | **live production**, read-only |
| Live site check, re-run now | `curl https://www.luxe-vault.store/` | **BLOCKED** | The audit environment's egress proxy refused the connection (HTTP 403). This says nothing about the site. | n/a |
| Production cron | GitHub Actions run 40088856567 (2026-10-24 11:10 UTC), read from its log | **PASS** | All four endpoints HTTP 200 (C-2 is in the reservations output) | **live production**, read-only |

No test was weakened, skipped or disabled. No security control was relaxed.

## 6. Production settings that could not be verified

The following could not be verified from here. Each item names who can verify it.

- Vercel environment variables, plan and preview scoping: owner.
- Admin TOTP on (P-2), and whether production still uses the burned credentials (C-3): owner. The new dashboard banner shows the latter after deploy.
- Stripe:
  - live or test mode;
  - webhook event subscriptions (P-5) and their delivery history (C-2);
  - Radar rules;
  - restricted API key.
  
  Owner, in the Stripe dashboard.
- NOWPayments configuration (P-4): owner.
- Supabase:
  - which migrations are applied (P-3);
  - the plan's backups and PITR (C-1);
  - Auth protections (CAPTCHA, leaked-password checks).
  
  Owner.
- Resend domain, DKIM and SPF, and webhooks (C-9): owner.
- Cloudflare WAF and rate rules: owner. The origin lock itself is verified by the live check.
- GitHub:
  - environment `backups` contents (C-1; the log shows them empty);
  - secret scanning and push protection;
  - collaborator 2FA.
  
  Owner. The API for these is closed to the audit's token.
- Log drain and alerting on `security_event` lines; whether Telegram is configured in Vercel. F-2 relies on it for push alerts and otherwise only logs. Owner.

## 7. Owner approvals and signatures still required

Full table, with next steps and evidence: [OWNER_APPROVAL_CHECKLIST.md](OWNER_APPROVAL_CHECKLIST.md).

- **Signatures or written statements from third parties:**
  - OA-01: a lawyer's written opinion on the catalogue.
  - OA-02: Stripe's written confirmation, and NOWPayments' if crypto is used.
- **Owner approvals:**
  - OA-04: credential rotation.
  - OA-06: offsite backups and the restore test.
  - OA-09: a live Stripe payment and refund.
  - OA-11: any missing migration.
  - OA-14: merging PR #28 and the deploy.
  - OA-15: the smoke test.
- **Owner confirmations and decisions:**
  - OA-03: the six orders.
  - OA-05: MFA and recovery.
  - OA-07: Supabase backups.
  - OA-08: Stripe events.
  - OA-10: cron and alerts.
  - OA-12: review-email consent and bounces.
  - OA-13: branch protection.
  - OA-16: crypto.
  - OA-17: Vercel plan.
  - OA-18: old logs, optional.

## 8. Remaining blockers to production readiness

1. No offsite backup and no proven restore (C-1; OA-06 and OA-07).
2. Unexplained payment/order disagreement on six live orders (C-2; OA-03 and OA-08).
3. Possibly valid public admin credentials (C-3; OA-04), and MFA unverified (OA-05).
4. No legal opinion and no payment-provider confirmation for the catalogue (OA-01, OA-02).
5. The fixes in this round are not deployed (OA-14), and nothing has been smoke-tested after a deploy (OA-15).
6. The live Stripe payment and refund paths have never been exercised (OA-09).

Until these are closed, a green test suite does not establish production readiness.

## 9. Prioritised remediation plan

| When | Step | Owner | Closes |
|---|---|---|---|
| Today | Look up the six orders in Stripe and their webhook deliveries; decide each one. Confirm the webhook's 11 events. | Owner | C-2, P-1, P-5 |
| Today | Confirm or rotate `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET`; check `/api/admin/login` says `mfa: true`. | Owner | C-3, P-2 |
| Today | Confirm the Supabase plan backups and download one manual backup. | Owner | C-1 (interim) |
| This week | Review and merge PR #28; Vercel deploy; run "Security check (live)" and the manual smoke test. | Owner | C-4, C-6, C-10, C-11 live; OA-15 |
| This week | Configure the `backups` environment; run "Offsite backup" and "Backup restore test"; add `INTERNAL_API_SECRET` to GitHub. | Owner | C-1, C-8 |
| This week | Protect `main` with the four CI jobs required; enable secret scanning and push protection. | Owner | C-5 |
| This week | Run `verify-production.sql` in the Supabase SQL editor; apply anything it names, after approval. | Owner | P-3 |
| Before more listings | Lawyer's written opinion; Stripe (and NOWPayments) written confirmation; act on them. | Owner + counsel + providers | P-7 |
| Before enabling review emails | Consent decision; Resend bounce/complaint webhook (a code change, then Resend configuration). | Owner, then engineering | C-9 |
| Next | Rebase and merge Dependabot PR #26. Decide the hourly scheduler (GitHub, Vercel paid cron, or external). Confirm the Vercel plan and NOWPayments status. Schedule the Tailwind 4 migration. | Owner / engineering | C-6, C-7, C-12, P-4, P-6 |
| Monthly | `/api/admin/reconciliation?days=30` and a backup restore test. | Owner | ongoing |
