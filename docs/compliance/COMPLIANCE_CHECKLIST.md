# Compliance checklist (Switzerland and cross-border)

Prepared on 2026-11-04 from the code and documents in this repository. **It
is not legal or tax advice, and nothing here is a compliance claim.** For
each area it separates four things:
- what the code does;
- what the repository states;
- what the owner must confirm;
- what needs a qualified professional.

The owner items it creates are in `OWNER_APPROVAL_CHECKLIST.md`.

| Area | What the code implements | What the repository states | Owner must confirm | Professional review |
|---|---|---|---|---|
| **Seller disclosure** (UWG art. 3(1)(s)) | Imprint from `config/business.ts`, never with placeholders. Since this round, **no new orders while the name or postal address is missing** (`lib/sales-gate.ts`). | Imprint texts in `lib/content/imprint.ts`, in five languages. | The real seller name, address, responsible person and UID if any (OA-23). | Lawyer: whether the seller is a private person or a business (OA-25). |
| **Nature of the sale** | Supplier lead time of 20–35 days, and per-product windows for dropshipped lines (`lib/fulfilment.ts`). | Terms §1/§3: a "private sale", "personal collection", "packed by hand", and a warranty limited under Art. 199 OR. **These contradict the code.** | The actual model: who buys from whom, where the stock is (OA-25, OA-28). | Lawyer: correct characterisation, the warranty limitation, terms rewrite. |
| **Product legality / IP** | Publication gate (0062): only own design or authorised resale, with a reference; audit trail (0065); drafts invisible on every public path. | Terms, Imprint, footer, card tag: "replicas", "designer-inspired". **Contradicts the gate.** | The provenance of every product, and the documents behind each rights record (OA-20). | IP lawyer (OA-01). The payment providers (OA-02). |
| **Price indications** (PBV) | Strike-through prices only from recorded prices (0063, `lib/price-reference.ts`). Prices in CHF, with conversion shown for EUR and USD. | — | That displayed prices are final prices including any taxes. | Lawyer and accountant: the reference-price rule in each market. |
| **VAT / tax** | No VAT line on prices, receipts or invoices. `TAX_RATE` in `lib/fulfilment.ts`. | — | Turnover; where goods are stored and shipped from; customer countries. | Accountant: Swiss VAT registration (the threshold applies to worldwide turnover), import VAT, EU OSS/IOSS (OA-26). |
| **Customs and import** | Shipping quotes by country (`lib/fulfilment.ts`, admin → Доставка). | Shipping page (`app/shipping`). | Which countries are served, and who pays duties (DDP or DAP). | Customs broker or lawyer: the duty disclosure wording for non-CH customers. |
| **Withdrawal and returns** | Refund cases with states, evidence, a ledger and partial refunds (0059, `docs/refunds/README.md`). | Refund policy: a 14-day return window (`app/legal/_content/refunds.ts`). | That the policy matches what you will actually honour, and the return address. | Lawyer: the EU 14-day withdrawal right and its information duties, if selling to EU consumers. Whether Swiss law gives more or less. |
| **Legal guarantee / conformity** | Defects can be reported through returns and support. | Terms §3 limit the warranty on the "private sale" basis. | — | Lawyer: whether the limitation is valid for the real model (Art. 197 ff. OR; the EU 2-year guarantee for EU consumers). |
| **GDPR / nFADP: privacy notice** | Privacy policy page; consent banner for analytics and marketing (no analytics before consent); no analytics on `/admin`. | `app/legal/_content/privacy.ts`, cookie policy. | That every processor is listed (Supabase, Vercel, Stripe, NOWPayments, Resend, Google Gemini and Places, Telegram, Cloudflare, Google Analytics) with their countries. | Lawyer: completeness, transfers outside CH and EU, and whether an EU representative is needed (GDPR art. 27) (OA-27). |
| **Processor agreements (DPA)** | — | — | A DPA accepted or signed with each processor. | Lawyer, if any is missing. |
| **Retention and deletion** | Daily retention (`lib/server/retention.ts`): orders and their items **5 years**, unconfirmed newsletter sign-ups 30 days, cart records 30 days, support tickets, payment blocks, order keys. Account deletion (`/api/account/delete`). | Privacy policy retention text. | — | **Accountant: Swiss business records are generally kept 10 years (OR art. 958f).** If the sale is commercial, 5 years for orders may be too short. Change it only on written advice. |
| **Marketing consent** | Newsletter double opt-in (0051), unsubscribe links and page, bounce and complaint suppression (Resend webhook). The review-request emails are `disabled`. | `docs/review-requests.md`. | The consent basis before enabling review requests (OA-12). | Lawyer, only if the basis is widened. |
| **Abandoned-cart email** | Only for customers who ticked "remind me". **Not sent while sales are closed.** | — | — | — |
| **AI assistant** | Read-only tools: search, product, compare, the status of one's own order, a human handoff. It cannot refund, cancel or change orders. Order data only for the signed-in owner or with the lookup token. Gemini is the provider. | `docs/support-assistant.md`. | That customers are told an AI answers (the chat UI says so) and that Google is a processor. | Lawyer: whether the privacy notice covers the AI provider. |
| **Accessibility** | Earlier rounds: axe scans, headings, labels, reduced motion. | `docs/audit`. | — | Not legally mandated for private businesses in CH. EU EAA (2025) duties apply to some e-commerce sellers: lawyer. |
| **Payment provider rules** | Stripe and NOWPayments webhooks verified; amounts and currency checked server-side. | — | That the products and the model are acceptable to each provider (OA-02). | — |
