# Executive report — security remediation (code)

**Dates:** audit 2026-10-12; remediation rounds 2026-10-12 (deployed), 2026-10-13 round 2 and round 3 (both uncommitted).

**Production:** `db36302` on `main`, deployed, CI green: the 2026-10-12 fixes.

**This work:** in the working tree of `claude/admiring-albattani-xgdcm5`. **It is not committed, pushed, deployed or migrated**, as the briefs require. No production system, provider dashboard, real payment, refund or customer notification was touched.

**Companion documents:**

- [FINDINGS.md](FINDINGS.md): 32 findings, with evidence, root cause, test and status;
- [REMEDIATION_LOG.md](REMEDIATION_LOG.md): every file changed, and why;
- [TEST_REPORT.md](TEST_REPORT.md): exact commands, exit codes and counts (§R3 for this round);
- [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md): code readiness (Part A) and external requirements (Part B);
- [MANUAL_ACTIONS_REQUIRED.md](MANUAL_ACTIONS_REQUIRED.md): what only the owner can do.

## Bottom line

**The code is ready for staging.** Every repository-level check passes on the final tree:

- typecheck and lint;
- 133 unit tests;
- 41 backup-script tests;
- 58 migrations and 89 database tests on Postgres 16 and 17;
- the production build;
- a check that no server-only code or secret reaches the browser bundle;
- 14 end-to-end and browser suites (about 470 checks) against the build;
- a refund-race stress test.

**Production readiness is not established, and code cannot establish it:**

1. **No offsite backup of production exists** (AUD-01). The scripts are proven, not the backups.
2. **The catalogue has no legal or payment-provider sign-off** (AUD-02). It sells goods described as replicas of designer items. This is the largest risk to the business.
3. **This code and migrations 0056–0058 are not in production.**
4. **Unverified settings:**
   - admin MFA;
   - rotation of the burned admin credentials;
   - provider dashboards;
   - branch protection;
   - a log drain.

No review proves an application secure. This one records what was tested, how, and what was not.

## Most important code fixes, by risk

| # | Finding | What was wrong | Evidence it is fixed |
|---|---|---|---|
| 1 | **AUD-32** (round 3) | Two refund presses a few milliseconds apart could **both be paid**, despite the deployed double-refund fix (AUD-07): one checked the order, the other read Stripe. | Without the fix, **15 of 30** racing pairs refunded twice; with it, **0 of 30**. Plus a deterministic end-to-end test and 3 unit tests. |
| 2 | **AUD-09** (round 2) | Anyone could hold the whole catalogue without paying. | Lapsed unpaid orders release after 48 h, never mid-payment, paid or shipped; DB, unit and end-to-end tests. |
| 3 | **AUD-27** (round 3) | In that release, one database error stopped the run, and a failed restock lost units silently and forever. | Per-order isolation; failed restocks repaired exactly once; database failures alert and turn the hourly job red. 9 unit tests; end to end with injected faults. |
| 4 | **AUD-18** (round 2) | A product-limited coupon discounted the whole basket (60.00 instead of 30.00); collection limits were ignored. | Reproduced on the deployed schema; `coupons.sql` 21; end to end. |
| 5 | **AUD-20** (round 3) | The public search function, callable with the public key, had no bounds. One request of 70 000 words cost ~2 s of CPU and then crashed with "stack depth limit exceeded". | Migration 0058: clamped, length-bound, service-role only. 8 ms instead of 2 s; `search.sql` 17; CI refuses a re-grant. |
| 6 | **AUD-22** (round 2) | A refund Stripe did not confirm could be issued again. | The claim is kept on timeouts and 5xx; end to end. |
| 7 | **AUD-23 / AUD-29** | Backup scripts accepted empty or truncated backups, and would restore into a Supabase project. They had no tests in the repository. | 41 tests in CI, **14 of which fail on the deployed scripts**; isolated real-tool restore of 120/120 orders. |
| 8 | AUD-24, 25, 26, 28, 30 | Smaller gaps: no Stripe reconciliation; unavailable products could be bought by a crafted request; no security event log; webhook errors echoed internals; nothing guarded the browser bundle. | Each tested; see FINDINGS. |

Also verified as already correct in round 3, and now pinned by tests:

- rate-limit counting under concurrency (10 requests against a limit of 5 → exactly 5);
- forged proxy headers cannot mint rate-limit buckets;
- the admin session cookie's attributes;
- the password check failing closed.

## Code quality

The codebase is careful where it matters: server-side pricing, a payment state machine enforced inside the database writes, RLS on every table, signed and revocable admin sessions, and documented reasoning beside the decisions. The defects found this round were at the **seams between steps**, where two correct steps leave a window between them:

- cancel, then restock;
- check the order, then read Stripe;
- an RPC granted more widely than its only caller needed.

The tests added this round target exactly those seams. They are concurrent, fault-injected and deterministic.

**Weak points that remain:**

- The end-to-end harness lives outside the repository, so CI does not run the HTTP or browser suites.
- 11 build-tool advisories wait on major upgrades.
- Admin access is one shared password, with an optional second factor (AUD-31).

## Still open

| ID | Severity | What | Blocked on |
|---|---|---|---|
| AUD-02 | Critical (legal) | Replica goods | Counsel; providers in writing |
| AUD-01 | High | No production backup | Owner: bucket, keys, first run |
| AUD-10 | Medium | Burned admin credentials | Owner: confirm or rotate |
| AUD-07 → 32, 09, 18, 20 | Medium | Fixed in code, not in production | Commit, migrations 0056–0058, deploy |
| AUD-31 | Low | Shared admin password; MFA optional when unset | Owner sets TOTP; per-person accounts are a later change |
| AUD-17 | Low | 11 build-tool advisories | Tailwind 4 / ESLint migrations |
| AUD-19 | Info | Two old migrations not re-runnable | By design: applied migrations are not edited |
| AUD-21 | Info | Dashboard settings | Owner |

## What the owner should do next

1. **Approve committing and pushing** this work to the branch. The container is temporary: uncommitted work is lost when it is reclaimed.
2. **Apply 0056, 0057 and 0058**, preview the first release with `?dry=1`, then merge and deploy.
3. **Configure offsite backups** and run the restore test.
4. **Sign in once** to confirm MFA; confirm or rotate the admin credentials.
5. **Get the legal review** and provider confirmation.
6. **Check the dashboards**, set up a log drain and branch protection, and fill in the runbook contacts.
7. **Run reconciliation** for the last 30 days.

## Scope

**Changed:** application code, migrations (new, forward-only), tests, scripts, CI and documentation.

**Not done:**

- no deploy;
- no commit or push;
- no production migration;
- no secret read, printed or rotated;
- no real or test-mode payment or refund;
- no customer notified;
- no dashboard accessed;
- no legal review.
