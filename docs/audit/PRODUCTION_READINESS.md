# Production readiness — 2026-10-13 (after the code-only remediation round)

**Verdict:**

- **The code is ready for staging.** Every repository-level check passes on the final working tree (Part A). Conditions:
  - commit it;
  - apply migrations 0056, 0057 and 0058 to the staging database;
  - use a staging environment with its own Supabase project and Stripe test keys. None was found or verified.
- **Production readiness is NOT established.**
  - No production backup exists.
  - The catalogue has no legal or payment-provider sign-off.
  - The three migrations and this code are not in production.
  - Admin MFA, the credential rotation, the dashboards and alerting are unverified (Part B).
  - None of these can be closed by changing code.

**What production runs today:** `db36302`, the 2026-10-12 fixes. It still carries:

- the refund race (AUD-32): 15 of 30 racing double presses refunded twice, against a build without the fix;
- the unbounded public search function (AUD-20);
- indefinite stock holds (AUD-09);
- whole-basket product coupons (AUD-18).

All four are fixed in the uncommitted working tree.

| Status | Meaning |
|---|---|
| **VERIFIED** | Checked on 2026-10-13 with the evidence named. |
| **VERIFIED (isolated)** | Shown on a production build against disposable Postgres (16.13 and 17.11) with PostgREST 12.2.3 and local stand-ins for Stripe, NOWPayments and S3. It has not run in production. |
| **FAILED** | Checked and not met. |
| **NOT VERIFIED** | Needs a dashboard, a production secret, live data, a lawyer, or a deploy this work may not do. |

Commands and counts: [TEST_REPORT.md](TEST_REPORT.md) §R3. Findings: [FINDINGS.md](FINDINGS.md). Owner steps: [MANUAL_ACTIONS_REQUIRED.md](MANUAL_ACTIONS_REQUIRED.md).

---

# Part A — Repository-level readiness (the code)

| Area | Status | Evidence |
|---|---|---|
| **Build, types, lint** | VERIFIED | `next build` exit 0; `tsc` 0 errors; lint clean. |
| **Unit and security tests** | VERIFIED | 133/133 (`npm run test:security`). |
| **Secrets in code** | VERIFIED | gitleaks: working tree 0; 217 commits 0 beyond the 4 known burned lines (AUD-10). No server-only variable read and no secret shape in the browser bundle (`check-client-bundle.sh`, new CI step, negative-tested). |
| **Admin authentication** | VERIFIED (isolated) | Sessions HMAC-signed, expiring, password-bound, revocable. Tampered, expired, malformed and secret-less tokens refused. An invalid TOTP secret blocks sign-in. Sign-in rate-limited and failing closed. Cookie `__Host-`, HttpOnly, Secure, SameSite=Lax (unit). Design limits: AUD-31. |
| **Authorization / IDOR** | VERIFIED | Every `/api/admin` handler calls `requireAdmin()`. Customer routes authorize by owner or constant-time token, with 404 for "not yours" (security and integration suites). |
| **Database access (RLS, grants)** | VERIFIED (isolated) | 58 migrations on empty Postgres 16 and 17; `check-access.sql` (7 rules); `rls.sql` 20 denials. Browser-callable SECURITY DEFINER functions are down to two, both `auth.uid()`-scoped. Negative tests: a permissive policy, and a re-grant of `search_products` to anon, each fail CI. |
| **Migrations** | VERIFIED (isolated) | All 58 apply in order; 32 (0027+) re-apply idempotently. 0005 and 0026 are not re-runnable (AUD-19, documented, not changed: applied migrations are not edited). |
| **Payment verification** | VERIFIED (isolated) | Signature on the raw body, de-duplication, amount and currency checked against the order, state machine in every UPDATE; payments suite 33/33. Webhook errors no longer echo internals (AUD-28). |
| **Refund safety** | VERIFIED (isolated) | Never above the remainder. One refund per ledger state, with an idempotency key. An unconfirmed refund keeps its claim (AUD-22). No refund while Stripe's ledger is ahead of the order (AUD-32). Stress: 0 of 30 double refunds (15 of 30 without the fix). Not against Stripe test mode. |
| **Inventory and reservations** | VERIFIED (isolated) | No oversell (race tests). Lapsed unpaid orders released after 48 h, never mid-payment, never paid, settling or shipped (AUD-09). One order's failure never stops the others; a failed restock is repaired exactly once by the next run; database failures turn the job red (AUD-27). |
| **Coupons** | VERIFIED (isolated) | Line-scoped, priced in the database, collection limits enforced, fail closed, single use under 4 racers (AUD-18; `coupons.sql` 21). |
| **Rate limiting** | VERIFIED (isolated) | Six guessing surfaces fail closed. Counting is atomic: a limit of 3 allows 3; 10 simultaneous requests against 5 give exactly 5 allowed. Forged or partial edge headers cannot mint buckets (unit). |
| **Public search and API limits** | VERIFIED (isolated) | `search_products` clamped, bounded and service-role only (AUD-20; `search.sql` 17). Every user-controlled limit, day count and id list is clamped server-side. |
| **Backup and restore scripts** | VERIFIED (repository tests + isolated) | 41 stub-based tests in CI (14 fail on the deployed scripts). The real tools end to end in isolation: 120/120 orders restored; 7 failure paths named; no secret in logs. Scripts delete nothing; retention is the bucket's Object Lock. |
| **Scheduled jobs (code)** | VERIFIED (isolated) | Cron routes refuse a missing or wrong secret before any work. The reservation job is idempotent and safe to repeat; failures alert and answer 500. |
| **Error handling and observability (code)** | VERIFIED | Structured `security_event` lines without raw IPs. Generic error bodies on payment webhooks. Critical paths alert (payment mismatch, stock conflict, restock failure, reservation failures). |
| **CI** | VERIFIED (locally) / NOT VERIFIED (GitHub) | Typecheck, lint, unit, backup tests, build, bundle check, gitleaks over the full history, dependency audit, migrations and database tests. Actions SHA-pinned, read-only permissions, no `pull_request_target`, no secrets in CI. The new steps have not run on GitHub: nothing pushed. |
| **Dependencies** | FAILED (low) | 11 build-time advisories (3 moderate, 8 high, 0 critical), none at runtime. No compatible fix exists: a non-force `npm audit fix` changes 66 lockfile entries and fixes none. Needs the Tailwind 4 / ESLint migrations (AUD-17). |
| **Rollback compatibility** | VERIFIED (isolated, by test) | 0056 and 0058 are additive or permission-only. 0057 refuses (never over-discounts) restricted codes for older callers. Old code works against all three. |
| **End-to-end tests in CI** | NOT VERIFIED | The HTTP and browser suites (14 suites, about 470 checks) run from a harness outside the repository, not in CI. |

# Part B — External infrastructure requirements (not code)

None of these can be verified or completed from the repository. Each is the owner's, in MANUAL_ACTIONS_REQUIRED.md.

| Requirement | Status | What closes it |
|---|---|---|
| **Offsite backups exist, and one restore has been proven** | **FAILED** — none has ever run (AUD-01) | Bucket, keys, `backups` environment; run both workflows (§2) |
| **Migrations 0056, 0057, 0058 on production** | NOT VERIFIED (not applied) | SQL editor, `?dry=1` preview first (§3) |
| **Deploy this code** | NOT VERIFIED (uncommitted) | Approve the commit, push and merge (§1) |
| **Admin MFA in production** | NOT VERIFIED | Sign in once; set `ADMIN_TOTP_SECRET` if not asked for a code (§4, AUD-31) |
| **Burned admin credentials rotated** | NOT VERIFIED | Confirm or rotate (§5, AUD-10) |
| **Stripe:** live/test mode, 7 webhook events, Radar, restricted key | NOT VERIFIED | Dashboard (§9) |
| **Stripe agrees with the orders** | NOT VERIFIED | `/api/admin/reconciliation?days=30` (§6) |
| **Supabase Auth protections; Cloudflare WAF, rate rules, Access** | NOT VERIFIED | Dashboards (§9) |
| **Branch protection requiring CI** | NOT VERIFIED | GitHub settings (§9) |
| **Log drain and alerts on `security_event`** | NOT VERIFIED | Vercel or another log platform (§10) |
| **Supabase plan backups and retention** | NOT VERIFIED | Dashboard (§2) |
| **Legal review of the catalogue; provider acceptance** | NOT VERIFIED — the largest business risk (AUD-02) | Counsel; Stripe and NOWPayments in writing (§7, §8) |
| **Named owners, incident contacts, rehearsal** | NOT VERIFIED | Fill in `docs/security/incident-response.md` |
| **Vercel plan, previews isolated, Netlify leftover** | NOT VERIFIED | Dashboards (§9) |
| **Core Web Vitals, full accessibility re-audit** | NOT VERIFIED | Field data; a separate audit |
