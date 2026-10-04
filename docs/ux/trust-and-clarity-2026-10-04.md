# Trust and clarity pass — 2026-10-04

Goal: make Luxe Vault an honest, transparent shop customers can buy from with
confidence. Priority: trust, then clarity, then conversion, then aesthetics.
Nothing here invents a person, an address, a review, a figure or a badge:
every claim on the site maps to something the code or the shop's own policies
do. Facts only the owner has are configuration, and they stay hidden until
they are set.

## 1. What changed

**New pages.** Each exists in EN, IT, FR and DE, and is in the sitemap with hreflang.

| Route | What it is |
|---|---|
| `/about` | Who runs the shop, what it sells (replicas, stated plainly), how items are chosen, how an order is handled (sourced from suppliers, checked, Swiss Post), what happens if something goes wrong. |
| `/shipping` | Fact grid (ships from, carrier, estimate, cost) plus sections on time, cost, tracking, destinations, customs and lost/damaged parcels. Every figure is the admin's live setting. |
| `/faq` | 22 questions in 7 groups, as accordions with jump links. Answers fill in live figures. Added: authenticity, ship-from, after-order, lost parcel, contact. |
| `/legal/imprint` | Seller identity from `config/business.ts`. Empty fields are omitted, never shown as placeholders. Also `/imprint`, `/impressum` (redirects). |
| `/returns` | Redirects to `/legal/refunds`. |

**Changed pages and components.**

- **Header.** Navigation is now Shop · About · Shipping · Returns · Contact, as real links with `aria-current`. The phone menu adds New in, Sale, Stylist, FAQ and Support.
- **Footer.** Columns: Shop · Customer care · Legal · Contact & social. Fixed: the old "Shop" buttons scrolled to a `#shop` section that no longer exists. Instagram and TikTok appear only when their URL is configured.
- **Homepage.**
  - Hero: a plain sentence saying what is sold (replicas), with "Shop the collection" and "About Luxe Vault".
  - New sections: a trust bar with four facts, 8 featured in-stock products chosen on the server, Why Luxe Vault, How ordering works, an FAQ excerpt and a final CTA.
  - Removed: the old About block with its decorative "01–04" numbers.
- **Product page.**
  - An "Product authenticity" note next to the price. When the admin's brand field names a designer, it reads "Design reference: X. Not made, sold or authorised by X."
  - Also new: a Condition line, a three-point trust block (Stripe, Swiss Post, a person answers) and a "2 / 5" photo counter. Thumbnails have labels.
  - Calmer copy: the "Select a size" prompt is a hint, no longer red, and the low-stock line no longer pulses orange.
- **Product card.** The brand name in gold is replaced by "Category · Replica".
- **Contact.** The form is inline and no longer a modal. It adds an optional order number. Email, Telegram, phone (if set), response time and the Imprint are listed beside it. The input borders were invisible on the light theme and are fixed.
- **Cart and checkout.**
  - Trust badges: "Swiss Quality" (false: the goods are replicas) and "Priority Delivery" (not a service the shop buys) are replaced by "Secure payment via Stripe · Tracked Swiss Post delivery · 14-day returns".
  - Checkout also states "No VAT is added by Luxe Vault" and repeats the replica disclosure above the pay button.
- **Order confirmation.** A four-step progress bar, a help box with the order number, and the 14-day returns line. The confirmation email gains the returns line.
- **Legal pages.**
  - The "Legal review required" banner is removed from all of them.
  - Visible `[OPERATOR TO COMPLETE]` brackets are replaced: identity now points to the Imprint, backups are described as what they are (S3-compatible, encrypted), and the Telegram retention is stated as fact (not deleted automatically).
  - "Provided on request" (seller identity) now links the Imprint.
  - The prevailing language is English; it was Russian, which no customer can select.
  - A contradiction is fixed: "items sold from a personal collection" against "sourced for your order".
- **Shipping claims.** "We deliver across all of Eurasia" (help text, FAQ, OG image) contradicted a checkout that accepts every country. It now reads "the countries you can select at checkout".
- **FAQ answers.** "Can I return an item?" no longer says the item *must* be unworn. That contradicted the policy, which allows a value reduction. "Something is wrong" now states the replace-or-refund remedy.
- **Defaults.** UI sounds are off by default and can be turned on in the footer.
- **SEO.**
  - New site title and descriptions. Removed: "Luxury Fashion", "meticulous craftsmanship", "limited drops".
  - The Organization JSON-LD reads legal name, address, phone and UID from configuration, only when set.
  - Product JSON-LD gains `hasMerchantReturnPolicy` (14 days, by mail, buyer pays the return).
  - The admin console shows which Imprint fields are missing.

## 2. The owner must provide

These are set as environment variables in Vercel (all environments), then redeploy. See `config/business.ts` and `.env.example`.

| Variable | Meaning |
|---|---|
| `NEXT_PUBLIC_SELLER_NAME` | [YOUR NAME OR COMPANY NAME] |
| `NEXT_PUBLIC_SELLER_STREET` | [FULL STREET ADDRESS] |
| `NEXT_PUBLIC_SELLER_POSTCODE` | [POSTCODE] |
| `NEXT_PUBLIC_SELLER_CITY` | [CITY] |
| `NEXT_PUBLIC_SELLER_UID` | [UID IF APPLICABLE] |
| `NEXT_PUBLIC_SELLER_RESPONSIBLE` | [NAME] |
| `NEXT_PUBLIC_SUPPORT_PHONE` (+ `_HOURS`) | [PHONE NUMBER], only if someone answers it |
| `NEXT_PUBLIC_INSTAGRAM_URL`, `NEXT_PUBLIC_TIKTOK_URL` | Only real accounts |

Until name and address are set, the Imprint shows the trading name, "Switzerland", email and Telegram. Swiss UWG art. 3(1)(s) requires name and address for online sales.

**Decisions only the owner can make:**
1. **Delivery estimate vs. supplier lead time.** The order tracker and assistant say pieces are ordered from a supplier (20–35 days, `FULFILMENT.supply`). The storefront shows the admin's estimate (default 10–14 business days). Make the admin estimate the real door-to-door time.
2. **Lost-parcel policy.** The site promises a Swiss Post search request and updates, and no outcome. Decide whether a confirmed loss is refunded or replaced, then add it to the Refund Policy.
3. **Destinations.** Checkout offers every country. Restrict the list if you do not ship everywhere.
4. **Prevailing language.** English now prevails over the translations. Confirm with your lawyer.
5. **Trade marks.** See the compliance audit §0. Naming designer brands, even inside a disclaimer, carries legal risk that no copy can remove.

## 3. QA

- `tsc` and `next lint` clean; `next build` OK.
- All new routes return 200 in all 4 languages; the redirects return 307.
- Widths 320 / 375 / 390 / 430 / 768 / 1280: horizontal-overflow and leftover-text checks across 16 pages.
- axe WCAG 2.2 AA on 10 pages at 1280 and 390.
- Existing suites: keyboard, compliance UI, CSP nonce and security.
