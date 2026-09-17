# Luxe Vault — Launch Operations Dossier

Everything needed to take the store from "code is ready" to "money is moving".
Four documents, in the order you should act on them:

| # | Document | Answers |
|---|---|---|
| 1 | [01-sourcing.md](./01-sourcing.md) | Where to buy the product, how to verify it, how to ship it in 10–14 business days |
| 2 | [02-launch-checklist.md](./02-launch-checklist.md) | Exactly what to pay for and configure, prioritised |
| 3 | [03-unit-economics.md](./03-unit-economics.md) | The per-order maths, target COGS, target CAC, the daily formula |
| 4 | [04-seven-day-plan.md](./04-seven-day-plan.md) | Day-by-day operations for the first week |
| — | **[Анализ Маржинальности](https://claude.ai/artifact/CNPh5eMby8Kh7PPwkWXC3r)** | Live calculator, Russian interface — every figure in #3, recomputed from your own inputs |

## Working assumptions

The brief left three figures as placeholders. These are the values used
throughout; every number below is recomputed if you change them, and the
calculator linked in `03-unit-economics.md` lets you do that live.

| Input | Value used | Where it lives in the code |
|---|---|---|
| Retail price | **109 CHF** incl. VAT | catalogue, per product (admin panel) |
| Shipping charged | **25 CHF** | `config/shipping.ts` → `shippingPrice` (admin-editable) |
| Free shipping over | **200 CHF** | `config/shipping.ts` → `freeShippingThreshold` |
| Delivery window | **10–14 business days** (= 14–20 calendar) | `config/shipping.ts` → `deliveryTimeframe` |
| Launch budget | **500 CHF** | — |
| Swiss VAT | **8.1%** (0% below CHF 100k turnover) | modelled in the calculator |

Two findings up front, before the detail:

1. **109 CHF is under-priced for the positioning.** Net of 8.1% VAT the price
   you actually earn is 100.83, so a realistic 38 CHF landed cost is a **2.65×
   multiple**. Premium DTC needs 4×. Hitting a 35% net margin from there
   implies a 25 CHF CAC and a 5.4× ROAS, which cold Meta traffic will not
   deliver. At 149 retail with landed cost cut to 27 you can pay **57 CHF** per
   customer instead of 25 — see `03-unit-economics.md` § "The price problem".
2. **500 CHF is a validation budget, not a launch budget.** It buys samples and
   one ad test — realistically 3–5 paid sales. The 10-sale target in week one
   is reachable only by pairing it with unpaid channels. See
   `04-seven-day-plan.md`.
