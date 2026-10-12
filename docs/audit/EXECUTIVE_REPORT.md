# Executive report — security, integrity and readiness audit

**Date:** 2026-10-12.
**Code audited:** `main` at `17eb2c9`.
**Fixes:** branch `claude/admiring-albattani-xgdcm5`, merged to `main` and **deployed to production** on 2026-10-12 as `d8a18cf`. The Vercel production deploy succeeded, CI is green on `main`, and the live security check passed after the deploy.

**Companion documents:**

- [FINDINGS.md](FINDINGS.md): every finding, with evidence;
- [REMEDIATION_LOG.md](REMEDIATION_LOG.md): what changed;
- [TEST_REPORT.md](TEST_REPORT.md): what was run and the results;
- [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md): checklist with VERIFIED, FAILED and NOT VERIFIED.

## Bottom line

The application's core controls hold up under direct testing:

- row-level security on every table;
- server-side pricing;
- signed, de-duplicated payment webhooks with a payment state machine;
- an admin session that can be revoked at the edge;
- a live origin lock behind Cloudflare.

Most earlier audit work is still sound. This audit found **no way for an outsider to read another customer's data, change a price or mark an order paid.**

It did find:

- several ways the shop's own **records of money and stock could become untrue**;
- places where a **control failed open**;
- one operational gap that matters more than any code finding: **there are no offsite backups.** The backup workflow has shown a green "success" every night while skipping the backup.

The largest risk is not technical. The shop sells goods described as replicas of designer items, and that needs a lawyer and the payment providers to sign off (AUD-02).

No audit can show an application is secure. This one shows what was tested, how, and what could not be checked from here.

## What needs the owner, in order

1. **Backups (AUD-01).**
   - Configure the offsite backup (`docs/security/phase-1-backups.md`).
   - Run the restore test by hand and confirm it passes.
   - Meanwhile, check the Supabase plan's own backups and take a manual dump.
   - After this branch is merged, both backup workflows turn **red** until configured. That is deliberate.
2. **Legal review of the catalogue (AUD-02).** IP counsel, plus written confirmation from Stripe and NOWPayments that replica / designer-inspired goods are acceptable to them. "Replica" on the label does not make a sale lawful.
3. **Now that it is live:**
   - Sign in to the admin console once. If it answers "Вход временно недоступен", `ADMIN_TOTP_SECRET` is set but invalid (AUD-05): fix it with `scripts/admin-totp-setup.mjs`, or remove it, and redeploy. An invalid secret now blocks sign-in instead of silently switching MFA off.
   - Confirm the old, burned admin password and session secret are not in use (AUD-10).
4. **Decide how long an unpaid order may hold stock (AUD-09).** Today it is forever. Anyone can reserve the whole catalogue without paying, at checkout speed.
5. **Next:**
   - Make the new CI checks required on `main` (AUD-08).
   - Review the Dependabot pull requests. The config now ignores major npm versions; the major-version PRs it opened first (Tailwind 4, ESLint 10, eslint-config-next 16, Stripe.js 10) are migrations to schedule deliberately, not to merge as bumps.
   - Work through the dashboard items in [FINDINGS AUD-21](FINDINGS.md#aud-21): Vercel plan, Netlify leftover, Supabase Auth settings, Stripe webhook events and Radar, Cloudflare WAF and Access, GitHub branch protection, and MFA on every console.

## Fixed in this branch

| ID | Severity | Fixed |
|---|---|---|
| AUD-03 | Medium | A customer could "cancel" an order that had been paid and refunded, or that had shipped. Units of delivered goods went back on sale and the payment record was rewritten. Cancellation now uses the payment state machine, enforced inside the database write. |
| AUD-04 | Medium | When the rate limiter failed, the admin password, order-lookup tokens, coupon codes and card numbers could be guessed without limit. These six endpoints now fail closed (503). |
| AUD-05 | Medium | A mistyped MFA secret silently turned admin MFA off. It now fails closed. |
| AUD-06 | Medium | Admins could permanently delete paid and refunded orders. Orders that took money are now kept. |
| AUD-07 | Medium | The same refund pressed twice (two tabs, two staff) was paid twice. Now one refund per ledger state, a Stripe idempotency key, and a stale-screen check. |
| AUD-08 | Medium | No CI. Added typecheck, lint, tests, build, a secret scan over all history, a dependency audit, and every migration applied to an empty database with RLS and function-privilege rules checked. Actions are pinned to commit SHAs. |
| AUD-01 (part) | High | Backup workflows now fail loudly instead of reporting a backup that did not happen. |
| AUD-11 to AUD-17 | Low | Staff cancellation releases stock; order size bounded; Stripe error text no longer sent to browsers; extra admin page guards; `noindex` on private pages; duplicate cron removed; one dependency advisory patched. |

Every Medium fix was **reproduced on the unmodified code first**, then shown fixed on the same test suite. That suite is 44 checks against the production build, real Postgres and PostgREST, and a Stripe stand-in: 23 failed before, and all 44 pass after. All existing suites still pass: security, payments, fraud, integration, pricing, 404 handling, Size Finder and referral. See TEST_REPORT.md for the numbers.

## Still open

| ID | Severity | What | Why open |
|---|---|---|---|
| AUD-02 | Critical (legal) | Replica goods: trade-mark and payment-provider exposure | Legal decision |
| AUD-01 | High | No offsite backup exists; no restore tested | Accounts and secrets to set up |
| AUD-09 | Medium | Unpaid orders hold stock indefinitely | Business rule |
| AUD-10 | Medium | Burned credentials in git history; rotation unconfirmed | Production secrets |
| AUD-17 | Low | 11 build-tool advisories, no patched releases | Tailwind 4 / ESLint 9 migrations |
| AUD-18 to AUD-20 | Low / Info | Latent coupon scoping, two old non-re-runnable migrations, unbounded search limit | Backlog |

## Scope and method

**Read:**

- middleware, admin authentication, sessions and TOTP;
- rate limiting, CSRF and client-IP handling;
- every `/api/admin` and customer API route;
- order creation, pricing, cancellation, deletion and refunds;
- Stripe and NOWPayments flows;
- coupons and inventory;
- all 55 migrations;
- CI workflows;
- SEO metadata.

**Run:**

- all 55 migrations on an empty Postgres, with Supabase's default grants emulated;
- role-by-role RLS probes;
- the production build with the end-to-end suites;
- gitleaks over all 211 commits;
- `npm audit`;
- the GitHub Actions run history through the API.

**Not done:**

- no production data was read or written;
- no deployment;
- no real or test-mode Stripe charges or refunds;
- no secret was read, printed or rotated;
- no provider dashboard was accessed;
- no penetration test of the live site beyond the repository's own passive live check.

Design, performance and accessibility were spot-checked, not re-audited. The 2026-10-04 compliance audit and the performance document remain the reference. Core Web Vitals field data was not available.
