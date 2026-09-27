# Performance roadmap

A measured audit of the storefront, with a phased plan. The security
counterpart is [docs/security/README.md](../security/README.md); the two
share the phase numbering below.

## How this was measured

This was a production build (`next build && next start`) against a local
Supabase stand-in, run on 2026-09-26/27:

- Postgres with all 44 migrations.
- PostgREST behind `/rest/v1`, with every request counted.
- **150 synthetic products** shaped like real ones after "translate
  catalogue": 5 languages of name and description, 5 images, a size chart,
  specs, and 10 variants each.

Two instruments:

- **Server:** `curl`. DB round trips, TTFB, and HTML size raw and gzipped, on
  the first and the second request.
- **Browser:** Chromium at 390×844 with 4× CPU throttling and a fast-4G
  profile. Requests, transferred KB, calls to `/api/catalog`, long-task time
  over 50 ms (a Total Blocking Time proxy), and LCP. Each figure is the median
  of 3–5 loads.

Absolute milliseconds are from a laptop-class container, not from Vercel.
Compare the ratios, not the numbers. In production, Vercel's CDN compresses
`/api/catalog`; locally it was sent uncompressed, so local transfer totals
overstate that one resource.

## Already in good shape (no work needed)

| Area | Evidence |
|---|---|
| **Image formats & compression** | `next/image` everywhere on the storefront. `formats: ['image/avif','image/webp']`, trimmed `deviceSizes`/`imageSizes`, one-year `minimumCacheTTL`. Originals live in Supabase Storage, not in HTML. |
| **Lazy loading** | `next/image` is lazy by default. Only the first 2 cards (or the grid's `eagerCount`) and the product hero are `priority`. Every grid image has a correct `sizes`. |
| **Fonts** | Self-hosted woff2 split by unicode-range. Only the two latin files are preloaded. |
| **Third-party scripts** | GA4 and the Meta Pixel load only after consent and only once the browser is idle. Stripe.js loads with the payment step only, Turnstile only with the sign-in and reset forms. Nothing else third-party. |
| **Animations** | Transform-only keyframes on composited layers. Phones get fewer, lighter blur layers. `prefers-reduced-motion` freezes everything. The pointer light runs only on fine pointers, through `requestAnimationFrame`. Scroll listeners are passive. The one measured layout shift was fixed earlier. |
| **Minification** | SWC minifies JS and CSS in production. The HTML weight below is **data**, not whitespace, so HTML minification would not move it. |
| **DB indexes & N+1** | Done in `94839eb`: migration 0044 plus the batched returns queue and sweep. |
| **Offline/repeat visits** | The service worker serves `/_next/static`, fonts and icons cache-first. |

## Findings, measured, most impactful first

| # | Finding | Measured | Fixed in |
|---|---|---|---|
| P1 | **The whole catalogue is embedded in every page.** The root layout reads it and passes it to `StoreProvider`, so it is serialised into every page's HTML and every RSC payload. That includes `/legal/terms` and `/checkout`. | **~5 KB per product.** At 150 products every page is 0.9–1.04 MB of HTML (80–96 KB gzipped). Each link prefetched in the viewport downloads another **~70 KB gzipped** copy. It grows linearly: 500 products means ~3 MB of HTML per page. | **Phase 2: done** |
| P2 | **Product pages were rendered on every request.** `/product/[slug]` had `revalidate` but no `generateStaticParams`, which in Next 13 makes the route fully dynamic (λ). | ~92 ms server render per view, a function invocation each. The `/it/` twin was cached (~15 ms). | **Phase 1: this change** |
| P3 | **Functions probably run far from the database.** Supabase is in AWS **eu-west-1 (Dublin)**: its IPv6 address matches AWS's published ranges. `vercel.json` pinned no region, and Vercel's default for new projects is `iad1` (Washington, D.C.). | If `iad1`: ~70–80 ms per DB round trip. A typical API route makes 3–6 in sequence (rate limit, session, reads, writes), so 250–450 ms. | **Phase 1: this change** |
| P4 | **The client re-downloaded the catalogue on every page load**, seconds after the server had sent it in the HTML. | One `/api/catalog` per load (765 KB of JSON; ~66 KB compressed in production), plus a parse and a re-render of every product component. | **Phase 1; gone entirely in Phase 2** |
| P5 | **All 5 UI languages ship to every visitor.** `lib/i18n.ts` (234 KB of source) is a shared chunk on every page. | **~69 KB gzipped** of JS per page, ~80% of it unused by any one visitor. | **Phase 2: done** |
| P6 | **The full Supabase browser client is on every page**, including realtime, which is unused. | ~71 KB gzipped (auth + realtime + REST chunks) on every page, before interactivity. | **Phase 2: done** |
| P7 | **Signed-in visitors pay an auth round trip on every request.** Middleware calls `auth.getUser()`, which goes to Supabase Auth. Anonymous visitors do not pay it. | +1 network round trip per page, API call and prefetch while signed in. | **Phase 2: done** (one per page load; zero with asymmetric JWT keys) |
| P8 | `libphonenumber-js` reaches the home, catalogue and product pages through shared components. | ~27 KB gzipped on pages with no phone field. | Phase 2 |
| P9 | Uploaded originals are kept at up to 5 MB, unresized. The storefront never serves them (the optimiser does) **except** the full-screen zoom, which is deliberately the original. | One multi-MB image per zoom. | Phase 3 |
| P10 | Vercel **Hobby** caps image optimisations per month. Past the cap, new image variants fail. | — | Phase 1c (Vercel Pro; see security F8) |

JavaScript per storefront page, as `next build` reports it: 350 kB "First
Load JS". Of that, 85 kB is the framework every route shares, and **~155 kB
comes from the root layout** (P5, P6 and the store).

## Phase 1: speed quick wins (this change)

### 1. Region: functions next to the database

`vercel.json` → `"regions": ["dub1"]`.

- **Why Dublin:** the database is in eu-west-1 (Dublin), and the customers are
  in Europe. Middleware already runs at the edge nearest each visitor; this
  moves the Node functions (API routes, ISR renders, Server Actions) next to
  Postgres.
- **Check after deploy:** a response's `x-vercel-id` header reads
  `<edge>::dub1::<id>`, e.g. `fra1::dub1::…`. Before, it showed which region
  was in use.
- **Expected:** if the project was on `iad1`, every dynamic request gets
  hundreds of milliseconds faster (P3). If it was already in Europe, this is a
  no-op or a small gain.

### 2. Product pages served from cache

`app/product/[slug]/page.tsx` now exports `generateStaticParams`. The 200
most recently updated products are prerendered at build; the rest render on
first request and are cached for `revalidate = 600`. Admin edits still
appear immediately, because `revalidateStorefront()` revalidates the root
layout.

| `/product/[slug]` | Before | After |
|---|---|---|
| Build output | λ (dynamic) | ● (static/ISR) |
| Repeat request TTFB (local) | ~92 ms | **~11–18 ms** |
| Server render per view | every view | once per product per 10 min |
| LCP (throttled browser) | 1,308 ms | **~800 ms** |

A product created after the deploy was checked too: it still renders on
demand (HTTP 200).

### 3. No second catalogue download

> **Superseded in Phase 2.** The layout no longer carries products at all, so
> there is nothing to download twice, and this mechanism (`initialCatalogAt`)
> was removed with it.

The layout now records when it read the catalogue (`initialCatalogAt`).
`StoreProvider` skips its mount-time `/api/catalog` fetch when that snapshot
is under 60 s old. The same 60 s is the layout's `revalidate` and the edge
cache on `/api/catalog`, so the refetch could only have returned the same
data. Older snapshots, meaning an ISR copy that sat in the cache, still
refetch exactly as before.

| Throttled phone, median of 3–5 | Before | After |
|---|---|---|
| `/` `/api/catalog` calls · long tasks | 1 · 497 ms | **0 · 368–377 ms** |
| `/catalog` `/api/catalog` calls · long tasks | 1 · 668 ms | **0 · 473–553 ms** |

That's 20–30% less main-thread blocking on the busiest pages, plus ~66 KB
compressed per page load in production.

### 4. Perimeter and backups

These are already on this branch: [security Phase 1](../security/README.md).

## Phase 2: structural (done)

Three commits, each measured with the same production build and local
Supabase stand-in (150 products) as Phase 1, and verified with browser test
suites: 37 catalogue checks, 9 session checks and 16 language checks. All
pass.

### 1. Catalogue out of the root layout (P1, P4)

- The root layout reads **collections and categories only**
  (`readTaxonomyLists`). No product goes into the store.
- **Listing pages** (catalogue, department, category, and their `/it/`,
  `/fr/`, `/de/` twins) pass their own products to the grid and sidebar
  through `ListingProvider`. The products are trimmed to what a listing shows,
  in the page's language (`lib/server/catalog-listing.ts`: ~2.1 KB instead of
  ~5 KB per product). The grid and sidebar still render complete in the
  server HTML, so the layout shift the old snapshot fixed does not come back.
- **The product page** chooses its related rail on the server.
- **The cart, checkout, wishlist, recently viewed and saved looks** look up
  only the products they show, through `/api/search?ids=` (CDN-cached, with
  its own rate-limit bucket).
- **The store's `products`** is now the whole catalogue or nothing, loaded
  on demand by the stylist's fallback and the admin console only. A cart line
  is dropped only once the server has **confirmed** its product is gone. A
  pending or failed lookup drops nothing; both cases are tested.
- **Search results** are listings in the visitor's language.

| HTML per page (150 products) | Phase 1 | Phase 2 |
|---|---|---|
| `/` | 924 KB (85 KB gz) | **94 KB (19 KB gz)** |
| `/legal/terms` | 909 KB (89 KB gz) | **80 KB (23 KB gz)** |
| `/checkout` | 886 KB (80 KB gz) | **57 KB (14 KB gz)** |
| `/product/…` | 1,024 KB (92 KB gz) | **208 KB (27 KB gz)** |
| `/category/women` | 999 KB (88 KB gz) | **226 KB (26 KB gz)** |
| `/catalog` (lists every product) | 1,006 KB (90 KB gz) | 541 KB (40 KB gz) |

Link prefetches shrank the same way: they used to carry the whole catalogue.

**Found and fixed along the way (migration 0045):** `search_products` had
been broken since 0017. It stored `row_count` in a boolean, so any search
with 2+ full-text matches raised an error. Its typo pass also called
`pg_trgm` unqualified under an empty `search_path`, so it never ran. Every
common search therefore fell back to an unranked substring match, which the
route deliberately never caches.

### 2. Supabase only when there is a session (P6, P7)

- **Browser:** the client is loaded on first use (`lib/supabase/lazy.ts`):
  - when a session cookie exists;
  - when an auth action runs (sign-in, sign-up, OTP, OAuth, sign-out);
  - when an account form acts.
  
  An anonymous visitor downloads no Supabase code at all (measured).
- **Middleware:** the session is refreshed only for a full page load
  (`Sec-Fetch-Dest: document`) that carries an `sb-*-auth-token` cookie. API
  routes check the user in their own handlers; prefetches and client
  navigations need no refresh. Measured signed in: **1 Auth call for 1 page
  load and 17 prefetches, down from 24.** It uses `getClaims()`, which
  verifies locally once the project uses asymmetric JWT keys (owner action 2
  below).

### 3. One UI language per visitor (P5)

- The UI table moved, verbatim, to `lib/ui-strings.ts`, which only server
  code and the admin console read.
- `scripts/ui-dictionaries.js` resolves it into one dictionary per language
  at every build. All 4,510 values were checked equal to `translate()`.
- English is bundled. Italian, French and German are chunks of their own,
  fetched when a page in that language opens or the visitor switches.
- The first render of a page in an unfetched language waits for its chunk,
  while React keeps the server's HTML (already in that language) on screen.
  Measured: no hydration mismatch.

| First Load JS (`next build`) | Phase 1 | Phase 2 |
|---|---|---|
| `/`, `/catalog`, `/checkout` | 350 kB | **228–230 kB** |
| `/product/[slug]` | 364 kB | **243 kB** |
| `/legal/terms` | 242 kB | **120 kB** |
| `/admin` (reads Russian from the full table) | 286 kB | 232 kB |

### Measured on a 4×-throttled phone (median of 5 loads)

| | Long tasks | LCP | Transferred |
|---|---|---|---|
| `/` | 377 → **147 ms** | 1,404 → **1,148 ms** | 1,138 → **673 KB** |
| `/product/…` | 718 → **375 ms** | 792 → **600 ms** | 1,236 → **712 KB** |
| `/legal/terms` | 212 → **97 ms** | 676 → **440 ms** | 1,049 → **639 KB** |
| `/catalog` | 553 → **403 ms** | 1,760 → **1,636 ms** | 1,657 → **800 KB** |

`/it/catalog` measured 225 ms of long tasks and an LCP of 1,812 ms, against
1,636 ms for `/catalog`. The first Italian page of a visit fetches its
dictionary before it hydrates; that fetch plausibly competes with the page's
other requests. Every page after that has it cached.

### Owner actions this phase needs

1. **Apply migration 0045** (`supabase/migrations/0045_search_products_fix.sql`)
   in production. Until then, search keeps falling back as described above.
2. **Supabase → Project Settings → JWT Keys:** move to asymmetric signing
   keys. The middleware's one check per page load then needs no network.
   Until then it falls back to `getUser()`, as before, now once per page load
   instead of per request.

### Still open

- **P8, the phone library.** Lazy-load `PhoneInput` and `CountrySelect` with
  `next/dynamic` (~27 kB gzipped on pages with no phone field).
- **`/stylist` static.** It is dynamic only because it reads `searchParams`;
  read `?product=` with `useSearchParams` inside a Suspense boundary instead.
- **`/catalog` pagination.** It is the one page that carries every product
  (as listings). Past a few hundred products, paginate it on the server and
  move its filters into the query.

**Redis/Memcached: not recommended.** Hot reads are already cached at three
layers: Next's data cache, ISR pages, and the Vercel CDN. Once functions are
co-located with Postgres (Phase 1.1), a Redis hop costs about what the query
it replaces does. Revisit only if the Postgres-backed rate limiter shows up
in profiles; Upstash Redis in eu-west-1 is the drop-in there.

**Cloudflare caching:** leave HTML to Vercel. ISR already caches it at
Vercel's edge, and a "Cache Everything" rule at Cloudflare would cache
responses that set auth cookies. Cloudflare's default static-asset caching
is fine.

## Phase 3: polish and guard rails (month 2)

- **Budgets in CI** (alongside security Phase 3). Fail a PR that grows any
  storefront route's First Load JS by more than 10 KB, or the home page's
  HTML past a set size. Parse `next build`'s route table or use
  `@next/bundle-analyzer` JSON.
- **Real-user metrics.** Vercel Speed Insights, or `web-vitals` posting to
  `/api/monitoring`. Alert when p75 LCP > 2.5 s, INP > 200 ms or CLS > 0.1.
  Lab numbers like the ones above do not replace field data.
- **Resize on upload (P9).** Downscale to ≤ 2560 px and re-encode as WebP in
  the admin before upload. Smaller zoom images and faster optimiser misses.
- **Low-end device check.** Profile the ambient background (`blur` +
  `mix-blend-mode: screen` on full-viewport layers is the most expensive paint
  on the site) on a mid-range Android. If INP suffers, turn the waves off
  when `navigator.hardwareConcurrency <= 4`.
- **Next.js 15 upgrade** (security Phase 1c) also brings smaller client
  runtime and better cache controls.
