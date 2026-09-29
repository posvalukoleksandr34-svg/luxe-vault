# Chat concierge (AI support assistant)

The floating chat (bottom left) answers customers with a language model that
reads the shop's own policies and the customer's own orders, and hands over to
a person when it cannot help. Without a model it falls back to the help
centre's prepared answers, the bot this used to be.

## How a message flows

```
Browser (components/support/chat-bot.tsx)
  │  POST /api/support/assistant
  │  { locale, messages: last 12 turns, orders: this browser's {id, token} }
  ▼
Route (app/api/support/assistant/route.ts)
  │  rate limit 'support.assistant' (40 / 10 min / IP), validation, caps
  ▼
answer() (lib/server/assistant/chat.ts)
  │  system prompt = concierge rules (prompt.ts)
  │                + the whole knowledge base in the visitor's language (knowledge.ts)
  │  Gemini generateContent with three tools ──┐
  │                                            │  get_order_status(order_number)
  │   up to 3 rounds of tool calls ◄───────────┤  list_my_orders()
  │                                            │  offer_human_support(category, summary)
  ▼                                            │
{ mode: 'ai', reply, handoff? }                └─ orders.ts: ONLY the requester's orders
{ mode: 'fallback' }  ← no key, timeout (15 s), blocked or empty answer
```

## Files

| File | What it does |
| --- | --- |
| `lib/server/assistant/knowledge.ts` | The knowledge base: shop facts, every help-centre answer with live figures (delivery window, fees, return window), the returns policy. |
| `lib/server/assistant/prompt.ts` | The concierge's system prompt: tone, language, "knowledge and tools only", hand-over rules, safety. |
| `lib/server/assistant/orders.ts` | Which orders the concierge may see, and what it is told about them. |
| `lib/server/assistant/chat.ts` | The Gemini call, the tool loop, the fallback. |
| `app/api/support/assistant/route.ts` | `GET` → is the concierge on; `POST` → one reply. |
| `components/support/chat-bot.tsx` | The widget: AI replies, order-number collection, typing indicator, hand-over. |

## Configuration

| Variable | Meaning |
| --- | --- |
| `GEMINI_API_KEY` | Already set for smart search and the stylist. Without it the chat runs on prepared answers. |
| `GEMINI_MODEL` | Optional; shared with the other AI features. |
| `SUPPORT_ASSISTANT_AI=off` | Turns the concierge off without touching the key (search and stylist keep working). |
| `GEMINI_BASE_URL` | Optional; route Gemini calls through a gateway or proxy. |

## Knowledge: why the whole base, not a vector search

Retrieval (RAG) exists to pick the few relevant passages out of a corpus too
large to send with every question. This shop's corpus is small: 17 help-centre
answers and the returns policy. The whole system prompt, rules included, is
about 11,600 characters (roughly 3k tokens) per language. Sending all of it is strictly better at this size: no relevant
passage can be missed by a bad match, and there is no index to keep in step
with the text. The figures are filled in from the live settings on every
request, so an answer can never quote an old fee or delivery window.

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

## Orders: function calling and privacy

The concierge never answers an order question from memory: the prompt requires
the tools. `get_order_status` and `list_my_orders` see only:

- orders bound to the **signed-in account** (from the verified Supabase session), and
- orders this **browser holds a lookup token for** (`lib/order-registry.ts`),

which is the same rule as `/api/orders/lookup`. For any other number the tool
answers `not_visible`, never whether the order exists, so the chat cannot be
used to enumerate orders. The model receives status, dates, items by name,
total, tracking and the return window. It never receives the customer's name,
address, phone or email.

For Shopify or another backend, replace `requesterOrders()` in `orders.ts`
with a call to that API, keeping the same ownership rule: never resolve an
order from its number alone.

## The widget

- **Order topics collect before asking.** "Where is my order?" and "Returns"
  ask for the number, offer the customer's own orders as one-tap chips, check
  the format locally ("12" is caught without a model call), then send the full
  question. The customer sees just the number they gave.
- **Other topics** keep their prepared questions, answered instantly and exactly.
- **Typing indicator**: three gold dots while the model works, and a short beat
  before instant answers. Still dots under reduced motion.
- **Hand-over**: when the model calls `offer_human_support`, its reply carries
  a "Write to the team" button that opens the request form with the category,
  the order and the customer's request already filled in.
- **Honesty**: the header says "AI assistant" and the first screen notes that
  answers are generated and may contain mistakes.

## Testing

`scratchpad` harnesses (not committed) exercised it against a scripted Gemini
stand-in (`GEMINI_BASE_URL`):

- answers in the page language with the full knowledge base;
- own guest order visible with its token, and invisible without it;
- another customer's order invisible, even with a guessed token;
- signed-in account orders visible, and invisible when signed out;
- no personal data in any request to the model;
- hand-over carries its category and summary into the form;
- timeout, blocked or empty answers fall back to prepared answers;
- history capped at 12 turns × 1000 characters;
- the widget works on a phone, including typing, collecting the number, the
  typing dots and the hand-over.

Before relying on it in production, review a sample of real conversations
(questions the knowledge does not cover are the ones to add to the help centre).
