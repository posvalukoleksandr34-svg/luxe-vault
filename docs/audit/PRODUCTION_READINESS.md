# Production readiness — 2026-10-12

| Status | Meaning |
|---|---|
| **VERIFIED** | Checked today, with the evidence named. |
| **FAILED** | Checked today and not met. |
| **NOT VERIFIED** | Could not be checked from here: a dashboard, production secret or live data this audit has no access to, or code that has not run yet. |
| **NOT APPLICABLE** | Does not apply to this shop. |

"Locally" means:

- the production build (`next build` + `next start`), behind the edge proxy;
- real Postgres 16 with PostgREST 12.2.3 and all 55 migrations;
- a Stripe stand-in.

"Live" means `https://www.luxe-vault.store` as checked by the repository's own "Security check (live)" workflow on GitHub.

## Security

| Item | Status | Evidence / what is missing |
|---|---|---|
| No secrets in the code or history beyond known, burned ones | VERIFIED | gitleaks 8.28.0: 211 commits and the working tree. The only findings are the 4 known burned-credential lines (AUD-10). |
| Burned admin credentials not in use in production | NOT VERIFIED | Owner: confirm or rotate `ADMIN_PASSWORD` / `ADMIN_SESSION_SECRET` (AUD-10). |
| Admin console: every API handler and page checks the session | VERIFIED | 46/46 handlers call `requireAdmin()`; all admin pages call `isAdminRequest()` (AUD-14). |
| Admin MFA enforced | NOT VERIFIED | Code verified: an invalid secret now fails closed (AUD-05). Whether production has a valid `ADMIN_TOTP_SECRET`: owner. |
| Admin behind Cloudflare Access | NOT VERIFIED | Dashboard. |
| CSRF guard | VERIFIED | Locally (security suite 47/47); live (cross-site POST → 403). |
| Origin lock (no Cloudflare bypass) | VERIFIED | Live, 2026-10-12 15:36 UTC: direct, forged-Host and guessed-secret requests refused. |
| Security headers / CSP | VERIFIED | Live: CSP without `unsafe-eval`, `frame-ancestors 'none'`, `object-src 'none'`, 2-year HSTS. `'unsafe-inline'` remains in `script-src` outside checkout and admin (known, prerendered pages). |
| Rate limits fail closed on auth/payment | VERIFIED | Locally (AUD-04). |
| Rate limits count real client IPs | VERIFIED | Code path verified earlier (`client-ip.ts`); live origin lock is on, so the edge header is trusted. |
| Customer data isolation (IDOR) | VERIFIED | Code review of every customer route, plus end-to-end checks (another customer's order → 404). |
| XSS sinks | VERIFIED | Every `dangerouslySetInnerHTML` is JSON-LD through `serializeJsonLd` or a fixed script. |
| Dependency vulnerabilities | FAILED (low) | 11 build-time advisories (3 moderate, 8 high, 0 critical); none in the runtime bundle; no patched releases (AUD-17). |
| Supabase Auth protections (CAPTCHA, leaked passwords) | NOT VERIFIED | Dashboard. |
| MFA on all provider consoles | NOT VERIFIED | Owner. |

## Database

| Item | Status | Evidence |
|---|---|---|
| All migrations apply to an empty database, in order | VERIFIED | 55/55 locally (PG16). CI will repeat on PG17 (NOT VERIFIED until it runs). |
| Migrations re-runnable | VERIFIED (0027–0055) | 0005 and 0026 are not re-runnable on the full set (AUD-19). |
| RLS on every table | VERIFIED | 35/35 public tables. |
| SECURITY DEFINER functions safe | VERIFIED | 28/28 pin `search_path`; the 3 the browser may call scope to public data or `auth.uid()`; the rest are revoked from `anon` and `authenticated`. |
| Protected columns / cross-user writes refused | VERIFIED | Role probes (TEST_REPORT §3). |
| Production has all 55 migrations applied | NOT VERIFIED | Run `scripts/security/verify-production.sql` in the SQL editor. 0054 and 0055 were confirmed by the owner on 2026-10-11. |
| No migration in this change | NOT APPLICABLE | Nothing to apply before deploying. |

## Payments

| Item | Status | Evidence |
|---|---|---|
| Server-side pricing, integer minor units | VERIFIED | `repriceItems`, `toMinorUnits`; price suite 17/17. |
| Webhook: signature on raw body, dedup, amount/currency check | VERIFIED | Payments suite 33/33 (forged, stale, replayed, mismatched). |
| Payment state machine (no un-pay, no refund before pay) | VERIFIED | Unit tests; payments suite; cancel and delete now inside it (AUD-03, AUD-06). |
| Refunds never exceed the remainder; never paid twice | VERIFIED | Locally (AUD-07). Not against Stripe test mode. |
| Stripe account in the intended mode (live/test) | NOT VERIFIED | Dashboard. No real money was moved by this audit. |
| Webhook endpoint subscribed to all 7 handled events | NOT VERIFIED | Dashboard (`docs/security/fraud-and-review-moderation-2026-10-06.md`). |
| Radar rules | NOT VERIFIED | Dashboard. |
| Card scheme / PCI SAQ A | NOT VERIFIED | Card data stays in Stripe's iframe (code); the questionnaire is the owner's. |
| Reconciliation with Stripe | NOT VERIFIED | No automated job compares orders with Stripe's balance; the webhook's "matched no order" alerts are the only signal. Recommended: a weekly reconciliation report. |
| Payment provider accepts the catalogue | NOT VERIFIED | AUD-02: legal and Stripe confirmation needed. |

## Orders and inventory

| Item | Status | Evidence |
|---|---|---|
| Oversell guard (atomic stock) | VERIFIED | `place_order` row lock (earlier suites); integration suite 24/24. |
| Cancel/delete keep money records and stock true | VERIFIED | AUD-03, AUD-06, AUD-11 (end to end). |
| Coupon redemption under concurrency | VERIFIED | `redeem_coupon` re-checks under the row lock (code); coupon scoping is latent (AUD-18). |
| Unpaid orders release their stock | FAILED | No expiry (AUD-09). Owner decision. |

## Operations

| Item | Status | Evidence |
|---|---|---|
| Offsite backups | FAILED | Never ran: every run skipped the backup (AUD-01). |
| Restore tested | FAILED | Never ran (AUD-01). |
| Supabase's own backups | NOT VERIFIED | Plan and retention: dashboard. |
| CI on every change | NOT VERIFIED | Workflow written and checked locally (AUD-08); first GitHub run and branch protection pending. |
| Actions pinned to SHAs, least privilege | VERIFIED | All `uses:` pinned; `permissions` set on every workflow. |
| Crash and security alerting | VERIFIED (partial) | Telegram alerts in code; no log drain or 5xx-rate alerting (`docs/security/README.md` F7). |
| Rollback | NOT VERIFIED | Vercel Instant Rollback exists on the platform; not exercised. |
| Vercel plan suitable for commercial use | NOT VERIFIED | `vercel.json` daily cron only, consistent with Hobby (F8). |
| Stray Netlify deployment | NOT VERIFIED | `netlify.toml` still in the repo (F11). |

## SEO and accessibility

| Item | Status | Evidence |
|---|---|---|
| Missing pages answer 404 | VERIFIED | Status matrix (browser and Googlebot), 404 suite 29/29. |
| Canonical, hreflang, structured data | VERIFIED | Product page: canonical, 5 hreflang alternates, Product/Offer/BreadcrumbList. |
| Private pages `noindex` | VERIFIED | `/order/*` and `/admin/login` fixed (AUD-15). |
| WCAG 2.2 AA | NOT VERIFIED (today) | axe checks run inside the Size Finder suite (106/106); a full-site audit was done on 2026-10-04 (`docs/compliance`), not repeated. |
| Core Web Vitals (LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1) | NOT VERIFIED | No field data available here; lab measurements in `docs/performance/README.md` predate recent features. |

## Legal and commercial

| Item | Status | Evidence |
|---|---|---|
| Replica goods: trade-mark exposure reviewed by counsel | NOT VERIFIED | AUD-02. |
| Imprint complete | NOT VERIFIED | The admin dashboard warns while `config/business.ts` fields are missing; values are environment variables. |
| Privacy policy matches processing | NOT VERIFIED (today) | Audited 2026-10-04; cookie list updated for the Size Finder keys. |

## Before merging this branch

1. **TOTP:** confirm the live admin sign-in asks for a 6-digit code, or that `ADMIN_TOTP_SECRET` is unset (AUD-05). Otherwise this deploy blocks admin sign-in until it is fixed.
2. **Expect red runs:** "Offsite backup" and "Backup restore test" will fail until backups are configured. That is intended (AUD-01).
3. **Staff:** paid orders can no longer be deleted; refunds on a stale screen ask for a refresh.
4. After merge, open the Actions tab and confirm the new CI workflow passes on `main`. Then make its jobs required.
