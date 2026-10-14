# Chat concierge (AI support assistant)

The chat (the "Support" launcher, bottom right on the home, category and
stylist pages) answers customers with a language model. The model reads the
shop's own policies, searches the real catalogue and looks up the customer's
own orders, and it hands over to a person when it cannot help. Without a model
the chat falls back to the help centre's prepared answers, which is what the
bot used to be.

What the concierge can do:

- answer policy questions (delivery, fees, returns, payment, sizing) from the
  live settings and the help centre;
- find, describe and compare products from the real catalogue, with honest
  availability and the canonical page link;
- say where the customer's own orders are (status, dates, tracking, payment
  confirmation);
- prepare a request to the team for anything else.

What it cannot do, by construction: place, change or cancel orders, refund,
apply discounts, reserve or change stock, or change account details. No tool
does any of these, and the prompt tells the model to say so and offer the team.

## How a turn flows

```
Browser (components/support/chat-bot.tsx)
  │  POST /api/support/assistant
  │  { locale, messages (≤12 turns), orders: this browser's {id, token},
  │    context?: { productId } }                    ← only on a product page
  ▼
Route (app/api/support/assistant/route.ts)
  │  rate limit 'support.assistant' (40 / 10 min / IP); body ≤ 64 KB (413);
  │  turns ≤ 1 000 chars, ≤ 8 000 in all; must start and end with the customer;
  │  locale allowlisted; product id shape-checked; credentials shape-checked
  ▼
answer() (lib/server/assistant/chat.ts)       one turn, stateless, ≤ 20 s
  │  system prompt = rules (prompt.ts) + knowledge in the page language (knowledge.ts)
  │                + the product the chat was opened on, looked up here
  │  customer messages redacted (cards, IBANs, e-mails, phones) before sending
  │
  │  Gemini generateContent (function calling) ──► tools.ts validates every call
  │      ≤ 4 rounds, ≤ 4 calls per round, ≤ 8 per turn,      ├ search_products ┐
  │      repeated calls answered from cache,                  ├ get_product     ├ catalog.ts (read-only)
  │      each result capped at 6 000 chars                    ├ compare_products┘
  │                                                           ├ get_order_status ┐ orders.ts: ONLY the
  │                                                           ├ list_my_orders   ┘ requester's orders
  │                                                           └ offer_human_support (hand-over form)
  ▼
guard.ts: reply checked: language (one rewrite), links grounded, Markdown
  │       flattened, ≤ 1 500 chars; product cards built from the catalogue
  ▼
{ mode: 'ai', reply, handoff?, products?, turnId }
{ mode: 'fallback', reason, turnId }   ← the widget answers from the help centre
```

## Files

| File | What it does |
| --- | --- |
| `lib/server/assistant/chat.ts` | The turn: dependencies, time budget, cancellation, tool loop, retries, fallback reasons. |
| `lib/server/assistant/tools.ts` | The six tool declarations and the server-side validation of every argument. |
| `lib/server/assistant/catalog.ts` | Read-only catalogue views: search, detail, cards, stock states, canonical URLs. |
| `lib/server/assistant/orders.ts` | Which orders the concierge may see, and what it is told about them. |
| `lib/server/assistant/guard.ts` | Redaction going in; language detection, link grounding and amount checks coming out. |
| `lib/server/assistant/prompt.ts` | The system prompt, describing only what the code can do. |
| `lib/server/assistant/knowledge.ts` | The knowledge base: shop facts, every help-centre answer with live figures, the returns policy. |
| `lib/server/assistant/metrics.ts` | Quality signals: one log line per turn, counts only. |
| `app/api/support/assistant/route.ts` | `GET` → is the concierge on; `POST` → one turn. |
| `app/api/support/assistant/feedback/route.ts` | "Was this helpful?" → one log line. |
| `components/support/chat-bot.tsx` | The widget. |
| `tests/assistant/` | The offline evaluation suite (`npm run test:assistant`, runs in CI). |
| `tests/assistant-live/` | Optional checks against the real model, never in CI. |

## Tools

All tools are read-only except `offer_human_support`, which only fills in the
request form the customer then reviews and sends. The model never writes a
query. It fills in typed fields, `tools.ts` validates and bounds each one, and
`catalog.ts` and `orders.ts` do the rest. An invalid call gets a typed error
back (`unknown_tool`, `invalid_argument`, `empty_search`,
`invalid_product_id`, `need_two_or_three_products`, `invalid_number`,
`tool_limit`), never an exception.

| Tool | Arguments (validated) | Returns |
| --- | --- | --- |
| `search_products` | `query` ≤ 100 chars, `category`, `color` (any of the four languages), `size`, `max_price_chf` / `min_price_chf` (numbers ≥ 0; text only when unambiguous: "CHF 1'290" yes, "300,50" refused), `in_stock_only`, `limit` 1–6 (default 4) | up to 6 summaries: id, name, brand, category, price (formatted CHF) and `priceChf`, `previousPrice`, colours, sizes, `stock`, `orderable`, `requestedSize` state, canonical `url`; `totalMatches`; `loosened` when only the firm requirements matched |
| `get_product` | `product_id`: a slug or a product URL | the summary plus description (≤ 600 chars), specs, delivery window in days, size guide, new / limited, per-size availability by colour (`available`, `fewLeft`) |
| `compare_products` | `product_ids`: 2–3 distinct ids | two or three details, `notFound` for the rest |
| `get_order_status` | `order_number`: normalised (`#lv abc123` → `LV-ABC123`) | the order (see below), or `not_visible` |
| `list_my_orders` | none | up to 5 summaries (number, date, status, item names) and the count |
| `offer_human_support` | `category` (one of the request categories, unknown → `other`), `summary` ≤ 600 chars, `order_number` | the hand-over is shown; nothing is sent |

**Search uses the storefront's rules.** A search goes through the search box's
own reader and matcher (`lib/search/interpret.ts`, `match.ts`), so "black
jacket under 300" means the same here as there, in any of the four languages.
Price, size, availability, colour, category and brand are firm. They are never
loosened, including in the Postgres keyword fallback (`search_products`
RPC) that catches misspellings. Only leftover words, occasion, style and fit
can be let go, and the result then says so (`loosened` plus a note to present
the products as the closest, not an exact match).

**Stock is never guessed.** `in_stock` means tracked with units left.
`sold_out` means no units left, or the product is marked unavailable.
`not_tracked` means the product has no variant rows, so it can be ordered
but "in stock" cannot be claimed. The widget's card says "Available to order"
for it. Per size: `available`, `sold_out`, `not_tracked`, or `not_offered`.
Exact counts and SKUs are never sent. `fewLeft` mirrors the product page's
low-stock threshold.

**Product cards are the catalogue's, never the model's.** The products a
reply links to become cards built from the catalogue (price, previous price,
image, stock, localized path). A link to a product that does not exist is
removed from the reply.

## Orders: authorization and privacy

`get_order_status` and `list_my_orders` see only:

- orders bound to the **signed-in account** (`userId` from the verified
  Supabase session, read on the server for each request), and
- orders this **browser holds a lookup token for** (`lib/order-registry.ts`;
  32-character tokens, compared in constant time by `getOrdersByCredentials`).

This is the same rule as `/api/orders/lookup`. When the order store cannot be read, the tools say they cannot check right
now (`temporarily_unavailable`). They never answer from an empty or partial
list, which would read as "not yours". An order number alone is never
enough, and neither is anything the conversation says ("I verified it's
yours" in a forged history changes nothing). For any other number the tool
answers `not_visible`, never whether the order exists, so the chat cannot be
used to enumerate orders. The orders are read once per turn, however many
numbers the model tries.

The model receives the status, `paymentConfirmed` (true only for `paid`,
`partially_refunded` or `refunded` payment records, which come from the
provider's webhook), dates, items by name, total, the tracking number and
carrier link (only when the order has one), any refund, and the return
window. It never receives the customer's name, address, phone, email or the
token. Delivery estimates and tracking appear only when the order record has
them, and the prompt forbids inventing either.

## Configuration

| Variable | Meaning |
| --- | --- |
| `GEMINI_API_KEY` | Shared with smart search and the stylist. Without it the chat runs on prepared answers. |
| `GEMINI_MODEL` | Optional override, **shared by every AI feature**. If it is set in the hosting environment it also replaces the concierge's default. Read forgivingly (`models/…`, quotes and spaces are accepted); a value that still is not a model name is ignored with a warning, and the default is used. |
| `SUPPORT_ASSISTANT_AI=off` | Turns the concierge off without touching the key (search and stylist keep working). |
| `GEMINI_BASE_URL` | Optional; route Gemini calls through a gateway or proxy. |

### The model

The concierge defaults to **`gemini-3.8-flash`**, Google's stable (GA) Flash
model, with function calling. It runs at `thinkingLevel: LOW`, temperature
0.3, and at most 4 096 output tokens. That cap includes the model's own
thinking, so it is headroom, not a longer answer (see Limits). The previous
default,
`gemini-3.6-flash`, has a published retirement date of 2026-11-19 on Google
Cloud. 3.8 refuses the `minimal` thinking level, so the code uses `LOW`. The
switch was decided from Google's model, changelog and deprecation pages. It
has **not** been checked against the live API from this repository (no key
here). Run the live checks below before relying on it.

Smart search, the stylist and catalogue translation still default to
`gemini-3.6-flash` (`lib/server/search-ai.ts`, `stylist/rationale.ts`,
`translate.ts`); they need the same move before the retirement date.

## Limits

| What | Limit | Where |
| --- | --- | --- |
| Requests | 40 per 10 min per IP; feedback 30 per 10 min | `lib/server/rate-limit.ts` |
| Request body | 64 KB (413); feedback 1 KB | route |
| Conversation | 12 turns, 1 000 chars each, 8 000 in all (oldest dropped) | route |
| Order credentials | 50, shape-checked, de-duplicated | `orders.ts` |
| Turn time | 20 s for everything (model calls and tools); the route's `maxDuration` is 30 s | `chat.ts` `LIMITS` |
| Tool use | 4 rounds; 4 calls per round; 8 per turn; then the model must answer in words | `chat.ts` |
| Tool result | 6 000 chars, lists shortened first | `capResponse` |
| Retries | one, only after a provider 5xx with time left; none for 429, timeouts or refusals. The SDK's own retries stay off | `chat.ts` |
| Reply | 4 096 output tokens, thinking included (at 700–1 024 a longer turn could stop with `MAX_TOKENS` before writing a word); 1 500 chars after checking, cut at a sentence | `chat.ts`, `guard.ts` |
| Product cards | 3 per reply | `chat.ts` |

## When there is no answer

`answer()` never throws to the customer. A failed turn returns a typed
`reason`, and the widget answers from the help centre instead, introduced as
such ("The concierge is unavailable right now — here is the help centre's
answer"). "Write to the team" stays one tap away:

| Reason | When |
| --- | --- |
| `unconfigured` | no `GEMINI_API_KEY`, or `SUPPORT_ASSISTANT_AI=off`. The widget then stays in help-centre mode. |
| `timeout` | the 20 s budget ran out |
| `cancelled` | the customer closed the chat or left; the model call is aborted |
| `rate_limited` | the provider answered 429 |
| `provider_error` | any other provider or network error. The HTTP status is in the log line (`providerStatus`); the message goes to the server log, never the customer |
| `invalid_response` | empty, cut off, blocked, or still calling tools after the last round; which one is in the log line (`finishReason`) |
| `wrong_language` | the customer clearly wrote in one language and the reply was in another, twice |

Any other failure, such as a network error or a 5xx from the route, shows an
error message with **Retry** (the same question again) and "Write to the
team". The AI stays on for the next question: one failure no longer switches
the chat to prepared answers for the rest of the visit.

## Output checks (`guard.ts`)

- **Language.** When the customer's last message is long and clear enough
  to be classified (English, Italian, French or German), the reply must be in
  that language: a reply in another one is rewritten once, then falls back
  (`wrong_language`). A short message ("Any black coats?") cannot be
  classified, so the model may answer in the page's language or in the
  customer's, and either is accepted. It used to be held to the page's
  language, and a correct English answer to an English question on an
  Italian page was replaced by a template.
- **Links.** Bare shop paths become full links. A product link must name a
  product in the catalogue. Any other link must be this shop's own page or a
  URL a tool returned (a tracking link). Everything else is removed.
- **Amounts.** CHF amounts that appear nowhere in the knowledge or the tool
  results are counted (`unverifiedAmounts` in the quality log). They are not
  removed: a correct sum such as a total with shipping would be lost. The
  evaluation suite checks the count.
- **Format.** Markdown is flattened to plain text. The widget renders text
  (React escapes it) and turns only http(s) URLs into links: the shop's own
  open in the same tab, others in a new tab with
  `rel="noopener noreferrer nofollow"`.

## Product-page context

When the chat is open on a product page, the widget sends only the product id
from the URL. The server looks it up in the catalogue itself and adds the
product's summary to the prompt, marked as catalogue data, not instructions.
An id that is not in the catalogue is ignored. The launcher is not shown on
product pages: the phone layout has a fixed buy bar there. The chat reaches
a product page when the customer taps a product card in it, and then offers
"About this piece".

## The widget

- **One request at a time**, aborted when the chat closes or the page is left.
  After 7 s a "still checking" line appears under the typing dots.
- **The conversation stays for the tab.** It is kept in `sessionStorage` under
  `lv.concierge` for at most 2 hours and 60 messages, validated when it is
  read back, and cleared by "New conversation". It never holds order tokens
  (those stay in `luxe-vault-orders`). It is disclosed in the chat's privacy
  note and the cookie policy (`lv.concierge`). Nothing of the conversation is
  stored on the server.
- **Hand-over.** The reply carries "Write to the team", which opens the
  request form with the category, the order and the model's first-person
  summary. If there is no summary, the customer's own question is used. The
  customer can edit everything before sending. When the AI is unavailable,
  the question is still carried over.
- **Feedback.** Thumbs up and down under each AI answer post `{turnId, rating,
  outcome}`. Only the rating and the kind of answer are logged.
- **Accessibility.** `role="dialog"`, `role="log"` with `aria-live="polite"`
  and `aria-busy`, a labelled status for the typing dots. Escape closes the
  chat, focus moves to the field on open and back to the launcher on close.
  axe (WCAG 2.2 AA) found no violations on the open chat in the 2026-10-13
  browser run (docs/audit/SUPPORT_ASSISTANT_REPORT.md). At phone widths it respects the safe area, and long words wrap.
- **Suggestions.** "Find a piece" (when the AI is on), "About this piece" (on
  a product page), the help-centre topics, and the customer's own order
  numbers as chips when an order number is wanted.

## Streaming: not used

Replies are sent whole. Each reply is checked after it is generated: language,
links against the catalogue, cards built from the products it names, length.
Streaming tokens to the customer first would show text that may then be
withdrawn. The upstream, the edge proxy and Vercel would also all need to
pass the stream through correctly. With replies of one to four sentences and
a "still checking" line after 7 s, a bounded single response is the more
robust choice. Streaming can be added later, without changing the
orchestration, by buffering until the check passes.

## Quality signals

One JSON line per turn in the platform log, searchable as `assistant_event`
(`lib/server/assistant/metrics.ts`):

```
{"assistant_event":"answered","at":"…","locale":"it","model":"gemini-3.8-flash","ms":2310,
 "rounds":2,"toolCalls":1,"tools":{"search_products":1},"rejectedCalls":0,"removedLinks":0,
 "unverifiedAmounts":0,"languageRetry":false,"handoff":false,"products":1}
{"assistant_event":"fallback","reason":"timeout", …same counts…}
{"assistant_event":"fallback","reason":"provider_error","providerStatus":404, …}
{"assistant_event":"fallback","reason":"invalid_response","finishReason":"MAX_TOKENS", …}
{"assistant_event":"feedback","rating":"not_helpful","outcome":"products"}
```

Counts only: never the question, the answer, an order number, a token, an
address, an IP or the turn id. Those lines answer how often the chat falls
back and why, how slow it is, which tools are used, how often links are
removed or amounts unverified, and whether people find it helpful. They add
no new service or vendor.

## Troubleshooting: "the chat only gives prepared answers"

The chat answers from the help centre (prepared, template answers) in three
situations. They look different, so start with what the chat shows.

**1. No note, from the first message: the concierge is off.** The widget
asked `GET /api/support/assistant`, got `{"ai": false}`, and never calls the
model. The server logs this once per instance:
`[assistant] the chat concierge is OFF (GEMINI_API_KEY is not set for this
deployment)` or `(SUPPORT_ASSISTANT_AI=off)`.

- Set `GEMINI_API_KEY` for that environment. On Vercel, Production, Preview
  and Development are separate. Then redeploy.
- Locally, put it in `.env.local`. `.env.example` leaves it empty.

**2. "The concierge is unavailable right now — here is the help centre's
answer": the model was asked and the turn failed.** The log has one
`assistant_event` line with `"reason"`:

| Log | Meaning | What to do |
| --- | --- | --- |
| `provider_error`, `providerStatus: 404` | the model (`GEMINI_MODEL`, or the default `gemini-3.8-flash`) is not available to this key | set `GEMINI_MODEL` to a model the key can use, e.g. `gemini-3.6-flash` until it retires |
| `provider_error`, `400` / `403` | the key is wrong, restricted, or for another project | check the key in Google AI Studio |
| `rate_limited` | the key's quota is spent | raise the quota, or wait |
| `invalid_response`, `finishReason` | cut off (`MAX_TOKENS`), blocked (`SAFETY`), empty | `MAX_TOKENS` should be rare at 4 096; report others |
| `timeout` | the provider took more than 20 s | provider status; repeated cases mean the region or model is slow |
| `wrong_language` | a clear-language question answered twice in another language | report it, with the locale |

**3. "That does not look like an order number": the widget is waiting for
one.** After "Where is my order?" or "Returns", only something that looks
like a number attempt ("LV12", "#123") gets this reply, without a model call.
Anything else goes to the concierge.

The topic buttons and their prepared questions answer instantly from the help
centre **by design**. Free text typed into the chat goes to the model.

## Knowledge: why the whole base, not a vector search

Retrieval (RAG) exists to pick the few relevant passages out of a corpus too
large to send with every question. This shop's corpus is small: 17
help-centre answers and the returns policy. The whole system prompt, rules
included, is about 14,700–15,600 characters (roughly 4k tokens) per language,
plus about 3,000 characters of tool declarations. Sending all of it is
strictly better at this size: no relevant passage can be missed by a bad
match, and there is no index to keep in step with the text. The figures are
filled in from the live settings on every request, so an answer can never
quote an old fee or delivery window.

### When to add pgvector

Once the knowledge grows past roughly 50–100k tokens (care guides, brand and
material stories, per-product notes, long policies), replace `knowledgeFor()`
with a retrieval step. Supabase already hosts the database, so pgvector is the
natural choice.

1. Migration:

   ```sql
   create extension if not exists vector;

   create table public.knowledge_chunks (
     id          bigserial primary key,
     source      text not null,        -- 'faq:return-window', 'policy:refunds#2', 'guide:cashmere'
     locale      text not null check (locale in ('en', 'it', 'fr', 'de')),
     content     text not null,
     embedding   vector(768) not null,
     updated_at  timestamptz not null default now()
   );
   create index on public.knowledge_chunks using hnsw (embedding vector_cosine_ops);
   alter table public.knowledge_chunks enable row level security;  -- server-only: no policies

   create or replace function public.match_knowledge(query vector(768), lang text, k int default 6)
   returns table (source text, content text, similarity float)
   language sql stable as $$
     select source, content, 1 - (embedding <=> query)
     from public.knowledge_chunks
     where locale = lang
     order by embedding <=> query
     limit k
   $$;
   ```

2. Ingest (a script run on deploy or from the admin console): split each
   document into ~500-token chunks on section boundaries, embed each with
   Gemini (`ai.models.embedContent({ model: 'gemini-embedding-001', contents,
   config: { outputDimensionality: 768 } })`), and upsert by `source`.
   Placeholders like `{span}` stay in the stored text and are filled at answer
   time, as now.

3. Retrieve: embed the latest question (plus the previous turn, for follow-ups
   such as "and for the other one?"), call `match_knowledge`, and send the top
   chunks in place of the full base. Keep the SHOP FACTS block always in the
   prompt; it is short, and the numbers matter most.

## Testing

```
npm run test:assistant        # offline: scripted model, fixture catalogue and orders; runs in CI
GEMINI_API_KEY=… ASSISTANT_LIVE_TESTS=1 npm run test:assistant:live   # optional, real model
```

The offline suite (`tests/assistant/`, 101 tests) needs no key, no network and
no database. It covers:

- **Catalogue:** stock states, search by words, colour in four languages,
  size, price and in-stock limits, the keyword fallback keeping firm filters,
  public fields only, injection-like product text staying data, argument
  validation, the read-only tool set.
- **Orchestration:** policy answers, product cards, invented links removed,
  unknown tools, malformed arguments, per-round and per-turn caps, the cache,
  the round limit, empty and cut-off replies, language rewrite and fallback,
  timeout, cancellation, 429, 5xx retry, 4xx, tool and store failures.
- **Orders:** own, someone else's, enumeration, a forged conversation, the
  signed-in account, tracking links, no estimate, unpaid, refunded,
  delivered; no personal data reaches the model.
- **Hand-over and privacy:** summary fallback, redaction, a quality log with
  no text.
- **Surface:** routes (413, 400 cases, unconfigured fallback, no-store),
  feedback validation, credential parsing, the knowledge in four languages
  following the admin's settings, and every widget string present in en, it,
  fr and de with matching placeholders.

The live suite (`tests/assistant-live/`) asks the real model a policy
question in each language, plus a product request, an own order, someone
else's order and a cancellation request. It checks outcomes (answered, right
language, real products, no invented links, no personal data, hand-over),
not wording. It is skipped unless both variables are set, and it is not part
of CI.

Before relying on the concierge in production, run the live suite with the
production model. Then review the `assistant_event` lines over the first
days: fallback reasons, `removedLinks`, `unverifiedAmounts` and the
not-helpful ratings show where the knowledge or the prompt needs work.
