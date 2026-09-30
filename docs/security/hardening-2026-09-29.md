# Security hardening — 2026-09-29

Part of the [security roadmap](README.md). This round closes roadmap item **F1**
(Next.js end-of-life) and fixes what a fresh audit of the application found.
Everything below was verified against a production build (`next build` +
`next start`) with scripted checks. The one exception is the live deployment
itself, which the audit environment could not reach (see "Not verified").

## Operator checklist (do these; the code cannot)

| # | What | Where |
|---|---|---|
| 1 | **Apply migrations 0047 and 0048** (order doesn't matter, safe to re-run). | Supabase → SQL editor |
| 2 | **Rotate `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET`.** Their old fallback values were committed (commit `a3aae8f`, 2026-09-04) and must be treated as public. A value merely *resembling* them must not be reused. Rotating either one invalidates every admin session. | Vercel → Environment Variables (mark Sensitive) |
| 3 | **Confirm `EDGE_ORIGIN_SECRET` is set in Production** and that the Cloudflare Transform Rule adds `x-edge-auth`. Production now logs `[security] EDGE_ORIGIN_SECRET is not set` when it is missing. | Vercel env + Cloudflare |
| 4 | **Add a Vercel Firewall rule for the static and image paths** (see "Direct origin" below). | Vercel → Firewall |
| 5 | Delete any Supabase auth user with the email `language-metadata-check@example.com` if it exists. The probe script used a fixed password, now random per run. | Supabase → Authentication |
| 6 | Set `NEXT_PUBLIC_SUPABASE_URL` for **builds** as well as runtime. The CSP is now pinned to that host at build time. | Vercel env (all environments) |

## 1. Next.js and dependencies

| | Before | After |
|---|---|---|
| next | 13.5.11 (end of life; 31 advisories, 2 critical) | **15.5.26** (backport line, all advisories fixed) |
| react / react-dom | 18.2.0 | 19.3.0 |
| eslint-config-next | 13.5.11 | 15.5.26 |
| postcss | 8.4.30 (+ next's 8.4.31) | 8.5.28 everywhere (`overrides`) |
| @radix-ui/* | 1.1–1.2 (react-remove-scroll without React 19 support) | latest 1.x |
| `npm audit` | 5 (1 critical, 4 high) | **0** |

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

**Fail-open by design.** Without `EDGE_ORIGIN_SECRET` the lock is off, so a misconfigured deploy cannot take the shop down. It is now logged loudly in production instead of being silent.

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

## Not verified here, and what remains

- **The live deployment.** The audit environment's network policy blocked `luxe-vault.store` and `*.vercel.app`. Run the `curl` checks in [phase-1-perimeter.md](phase-1-perimeter.md) step 4 after deploying, and confirm `x-powered-by` is gone and the CSP names the project host.
- **Production database state.** Whether 0047/0048 are applied, and whether production policies match the migrations (dashboard edits would not show here). Run `select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public' order by 1;` and compare.
- **`script-src 'unsafe-inline'`.** Next's inline RSC payload needs a per-request nonce. That makes every page dynamic (no static prerender), so it is a performance decision for a separate round.
- **Admin pages with a revoked token.** They return 200 with a client redirect and no data, rather than a 307: Next 15 streams before the page's `redirect()`. The data check is what matters and it holds.
- **Admin identity.** Still one shared password. Per-person accounts with MFA remain roadmap Phase 2; Cloudflare Access in front of `/admin` is the interim step.
- **Unknown language segments** (`/it/<missing>`) still render the 404 page in English on the server and Italian in the browser. This is cosmetic, not security.
