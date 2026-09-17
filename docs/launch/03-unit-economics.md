# 3. Unit Economics

All figures CHF. Assumptions: retail **109** (VAT-inclusive, as Swiss and EU
consumer prices must be), shipping charged **25**, free shipping above **200**
(`config/shipping.ts`), **8.1%** Swiss VAT, **6%** refund rate, **2%**
shrinkage.

**[→ Margin Desk — the live calculator](https://claude.ai/artifact/CNPh5eMby8Kh7PPwkWXC3r)**
— change any input (price, VAT rate, gateway mix from 2.9% card to 5.5% BNPL,
ex-works cost, freight, refund rate, return handling, shrinkage) and every
figure below recomputes: contribution, target and break-even CAC, ROAS,
monthly break-even orders, the scenario table, and a daily profit check.

---

## 3.1 Target COGS: what you may pay the supplier

Work backwards from the multiple, not forwards from the supplier's quote.

**The rule: landed cost ≤ 25% of the VAT-exclusive retail price.** At 109 CHF
inclusive, the price you actually earn is 109 ÷ 1.081 = **100.83**, so the
budget is against that figure, not the sticker.

"Landed" = product ex-works **+ freight + duties + import VAT prepaid (DDP)**.
Quoting yourself the ex-works price alone is the most common way founders
discover at order 30 that they have no margin.

| At retail 109 CHF incl. VAT (100.83 net) | Landed cost | Multiple | Verdict |
|---|---|---|---|
| Target | **≤ 25** | 4.0× | Healthy. Scales |
| Acceptable | 26–33 | 3.0–3.9× | Works, no room for error |
| Ceiling | 34 | 3.0× | Below this you are working for Meta |
| Typical China quote | 38–45 | 2.2–2.7× | ❌ Under-priced product, not overpriced supply |

**What to say to your agent, verbatim:**

> "I need this jacket delivered **DDP to Switzerland** — duties and import VAT
> prepaid, customer pays nothing at the door — for **under USD 28 all-in**.
> Split the quote: ex-works price, freight, duty. My ex-works ceiling is
> **USD 22**. Line used and measured door-to-door time to Zürich, please."

Budget split inside that 25 CHF: **ex-works ≤ 18 CHF (~USD 20)**, **freight +
DDP ≤ 9 CHF** on a consolidated line. The 25 CHF you charge for shipping more
than covers the freight — shipping is a margin line, not a cost line, which is
exactly why the fee stays.

---

## 3.2 The single order, fully costed

**Scenario A — one jacket, 109 + 25 shipping.** Landed cost assumed 38 (a
realistic first quote, before you negotiate).

| Line | Amount | Basis |
|---|---:|---|
| Product | 109.00 | incl. VAT |
| Shipping charged | 25.00 | `shippingPrice`, taxed at the same rate |
| **Gross charged to the card** | **134.00** | what the gateway moves |
| VAT / sales tax | −10.04 | 8.1% **extracted** from the gross |
| **Net revenue** | **123.96** | yours to work with |
| Landed COGS (DDP) | −38.00 | ex-works 24 + freight/duty 14 |
| Gateway fee | −4.19 | 2.9% of **gross** + 0.30 |
| Refund provision | −9.72 | 6% × (net revenue + goods written off) |
| Return handling | −0.48 | 6% × 8.00 per unit |
| Shrinkage / damage | −0.76 | 2% of landed cost |
| Per-order overhead | −2.50 | insert card, mailer, support time |
| **Contribution margin** | **68.32** | **55.1% of net revenue** |

Everything else in the business — ads, software, your time — comes out of that
68.32.

### Why each line is where it is

**VAT comes out of the price, not on top of it.** Swiss and EU consumer prices
are quoted tax-inclusive. A 109 CHF tag at 8.1% is 100.83 of revenue and 8.17
owed to the Eidgenössische Steuerverwaltung — and the 25 CHF shipping fee
carries the same rate. Model it as an addition and you overstate every margin
in the business by 8%.

**But you do not owe it yet.** Below **CHF 100,000** of turnover you are not
registered for Swiss MWST, so at VAT = 0 the same order contributes **77.75**
(58.0%) and target CAC rises to **31**. Crossing the threshold therefore costs
you **9.43 CHF of contribution per order, overnight** — roughly 2,800 CHF a
month at 300 orders. Set the calculator's VAT field to 0 for today's reality
and to 8.1 to see the cliff you are walking toward. Plan the price increase
*before* you cross, not after.

**The gateway takes its cut of the gross**, because the gross is what it moved.
2.9% + 0.30 is the domestic Swiss card rate; non-Swiss cards add ~1.5%,
EUR/USD presentment ~1%, and Klarna or PayPal land between 3.4% and 5.5%. The
calculator's slider spans that range — set it to your real channel mix. At a
**5.5% BNPL-heavy mix**, contribution falls to **64.83** and target CAC to
**21**, which is a different business. If you offer Klarna, price for Klarna.

**Refunds cost more than the refund.** A reversed order loses the net revenue
*and* writes off the landed goods, because a garment on a 14–20 day
China-direct line is rarely worth shipping back — then the return label and
repackaging are charged on top. At 6% that is 9.72 + 0.48 = **10.20 per order
on average**, not the 8.04 a naive "6% of revenue" reserve would suggest.
6% is optimistic for apparel; sizing disputes alone usually exceed it.

**Shrinkage is a separate event.** Units lost, stolen or damaged before they
ever earn, valued at what replacing them costs — landed cost, freight
included, because you ship the replacement too. 2% is normal for a long
cross-border line; treat 5% as the signal to change carriers.

---

## 3.3 Target CAC: what you may pay Meta for one sale

| Tier | Max CAC | Net per order | ROAS needed | Meaning |
|---|---:|---:|---:|---|
| **Break-even** | **68.32** | 0.00 | **1.96** | One franc past this and you are paying to work |
| Survival | 52 | 16.32 | 2.58 | Acceptable while testing creative |
| **Target** (35% net) | **25** | **43.39** | **5.38** | ⚠️ see below |
| Realistic band | 40–52 | 16–28 | 2.6–3.4 | Where you will actually live |

**The target is the finding, and it is bad news.** A 35% net margin at this
price implies a **25 CHF CAC and a 5.4× ROAS**. Cold Meta traffic in
Switzerland and Germany for a new apparel brand does not deliver a 5.4× ROAS —
not with good creative, not ever, reliably. Read that not as "try harder on
ads" but as **the price is wrong**, which § 3.4 fixes.

ROAS here is measured on **gross** revenue, because that is what Meta reports.
Comparing Meta's ROAS to a break-even computed on net revenue is a common and
expensive error.

Read the break-even number as a tripwire, not a budget. If your 7-day rolling
CAC crosses ~52, the campaign is not "still learning" — pause it, change the
creative, and restart. Creative is the variable that moves CAC; bid settings
are not.

### The lever that matters more than CAC: AOV

**Scenario B — two pieces, 218 CHF, free shipping** (the `freeShippingThreshold`
doing its job):

| Line | Amount |
|---|---:|
| Gross charged | 218.00 |
| VAT 8.1% | −16.33 |
| Net revenue | 201.67 |
| Landed COGS (2 units, one parcel) | −70.40 |
| Gateway fee | −6.62 |
| Refunds + return handling | −17.28 |
| Shrinkage | −1.41 |
| Overhead | −2.50 |
| **Contribution margin** | **103.45** (51.3%) |
| **Break-even CAC** | **103.45** |
| **Target CAC** (35% net) | **32.87** |

One extra item in the basket raises what you can profitably pay per customer
from **25 to 33 CHF** — a 32% increase in your buying power against every other
advertiser in the auction. Note that CM *percentage* falls (51.3% vs 55.1%),
because the waived shipping fee was pure margin; the CM in **francs** is what
pays for the customer, and that nearly doubles. Concretely: a bundle, a second
colourway, and the "free shipping over 200" threshold surfaced in the cart are
worth more than any bid optimisation you will ever do.

---

## 3.4 The price problem

At 109 CHF inclusive and a 38 CHF landed cost, your real multiple is
**2.65×** on the VAT-exclusive price. Premium DTC needs 4×, because ads eat the
difference. There are two ways out and you should do both:

**Fix 1 — negotiate landed cost to 27.** Multiple 3.73×, contribution
**80.20** (64.7%), target CAC **37**. Achievable with a real agent and a
serious tech pack.

**Fix 2 — raise the price to 139–159.** At **149 + 25**:

| Line | Amount |
|---|---:|
| Gross charged | 174.00 |
| VAT 8.1% | −13.04 |
| Net revenue | 160.96 |
| Landed COGS | −38.00 |
| Gateway fee | −5.35 |
| Refunds + return handling | −12.42 |
| Shrinkage | −0.76 |
| Overhead | −2.50 |
| **Contribution margin** | **101.94** (63.3%) |
| **Break-even CAC** | **101.94** |
| **Target CAC** | **45.60** |
| **Target ROAS** | **3.82** — reachable |

**Do both and the business changes shape.** At 149 retail with landed cost cut
to 27: contribution **113.82** (70.7%), multiple **5.11×**, target CAC
**57.48**, break-even ROAS **1.53**.

> **25 CHF per customer versus 57 CHF per customer.** Same product, same
> supplier, same ads. That gap is the entire difference between a store that
> cannot buy traffic and one that can.

There is also a positioning argument, and it runs the same direction. 109 CHF
is a mid-market price. A customer shopping "Dark Luxury" reads 109 as *fast
fashion pretending*, and 149–179 as *a young brand with a point of view*. The
price **is** part of the product. Lowering it does not make the brand more
accessible; it makes it less believable.

**Recommendation: launch the hero puffer at 149 CHF, anchored by one 249 CHF
piece and supported by a 79 CHF accessory.** Keep 25 CHF shipping and the
200 CHF free-shipping threshold — at 149, a second item crosses it naturally.

---

## 3.5 Monthly break-even

Fixed costs ÷ contribution margin per order, and then the two figures that
actually matter.

| Question | Orders / month | Why |
|---|---:|---|
| Clear fixed costs (60 CHF) | **1** | `60 ÷ 68.32` |
| Clear fixed costs **+ the ads that brought them** | **2** | `60 ÷ (68.32 − 25)` |
| **+ pay yourself 3,000 CHF** | **71** | `3,060 ÷ 43.39` ≈ **2.4 orders/day** |
| Gross revenue at that point | **9,514 CHF** | 71 × 134 |

**Overhead is not your problem.** One order a month clears every subscription
you have — the infrastructure is free-tier and the repo already works around
the Vercel Hobby cron limit. What you actually have to clear is the ads that
produce the orders and the money you live on, and that is a **71-order,
9,500 CHF month**. Anchor the plan to that number, not to the 1.

Two things move it hard: contribution per order (see § 3.4 — at 149 retail and
27 landed, the same draw needs **46** orders, not 71) and the owner draw
itself. Nothing else in the fixed-cost column is worth optimising.

---

## 3.6 The daily formula

Three numbers. Track them every morning for the previous day.

```
               Landed COGS + Gateway + Refunds + Returns + Shrinkage + Overhead
  CM%  =  1 −  ────────────────────────────────────────────────────────────────
                        Net revenue  ( = Gross ÷ (1 + VAT rate) )

  Break-even ROAS  =  Gross revenue ÷ Contribution margin

  Net profit  =  (Orders × CM per order)  −  Ad spend  −  (Monthly fixed ÷ 30)
```

**On today's assumptions** (CM = 68.32, fixed ≈ 60 CHF/month = 2/day), the
pocket version:

```
  Net today  =  (Orders × 68)  −  Ad spend  −  2
```

If that is negative, you have exactly two moves: **cut spend** or **fix
creative**. Not "wait for the algorithm".

### Break-even ROAS by margin — pin this to the wall

Measured on gross revenue, so it compares directly to what Meta reports.

| Your CM (CHF) | CM % of net rev. | Break-even ROAS |
|---:|---:|---:|
| 65 (5.5% BNPL mix) | 52.3% | 2.07 |
| **68** ← you today | **55.1%** | **1.96** |
| 80 (landed cut to 27) | 64.7% | 1.67 |
| 102 (retail 149) | 63.3% | 1.71 |
| 114 (149 **and** landed 27) | 70.7% | 1.53 |

### Weekly review — five numbers, nothing else

| Metric | Target at launch | Where |
|---|---|---|
| **CAC** (ad spend ÷ orders) | ≤ 40, alarm at 52 | Meta + orders table |
| **AOV** | ≥ 150 gross | admin orders |
| **CM %** | ≥ 55% of net revenue | formula above |
| **CVR** (site conversion) | ≥ 1.5%, alarm below 0.8% | GA4 |
| **Refund rate** | ≤ 6% | admin refunds |

Diagnostic order, always: **CVR first, then AOV, then CAC.** A 0.5% conversion
rate cannot be fixed by cheaper traffic, and chasing CAC while the site is
leaking is the most expensive mistake available to you.

---

## 3.7 Cash flow — the thing the margin table hides

You are profitable per order and can still run out of money. Three traps:

1. **Stripe payouts lag.** A new Swiss Stripe account typically pays out on a
   ~7-day rolling delay. You pay the agent for order #1 days before Stripe pays
   you for it. At 20 orders in flight, that is roughly **760 CHF of working
   capital** tied up before a single payout lands.
2. **Ads are prepaid, revenue is not.** Meta bills you on a threshold; refunds
   arrive 14–30 days after the sale.
3. **VAT is not your money.** Once registered, the 8.1% sitting in your bank
   account belongs to the tax office and is settled quarterly. Spending it on
   ads is the single most common way a growing store becomes insolvent while
   showing a profit. Move it to a separate account the day it arrives.

**Practical rule for month one:** never let committed ad spend plus unfunded
COGS exceed cash on hand minus 150 CHF. With a 500 CHF budget this caps you at
roughly **10–12 orders in flight** until the first Stripe payout clears. Plan
the ramp around the payout date, not the ad results.
