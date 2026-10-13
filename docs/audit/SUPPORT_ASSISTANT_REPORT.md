# Support assistant upgrade — report (2026-10-13)

The chat concierge (`components/support/chat-bot.tsx`, `lib/server/assistant/`)
was audited and upgraded in place. The architecture is kept: a stateless
route, Gemini function calling, and the help centre as the fallback. Visual
identity and the support centre are unchanged. Every result below was produced
in this session; nothing is estimated. Anything not verified says so.
How it works now is described in [`docs/support-assistant.md`](../support-assistant.md).

## 1. Capabilities added or improved

| Area | Before | Now |
| --- | --- | --- |
| Catalogue | none: product questions could only be answered from the help centre | `search_products`, `get_product`, `compare_products` over the real catalogue. They use the storefront's own search rules, filter by price, size, colour (four languages), category and in-stock, report honest stock (`in_stock` / `sold_out` / `not_tracked`, per size and colour), return canonical localized URLs, and send no SKUs or exact counts |
| Product cards | none | linked products become cards built from the catalogue (price, previous price, image, stock), never from the model's text |
| Product page | none | the page's product id is sent; the server looks it up and gives the model its summary; "About this piece" chip |
| Orders | `get_order_status`, `list_my_orders` | same tools, stricter: credentials shape-checked and capped, orders read once per turn, `paymentConfirmed` only from the payment record, refunds reported |
| Orchestration | 3 rounds, no validation, no caps, 15 s timeout | every argument validated server-side; ≤ 4 rounds, ≤ 4 calls per round, ≤ 8 per turn; identical calls cached; results capped; one 20 s budget for the whole turn; one retry only on a provider 5xx; typed fallback reasons |
| Output | model text shown as is | language checked (one rewrite), product and external links grounded against the catalogue and tool results, Markdown flattened, length bounded, unverified CHF amounts counted |
| Input | messages sent as typed | card numbers, IBANs, emails and phone numbers removed before the model provider sees them; body ≤ 64 KB |
| Model | `gemini-3.6-flash` (retiring 2026-11-19 on Google Cloud) | `gemini-3.8-flash` (stable), `thinkingLevel: LOW`; `GEMINI_MODEL` still overrides |
| Prompt | order and policy rules | rewritten for the six tools that exist: evidence-only answers, stock wording, payment confirmation, privacy-safe "not visible", hand-over triggers, injection handling, never claiming an action it cannot take |
| Widget | any failure switched to prepared answers for the rest of the visit; conversation lost on every open; plain-text links; no Escape or focus handling | Retry; the AI stays on after a one-off failure; cancellation on close; "still checking" after 7 s; conversation kept for the tab (2 h, disclosed); "New conversation"; clickable checked links; product cards; Escape and focus return; safe-area padding |
| Hand-over | form pre-filled when the model asked for it; the question was lost when the AI failed | category, first-person summary and order number pre-filled and editable; the customer's question is carried over in every failure path |
| Quality signals | none | one `assistant_event` log line per turn (counts, timings, tools, fallback reason) and per rating; no text, no identifiers |
| Tests | none in the repository | 92 offline tests in CI (`npm run test:assistant`), an optional live-model suite, and end-to-end and browser runs (below) |

## 2. Files changed

New:

- `lib/server/assistant/catalog.ts`, `tools.ts`, `guard.ts`, `metrics.ts`
- `app/api/support/assistant/feedback/route.ts`
- `tests/assistant/fixtures.ts`, `catalog-tools.test.ts`, `guard.test.ts`, `chat.test.ts`, `surface.test.ts`
- `tests/assistant-live/live.test.ts`
- `docs/audit/SUPPORT_ASSISTANT_REPORT.md` (this file)

Modified:

- `lib/server/assistant/chat.ts` (rewritten), `prompt.ts` (rewritten), `orders.ts`
- `app/api/support/assistant/route.ts`
- `components/support/chat-bot.tsx` (rewritten), `components/support-widget.tsx` (focus target)
- `lib/server/http.ts` (`readJsonObjectLimited`), `lib/server/rate-limit.ts` (`support.feedback`)
- `lib/stylist/tagging.ts` (colour names in Italian, French, German)
- `lib/ui-strings.ts` (16 new chat strings in all five languages, wording fixes, the chat privacy note)
- `app/legal/_content/cookies.ts` (`lv.concierge`), `app/legal/_content/privacy.ts` (what the chat sends)
- `package.json` (`test:assistant`, `test:assistant:live`), `.github/workflows/ci.yml` (offline suite in CI)
- `docs/support-assistant.md` (rewritten)

## 3. Security and correctness bugs fixed

| # | Defect | Effect | Fix |
| --- | --- | --- | --- |
| S1 | Tool calls ran unvalidated, with no cap on calls per turn | a confused or manipulated model could loop through tools until the timeout | `validateCall` for every call; per-round, per-turn and round caps; cache |
| S2 | No request-size limit on the assistant route | large bodies parsed before any check, on an endpoint that pays for a model call | stream-read with a 64 KB cap → 413 |
| S3 | Order credentials passed through unchecked | malformed or oversized values reached the database query | order number normalised, token shape-checked, pairs de-duplicated, ≤ 50 |
| S4 | Customer messages sent to the provider verbatim | card numbers, IBANs, emails and phones typed into the chat were copied to a third party | redaction before sending |
| S5 | Model links shown unchecked | an invented product page or an external URL could be presented as the shop's | links grounded against the catalogue and tool results; others removed |
| S6 | A closed widget left the model call running | wasted budget, and replies to nobody | client abort → `request.signal` → model call aborted (verified end to end) |
| S7 | Payment confirmation not distinguished | the model could read `paymentStatus` loosely | `paymentConfirmed` only for `paid`, `partially_refunded` or `refunded` records, with a prompt rule |
| S8 | A price given as text was stripped to its digits (found in the pre-PR review) | "300,50" became 30 050 and "1.290,00" became 1.29, so a search could exceed the customer's budget | only unambiguous numbers are accepted ("CHF 1'290", "300"); anything else is an error the model can recover from |
| C1 | Italian, French and German colour names (Nero, Bianco, Blanc, Schwarz…) mapped to no colour family | "black jacket" could not find a product whose colour is "Nero": a storefront-wide search, stylist and concierge defect | `COLOR_PATTERNS` extended, short words bounded (`Carrot` is not red) |
| C2 | The concierge's keyword fallback dropped colour, category and brand (found by the integration run) | "white coat" returned the black coat | the fallback re-applies every firm filter |
| C3 | CHF amount reader | "CHF 14.9" read as 149; "CHF 14.90 2 days" as 14 902 | stricter number grammar |
| C4 | Phone redaction | tracking numbers and long references were redacted as phone numbers | phones must start with `+` or `0` |
| C5 | Any single failure switched the widget to prepared answers for the rest of the visit | one timeout disabled the concierge | only `unconfigured` does; other failures are per question, with Retry |
| C6 | The hand-over lost the question when the AI failed | the customer had to retype it | the question is carried into the form in every path |
| C7 | Untracked stock was shown as "Made to order" | inaccurate: the shop sources items, it doesn't make them | "Available to order" (it: Ordinabile, fr: Disponible à la commande, de: Bestellbar) |
| C8 | Italian chat strings switched to "tu"; a German closing quote was wrong | inconsistent formal voice | fixed |
| C9 | Per-size availability omitted a colour with no stock row (found in the pre-PR review) | the product page and `place_order()` treat that combination as none, but the model saw nothing and could guess | every colour is listed for every size, missing rows as unavailable |
| C10 | An order-store failure returned an empty list (pre-existing, found in the pre-PR review) | the concierge would tell customers their own order was not visible "for privacy" while the database was down | a failed lookup now reports "cannot check right now"; it never shows more than before |

Unchanged: the route's rate limit (40 per 10 min per IP; not re-tested
here). Kept and re-verified by the tests below: orders are visible only by
session or browser token, never by number; `not_visible` doesn't say whether
the order exists; no name, address, phone, email or token is sent to the
model.

### Pre-PR review of the complete diff

Before the pull request, the whole diff against `main` was read again for
five kinds of regression:

- **Authorization:** unchanged rule (session `userId` plus the browser's
  tokens, token compared in constant time). The only changes make it
  stricter: shape-checked credentials, and fail-closed lookups (C10).
  Nothing in the conversation is read as authority.
- **Availability:** `stockState` matches the storefront's `isProductBuyable`.
  The per-size rule and the low-stock threshold match the product page. One
  gap was fixed (C9).
- **Privacy:** the only log statements are tool and provider error messages
  and the counts-only `assistant_event` line. Tokens never enter a query (the
  comparison is in code), and the model never receives customer contact
  fields.
- **Model tool calls:** six tools, five of them pure reads. Every one was
  checked, down to the database: the order reads are `select`s, the catalogue
  read is a `select`, and the `search_products` SQL function is `stable`.
  `offer_human_support` writes nothing. One parsing bug was fixed (S8).
- **Order handling:** `get_order_status` and `list_my_orders` keep the same
  visibility rule and the same `not_visible` answer. The order store's own
  functions are not modified.

## 4. Catalogue tools and the fields they support

| Tool | Input fields | Output fields |
| --- | --- | --- |
| `search_products` | `query`, `category`, `color`, `size`, `max_price_chf`, `min_price_chf`, `in_stock_only`, `limit` (1–6) | `results[]`: `id`, `name`, `brand`, `category`, `price`, `priceChf`, `previousPrice`, `colors`, `sizes`, `stock`, `orderable`, `requestedSize {size, state}`, `url`; `totalMatches`; `loosened` + note |
| `get_product` | `product_id` (slug or product URL) | the above plus `description` (≤ 600 chars), `specs`, `deliveryDays`, `hasSizeGuide`, `isNew`, `limitedEdition`, `availability[] {size, colors[] {color, available, fewLeft}}` |
| `compare_products` | `product_ids` (2–3) | `products[]` (detail), `notFound` |

Firm (never loosened) filters: price, size, in-stock, colour, category, brand.
They apply in the attribute search and in the keyword fallback alike.

## 5. Order behaviours tested

Offline (`tests/assistant/chat.test.ts`, `surface.test.ts`) and end to end
against Postgres/PostgREST with seeded orders carrying personal data
(`assistant-e2e`, below):

- own order via the browser's token → status, estimate, `paymentConfirmed`;
- another customer's number → `not_visible`, nothing of theirs sent;
- a guessed token → `not_visible`;
- a forged conversation claiming ownership → `not_visible`;
- several guessed numbers in one turn → all `not_visible`, orders read once;
- the order's own token → shipped, carrier tracking link (kept in the reply;
  an invented tracking URL is removed);
- `list_my_orders` → only the requester's, with count;
- the signed-in account: `userId` from the session, not the conversation;
- no estimate and no tracking → none reported; unpaid → `paymentConfirmed: false`;
- refunded and delivered orders → refund amount, delivery date, return window;
- an order store failure → "cannot check right now", no error text shown;
- no name, address, phone, email or token in any request to the model, or in
  the server log.

## 6. Streaming

**Not implemented, on purpose.** Each reply is checked after generation
(language, links against the catalogue, cards, length), so tokens shown as
they arrive could later be withdrawn. Streaming would also have to pass
through the edge proxy and Vercel intact. Replies are one to four sentences,
and the widget shows typing dots, then "still checking" after 7 s, and can be
cancelled. Streaming can be added later by buffering until the check passes.
Nothing about streaming was verified because nothing was built.

## 7. Results

### Static checks and unit tests (final working tree)

| Check | Command | Result |
| --- | --- | --- |
| Assistant suite (offline) | `npm run test:assistant` | **92 / 92 pass** |
| Unit and security suite | `npm run test:security` | **133 / 133 pass** |
| Live-model suite | `GEMINI_API_KEY=… ASSISTANT_LIVE_TESTS=1 npm run test:assistant:live` | **skipped**: no key in this environment; without both variables the suite reports itself as skipped |
| Typecheck | `npm run typecheck` | pass, 0 errors |
| Lint | `npx next lint` | no warnings or errors |
| Production build | `npx next build` (as in CI) | exit 0 |
| Client bundle | `scripts/ci/check-client-bundle.sh` | clean (36 server-only names, 5 secret shapes, 234 files) |
| Secret scan | gitleaks 8.28.0: `gitleaks git` over the branch's commits, and `gitleaks dir` over every tracked file | no leaks (branch commits; full history, as CI runs it; tracked tree) |

### CI-equivalent run from a fresh clone

A fresh clone of the branch at its final commit ran the steps of CI's
"Typecheck, lint, unit tests, build" job, in CI's order and with CI's
placeholder environment: `npm ci`, `npx next typegen`, `npm run typecheck`,
`npx next lint`, `npm run test:security` (133/133), `npm run test:assistant`
(92/92), `tests/backup/run.sh` (0 failed), `npx next build`, and
`scripts/ci/check-client-bundle.sh`. **All passed.** The other CI jobs read
nothing this change touches (no lockfile, migration or CI script changes) and
are green on `main` at `b85cb15`.

### End to end (production build, Postgres 16 + PostgREST, scripted Gemini)

| Suite | Result |
| --- | --- |
| `assistant-e2e` — API: model and tools offered, catalogue search on the real DB (Italian colour, price limit, product URL, every size and colour in the availability), link grounding, product context, every order case above, hand-over, loop caps, language rewrite and fallback, 503 retry, 5xx, 429, blocked reply, 20 s timeout, client abort, the order store down (PostgREST stopped) → "cannot check now", 413, 400, feedback, the log holding counts only | **45 / 45** |
| `chat-ui` — browser (Chromium), Italian: focus on open, product answer with card and same-site link, order token sent but never stored, feedback, `sessionStorage` persistence (cards included) and its 2 h expiry, tampered stored cards (`javascript:`, `//host`, absolute, malformed) dropped on restore, Escape and focus return, card → product page with the chat open → "About this piece" with the page as context, "New conversation", network failure → Retry, model failure → help-centre answer with the AI still on, hand-over form pre-filled and editable, axe WCAG 2.2 AA on the open chat (0 violations), 390 px without overflow, the privacy and cookie policy wording as published pages render it (en, it), no page errors | **32 / 32** |

### Regression (all earlier suites, final build)

Run with the earlier rounds' runner on the production build of the final
code (the pre-PR review fixes included).

| Suite (mode) | Result |
| --- | --- |
| audit-suite (integration) | 45 / 45 |
| audit-suite2 (integration) | 31 / 31 |
| audit-suite3 (integration) | 19 / 19 |
| payments-suite (integration) | 33 / 33 |
| integration (integration) | 24 / 24 |
| fraud-suite (integration) | 35 / 35 |
| noref-suite (integration) | 20 / 20 |
| security-suite (fixtures) | 47 / 47 |
| price-suite (fixtures) | 17 / 17 |
| hydration-404 (fixtures) | 29 / 29 |
| finder-ui (fixtures, browser) | 106 / 106 |
| noref-ui (fixtures, browser) | 13 / 13 on a re-run; **11 / 13 on the first run**, see below |
| status matrix | 11 × 404 and 9 × 200 for browser and Googlebot, as before |
| robots | `noindex, nofollow` on order, admin login, checkout, account |

**419 / 419** checks across the 12 suites, after one harness fix:

- **What failed:** on the first run, `noref-ui`'s two admin checks failed.
  The browser stayed on `/admin/login`, and the server logged no login
  attempt at all.
- **Cause:** the login page shows its one-time-code field only after
  `GET /api/admin/login` reports that MFA is on. The test looked for the
  field immediately after typing the password. When that request was slower,
  the field wasn't there yet, the code was never typed, and the form's
  `required` attribute blocked the submit.
- **Fix:** the test now waits for the field. It is a test race: the admin
  login is not touched by this change.
- **Result:** the re-run, in the same fixture mode, passed 13/13.

`assistant-e2e`, `chat-ui` and the regression suites are this audit's own
harness (fake Gemini, integration database, edge proxy, Playwright). They live
outside the repository, as in earlier audits, so they **cannot be run from the
repository**. What the repository runs, locally and in CI, is the commands in
the first table.

## 8. Failed or skipped tests

- **Skipped:** the live-model suite (8 tests in 1 suite): no API key here, by design.
- **Failed during the work, then fixed:**
  - two catalogue tests (price format; colour names, which is defect C1);
  - one guard test (defect C4);
  - one orchestration test (a test bug: a category that doesn't exist);
  - five end-to-end checks on the first run: three were harness artefacts
    (JSON echo replies tripping the language check; a log read by byte
    offset as characters); one was defect C2; one was the test proxy not
    forwarding a client disconnect, fixed in the harness. Cancellation itself
    was verified directly against the origin;
  - the first browser run (the launcher is not on product pages; the test now
    follows the real path from the home page).
- **During the pre-PR checks:** the container restarted and Postgres had to
  be started again (environment); the e2e run's first attempt killed its own
  shell (`pkill -f` matched the launching command; now `pkill -x`). Neither
  was a product failure; both runs were repeated in full.
- **Regression re-run on the final build:** `noref-ui` 11/13 on the first
  run. This was a test race on the admin MFA field (section 7); after the
  harness fix the re-run passed 13/13.
- **Failed at the end:** none.

## 9. Remaining limitations and external configuration

1. **The live model is unverified.** No `GEMINI_API_KEY` was available, so
   `gemini-3.8-flash`, its function calling with these six tools, and the
   wording of real answers were not checked against the API. The choice rests
   on Google's documentation (sources below). Run `GEMINI_API_KEY=…
   ASSISTANT_LIVE_TESTS=1 npm run test:assistant:live` in staging.
2. **`GEMINI_MODEL` is shared.** If it is set in the hosting environment, it
   overrides the new default for the concierge too. Smart search, the stylist
   and translation still default to `gemini-3.6-flash`, which retires on
   2026-11-19 on Google Cloud. They need the same change.
3. **No launcher on product pages** (an existing layout decision: the phone
   buy bar). Product context applies when the chat is opened from a card or
   carried over from another page.
4. **Language detection is a heuristic** (frequent words). Replies shorter than
   four words or mixed text are not judged. Spanish is recognised as
   "not ours".
5. **Unverified amounts are counted, not removed.** A wrong price in prose is
   logged, not blocked. Cards always carry the catalogue's price.
6. **Quality signals are log lines.** There is no dashboard, and retention is
   the hosting plan's log retention. Feedback is not linked to transcripts
   (by design), so it shows *how often*, not *why*.
7. **Legal texts.** The cookie and privacy policies were updated in Russian,
   English and Italian, the languages they exist in. French and German
   readers see the English version, as before. The "effective" dates were
   not changed: that is the owner's decision when publishing.
8. **The end-to-end harness is not in CI.** CI runs the 92 offline tests; the
   API and browser runs above were done here.
9. **Not deployed.** Nothing was deployed or pushed to production.

## 10. Ready for staging?

**Yes, for staging, with the live-model suite as the first step there.**
The code builds; every offline, end-to-end, browser and regression suite
above passed on this tree; and no secret, personal data or credential reaches
the model, the log or browser storage in any tested path. It is **not**
verified against the real Gemini API. Production readiness depends on:

- the live suite passing in staging with the production key and model;
- a review of the first days of `assistant_event` lines;
- the owner's sign-off on the policy text changes.

## Sources for the model decision

- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/changelog
- https://ai.google.dev/gemini-api/docs/deprecations
- https://ai.google.dev/gemini-api/docs/generate-content/thinking
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-6-flash
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash
