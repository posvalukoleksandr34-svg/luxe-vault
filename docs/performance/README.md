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
| P1 | **The whole catalogue is embedded in every page.** The root layout reads it and passes it to `StoreProvider`, so it is serialised into every page's HTML and every RSC payload. That includes `/legal/terms` and `/checkout`. | **~5 KB per product.** At 150 products every page is 0.9–1.04 MB of HTML (80–96 KB gzipped). Each link prefetched in the viewport downloads another **~70 KB gzipped** copy. It grows linearly: 500 products means ~3 MB of HTML per page. | Phase 2 (structural) |
| P2 | **Product pages were rendered on every request.** `/product/[slug]` had `revalidate` but no `generateStaticParams`, which in Next 13 makes the route fully dynamic (λ). | ~92 ms server render per view, a function invocation each. The `/it/` twin was cached (~15 ms). | **Phase 1: this change** |
| P3 | **Functions probably run far from the database.** Supabase is in AWS **eu-west-1 (Dublin)**: its IPv6 address matches AWS's published ranges. `vercel.json` pinned no region, and Vercel's default for new projects is `iad1` (Washington, D.C.). | If `iad1`: ~70–80 ms per DB round trip. A typical API route makes 3–6 in sequence (rate limit, session, reads, writes), so 250–450 ms. | **Phase 1: this change** |
| P4 | **The client re-downloaded the catalogue on every page load**, seconds after the server had sent it in the HTML. | One `/api/catalog` per load (765 KB of JSON; ~66 KB compressed in production), plus a parse and a re-render of every product component. | **Phase 1: this change** |
| P5 | **All 5 UI languages ship to every visitor.** `lib/i18n.ts` (234 KB of source) is a shared chunk on every page. | **~69 KB gzipped** of JS per page, ~80% of it unused by any one visitor. | Phase 2 |
| P6 | **The full Supabase browser client is on every page**, including realtime, which is unused. | ~71 KB gzipped (auth + realtime + REST chunks) on every page, before interactivity. | Phase 2 |
| P7 | **Signed-in visitors pay an auth round trip on every request.** Middleware calls `auth.getUser()`, which goes to Supabase Auth. Anonymous visitors do not pay it. | +1 network round trip per page, API call and prefetch while signed in. | Phase 2 |
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

## Phase 2: structural (next 2–4 weeks, one PR each, re-measured)

1. **Catalogue out of the root layout (P1, P4).** This is the biggest
   remaining win.
   - Pages that render product lists (home, catalogue, category, wishlist)
     pass their own products to their grids.
   - `StoreProvider` keeps only what is global: cart, wishlist IDs, session
     and shipping.
   - Search suggestions move from client-side matching over the full
     catalogue (`lib/search/match.ts`) to the existing, CDN-cached
     `/api/search`.
   - The cart re-prices through `/api/cart/validate`, which it already calls.
   - **Target:** a non-catalogue page under 100 KB of HTML, and prefetches of
     a few KB instead of ~70 KB.
   - **Watch:** the one layout shift this snapshot was introduced to fix. The
     grid must still render products in the server HTML.
2. **One language of UI strings per visitor (P5).** Split `lib/i18n.ts` into
   per-locale dictionaries, with the active one chosen by the locale segment
   and the others loaded on switch. About −55 KB gzipped of JS on every page.
3. **Supabase client after first paint (P6).** Create the browser client
   through a dynamic `import()` in the store's session effect, and only when
   an `sb-` auth cookie exists; anonymous visitors never download it. About
   −70 KB gzipped for most visitors.
4. **Local session checks (P7).** Switch the Supabase project to asymmetric
   JWT signing keys (Dashboard → Project Settings → JWT Keys), then use
   `auth.getClaims()` in middleware. It verifies the token against cached
   public keys, with no network hop. Installed `@supabase/supabase-js` 2.115
   already has it.
5. **Phone library only with phone fields (P8).** Lazy-load `PhoneInput` and
   `CountrySelect` with `next/dynamic`, and keep `lib/validation.ts` phone
   parsing on the server.
6. **`/stylist` static.** It is dynamic only because it reads
   `searchParams`. Read `?product=` with `useSearchParams` inside a Suspense
   boundary instead.

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
