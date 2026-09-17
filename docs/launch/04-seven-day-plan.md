# 4. The 7-Day Action Plan

**Goal:** sourcing locked, store live, ads running, first 10 sales.

**The honest version of the target.** 300 CHF of cold Meta traffic at a
learning-phase CAC of 60–90 buys **3–5 sales**. The other 5–7 have to come from
channels that cost time instead of money. Every day below therefore has a paid
track and an unpaid track, and the unpaid track is not optional filler — it is
where most of week one's revenue comes from.

Samples will not arrive inside these seven days (express from China is 4–7 days
from *dispatch*, and suppliers take 1–3 days to dispatch). That is fine and
planned for: your 14–20 day delivery window means the first orders do not ship
until after the samples land and you have QC'd them. Do **not** fulfil an order
from a supplier whose sample you have not held.

---

## Day 1 — Sourcing sprint & financial lock

**Morning — money before product.**
- [ ] Decide the launch price. Recommendation: **hero puffer at 149 CHF**, one
      249 CHF anchor, one 79 CHF accessory. (`03-unit-economics.md` § 3.4)
- [ ] Write your target landed cost on a sticky note: **≤ 25 CHF for a 109
      piece, ≤ 34 for a 149 piece** — budgeted against the VAT-exclusive price,
      not the sticker. This is the number you negotiate against all week.
- [ ] Open the [Margin Desk](https://claude.ai/artifact/CNPh5eMby8Kh7PPwkWXC3r), enter your real numbers, and note **target CAC** and
      **break-even CAC**. You will check ad performance against these daily.

**Afternoon — contact 10 suppliers, not 3.**
- [ ] Browse 1688 with the Chinese search terms in `01-sourcing.md` § 1.1.
      Screenshot 5–8 reference products.
- [ ] Message **10 agents**. Expect 4 replies and 2 good ones. Send every one
      of them the same message: reference screenshots, target DDP price,
      destination Switzerland, the five disqualifying questions.
- [ ] In parallel, open a **Faire** and an **Ankorstore** account. Both give new
      retailers opening credit and net-60 terms — this is how you get two
      genuinely premium European pieces onto the site **without spending cash**,
      shippable from your own address in 2–4 days.

**Evening — legal, 30 minutes.**
- [ ] Trademark search "Luxe Vault" on IPI (Swiss) and EUIPO TMview. Do it
      before anything gets printed.
- [ ] Confirm you are trading as an **Einzelfirma** (no registration needed
      below CHF 100k). Open the business bank account application.

---

## Day 2 — Shortlist, samples, infrastructure

**Morning.**
- [ ] Score the replies. Anyone who will not quote DDP to Switzerland, or will
      not send a live warehouse video, is out. You want **2–3 finalists**.
- [ ] **Order samples today.** Same style from 2–3 suppliers, express shipping
      (DHL/FedEx), to your own address. Budget ~150 CHF. This is the single
      highest-return 150 CHF in the entire plan.
- [ ] Ask each finalist, in writing: measured door-to-door time to Zürich on
      their last 20 parcels, which line, and who pays for a defective unit.

**Afternoon — infrastructure (P0 list, `02-launch-checklist.md`).**
- [ ] Domain bought, DNS pointed at Vercel.
- [ ] Supabase project created, all 29 migrations run.
- [ ] Stripe account in **live mode**, currency CHF, Apple/Google Pay on,
      webhook endpoint registered, `STRIPE_WEBHOOK_SECRET` set.
- [ ] Resend domain verified — **SPF, DKIM and DMARC records published**. Skip
      this and every order confirmation lands in spam.
- [ ] `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `CRON_SECRET` generated with
      `openssl rand -base64 32`.
- [ ] `/admin/settings`: shipping 25 CHF, free-shipping threshold 200,
      window 10–14 business days.
- [ ] Check `EXCHANGE_RATES` in `lib/currency.ts` against today's real rates.

---

## Day 3 — Store readiness & tracking

**Morning — the catalogue.**
- [ ] Load 3–6 products. Fewer, better. A 5-piece "First Drop" reads as
      curation; 40 dropship SKUs read as AliExpress.
- [ ] Write the product copy in **EN first**, then run
      `/admin` → translate-catalog for IT, RU, DE, FR. Then *read the German and
      French yourself* — machine translation in a luxury register is the fastest
      way to look cheap.
- [ ] Set per-product `deliveryDays` for anything on a slower line.

**Afternoon — the promises.**
- [ ] Legal pages filled in with real details: Impressum, terms, privacy,
      refunds. Terms must state **"all duties and import taxes included"** (DDP)
      and the **14-day right of withdrawal** for EU customers.
- [ ] Publish a **Swiss returns address**. Never a Chinese one.
- [ ] Verify the cookie banner actually blocks GA4 and the Pixel before consent.

**Evening — tracking, then the smoke test.**
- [ ] Meta Business Manager: ad account in **CHF**, domain verified,
      Aggregated Event Measurement configured with `Purchase` prioritised.
- [ ] GA4 + Pixel IDs into env.
- [ ] ⚠️ **Wire the Meta Conversions API** from the Stripe webhook
      (`app/api/payments/stripe/webhook/route.ts`), sharing `event_id` with the
      browser pixel so Meta de-duplicates. Browser-only tracking under-reports
      purchases by 20–40% and will make your CAC look worse than it is —
      then push you to kill campaigns that were actually working.
- [ ] **Full live-mode smoke test with a real card**, in at least EN and DE:
      checkout → order confirmation email → order visible in admin → mark
      shipped → tracking email arrives. Then trigger and verify the
      abandoned-cart email. Refund yourself afterwards.

---

## Day 4 — Creative

Creative is the only variable that meaningfully moves CAC. Spend the whole day.

- [ ] **3 videos, 6–12 seconds each**, vertical 9:16: (1) product rotating on a
      dark background, hard single light source; (2) worn, walking, motion in
      the fabric; (3) macro detail — zip pull, baffle stitching, woven label.
- [ ] **5 statics**: hero on black, detail crop, scale/fit shot, flat-lay,
      one with text overlay carrying the offer.
- [ ] Shoot on the reference product or supplier footage if samples have not
      landed. A phone, a dark room and one hard light is genuinely enough for
      this aesthetic — softness and clutter are what look cheap, not resolution.
- [ ] **No discount in the creative.** Use scarcity: *"First Drop — 50 pieces."*
- [ ] Cut 10–15 seconds of vertical footage for organic TikTok/Reels while the
      lights are still up. You will post from this all week.

---

## Day 5 — Launch

**Morning — paid track goes live.**
- [ ] One campaign · one ad set · **broad** (CH + DE + AT, 18–45, no interest
      stacking) · 5 creatives · **20 CHF/day**. Objective: Purchase.
- [ ] Set an **account-level spend cap at 300 CHF**. This is your only hard brake.
- [ ] Upload the product feed to Meta Commerce Manager and build one dynamic
      retargeting ad set (site visitors, 7 days) at 5 CHF/day. On a small budget,
      retargeting is where the conversions actually happen.

**All day — unpaid track. This is where week one's revenue comes from.**
- [ ] Post the "First Drop" announcement to every personal channel you have:
      Instagram, TikTok, WhatsApp status, Telegram, LinkedIn.
- [ ] **Direct-message 30–50 people individually.** Not a broadcast — a personal
      message. This converts at 5–15%, which is 2–7 sales from this step alone.
- [ ] Offer the first 10 customers a **"Founding 10"** position: their name (if
      they want) on the site, and first access to drop two. Not a discount —
      status. It fits the brand and it costs nothing.
- [ ] Contact 5 micro-influencers in CH/DE (5–30k followers) offering a free
      piece for content rights.

**Evening.** Verify the first real order end-to-end. Do not touch the campaign.

---

## Day 6 — Read the data, do not panic

- [ ] Check in this order: **CVR first, then AOV, then CAC.**

| What you see | What it means | What to do |
|---|---|---|
| Clicks, no add-to-carts | Creative sells a product the page does not deliver | Fix the product page, not the ads |
| Add-to-carts, no checkouts | Shipping cost or delivery window shock | Surface "duties included" and the window *on the product page* |
| Checkouts, no payments | Payment or trust failure | Re-test checkout; check Stripe logs; add trust signals |
| Nothing at all, <1,000 impressions | Not enough data | **Change nothing.** Wait |

- [ ] **Do not touch the campaign before ~50 CHF spent or 1,000 impressions.**
      Editing resets the learning phase and wastes the budget you already spent.
- [ ] Kill only creatives with >1,000 impressions and zero add-to-carts.
- [ ] Reply to every support message within two hours. At ten customers, service
      *is* the marketing.
- [ ] Keep posting organic — 1–2 pieces per day from Day 4's footage.

---

## Day 7 — Close the loop, build the machine

- [ ] Send the **"First Drop closes tonight"** email and story to everyone who
      visited but did not buy. Scarcity, not discount.
- [ ] Push retargeting to 10 CHF/day for 48 hours — the warmest, cheapest
      conversions you will get all week.
- [ ] **Write the fulfilment SOP** and follow it for every order, from the first:
      1. Order paid → place with agent **within 24 h**
      2. Agent confirms stock + sends QC photo → you approve
      3. Tracking number into admin **within 72 h** (the shipped email carries it)
      4. Day 10 after dispatch: proactive "your order is in transit" check-in
      5. Delivered → day 3: ask for a photo review (`reviews-store.ts` is built)
- [ ] Ask all 10 customers for a photo review. UGC from real customers
      outperforms studio creative and costs nothing.
- [ ] **Run the numbers for real.** Fill the [Margin Desk](https://claude.ai/artifact/CNPh5eMby8Kh7PPwkWXC3r) with actual spend and
      actual orders. Compute genuine CAC and CM%. Compare to target.

### The Day-7 decision

| Actual CAC | Verdict | Next move |
|---|---|---|
| **< 40** | It works | Raise budget 20–30%/day, no more. Reinvest revenue |
| **40–68** | Marginal | Fix price and AOV first (§ 3.4, bundles, the 200 CHF threshold), then creative |
| **> 68** | Losing money per sale | Stop paid. Fix the offer, the price or the product page before spending another franc |

Thresholds are for the 109 CHF launch case at 8.1% VAT. At 149 retail they
become < 55 / 55–102 / > 102 — which is the point of raising the price.

**Whatever the result, you will know three things by Day 7 that you cannot know
today:** whether the product converts, what a customer actually costs, and
whether your supplier can hold the window. That is what the 500 CHF buys. Scale
only comes from a second budget spent against those answers.

---

## Week 2 preview

Samples land → QC against § 1.2 → fulfil the first orders → real product
photography → IOSS registration before EU spend passes 200 CHF → move the best
SKU to bulk once ~50 orders justify a European 3PL.
