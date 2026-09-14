# 3. Unit Economics

All figures CHF. Assumptions: retail **109**, shipping charged **25**, free
shipping above **200** (`config/shipping.ts`).

**[→ Margin Desk — the live calculator](https://claude.ai/artifact/CNPh5eMby8Kh7PPwkWXC3r)** — change any input (price,
ex-works cost, freight, card fee, refund reserve) and every figure below
recomputes: contribution, target CAC, break-even CAC and ROAS, the scenario
table, and a daily "did today make money" check.

---

## 3.1 Target COGS: what you may pay the supplier

Work backwards from the multiple, not forwards from the supplier's quote.

**The rule: landed cost ≤ 25% of retail. Absolute ceiling 33%.**

"Landed" = product ex-works **+ freight + duties + import VAT prepaid (DDP)**.
Quoting yourself the ex-works price alone is the most common way founders
discover at order 30 that they have no margin.

| At retail 109 CHF | Landed cost | Multiple | Verdict |
|---|---|---|---|
| Target | **≤ 27** | 4.0× | Healthy. Scales |
| Acceptable | 28–36 | 3.0–3.9× | Works, no room for error |
| Ceiling | 36 | 3.0× | Below this you are working for Meta |
| Typical China quote | 38–45 | 2.4–2.9× | ❌ Under-priced product, not overpriced supply |

**What to say to your agent, verbatim:**

> "I need this jacket delivered **DDP to Switzerland** — duties and import VAT
> prepaid, customer pays nothing at the door — for **under USD 30 all-in**.
> Split the quote: ex-works price, freight, duty. My ex-works ceiling is
> **USD 24**. Line used and measured door-to-door time to Zürich, please."

Budget split inside that 27 CHF: **ex-works ≤ 22 CHF (~USD 24)**, **freight +
DDP ≤ 14 CHF**. The 25 CHF you charge for shipping more than covers the freight
— shipping is a margin line, not a cost line, which is exactly why the 25 CHF
fee stays.

---

## 3.2 The single order, fully costed

**Scenario A — one jacket, 109 + 25 shipping.** Landed cost assumed 38 (a
realistic first quote, before you negotiate).

| Line | Amount | Basis |
|---|---:|---|
| Product | 109.00 | |
| Shipping charged | 25.00 | `shippingPrice` |
| **Revenue collected** | **134.00** | |
| Landed COGS (DDP) | −38.00 | product 24 + freight/duty 14 |
| Stripe fee | −4.19 | 2.9% × 134 + 0.30 |
| Refund / chargeback reserve | −8.04 | 6% of revenue |
| Per-order overhead | −2.50 | insert card, mailer, support time |
| **Contribution margin** | **81.27** | **60.6% of revenue** |

Everything else in the business — ads, software, your time — comes out of that
81.27.

**Why a 6% refund reserve and not zero.** A 14–20 day delivery window on a
first-purchase fashion item, sold to EU consumers with a statutory 14-day
withdrawal right, generates returns. 6% is optimistic for apparel; sizing
disputes alone usually exceed it. Reserve it or it will arrive as a surprise.

**Stripe, realistically.** 2.9% + 0.30 is the domestic Swiss card rate. Add
~1.5% for non-Swiss cards and ~1% for currency conversion on EUR/USD
presentment (`STRIPE_PRESENTMENT_CURRENCIES`). A realistic blended rate for a
CH+EU mix is **~4.0% + 0.30 = 5.66 CHF**, which costs you 1.47 CHF of the
margin above. Not fatal — but model 4%, not 2.9%.

---

## 3.3 Target CAC: what you may pay Meta for one sale

| Tier | Max CAC | Net per order | ROAS needed | Meaning |
|---|---:|---:|---:|---|
| **Break-even** | **81.27** | 0.00 | **1.65** | One franc past this and you are paying to work |
| Survival | 55 | 26.27 | 2.44 | Acceptable while testing creative |
| **Target** | **35** | **46.27** | **3.83** | The number to run the business on |
| Scaling band | 40–50 | 31–41 | 2.7–3.4 | Where you will actually live once volume comes |

**So: 35 CHF to acquire a customer, 81 CHF before you lose money.**

Read the break-even number as a tripwire, not a budget. If your 7-day rolling
CAC crosses ~55, the campaign is not "still learning" — pause it, change the
creative, and restart. Creative is the variable that moves CAC; bid settings
are not.

### The lever that matters more than CAC: AOV

**Scenario B — two pieces, 218 CHF, free shipping** (the `freeShippingThreshold`
doing its job):

| Line | Amount |
|---|---:|
| Revenue collected | 218.00 |
| Landed COGS (2 units, one parcel) | −68.00 |
| Stripe (2.9% + 0.30) | −6.62 |
| Refund reserve 6% | −13.08 |
| Overhead | −2.50 |
| **Contribution margin** | **127.80** (58.6%) |
| **Break-even CAC** | **127.80** |
| **Target CAC** (35% net) | **51.50** |

One extra item in the basket raises what you can profitably pay per customer
from **35 to 51 CHF** — a 47% increase in your buying power against every other
advertiser in the auction. Concretely: a bundle, a second colourway, and the
"free shipping over 200" threshold surfaced in the cart are worth more than any
bid optimisation you will ever do.

---

## 3.4 The price problem

At 109 CHF retail and a 38 CHF landed cost, your multiple is **2.87×**. Premium
DTC needs 4×, because ads eat the difference. There are two ways out and you
should do both:

**Fix 1 — negotiate landed cost to 27.** Multiple becomes 4.04×, CM rises to
92.27, target CAC to **45**. Achievable with a real agent and a serious tech pack.

**Fix 2 — raise the price to 139–159.** At **149 + 25**:

| Line | Amount |
|---|---:|
| Revenue collected | 174.00 |
| Landed COGS | −38.00 |
| Stripe (2.9% + 0.30) | −5.35 |
| Refund reserve 6% | −10.44 |
| Overhead | −2.50 |
| **Contribution margin** | **117.71** (67.7%) |
| **Break-even CAC** | **117.71** |
| **Target CAC** | **56.81** |

Same product, same supplier, same ads — and you can now outbid a 109 CHF
competitor by 60% on every impression.

There is also a positioning argument, and it runs the same direction. 109 CHF
is a mid-market price. A customer shopping "Dark Luxury" reads 109 as *fast
fashion pretending*, and 149–179 as *a young brand with a point of view*. The
price **is** part of the product. Lowering it does not make the brand more
accessible; it makes it less believable.

**Recommendation: launch the hero puffer at 149 CHF, anchored by one 249 CHF
piece and supported by a 79 CHF accessory.** Keep 25 CHF shipping and the
200 CHF free-shipping threshold — at 149, a second item crosses it naturally.

---

## 3.5 The daily formula

Three numbers. Track them every morning for the previous day.

```
                 Landed COGS + Payment fees + Refund reserve + Overhead
  CM%   =  1  −  ───────────────────────────────────────────────────────
                                  Revenue collected

  Break-even ROAS  =  1 ÷ CM%

  Net profit  =  (Revenue × CM%)  −  Ad spend  −  (Monthly fixed ÷ 30)
```

**On today's assumptions** (CM% = 60.6%, fixed ≈ 60 CHF/month = 2/day), the
pocket version:

```
  Net today  =  (Orders × 81)  −  Ad spend  −  2
```

If that is negative, you have exactly two moves: **cut spend** or **fix
creative**. Not "wait for the algorithm".

### Break-even ROAS by margin — pin this to the wall

| Your CM% | Break-even ROAS | Target ROAS (35% net) |
|---:|---:|---:|
| 50% | 2.00 | 3.3 |
| 55% | 1.82 | 2.8 |
| **60.6%** ← you | **1.65** | **3.8** |
| 65% | 1.54 | 3.3 |
| 70% | 1.43 | 2.9 |

### Weekly review — five numbers, nothing else

| Metric | Target at launch | Where |
|---|---|---|
| **CAC** (ad spend ÷ orders) | ≤ 35, alarm at 55 | Meta + orders table |
| **AOV** | ≥ 150 | admin orders |
| **CM%** | ≥ 60% | formula above |
| **CVR** (site conversion) | ≥ 1.5%, alarm below 0.8% | GA4 |
| **Refund rate** | ≤ 6% | admin refunds |

Diagnostic order, always: **CVR first, then AOV, then CAC.** A 0.5% conversion
rate cannot be fixed by cheaper traffic, and chasing CAC while the site is
leaking is the most expensive mistake available to you.

---

## 3.6 Cash flow — the thing the margin table hides

You are profitable per order and can still run out of money. Two traps:

1. **Stripe payouts lag.** A new Swiss Stripe account typically pays out on a
   ~7-day rolling delay. You pay the agent for order #1 days before Stripe pays
   you for it. At 20 orders in flight, that is roughly **700–800 CHF of working
   capital** tied up before a single payout lands.
2. **Ads are prepaid, revenue is not.** Meta bills you on a threshold; refunds
   arrive 14–30 days after the sale.

**Practical rule for month one:** never let committed ad spend plus unfunded
COGS exceed cash on hand minus 150 CHF. With a 500 CHF budget this caps you at
roughly **10–12 orders in flight** until the first Stripe payout clears. Plan
the ramp around the payout date, not the ad results.
