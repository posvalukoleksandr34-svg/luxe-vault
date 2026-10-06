# Card-fraud guard and review moderation — 2026-10-06

## Card payments: what the shop now does

Stripe Radar scores every card payment and blocks the riskiest on Stripe's
side. On top of that (`lib/server/payment-fraud.ts`, migration
[`0053_payment_fraud_guard.sql`](../../supabase/migrations/0053_payment_fraud_guard.sql)):

| Signal | What happens |
|---|---|
| Every card payment | 3-D Secure is requested whenever the card supports it (`request_three_d_secure: any`). A stolen card number is useless without the owner's banking app or SMS code. A fraud chargeback on an authenticated payment is normally the bank's loss (liability shift). Set `STRIPE_THREE_D_SECURE=automatic` to relax this. |
| A declined card attempt | Counted per order (wrong CVC counts double). |
| 3 failed attempts (or 2 wrong CVCs) | 1. The PaymentIntent is cancelled, so the open payment form cannot try more cards. 2. Card payment for the order is locked. 3. The email and IP address are refused card payments for **24 h**. 4. A Telegram alert is sent. |
| A fraud-type decline (stolen, lost, "fraudulent", pick-up card, or blocked by Radar) | Locked at once. Email and IP are refused for **30 days**. |
| Paid, but Radar scored it "elevated" | Order flagged; Telegram alert: do not ship before checking. |
| Early fraud warning from the card network | Order not yet shipped: refunded in full automatically and marked refunded. Already shipped: flagged, alert. Email blocked 30 days. |
| Dispute (chargeback) opened | Order flagged, email blocked 30 days, alert. |

Behaviour around these:
- Flags and locks show as red badges in **Admin → Заказы**.
- A locked order has a «Разблокировать» link. It lifts the lock and the blocks
  that order caused, for when a genuine customer simply mistyped.
- Wallet payments (Apple Pay / Google Pay) are cards and are treated the same way.
- Klarna and TWINT cancellations are not counted.

Where the data is kept and for how long:
- The IP address is stored only as an HMAC (keyed with `PAYMENT_FRAUD_SECRET`,
  or the service-role key).
- Blocks are deleted by the daily sweep once they expire.
- The privacy policy says so (retention section, in force since 6 October 2026).
- The fraud tables are server-only: they have RLS and no policies, and
  `verify-production.sql` checks this.

**Fails open:** if the database is unreachable or 0053 is not applied, card
payments still work, with Radar only.

### Stripe Dashboard: what to switch on

1. **Developers → Webhooks → your endpoint → Select events:** add
   `radar.early_fraud_warning.created` and `charge.dispute.created`. Without
   them the automatic refund and the dispute flag never fire.
2. **Radar → Rules**, included in standard pricing:
   - Turn on **"Block if CVC verification fails"**.
   - Turn on **"Block if postal code verification fails"**. It mostly affects
     US, UK and Canadian cards and is harmless elsewhere.
   - Leave the default "Block if risk level is highest" on.
3. **Optional, paid: Radar for Fraud Teams** (a fee per screened payment)
   adds custom rules and a review queue. For the strictest setup:
   - `Block if :risk_level: = 'elevated'`. This also blocks some genuine
     customers; "Review" instead of "Block" holds the payment for you to
     approve.
   - Velocity rules (the rule editor suggests the exact attribute names), for
     example blocking a card or IP address with more than 3 declined attempts
     in an hour.
   - Block lists: add the email or card of anyone who files a fraudulent dispute.

## Product reviews: automatic moderation

`lib/server/review-moderation.ts`. Every review is already from a verified
buyer (0052).

| Review | Result |
|---|---|
| 4–5★, no flags | Published immediately; the customer sees "your review is now live". |
| 1–3★ | `pending` — often a delivery complaint rather than a product flaw. |
| Profanity (it/en/fr/de/ru, incl. "f.u.c.k", "sh1t", accents, repeated letters) | `pending` |
| Link, email, phone number, @handle, t.me / wa.me | `pending` |
| Spam vocabulary (casino, viagra, "make money", "click here"…) | `pending` |
| Gibberish (keyboard mashing, a held key, a word repeated, unpronounceable text) | `pending` |

How it decides:
- Nothing is rejected automatically. The filter only decides "publish now" or
  "a person looks first".
- Words are matched whole: "cocktail", "Dickens", "Schnitt", "Herbstschuhe",
  dates and emoji pass. The tests list the genuine reviews that must pass and
  the abuse that must be held.

**Admin → «Отзывы о товарах»** lists only pending reviews, oldest first, each
with:
- its reasons;
- the product (link);
- the author's name and email;
- the order number.

The actions are:
- **Опубликовать:** publishes the review.
- **Отклонить:** hides it; the customer cannot write another one.
- **Удалить:** removes it after confirmation; the customer can write again.

**Publish low ratings unless they break the rules.** Holding them briefly for
a check is fine. Suppressing negative reviews misleads customers and is an
unfair commercial practice under EU and Swiss law; the admin screen says so too.

## Tests

- Unit tests: 62 (`npm run test:security`). Moderation: 21 cases. Fraud
  decisions and IP hashing.
- End to end, against the production build on real Postgres 16 + PostgREST
  with a fake Stripe API (scratch harness):
  - fraud (35): every row of the table above, the unlock, customer
    unreadability, the retention sweep;
  - reviews (82, incl. moderation and the admin API: auth, CSRF, 400/404);
  - browser (37, incl. the admin queue at 1280 and 390 px).
- The existing security suite (47) still passes.
- The admin console no longer scrolls sideways on phones: the mobile tab bar
  scrolls inside itself (pre-existing; `min-w-0`).
