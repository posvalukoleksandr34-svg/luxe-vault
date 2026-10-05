# Security hardening — 2026-09-29

Part of the [security roadmap](README.md). This round closes roadmap item **F1**
(Next.js end-of-life) and fixes what a fresh audit of the application found.
Everything below was verified against a production build (`next build` +
`next start`) with scripted checks. The one exception is the live deployment
itself, which the audit environment could not reach (see "Not verified").
A follow-up round on 2026-10-04 (section 12) closed most of what was left
open and added tooling to check the live site and the production database.

## Operator checklist (do these; the code cannot)

| # | What | Where |
|---|---|---|
| 1 | **Apply migrations 0047, 0048 and 0049** (order doesn't matter, safe to re-run). Then run `scripts/security/verify-production.sql` and expect no `PROBLEM` rows. | Supabase → SQL editor |
| 2 | **Rotate `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET`.** Their old fallback values were committed (commit `a3aae8f`, 2026-09-04) and must be treated as public. A value merely *resembling* them must not be reused. Rotating either one invalidates every admin session. | Vercel → Environment Variables (mark Sensitive) |
| 3 | **Confirm `EDGE_ORIGIN_SECRET` is set in Production** and that the Cloudflare Transform Rule adds `x-edge-auth`. Production now logs `[security] EDGE_ORIGIN_SECRET is not set` when it is missing. | Vercel env + Cloudflare |
| 4 | **Add a Vercel Firewall rule for the static and image paths** (see "Direct origin" below). | Vercel → Firewall |
| 5 | Delete any Supabase auth user with the email `language-metadata-check@example.com` if it exists. The probe script used a fixed password, now random per run. | Supabase → Authentication |
| 6 | Set `NEXT_PUBLIC_SUPABASE_URL` for **builds** as well as runtime. The CSP is now pinned to that host at build time. | Vercel env (all environments) |
| 7 | **Turn on the admin's second factor.** On your own computer: `node scripts/admin-totp-setup.mjs`, scan the QR code with an authenticator app, then set `ADMIN_TOTP_SECRET` (Production, Sensitive) and redeploy. Never paste the secret into a chat or ticket. Until it is set, production logs a warning on every admin sign-in. | your computer, then Vercel env |
| 8 | **After each deploy**, run the "Security check (live)" workflow (Actions tab → Run workflow), or `scripts/security/check-live.sh` locally. It also runs every Monday. | GitHub Actions |

## 1. Next.js and dependencies

| | Before | After |
|---|---|---|
| next | 13.5.11 (end of life; 31 advisories, 2 critical) | **15.5.26** (backport line, all advisories fixed) |
| react / react-dom | 18.2.0 | 19.3.0 |
| eslint-config-next | 13.5.11 | 15.5.26 |
| postcss | 8.4.30 (+ next's 8.4.31) | 8.5.28 everywhere (`overrides`) |
| @radix-ui/* | 1.1–1.2 (react-remove-scroll without React 19 support) | latest 1.x |
| `npm audit` | 5 (1 critical, 4 high) | **0** at the time; 9 high since 2026-10 (`braces`, see section 12) |

**Why 15.5.26 and not 16.3.7.** Both are fixed. 16 renames `middleware` to `proxy` and changes more defaults, which is a larger migration than this round needed. 15.5.x is the maintained backport line.

**Code migration:**
- The official codemod made `params`, `searchParams`, `cookies()` and `headers()` asynchronous (47 files).
- `lib/supabase/server.ts` now uses @supabase/ssr's async cookie store instead of the codemod's `UnsafeUnwrappedCookies` shim.
- `experimental.serverActions` was removed, and `serverComponentsExternalPackages` became `serverExternalPackages`.
- `ImageResponse` now comes from `next/og`, and one `useRef` was given the argument React 19 requires.
- Two `<a href="/">` became `Link`.

**Prices vs React 19.** `formatMoney` in `lib/currency.ts` now normalises the de-CH thousands separator. Node writes `1'890` and browsers write `1’890`, and React 19 turned that one-character difference into a hydration failure: the whole page was re-rendered on the client on the catalogue, category and product pages. Measured: #418 gone.

## 2. Direct origin (`*.vercel.app`)

**Mechanism.** Two pieces work together:
- Cloudflare's Transform Rule **sets** `x-edge-auth: <EDGE_ORIGIN_SECRET>` on every request it forwards. "Set" overwrites any value a client sent.
- `middleware.ts` refuses, with a 403 and before any other code runs, every production request whose `x-edge-auth` does not match the secret (constant-time compare).

The check never looks at `Host`. A request that reaches Vercel any other way is therefore refused whatever hostname it names. That covers the `*.vercel.app` address, a custom domain resolved straight to Vercel, and a forged `Host: luxe-vault.store`.

**Verified (production build, secret set):**

| Request | Result |
|---|---|
| no header | 403 |
| wrong secret | 403 |
| `Host: luxe-vault.store` without the secret | 403 |
| forged `CF-Connecting-IP` | 403 |
| `/api/admin/*` without the secret | 403 |
| correct secret | 200 |
| `/api/cron/*` | exempt from the lock (Vercel's scheduler calls the deployment directly), still requires `CRON_SECRET` |

**Remaining gap.** Middleware does not run for `/_next/static/*`, public files and `/_next/image`, so those stay reachable directly. They serve only public content. The optimiser's remote allow-list and the upgrade limit what the image path can do, but it can still be used to spend Vercel bandwidth and optimisation quota outside Cloudflare's rate limits. Close it at the platform with a **Vercel Firewall custom rule**:

> If **Host** ends with `.vercel.app` **and** Path does not start with `/api/cron/` → **Deny**

Scope it to Production. That protects the production `*.vercel.app` alias only; preview URLs are covered by Vercel Deployment Protection.

**Fail-closed since 2026-10-04** (was fail-open). A production deployment without `EDGE_ORIGIN_SECRET` now answers 503 (except `/api/cron/*`); the explicit `EDGE_ORIGIN_LOCK=off` is the only way to run production unlocked. `/_next/image` is behind the lock too. See [the 2026-10-04 audit](security-audit-2026-10-04.md).

## 3. Credentials

**Git history.** All 196 commits across all branches were scanned for:
- Stripe secret, restricted and webhook keys;
- JWTs (Supabase keys);
- Supabase secret keys;
- AWS, GitHub, Google, OpenAI, Anthropic, Slack, Resend and Telegram token formats;
- private keys;
- secret-named variables assigned literals.

No provider key or token was ever committed. Literal credentials that were:

| Variable | Where | Status |
|---|---|---|
| `ADMIN_PASSWORD` (fallback literal) | `lib/server/admin-auth.ts`, commit `a3aae8f` | removed earlier; **rotate** (checklist 2) |
| `ADMIN_SESSION_SECRET` (fallback literal) | same commit | removed earlier; **rotate** |
| the same admin password, and the session secret, in plain text | `scripts/verify-security.mjs` (in the tree until this round) | **removed now**; the script compares SHA-256 digests instead |
| `PROBE_PASSWORD` | `scripts/check-language-metadata.mjs` | **replaced** with a random value per run (checklist 5) |
| demo account password | `lib/store.tsx`, commit `a3aae8f` (old client-side demo login) | removed long ago; never a real credential |

Also checked:
- `.gitignore` excludes `.env*` except `.env.example`, and only `.env.example` files were ever committed. The `jarvis/*` ones are on branch `claude/blissful-mccarthy-lwepmd`, a different project stored in this repository.
- **Client bundle:** built with a marker value in every secret. No marker appears anywhere in `.next/`, client or server, because secrets are read at runtime only.
- **`NEXT_PUBLIC_*`:** all public by nature (Supabase URL and anon key, Stripe publishable key, Turnstile site key, analytics IDs, site URL, support phone).
- **`server-only`:** added to `lib/server/stripe.ts` and `lib/server/nowpayments.ts`, so importing either from a client component fails the build.

## 4. Images (`next.config.js`)

- `formats: ['image/webp']` — AVIF off.
- `images.unsplash.com` restricted to `/photo-*`.
- SVG is never optimised, stated explicitly (`dangerouslyAllowSVG: false`).
- The Supabase pattern stays pinned to the project host and `/storage/v1/object/public/**`.

Verified against the optimiser:

| Source | Result |
|---|---|
| another host | refused |
| another Unsplash path | refused |
| `http:` | refused |
| a different `*.supabase.co` project | refused |
| this project's REST API | refused |
| `169.254.169.254` (cloud metadata) | refused |
| allowed sources | fetched |

Customer uploads (returns, support attachments) never go through the optimiser. They sit in private buckets, are served by signed URL, and their file signatures are checked on upload.

## 5. Admin authentication

The existing model is kept: HMAC-signed, expiring tokens bound to the password, a middleware gate plus a check in every handler, and constant-time comparisons. Added:

- **Server-side sessions and real sign-out** (`lib/server/admin-sessions.ts`, migration 0047). Each login records its token's nonce. `isAdminRequest()` (every admin API handler and admin page) accepts a token only while its row is unrevoked and unexpired. Sign-out revokes it.
  - **Before:** sign-out only deleted the cookie, and a copied token worked for 8 more hours.
  - **Verified:** a replayed cookie after logout gets 401 on the API, and the admin page returns no data.
  - **Until 0047 is applied** the code falls back to the previous behaviour and logs it.
- **Cookie** `__Host-lv_admin_session` in production: HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=8 h. The prefix stops a subdomain or plain-HTTP response planting or overwriting it.
  - SameSite stays Lax so links from Telegram alerts arrive signed in. The CSRF guard refuses cross-site writes regardless.
  - Path must be `/` because the API lives under `/api/admin`.
- **Token shape validated** (length, hex) before any HMAC work.
- **Verified:**
  - all 44 admin handlers answer 401 without a session;
  - a forged cookie gets 401;
  - `x-middleware-subrequest` (CVE-2025-29927) does not bypass;
  - a wrong password gets a generic 401;
  - brute force is limited per IP (8 per 5 minutes, Postgres-backed), plus Cloudflare rule A.

## 6. Authorisation (IDOR/BOLA)

Every non-admin route that takes an ID was traced to its check before the database operation:

| Route | Check |
|---|---|
| `orders/[id]/cancel`, `orders/[id]/refund-request` | `order.userId === session user` |
| `orders/lookup`, `payments/stripe/intent`, `payments/crypto/status`, `payments/crypto/resume` | the order's lookup token, constant-time; the order number alone is never enough |
| `support/tickets/[number]` | owner, or the ticket's access token |
| `account/*` | RLS or `user_id` from the session |
| `notifications` | `user_id` from the session |
| `account/cards` | the customer ID derives from the session, and the card must belong to it |

Fixed: the two token comparisons that used `===`, the ticket access token and the guest-order lookup token, now use `safeEqual` (constant time).

Verified: wrong tokens return nothing or 404 on the lookup, crypto status, Stripe intent and ticket endpoints.

## 7. Price and quantity

The server already repriced from the catalogue. Added in `repriceItems`:
- the size and colour must be ones the product is sold in;
- the line's image and name come from the catalogue, never from the browser.

Verified by what reaches the database:

| Tampered input | Result |
|---|---|
| a price of 0.01 | charged 1890 (the catalogue price) |
| negative or zero quantity | rejected |
| 2.7 | 2 units |
| 10⁹ | 20 (the cap) |
| unknown product, size or colour | rejected |
| `discount` / `total` / `currency` sent by the client | ignored |
| unknown promo code | no discount |
| each line | priced separately from the catalogue |

Orders with a total ≤ 0 are refused.

## 8. Payments

The Stripe webhook already did the essentials:
- verified the signature on the raw body;
- handled an allow-list of event types;
- claimed each event id once (idempotency);
- refused to let a late failure undo a settled payment.

The gap was that `payment_intent.succeeded` marked an order paid without comparing the amount. Via the metadata **adoption** path, any PaymentIntent on the account naming an `orderId` could settle that order. Now `amount_received` and the currency must match the charge recorded for the order, or the event is logged, alerted and **not applied**.

**Verified:**

| Event | Result |
|---|---|
| no signature | 400 |
| forged signature | 400 |
| signed with another secret | 400 |
| 1.00 CHF for a 1890 CHF order | not paid |
| right amount in EUR | not paid |
| foreign intent adopting another order | not paid |
| correct amount and currency | paid |
| NOWPayments IPN with a forged HMAC-SHA512 | 401 |

Refunds are capped by Stripe's remaining balance. The return page is never treated as proof of payment.

## 9. CSRF, CORS, headers, XSS

- **CSRF:** `same-site` requests (another subdomain) must now also carry this host's `Origin`, so a taken-over subdomain cannot write. Verified: cross-site, same-site subdomain and foreign-Origin writes all get 403. Webhooks are exempt and authenticate by signature.
- **CORS:** no route sets `Access-Control-*`, so the API is same-origin only.
- **Headers:**
  - CSP has no `unsafe-eval`, and `frame-ancestors`, `object-src 'none'` and `base-uri 'self'` are set;
  - Supabase is pinned to the project host (it was `*.supabase.co`, which let injected script send data to any Supabase project);
  - HSTS is 2 years with subdomains, X-Frame-Options is DENY, plus nosniff, Referrer-Policy, Permissions-Policy and COOP;
  - `X-Powered-By` is removed.
- **XSS:**
  - every `dangerouslySetInnerHTML` is JSON-LD through `serializeJsonLd` (escapes `<`, `>`, `&`), a constant, or a validated locale;
  - emails and Telegram escape every interpolation;
  - the legal pages use a parser, not raw HTML;
  - React escapes the rest, and React 19 refuses `javascript:` URLs.

## 10. Supabase

RLS is enabled on all 32 tables. Migration **0048** closes direct writes through Supabase's public REST API that went around the application:

- **`orders`: CRITICAL.** A customer could update their own delivered order through the REST API with their own JWT. The policy (0004) constrained rows, not columns, so `total`, `payment_status`, `refunded_amount`, `status`, address and email could all be rewritten in the same request. The policy is dropped; returns go through the API since 0039.
- **`support_tickets`: HIGH.** `insert … to anon with check (true)`. A ticket could be inserted with any `user_id`, and it then appeared in that customer's own history as theirs. Dropped (the API uses the service role).
- **`return_requests`, `site_reviews`: direct inserts** bypassed photo-ownership checks, CAPTCHA and rate limits. Dropped.
- **`notifications`:** column privilege limits customer updates to `is_read`.
- **`profiles.welcome_sent_at`:** now server-only (trigger), so a script cannot re-trigger the welcome email.

Kept, because the browser uses them with tight checks:
- `reviews` insert: pending, and only on a delivered order;
- `saved_looks`: the owner's own rows;
- `addresses`: the owner's own rows; `set_default_address` checks `auth.uid()`.

Public reads are catalogue data, approved reviews and `store_settings` (offer parameters only, no codes).

## 11. Rate limiting

Counted in Postgres (`check_rate_limit`), so it is shared by every serverless instance. It is not process-local.

The client address is `CF-Connecting-IP` only on requests proven to come through Cloudflare. Otherwise it is Vercel's own `X-Forwarded-For`, which a client cannot set on Vercel. Neither can be spoofed with extra headers.

It fails open on a database error by design (documented in `rate-limit.ts`), so Cloudflare's rules are the outer layer.

## 12. Follow-up round — 2026-10-04

Everything here was verified against a production build, behind a local
stand-in for Cloudflare (a proxy that sets `x-edge-auth`), with the origin
lock, a TOTP secret and every webhook secret configured.

### Checking production from outside

- **`scripts/security/check-live.sh [SITE_URL] [ORIGIN_URL]`** checks the live shop with no secrets: security headers, the strict CSP on `/checkout`, that the Vercel origin refuses requests that did not come through Cloudflare (including a forged `Host` and a guessed secret), that admin, webhook, CSRF and order-lookup endpoints refuse forged requests, and the image allow-list. Exit code = number of failures.
  - Verified both ways locally: 0 failures through the proxy; 3 failures when the "origin" is reachable around the lock.
  - **`.github/workflows/security-check.yml`** runs it every Monday and on demand. If Cloudflare's bot rules challenge GitHub's runners, the homepage check fails with 403; allow the runner or run the script from your own machine.
- **`scripts/security/verify-production.sql`** is a read-only report for the Supabase SQL editor. One row per check, `OK` or `PROBLEM` with the fix:
  - RLS on every table in `public`;
  - migrations 0047–0049 applied (0048 checked by its effect, not its name);
  - write policies that apply to anon, `OK` only when scoped to `auth.uid()`;
  - `SECURITY DEFINER` functions anon can call, `OK` only for trigger functions and the three that were read (`search_products`, `can_review` — replaced by `review_eligibility` in 0052 — and `set_default_address`);
  - no policies at all on the server-only tables.
  - Verified: all 49 migrations apply cleanly to Postgres 16 with Supabase's roles and default grants, and the report shows no `PROBLEM`. A policy `using (true)` on orders, RLS switched off on a table, and an unguarded definer function were each planted and reported, then removed.

**RLS, attempted for real** (Postgres 16, roles and JWT claims as PostgREST sets them):

| Attempt | Result |
|---|---|
| customer updates the `total` of their own order | 0 rows changed |
| customer B reads customer A's order | 0 rows |
| anonymous reads orders | 0 rows |
| customer changes a notification's `title` | permission denied (column grant) |
| customer marks their own notification read | allowed, 1 row; another customer's: 0 rows |
| customer inserts a support ticket directly | refused by RLS |
| customer sets their own `welcome_sent_at` | refused by trigger |
| customer reads `admin_sessions` | permission denied |
| anonymous adds to someone's wishlist | refused by RLS |

### Admin

- **A revoked session is refused at the edge.** `middleware.ts` now also asks the database whether the token's session is still live (`lib/server/admin-session-edge.ts`, a 3-second PostgREST call with the service key).
  - **Before:** a replayed cookie after sign-out reached the admin page, which answered 200 with a client-side redirect and no data.
  - **Now:** 307 to `/` before any page code runs, and 401 on the API.
  - If the lookup fails, the session is refused (fail closed); before migration 0047 it falls back to the token check alone.
- **Second factor (TOTP, RFC 6238)** — `lib/server/admin-totp.ts`, migration 0049, checklist 7. With `ADMIN_TOTP_SECRET` set, signing in needs the password and the 6-digit code from an authenticator app.
  - The password is checked first, so a wrong password does not spend a code.
  - One wording for every refusal, so it does not reveal which factor was wrong.
  - A code is accepted once: its time step is recorded in `admin_totp_steps`, and a replay inside its 90-second window is refused.
  - Comparisons are constant-time. The implementation matches the RFC 6238 test vectors.
  - Off until the variable is set, so deploying it locks nobody out.
  - **Verified (14 checks):**
    - password alone → 401;
    - wrong code → 401;
    - wrong password with a valid code → 401;
    - a code 5 steps old → 401;
    - password with a valid code → 200;
    - the same code again → 401;
    - after sign-out, the replayed cookie → 307 on the page, 401 on the API.
- Still one shared identity: per-person accounts remain roadmap Phase 2.

### Strict CSP on payment and admin pages

- `/checkout` and `/admin` now get their own policy from `middleware.ts`: a fresh nonce per response, the SHA-256 hash of the one fixed inline script (`lib/motion-boot.ts`), and **no `'unsafe-inline'` in `script-src`**. The directives live in `config/csp.js`, shared with `next.config.js`, which no longer sends the site-wide policy on these paths (exactly one CSP header).
- Both pages are rendered per request (`dynamic = 'force-dynamic'`). The cart opens checkout with a full page load, because a CSP belongs to a document.
- **Verified:**
  - Next's inline scripts all carry the nonce;
  - an injected `<script>` does not run;
  - the nonce changes per response;
  - no violations, and the page hydrates;
  - cart → "continue as guest" → checkout renders its form;
  - other pages keep the site-wide policy.
- **Not covered:**
  - The storefront's other pages keep `'unsafe-inline'`: they are prerendered, and a nonce would make every page dynamic.
  - "Pay later" in the account panel (`components/account-orders.tsx`) mounts the Stripe form on whatever page is open, so it runs under the site-wide policy.
- Zod 4 probed for `eval` on every page, harmless but a violation report each time; now off (`z.config({ jitless: true })` in `lib/returns/schema.ts`). Pages now load with zero violations.

### Fixed along the way

- **Viewport and theme colour.** Since the Next 15 upgrade, `viewport` and `themeColor` inside `metadata` were ignored, so pages shipped Next's default viewport. Moved to `export const viewport` in `app/layout.tsx`; the zoom policy and `theme-color` are back.
- **Localised 404.** `/it/<missing>`, `/fr/…`, `/de/…` now render the 404 in the URL's language on the server too (`app/[locale]/[...missing]`), with `noindex`.

### `npm audit`: braces (GHSA-vfj7-8cjw-p6xm)

A high-severity advisory published after the upgrade covers every version of `braces`. It is a stack overflow on deeply nested glob patterns, and `braces` reaches the tree through Tailwind and ESLint.

Accepted for now: those run at build time on patterns from our own config, and no visitor input reaches them. `npm audit fix --force` would downgrade `eslint-config-next` to 14 and fixes nothing. Re-check when a patched `braces` is published.

## Not verified here, and what remains

- **The live deployment and the production database.** This environment still cannot reach `luxe-vault.store`, `*.vercel.app` or Supabase. The tools are ready: run `check-live.sh` (or the workflow) and `verify-production.sql` (checklist 1 and 8).
- **`scripts/verify-security.mjs`** needs the real Supabase project (`.env.local`), so it was not run here. Its source-tree check is covered by the digest scan.
- **Every 404 answers HTTP 200, and `redirect()` in a page becomes a client-side redirect.**
  - Cause: the root layout wraps every page in `<Suspense>` (added 2026-09-27 so a page in a not-yet-loaded language can hydrate). Next cannot change the status once streaming has started inside it.
  - What is still correct: 404 pages carry `noindex`, so search engines drop them; admin pages are now refused at the edge with a real 307.
  - The fix is structural: deliver the page's dictionary with the HTML so nothing suspends during hydration, then remove the boundary. A separate task.
- **Admin identity.** TOTP is in; per-person accounts are still roadmap Phase 2.
