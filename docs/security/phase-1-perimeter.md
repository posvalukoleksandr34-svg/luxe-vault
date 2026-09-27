# Phase 1a — Perimeter: Cloudflare WAF, rate limiting, origin lock

Part of the [security roadmap](README.md). Do the steps in order: each one is
safe on its own, and the order matters for the origin lock (step 4).

## Where traffic goes today

```
                       ┌──────────────── Cloudflare (already proxying luxe-vault.store) ──┐
 customer ── HTTPS ──▶ │ DDoS · WAF · rate limiting · Transform Rule adds x-edge-auth    │ ──▶ Vercel (Next.js)
                       └──────────────────────────────────────────────────────────────────┘        │
 attacker ── HTTPS ──────────────────── luxe-vault-hlb1.vercel.app ─────────────────────────────▶ │  ◀── origin lock
                                                                                                    ▼  refuses this
 customer ── sign-in / sign-up ─────────▶ Supabase Auth  (never passes Cloudflare — see step 6)   Supabase
 customer ── card number ───────────────▶ Stripe (iframe)  (never passes Cloudflare or Vercel)
```

`luxe-vault.store` and `www.luxe-vault.store` resolve to Cloudflare addresses
(`2606:4700::/32`), so the zone is already proxied ("orange cloud"). Three
things follow from that. Two were bugs, and this change fixes both:

1. **Rate limits were counting Cloudflare servers, not visitors.** Vercel
   overwrites `X-Forwarded-For` with the address that connected to it, which
   behind Cloudflare is a Cloudflare edge server. Every limit in
   `lib/server/rate-limit.ts` was therefore shared by strangers who happened
   to use the same edge. A script also got a fresh budget whenever its traffic
   landed on a different edge. You can confirm this on production:
   `select subject, count(*) from rate_limits group by 1 order by 2 desc limit 20;`
   If the subjects are addresses in `104.16.0.0/13`, `172.64.0.0/13`,
   `162.158.0.0/15` or `2a06:98c0::/29`, they are Cloudflare's.
2. **The WAF can be bypassed entirely.** The same deployment answers on
   `*.vercel.app`, where no Cloudflare rule applies.
3. **Cloudflare cannot protect customer sign-in.** The browser talks to
   Supabase Auth directly, so credential-stuffing defence for customers lives
   in Supabase's settings (step 6), not here.

## Which WAF, and why

| Option | Verdict |
|---|---|
| **Cloudflare (Pro plan)** | **Recommended.** It already fronts the domain, Turnstile is already Cloudflare, and Pro adds the Cloudflare Managed Ruleset and the OWASP Core Ruleset. It costs a flat monthly fee (check current pricing). DDoS mitigation is included on every plan. |
| Vercel Firewall | A useful complement, not a replacement. It is always on for DDoS, and custom rules and rate limiting come on paid plans. It sees traffic after Cloudflare, so leave its defaults on. |
| AWS WAF + Shield | Not a fit. The app is not on AWS, so it would mean putting CloudFront in front of Cloudflare in front of Vercel: a third proxy layer for no added coverage. Shield Advanced's value (DDoS cost protection, a response team) matters at a scale this shop is not at. |

> Plan features and rule quotas change. Before buying, check that the plan you
> pick includes the **OWASP Core Ruleset** and at least **two rate-limiting
> rules**. The rules below are written to fit in two.

## Step 1 — TLS settings (5 minutes, zero risk)

Cloudflare dashboard → the zone → **SSL/TLS**:

- **Encryption mode: Full (strict).** Anything weaker lets Cloudflare talk to
  Vercel without verifying its certificate, or in plaintext ("Flexible").
- **Edge Certificates → Always Use HTTPS: on.** Minimum TLS version: **1.2**.
- Leave HSTS off here. The app already sends it (`next.config.js`), and two
  sources disagreeing is how a site gets locked out.

## Step 2 — Managed rules (15 minutes, then a week of watching)

**Security → WAF → Managed rules**:

1. Deploy the **Cloudflare Managed Ruleset** with default actions. It carries
   virtual patches for framework CVEs, including the Next.js middleware bypass
   (CVE-2025-29927). That matters while this app is still on Next 13.5 (see the
   roadmap, Phase 1b).
2. Deploy the **Cloudflare OWASP Core Ruleset**: paranoia level **PL1** and
   score threshold **Medium**. Set its action to **Log** for the first 7 days.
3. Add an **exception** (Skip → all managed rules) for:
   ```
   (http.request.uri.path in {"/api/payments/stripe/webhook" "/api/payments/crypto/webhook"})
   ```
   Payment providers cannot solve a challenge, and a blocked webhook means an
   order that never turns "paid". Both endpoints verify a provider signature
   themselves.
4. After a week, review **Security → Events**, filtered to the OWASP ruleset.
   Expect false positives on admin requests that carry HTML or long text:
   product descriptions, newsletters, support replies. Add a narrow exception
   per rule ID for `starts_with(http.request.uri.path, "/api/admin/")`. Once
   Cloudflare Access protects the admin (step 5), that path is behind
   authentication anyway. Then switch the ruleset's action to **Block**.

## Step 3 — Custom rules and rate limiting (20 minutes)

**Security → WAF → Custom rules**, in this order:

| # | Name | Expression | Action |
|---|---|---|---|
| 1 | Webhooks skip | `(http.request.uri.path in {"/api/payments/stripe/webhook" "/api/payments/crypto/webhook"})` | Skip: all remaining custom rules, rate limiting, Super Bot Fight Mode |
| 2 | Probe paths | `(http.request.uri.path contains "/.env") or (http.request.uri.path contains "/.git") or (http.request.uri.path contains "wp-") or (http.request.uri.path contains "xmlrpc") or (http.request.uri.path contains "phpmyadmin") or (ends_with(http.request.uri.path, ".php"))` | Block |
| 3 | Odd methods | `not (http.request.method in {"GET" "HEAD" "POST" "PUT" "PATCH" "DELETE" "OPTIONS"})` | Block |
| 4 | Admin from unusual places *(optional; skip if you do step 5)* | `(starts_with(http.request.uri.path, "/admin") or starts_with(http.request.uri.path, "/api/admin")) and not (ip.src.country in {"CH" "UA"})` (replace with the countries your staff actually work from) | Managed Challenge |

**Security → WAF → Rate limiting rules** (counted per IP by Cloudflare, before
the request reaches Vercel):

| # | Name | Expression | Rate | Action |
|---|---|---|---|---|
| A | Credential & oracle endpoints | `(http.request.method eq "POST" and http.request.uri.path in {"/api/admin/login" "/api/auth/recovery" "/api/orders/lookup" "/api/coupons/validate"})` | 10 requests / 1 minute | Block for 10 minutes (or the longest your plan allows) |
| B | API flood | `(starts_with(http.request.uri.path, "/api/") and not http.request.uri.path in {"/api/payments/stripe/webhook" "/api/payments/crypto/webhook"})` | 300 requests / 1 minute | Block for 1 minute |

These are deliberately coarser than the app's own limits in
`lib/server/rate-limit.ts`. Cloudflare's job is to stop floods and scrapers
before they cost a function invocation and a database round trip. The app's
limiter stays the precise inner layer: per endpoint, and per user for
signed-in writes. Keep both.

**Bots:** do not turn on the free "Bot Fight Mode". It cannot be skipped per
path, and it will challenge Stripe's webhooks. On Pro, **Super Bot Fight Mode**
can be skipped (rule 1 above). Set "Definitely automated" to Block and
"Verified bots" to Allow, so search engines still index the catalogue.

## Step 4 — Origin lock (the code in this change)

Rules 1–B only apply to requests that pass through Cloudflare. This step makes
passing through Cloudflare mandatory, and lets the app see the real visitor
address.

What the code does (`lib/server/client-ip.ts`, `middleware.ts`):

- With `EDGE_ORIGIN_SECRET` set, in production, any request without a matching
  `x-edge-auth` header gets a **403** before any other code runs.
  `/api/cron/*` is exempt: Vercel's scheduler calls the deployment directly,
  and those routes already require `CRON_SECRET`.
- On a request that carries the secret, rate limits count `CF-Connecting-IP`,
  the real visitor. Without the secret, that header is never believed, because
  anyone can send it to `*.vercel.app`.
- With the variable unset, behaviour is exactly as before.

**Roll it out in this order.** In the other order the live site refuses all
traffic until the rule exists.

0. **Pre-flight.** Once the lock is on, anything that still points at
   `*.vercel.app` gets a 403. Make sure each of these uses
   `https://www.luxe-vault.store`:
   - Vercel `NEXT_PUBLIC_SITE_URL`. It builds the links in sign-up and
     password-reset emails, and `.env.example` still shows the `vercel.app`
     address.
   - Supabase → Authentication → URL Configuration: Site URL and Redirect
     URLs.
   - The Stripe webhook endpoint URL, and `NOWPAYMENTS_IPN_CALLBACK_URL` if
     set.
   - The GitHub variable `SITE_URL`, used by the cron and alert workflows.
1. Generate the secret: `openssl rand -hex 32`. Store it in the password
   manager.
2. Cloudflare → **Rules → Transform Rules → Modify Request Header** → Create:
   - When: **All incoming requests**
   - Then: **Set static** · header `x-edge-auth` · value = the secret
   - "Set" overwrites anything a client sent, so the header cannot be forged
     through Cloudflare.
3. Vercel → Settings → Environment Variables → `EDGE_ORIGIN_SECRET` = the
   secret, scoped to **Production only**. Mark it Sensitive. Preview
   deployments are not behind Cloudflare and would answer 403 to everything.
4. Redeploy production.
5. Verify:
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://www.luxe-vault.store/            # 200
   curl -s -o /dev/null -w '%{http_code}\n' https://luxe-vault-hlb1.vercel.app/      # 403
   curl -s -o /dev/null -w '%{http_code}\n' -H 'x-edge-auth: guess' \
        https://luxe-vault-hlb1.vercel.app/                                           # 403
   ```
   Then send a test event from Stripe (Developers → Webhooks → your endpoint
   → Send test event) and confirm a 2xx. Trigger the "Abandoned-cart
   reminders" workflow by hand and confirm it succeeds.
6. A day later, re-run the `rate_limits` query above. Subjects should now be
   varied visitor addresses, not Cloudflare ranges.

**Rollback:** delete `EDGE_ORIGIN_SECRET` in Vercel and redeploy, or use
Vercel's Instant Rollback. The Transform Rule is harmless without it.

**Known gap:** the middleware does not run for static files or `/_next/image`,
so those remain reachable directly on `*.vercel.app`. They serve only public
content. The real fix for the image optimizer's advisories is the Next.js
upgrade (roadmap, Phase 1b).

## Step 5 — Cloudflare Access in front of the admin console (30 minutes)

Today `/admin` is protected by one shared password. Cloudflare Zero Trust
(free for up to 50 users) can add a per-person login with MFA in front of it,
with no code change. That covers roadmap Layer 3 for the admin console while
the proper fix (Phase 2) is built.

1. Zero Trust dashboard → **Access → Applications → Add → Self-hosted**.
2. Application domains: add `luxe-vault.store/admin`,
   `luxe-vault.store/api/admin`, `www.luxe-vault.store/admin` and
   `www.luxe-vault.store/api/admin`. Paths cover everything beneath them.
3. Session duration: **8 hours**, matching the app's admin session.
4. Policy **Allow** → Include → **Emails**: each staff member's address.
   Identity: add Google or Microsoft as a login method and require their
   accounts to have 2-step verification. Alternatively use Access's one-time
   PIN, which is weaker because it only proves control of the inbox.
5. Test in a private window: `/admin` should show the Cloudflare login first,
   then the existing password page.

Everyone still needs the admin password after Access, so this is additive: two
independent factors, and a record of who signed in.

## Step 6 — Supabase Auth (customer sign-in) settings (15 minutes)

Customer sign-in goes browser → Supabase directly, so Cloudflare never sees a
credential-stuffing attack against it. In the Supabase dashboard:

- **Authentication → Attack Protection → CAPTCHA**: Turnstile, with the same
  secret as `CLOUDFLARE_TURNSTILE_SECRET_KEY`. `.env.example` explains why:
  without this, the widget on the sign-in form is decoration.
- **Attack Protection → Prevent use of leaked passwords**: on (paid plans).
  Minimum password length ≥ 8, matching `lib/auth-config.ts`.
- **Authentication → Rate Limits**: review sign-in, sign-up and OTP limits.
  Defaults are per IP, and far above what one person needs.
- **Database → Settings → SSL Configuration → Enforce SSL**: on.

## Done when

- [ ] SSL mode Full (strict), Always Use HTTPS, TLS ≥ 1.2
- [ ] Managed Ruleset deployed; OWASP ruleset deployed (Log → Block after review)
- [ ] Webhook exception in place; a Stripe test event returns 2xx
- [ ] Custom rules 1–3 and rate-limiting rules A–B live
- [ ] Transform Rule + `EDGE_ORIGIN_SECRET` live; `*.vercel.app` answers 403
- [ ] `rate_limits.subject` shows visitor addresses, not Cloudflare's
- [ ] Cloudflare Access protects `/admin` and `/api/admin`
- [ ] Supabase CAPTCHA, leaked-password check and SSL enforcement on
