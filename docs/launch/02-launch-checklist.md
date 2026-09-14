# 2. Procurement & Setup Checklist

Priority key: **P0** = cannot take money without it · **P1** = cannot advertise
profitably without it · **P2** = do in week 2–4.

Costs are monthly unless marked. CHF, rounded.

---

## 2.1 Software & Infrastructure

Most of this is already built in the repo. The work is configuration, not code.

### P0 — required to accept a single order

| # | Item | Cost | Notes / env var |
|---|---|---|---|
| 1 | **Domain** (`.ch` and/or `.com`) | ~15/yr | Buy both; redirect one. `NEXT_PUBLIC_SITE_URL` |
| 2 | **Hosting — Vercel Hobby** | 0 | Repo already moved the abandoned-cart cron to a GitHub Actions hourly trigger (`f6cb5d4`), so Hobby is viable. Pro (~20/mo) only when you want Vercel Cron back |
| 3 | **Supabase** — free tier | 0 | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Run all 29 migrations in `supabase/migrations/` |
| 4 | **Stripe account** (Swiss entity) | 0 + per-txn | `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`. Enable Apple Pay / Google Pay (already wired, commit `8201c27`) and set `STRIPE_PRESENTMENT_CURRENCIES` for CHF/EUR/USD |
| 5 | **Resend** — free tier (3k emails/mo) | 0 | `RESEND_API_KEY`. **Verify your sending domain** — SPF, DKIM and DMARC records. Unverified = order confirmations land in spam = chargebacks |
| 6 | **Admin credentials** | 0 | `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `CRON_SECRET`. Generate all three with `openssl rand -base64 32` |
| 7 | **Support inbox** | 0 | `SUPPORT_INBOX_EMAIL` — a real, monitored address |
| 8 | **Update FX rates** | 0 | `lib/currency.ts` → `EXCHANGE_RATES` is hand-set (Sept 2026). A stale rate mis-charges every EUR/USD card. Check before launch, then monthly |
| 9 | **Set shipping settings** | 0 | `/admin/settings` → price 25 CHF, free-ship threshold, window 10–14 business days |
| 10 | **Live-mode smoke test** | ~5 (one real order to yourself) | Real card → order confirmation email → admin sees order → mark shipped → tracking email arrives. Do this before ads, in all 5 locales |

**Skip for now:** NOWPayments crypto (`NOWPAYMENTS_*`) — it is built and works,
but crypto checkout on a brand-new store correlates with fraud and adds nothing
to a Swiss/EU launch. Turn it on in month 2 if customers ask.

### P1 — required before spending on ads

| # | Item | Cost | Notes |
|---|---|---|---|
| 11 | **GA4 property** | 0 | `NEXT_PUBLIC_GA_MEASUREMENT_ID`. Consent-gated already (`e7fd3ce`) |
| 12 | **Meta Pixel** | 0 | `NEXT_PUBLIC_FACEBOOK_PIXEL_ID` |
| 13 | **Meta Conversions API (server-side)** | 0 | ⚠️ **Gap.** The repo has browser-pixel only. Since iOS ATT, browser-only tracking under-reports purchases by 20–40%, which makes Meta's optimiser blind and inflates your apparent CAC. Fire a server-side `Purchase` from the Stripe webhook (`app/api/payments/stripe/webhook/route.ts`) with the same `event_id` as the browser pixel so Meta de-duplicates |
| 14 | **Domain verification in Meta Business Manager** | 0 | Required for Aggregated Event Measurement. Prioritise 8 events, `Purchase` first |
| 15 | **Product images that carry the price** | 0–150 | At 109 CHF the photography *is* the product. See § 2.2 |
| 16 | **Legal pages live and accurate** | 0 | `app/legal/` exists — terms, privacy, refunds. Fill in real company details, DDP statement, 14-day withdrawal, Swiss returns address |

### P2 — weeks 2–4

| # | Item | Cost | Notes |
|---|---|---|---|
| 17 | **IOSS intermediary** | ~35 | Eurora / Ship24 / Crossborderit. **Do this before EU ad spend exceeds ~200 CHF** |
| 18 | **EU GDPR representative (Art. 27)** | ~30 | Prighter, DataRep. A Swiss seller targeting EU consumers needs one |
| 19 | **Reviews / UGC widget** | 0–25 | `reviews-store.ts` and an admin reviews manager already exist — use them before paying for Loox/Judge.me |
| 20 | **Resend Pro** | ~20 | When you pass 3,000 emails/month |
| 21 | **Supabase Pro** | ~25 | When free-tier limits or backups become a concern |
| 22 | **Helpdesk** | 0–20 | `support-store.ts` + support widget already ship. Defer Crisp/Gorgias |
| 23 | **Error monitoring (Sentry)** | 0 | Free tier. A silent checkout error is the most expensive bug you can have |

**P0+P1 software total to go live: ~20 CHF** (domain + a test order).
Everything else is free tier. This is the good news.

---

## 2.2 Marketing Setup

### P0

| # | Item | Cost | Notes |
|---|---|---|---|
| 24 | **Meta Business Manager + Ad Account + verified domain** | 0 | Set the ad account currency to **CHF** — it cannot be changed later |
| 25 | **Instagram + TikTok handles** (`@luxevault` variants) | 0 | Claim now even if unused |
| 26 | **Payment method on the ad account, with a spend cap** | 0 | Set an account-level spend cap at your budget. This is your only hard brake |
| 27 | **Creative assets** | 0–150 | Minimum viable set: **3 hero videos** (6–12 s, product in motion, dark background, one clean product-rotation, one worn-on-model, one detail macro of zip/fabric) and **5 static images**. Shoot on the samples you ordered. A phone in a dark room with one hard light source is genuinely enough for this aesthetic |
| 28 | **One offer** | 0 | Not a discount — discounts destroy Dark Luxury. Use **"First Drop — 50 pieces, numbered"** scarcity, or free shipping above 200 CHF (already built into `freeShippingThreshold`) |

### P1

| # | Item | Notes |
|---|---|---|
| 29 | **Campaign structure** | One ABO or Advantage+ campaign · 1 ad set · broad targeting (CH + DE + AT, 18–45) · 3–5 creatives. **Do not stack interests** — at this budget, tight audiences never leave the learning phase |
| 30 | **Catalogue + dynamic retargeting** | Upload the product feed to Meta Commerce Manager. Retargeting is where a 500 CHF budget actually converts |
| 31 | **Abandoned-cart flow** | Already built (`lib/server/emails/abandoned-cart.ts`, hourly GH Actions trigger). **Verify it fires** in the smoke test — it is typically 5–10% of revenue for free |
| 32 | **UTM discipline** | Tag every link. Without it you cannot attribute anything |

### P2

| # | Item | Notes |
|---|---|---|
| 33 | Organic TikTok/Reels — 1–2 posts/day from your sample footage | Free, and at this budget the highest-leverage channel you have |
| 34 | Micro-influencer gifting (CH/DE, 5–30k followers) | Free product for content rights. 3–5 of them ≈ a month of creative |
| 35 | Email capture on-site (pop-up / footer) | Own the list before you need it |

---

## 2.3 Legal & Business Setup (Switzerland)

Not legal advice — this is the operator's checklist. Confirm specifics with a
Swiss fiduciary (*Treuhänder*); a first consultation is often free.

### P0

| # | Item | Cost | Notes |
|---|---|---|---|
| 36 | **Einzelfirma (sole proprietorship)** | 0 | The correct structure at this budget. No minimum capital, no registration needed below **CHF 100,000** turnover. You may trade immediately under your own name + brand. Downside: unlimited personal liability |
| 37 | **Register as self-employed with AHV/AVS** | 0 | Your cantonal compensation office (*Ausgleichskasse*). Do this once income is real |
| 38 | **Business bank account** | 0–10 | Separate from personal, from day one. Wise Business or a neobank is fine to start; a Swiss bank once volume justifies it |
| 39 | **Impressum / legal notice on the site** | 0 | Name, address, email. Required in CH and effectively required for DE/AT traffic |
| 40 | **Terms of sale stating DDP** | 0 | "All duties and import taxes are included in the price shown." If this is not true and enforced, refunds follow |
| 41 | **14-day right of withdrawal, EU customers** | 0 | Swiss law has no statutory cooling-off period; EU law does, and it applies to your EU sales. `app/legal/refunds` and `FULFILMENT.returnWindowDays = 14` already assume this |
| 42 | **Swiss returns address** | 0–25 | Your own address, or a virtual one. A China return address on a premium brand is a conversion killer |

### P1

| # | Item | Cost | Notes |
|---|---|---|---|
| 43 | **revFADP / nLPD compliance** (Swiss data protection) | 0 | Privacy policy naming what you collect and why. `app/legal/privacy` exists — fill it in properly |
| 44 | **Cookie consent** | 0 | ✅ Already built and consent-gates GA4 + Pixel (`e7fd3ce`). Verify it actually blocks before consent |
| 45 | **Trademark search** for "Luxe Vault" | 0 to search | IPI (Swiss institute) + EUIPO TMview. Search **before** you print labels. It is a generic-sounding mark; conflicts are likely |
| 46 | **Trademark filing** (CH class 25) | ~550 one-off | Month 2–3, once the name is validated by sales |

### P2

| # | Item | Notes |
|---|---|---|
| 47 | **VAT (MWST) registration** | Mandatory at **CHF 100,000** worldwide turnover. Voluntary registration earlier lets you reclaim input VAT on imports — ask the fiduciary whether it nets positive for you |
| 48 | **Bookkeeping** | Bexio / Run my Accounts, ~25–50/mo. Or a spreadsheet until ~50 orders/mo — but keep every invoice from day one |
| 49 | **Product liability insurance** | ~200–400/yr. Relevant once you sell your own label at volume |
| 50 | **Convert to GmbH** | CHF 20,000 capital. Do it when profit or liability justifies the shield — not before |

---

## 2.4 The 500 CHF allocation

| Line | Amount | Why |
|---|---|---|
| Product samples (3 units, 2–3 suppliers, express) | **150** | Non-negotiable. You cannot sell Dark Luxury you have never touched |
| Domain + live-mode test order | **25** | |
| Meta ads — test budget | **300** | 20 CHF/day × 15 days, or 30/day × 10 |
| Contingency (first refund / reshipment) | **25** | One goes wrong. It always does |
| **Total** | **500** | |

**What 300 CHF of ads realistically buys.** At a learning-phase CAC of 60–90 CHF
for a new brand at this AOV: **3–5 paid sales**. Not ten. Getting to ten in week
one requires the unpaid channels in `04-seven-day-plan.md` running alongside.
Plan for that from day one rather than discovering it on day six.
