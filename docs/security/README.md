# Security roadmap

A phased plan for the 10-tier framework, fitted to what this shop actually
runs, audited on 2026-09-26. The order is **impact ÷ effort**: every Phase 1
item closes a real gap in an afternoon or less. Captcha and basic bot
filtering are already in place and are not repeated here.

| Doc | Covers |
|---|---|
| [../performance/README.md](../performance/README.md) | The performance half: measured audit, speed quick wins, structural plan |
| [phase-1-perimeter.md](phase-1-perimeter.md) | Cloudflare WAF, rate limits, origin lock, admin behind Cloudflare Access |
| [phase-1-backups.md](phase-1-backups.md) | Offsite encrypted backups, weekly restore test, restore runbook |

## The system as it stands

```
Browser ─▶ Cloudflare (proxied) ─▶ Vercel · Next.js 13.5 (App Router, Server Actions)
   │                                   ├─▶ Supabase Postgres / Storage (service role, RLS)
   │                                   ├─▶ Stripe API · NOWPayments API · Resend · Gemini · Telegram
   ├─▶ Supabase Auth (direct: sign-in, sign-up, OTP)
   └─▶ Stripe.js iframe (card data, direct to Stripe)
Stripe / NOWPayments ─▶ signed webhooks ─▶ Vercel
GitHub Actions ─▶ cron endpoints (bearer secret)
```

**Already solid.** Keep these as they are:

- **CSP** with an origin allow-list, plus HSTS (preload), `frame-ancestors 'none'`, nosniff and Permissions-Policy (`next.config.js`).
- **CSRF guard** using Fetch Metadata and Origin (`lib/server/csrf.ts`).
- **Admin session:** expiring HMAC tokens bound to the password; admin checks in both middleware and each handler (`admin-guard.ts`).
- **Rate limiting** on every abuse-prone endpoint, counted in Postgres (`lib/server/rate-limit.ts`, migration 0013).
- **Webhooks:** Stripe and NOWPayments signatures are verified; neither success page counts as proof of payment.
- **Secrets:** constant-time comparisons, no credentials in the tree or in git history (scanned), `server-only` guards on privileged clients.
- **RLS** on customer tables; crash alerting to Telegram.

## Findings, most severe first

| # | Severity | Finding | Where it's fixed |
|---|---|---|---|
| F1 | **Critical** | `next@13.5.11` is end-of-life and `npm audit` matches it to ~30 advisories. They include an **unauthenticated RCE in the Image Optimization API with AVIF** (GHSA-2xp9-vwfh-vxw4; the config enables `image/avif`), several Server Components / Server Actions DoS issues, and an authorization bypass (GHSA-7gfc-8cq8-jh5f). Fixed versions: 15.5.24+ or 16.3.3+. | Phase 1c |
| F2 | High | Rate limits count Cloudflare edge servers, not visitors: behind Cloudflare, Vercel's `X-Forwarded-For` is the edge address. | Phase 1a: **code in this change** |
| F3 | High | The WAF can be bypassed via `luxe-vault-hlb1.vercel.app`. | Phase 1a: **code in this change** |
| F4 | High | No backup outside the Supabase account, and no restore has ever been tested. | Phase 1b: **workflows in this change** |
| F5 | High | The admin console is one shared password: no MFA, no per-person identity, no audit trail of who did what. | Phase 1a (Access), Phase 2 |
| F6 | Medium | CI runs no build, typecheck, dependency or code scanning; third-party actions are referenced by tag, not SHA. | Phase 3 |
| F7 | Medium | Logs are the platform's short-retention runtime logs only. Nothing alerts on login-failure spikes, 429 storms or 5xx bursts. | Phase 3 |
| F8 | Medium | Production appears to run on Vercel **Hobby** (`vercel.json`: daily crons only). Hobby is for non-commercial use under Vercel's terms, and it also rules out log drains and firewall rate limiting. | Phase 1c |
| F9 | Medium | Customer sign-in goes straight to Supabase, so Cloudflare can't see credential stuffing against it. Protection depends on Supabase dashboard settings. | Phase 1a, step 6 |
| F10 | Low | Analytics pixels (GA4, Meta) load on the checkout page that hosts the Stripe iframe (PCI SAQ A script-integrity eligibility), and CSP `script-src` still allows `'unsafe-inline'`. | Phase 2 |
| F11 | Low | `netlify.toml` and `@netlify/plugin-nextjs` suggest a second deployment may exist. If it is live with production secrets, it is an origin nobody is watching. | Phase 1c |

## Phase 1 — Perimeter & backups (this week)

### 1a. Perimeter — [phase-1-perimeter.md](phase-1-perimeter.md)

| Step | Effort | Who |
|---|---|---|
| 1. Cloudflare TLS: Full (strict), TLS ≥ 1.2 | 5 min | owner, dashboard |
| 2. Cloudflare Managed Ruleset + OWASP Core Ruleset (log for a week, then block) | 15 min + review | owner, dashboard |
| 3. Custom rules (probes, methods, webhook skip) + 2 rate-limiting rules | 20 min | owner, dashboard |
| 4. **Origin lock + real client IPs**: Transform Rule + `EDGE_ORIGIN_SECRET` | 15 min | **code done**; dashboard + Vercel env |
| 5. Cloudflare Access (per-person login + MFA) in front of `/admin` | 30 min | owner, Zero Trust dashboard |
| 6. Supabase Attack Protection: CAPTCHA, leaked passwords, SSL enforcement | 15 min | owner, Supabase dashboard |

**Code in this change:** `lib/server/client-ip.ts` (new), `middleware.ts`
(origin lock), and `lib/server/rate-limit.ts`, `app/api/auth/recovery`,
`actions/waitlist.ts` and `actions/abandoned-cart.ts`, which now read the
visitor's address through `clientIp()`. All of it is inert until
`EDGE_ORIGIN_SECRET` is set.

### 1b. Backups — [phase-1-backups.md](phase-1-backups.md)

Nightly encrypted offsite backups of the database, Storage media and code go
to an Object-Locked bucket, and a weekly automated restore test checks them.
**Code in this change:** `scripts/backup/*` and two workflows. Setup takes
about 45 minutes of accounts and secrets.

### 1c. Platform hygiene (parallel, separate PRs)

- **Upgrade Next.js to 15.5.24+** (F1). This is the largest single risk
  reduction available. It is a real migration, not a version bump: React 19,
  async `cookies()`/`headers()`, Server Actions leaving `experimental`. Do it
  on its own branch with a full checkout test. Until it ships, the Cloudflare
  Managed Ruleset (1a step 2) is the interim virtual patch. If it slips more
  than a few weeks, also set `images.formats: ['image/webp']` to take AVIF out
  of the image path.
- **Move to Vercel Pro** (F8). This brings commercial-use terms, log drains
  (needed in Phase 3), hourly crons, firewall rate limiting and a higher
  image-optimisation quota (performance P10).
- **Check Netlify** (F11). If a site deploys this repo there, delete it and
  its environment variables, then remove `netlify.toml` and the plugin.

## Phase 2 — Identity, secrets, payments (next 2–4 weeks)

### Layer 3: authentication and access control (MFA / IAM)

1. **MFA on every console that can change production** (1 hour, the highest
   leverage in this phase): Vercel, Supabase, Cloudflare, GitHub, Stripe,
   Backblaze/AWS, the domain registrar, the Telegram accounts in the ops
   group, and the email inbox that receives password resets for all of them.
   Use hardware keys or passkeys where offered. Most shop breaches start at
   one of these, not in the app.
2. **Replace the shared admin password with per-person admin accounts.** Admins
   become Supabase users with `app_metadata.role = 'admin'`, set only through
   the service role. They are **required to enrol TOTP**: Supabase Auth MFA,
   with the admin gate demanding `aal2`. `middleware.ts` and
   `lib/server/admin-guard.ts` then check the Supabase session's role and
   assurance level instead of the HMAC cookie. That gives MFA, revocation per
   person, and an audit log (`auth.audit_log_entries`) that names who signed
   in. Keep Cloudflare Access (Phase 1a) in front: two independent gates.
   *Why not Auth0 or Keycloak:* the shop already runs Supabase Auth, which
   has MFA built in. A second identity provider is a second thing to secure.
3. Admin writes get an `admin_audit` table: who, what, when, before and after.

### Layer 4: secrets and credentials

The audit found no secrets committed, and the git history is clean. What
remains is operational:

1. **Inventory.** List all ~20 secrets in `.env.example` with owner, where
   each is stored, blast radius and rotation cadence. Rotate yearly, and
   immediately when someone with access leaves: `SUPABASE_SERVICE_ROLE_KEY`,
   `STRIPE_SECRET_KEY`, `ADMIN_*`, `CRON_SECRET`, `INTERNAL_API_SECRET`,
   `EDGE_ORIGIN_SECRET`, and the webhook signing secrets.
2. **Storage.** Vercel environment variables marked **Sensitive** (write-only
   after saving) as the runtime store. A password manager vault (1Password or
   Bitwarden) is the source of truth and the break-glass copy. *Why not
   HashiCorp Vault:* it is a server to run, patch, unseal and back up. For a
   single Vercel app with ~20 static secrets it adds more risk than it
   removes. Revisit if the shop grows to several services or needs dynamic
   database credentials. Doppler or Infisical are the middle ground if a
   dedicated manager becomes worthwhile.
3. **Guardrails.** Turn on GitHub secret scanning and **push protection**;
   add gitleaks to CI (Phase 3). Use Stripe **restricted keys** scoped to
   PaymentIntents, Customers, PaymentMethods and Refunds, instead of the full
   secret key.

### Layer 2: payments and PCI-DSS

**Card data flow, audited:** card number, expiry and CVC are typed into
Stripe's PaymentElement, which is an iframe served by Stripe
(`components/stripe-payment.tsx`). The server creates PaymentIntents from the
stored order total (`app/api/payments/stripe/intent`), and sees only intent
IDs, brand, last 4 digits and expiry (`lib/server/stripe.ts`). Nothing in the
database schema holds card data. Saved cards are Stripe PaymentMethods listed
by customer ID, which is derived from the session and never from the request.
NOWPayments (crypto) is outside PCI scope. **Raw card data never touches the
servers or the database.** That makes the shop eligible for the shortest
questionnaire, **SAQ A**, which Stripe pre-fills: Dashboard → Settings →
Compliance.

What to do to stay eligible:

1. Complete and file SAQ A yearly (Stripe prompts for it).
2. **Protect the payment page's scripts.** SAQ A expects the merchant to make
   sure scripts on the page hosting the iframe cannot be tampered with.
   Concretely:
   - Do not load GA4 or the Meta Pixel on `/checkout`. Fire the conversion
     from `/success` instead (F10).
   - Move the CSP to per-request nonces so `script-src` drops
     `'unsafe-inline'`. This is easier after the Next.js upgrade, which
     supports nonces properly.
   - Keep CSP violation reports (`/api/csp-report`) flowing into the Phase 3
     alerting.
3. Enable **Stripe Radar** rules for card testing: block when the CVC check
   fails, and cap attempts per card fingerprint per hour. Rate-limiting rule A
   and the app's `payment.start` limit cover the shop's side.

## Phase 3 — Detection: code scanning, logging, alerting (month 2)

### Layer 6: SAST, DAST, dependencies

Add `.github/workflows/ci.yml` on every pull request and on `main`:

| Check | Tool | Blocks merge? |
|---|---|---|
| Typecheck, lint, build | `npm run typecheck`, `next lint`, `next build` | yes |
| Vulnerable dependencies | `npm audit --omit=dev --audit-level=high` (after F1, which would otherwise fail every run) + **Dependabot** alerts and security updates | yes (high/critical) |
| Code patterns (SQLi, XSS, SSRF, unsafe redirects) | **Semgrep CE** with `p/nextjs`, `p/typescript`, `p/owasp-top-ten` (free, runs locally in CI); or **CodeQL** if the repo has GitHub Code Security | yes (new findings only) |
| Committed secrets | **gitleaks** | yes |
| Supply chain | Pin every `uses:` to a commit SHA; Dependabot for `github-actions` | — |
| DAST | **OWASP ZAP baseline** (passive) weekly, against the Vercel preview of `main` | report only |

Two DAST rules. **Never run an active ZAP scan against production:** it
submits every form, creating orders, tickets and emails to real addresses.
Active scans belong on a preview deployment wired to a staging Supabase
project. Snyk is a reasonable alternative to Dependabot and Semgrep together.
It adds little over them at this size.

### Layer 7: logging, monitoring, SIEM

1. **Collect.** Vercel log drain (Pro) to Better Stack, Axiom or Grafana Cloud
   (each has a free tier), with 30–90 day retention. Add Cloudflare Security
   Events, and Supabase Auth and API logs (log drains on Team plan; otherwise
   the dashboard's log explorer, which keeps logs for a short time).
2. **Emit structured security events** from the app: one JSON line per
   admin login failure, 429, CSRF refusal, origin-lock refusal, webhook
   signature failure and payment-status write failure, e.g.
   `{"security_event":"admin_login_failed","ip":…}`. These are the hooks the
   alerts below key on.
3. **Alert** to the existing Telegram errors topic:

   | Alert | Threshold (starting point) |
   |---|---|
   | Admin login failures | > 10 in 5 min |
   | Rate-limit 429s | > 200 in 5 min |
   | 5xx responses | > 20 in 5 min, or any on `/api/payments/*` |
   | Webhook signature failures | any |
   | Supabase sign-in failures | > 50 in 10 min |
   | Cloudflare blocks | > 5× the 7-day baseline |
   | Backup / restore-test workflow failed | any (**done in Phase 1b**) |

A full SIEM (Splunk, Sentinel, Elastic Security) is not proportionate at this
size. A log platform with saved searches and alerts covers the same ground.

## Phase 4 — Incident response readiness (month 2, then twice a year)

### Layer 8: incident response plan (outline)

Write this up as `docs/security/incident-response.md` with real names and
phone numbers. Print it; during an incident the wiki may be the thing that is
down.

**Roles.** Incident lead (the owner), a deputy, and the external contacts:
Vercel, Supabase, Cloudflare and Stripe support, the domain registrar, a
lawyer familiar with data-protection law, and the cyber-insurance hotline.

**Severity.** SEV1: customer data exposed, money moving wrongly, or site
down. SEV2: a confirmed intrusion with no data impact yet. SEV3: a suspicious
signal.

**1. Triage (first 30 minutes).** Confirm the signal. Open a timeline doc
and write down everything with timestamps. **Export logs now**: Vercel,
Supabase and Cloudflare retention is short, and evidence expires within hours
to days.

**2. Contain.** The levers, fastest first:

| Situation | Lever |
|---|---|
| Traffic attack / scraping | Cloudflare **Under Attack mode**; a block rule by IP, ASN or country |
| Bad deploy or compromised code | Vercel **Instant Rollback** to the last good deployment |
| Admin console compromised | Rotate `ADMIN_SESSION_SECRET` and `ADMIN_PASSWORD` (kills every admin session at once); revoke the person in Cloudflare Access |
| Service key leaked | Rotate `SUPABASE_SERVICE_ROLE_KEY` (Supabase → API keys), update Vercel, redeploy |
| Customer sessions suspect | Rotate the Supabase JWT secret (signs everyone out) |
| Stripe key leaked | Roll the key in Stripe; check the Stripe log for refunds or payouts you did not make |
| Webhook forged | Roll the webhook signing secret; reconcile orders against the Stripe dashboard |
| GitHub compromised | Revoke tokens, deploy keys and Actions secrets; review recent pushes to `main` |

**3. Eradicate.** Find the root cause before restoring: which credential,
which bug. Patch it and redeploy from a known-good commit.

**4. Recover.** If data was altered or destroyed, restore
([phase-1-backups.md](phase-1-backups.md)) into a new project **with every
secret rotated**. Then verify orders, stock and payouts against Stripe.

**5. Notify.** Personal data breach: under the GDPR, notify the supervisory
authority **within 72 hours** of becoming aware, and the affected customers
without undue delay if the risk to them is high. Swiss customers and CHF
pricing suggest the Swiss nFADP may apply too: notify the FDPIC as soon as
possible. Tell Stripe if card data could be involved. That is unlikely with
Elements, but it is their call. Get a lawyer to confirm which regimes apply
**before** an incident, not during one.

**6. Review.** Write a blameless post-mortem within a week: timeline, root
cause, what detection missed, and the action items that follow.

**Rehearse** with a tabletop exercise twice a year: walk through "the admin
password was phished" and "the Supabase account was taken over" with this
page and a stopwatch.

### Managed SOC: not yet

A 24/7 managed SOC typically costs thousands per month and is built for
fleets of endpoints and servers this shop does not have. The better spend now
is Phase 3 alerting to Telegram, plus **cyber insurance with an incident
response retainer**, which provides the forensic team when needed. Reconsider
a SOC or MDR service when there are dedicated staff laptops to protect, when
revenue makes an hour of downtime expensive, or when a partner or regulator
requires one.

## Tracking

| Phase | Layer | Status |
|---|---|---|
| 1a | Perimeter: code (origin lock, real client IP) | ✅ in this change, **inert until configured** |
| 1a | Perimeter: Cloudflare, Access and Supabase settings | ☐ owner, [runbook](phase-1-perimeter.md) |
| 1b | Backups: code (backup + restore-test workflows) | ✅ in this change, **inert until configured** |
| 1b | Backups: bucket, keys and GitHub environment | ☐ owner, [runbook](phase-1-backups.md) |
| 1c | Next.js upgrade · Vercel Pro · Netlify check | ☐ |
| 2 | MFA on consoles · per-person admin + TOTP · secrets inventory · PCI checkout scripts | ☐ |
| 3 | CI security checks · log drain · alerts | ☐ |
| 4 | Incident response doc · first tabletop | ☐ |
