# Admin console: audit and improvement round (2026-10-23)

This round reviewed and improved the existing console. It did not rebuild it.
Each change below is listed with the problem it solves.

## How the console is put together

- **One frame.** Every page sits inside `components/admin/admin-shell.tsx`,
  mounted by `app/admin/layout.tsx`. The login page has no frame.
  - The navigation is grouped by job (`lib/admin-nav.ts`): Продажи, Каталог,
    Покупатели и отзывы, Маркетинг и настройки.
  - It shows a count of what waits beside the relevant section.
  - On phones the navigation is a drawer.
- **Sections.**
  - Some are their own routes: `/admin/orders`, `/admin/returns`,
    `/admin/reconciliation`, `/admin/promocodes`, `/admin/review-requests`,
    `/admin/newsletter`, `/admin/settings`.
  - The rest are views of `/admin` chosen by `?tab=`: `products`,
    `collections`, `inventory`, `customers`, `support`, `productReviews`,
    `reviews`.
  - Both are ordinary links. A section can be reloaded, bookmarked and opened
    in a new tab.
- **"What needs attention".** `GET /api/admin/attention`
  (`lib/server/admin-attention.ts`) counts what waits in the database:
  - orders to ship;
  - orders flagged by the fraud guard;
  - refund cases waiting for staff;
  - support requests waiting for an answer;
  - reviews waiting for moderation;
  - variants out of stock or running low;
  - failed review-request emails.

  A source that cannot be read is `null` and is shown as "нет данных", never
  as 0.
- **Shared pieces:**
  - `AdminPageHeader` (title, description, actions);
  - `ConfirmDialog` (`components/admin/confirm-dialog.tsx`);
  - the toast `error` variant, which is announced and stays 9 seconds.
- **Palette.** `data-admin-shell` switches the theme tokens to neutral greys
  and black (`app/globals.css`), and uses one sans typeface. Status colours
  keep their meaning.

## Findings, ranked, and what was done

### 1. Data integrity and safety

| Finding | Change |
|---|---|
| **Saving a product overwrote live stock.** The product editor wrote every variant's stock back as an absolute number. If the form stayed open while orders came in, saving it put the sold units back on sale and allowed overselling. | Each variant carries `stockBase`, the value the editor showed (`lib/stock-sync.ts`). Untouched cells are not written. A changed cell is written only if the live stock still equals `stockBase` (compare-and-set). Otherwise the answer is 409 `STOCK_CONFLICT` and nothing is saved. Availability (`in_stock` / `out_of_stock`) is derived from the stock as it will be after the save, not from the form. |
| **The stock page had the same problem.** `PATCH /api/admin/inventory` wrote absolute stock, and the one-click "in/out" toggle could set a variant with 5 units to 1. | The page sends `expectedStock`. The server writes only if it still matches, and otherwise answers 409 with the live value. The page reloads. |
| **Choosing an order status saved it immediately.** That emailed the customer at once. Choosing "Отменён" also cancelled the payment and returned the stock, so one mis-click caused irreversible effects. | The status change is staged. The panel says what the change will do and saves on "Сохранить". "Отменён" and "Возвращён" ask once more and say what they do. "Возвращён" does not move money, and the dialog says so. |
| **Two staff members (or a payment webhook) could overwrite each other's status change.** | The save carries `expectedStatus`. The server refuses with 409 if the order moved on. Older callers still work. |
| **The real Stripe refund was one click** once its panel was open. | It now confirms the amount, the card and that the refund is irreversible. |
| **A product was deleted by a single click on a trash icon.** There was no confirmation and no label. | A confirmation explains what happens: removed from the catalogue, past orders keep their details, a stock of 0 is the alternative. Icon buttons are labelled. |
| **Closing the product editor lost all edits.** The backdrop, the X and "Отмена" all closed it without asking. | Unsaved changes are tracked. Closing asks first, Escape included, and so does reloading the tab. The dialog has proper dialog semantics. "Сохранить" is always visible and disabled until something changes. |
| **An empty price saved a product at CHF 0.** An "old price" below the price was silently dropped. | Inline errors appear under the fields. Name and price are required and marked. The server's validation messages are now in Russian, and it limits name, description, image and variant sizes. |
| **Analytics could run in the console.** If staff had once accepted analytics on the shop, GA4 and the Meta Pixel could start in the console with admin addresses (`/admin/orders?order=LV-…`). The cookie banner also covered the order table. | The analytics manager and the banner do nothing under `/admin`. A browser test checks this against a control page. |
| **"Delete order" was offered on paid orders** that the server would refuse. | It is shown only when no money arrived. Otherwise the panel explains that paid orders cannot be deleted. |

### 2. Workflows

- **Navigation.** Orders, returns, promo codes, shipping, newsletter and
  review requests had no navigation, only a "Назад в админ-панель" link.
  Going from an order to the stock of its item took three clicks through the
  dashboard. Now one grouped navigation appears everywhere, with counts.
- **Dashboard.** "Требует внимания" comes first: every count from the
  database, each a link to the right filtered view.
  - "Последние заказы" stays.
  - "Заканчивается на складе" replaces a list of the first five products,
    which answered no question.
  - The revenue figures are unchanged and still come from settled payments
    minus refunds.
- **Orders.**
  - A "К отправке" tab (paid, not yet shipped) is the default.
  - New period filter (7/30/90 days).
  - The filters are in the address, so a reload or a link keeps them.
  - New "Обновить" button.
  - Server error messages are shown instead of a generic "не удалось".
- **Customers.** The order count links to that customer's orders.
- **Products.**
  - Search also matches the address (slug).
  - New filters: category, availability, "требуют заполнения", and a sort.
  - All of them are kept in the address.
  - The product name opens the editor. `?edit=slug` and `?new=1` open it
    directly, which is how the dashboard's "Добавить товар" works.
  - Each row has a link to the product on the site.
- **New products get readable addresses**, for example
  `/product/wool-coat-x7k2` instead of `/product/p-1729684523117`
  (`lib/product-slug.ts`). Existing products keep theirs, because orders and
  reviews point at the slug.

### 3. Consistency

- **Confirmations.** Five copies of a hand-made confirmation modal and five
  `window.confirm()` calls became one `ConfirmDialog`. It has focus handling
  and Escape, and states what will happen.
- **Failure toasts.** They now use the `error` variant: a red edge,
  `role="alert"`, a longer timeout. Success and failure no longer look the
  same.
- **Page headers and spacing.** One page header, one page padding, and one
  `<main>`, provided by the shell. Previously pages nested their own `<main>`.

### 4. UX refinement round (2026-10-24)

A screen-by-screen pass over every page, at 1280px and at 390px, plus the
detail views: the product editor, an open order, a support request, a refund
case, the refund policy and staff pages. No features, settings, routes or API
changes.

| Problem seen | Change |
|---|---|
| **Width classes had no effect in the refund and review-request consoles.** `inputClass` carries `w-full`, and `` `${inputClass} w-auto` `` let `w-full` win in the CSS. Every filter select took a full row: five stacked selects on "Возвраты". Policy number fields and quantity inputs stretched across the page. | The classes are merged with `cn()` (tailwind-merge), so the caller's width applies. Fixed in 8 files and 26 places. |
| **Gold checkboxes and radios** on the promo, review-request and policy pages. `:root` takes `accent-color` from the shop's gold. | The admin token block sets a black `accent-color`. |
| **Pages sat at different widths.** Some were centred at 2xl/4xl/5xl/6xl/1280px and some were full width, so on a wide screen each section jumped. "Доставка" was centred while every other page was left-aligned. | The shell gives one container (`max-w-[1280px]`). Pages keep only a reading width for narrow forms, left-aligned. |
| **The login page was still ivory and gold**, with an English "Private Access" and English password-toggle labels. | It now uses the console palette, a sans heading "Luxe Vault · админ", Russian toggle labels and `role="alert"` on errors. The form fields and "Войти" are unchanged. |
| **"Разделы и категории" was in the old style**: uppercase tracked buttons ("ЗАМЕНИТЬ ФОТО"), square cards and a gold "Новый раздел". | Normal-case buttons, rounded cards, the shared page header and a black primary button. |
| **Headings and tables differed by section.** The refund and review-request consoles had their own heading, grey-gold primary buttons and lowercase table headers. The store reviews page was titled "Отзывы" next to "Отзывы о товарах". | Those pages use `AdminPageHeader`. The refund-console primary button is black. List tables share one header style. The store reviews page is "Отзывы о магазине", as in the menu. |
| **Phone: the search icon overlapped the typed text** in Остатки, Клиенты and Рассылка. The phone field rule replaced `pl-9` because the class had no `px-`. | Those fields declare `px-3 pl-9`. The storefront rule is untouched. |
| **Phone: the product search was squeezed** to about 150px beside the filters. | It takes its own row below 640px. |
| **Refund case header**: the risk badge wrapped into an orphaned right-aligned box. **Field labels** sat inline with their inputs. | The header has two columns that wrap cleanly, and the labels are block-level. |
| Small items | The product editor's field labels are no longer uppercase. "Early fraud warning" on orders is now Russian. An empty support thread says so instead of showing a blank strip. Refund amounts no longer break across lines. The store reviews empty state uses the dashed box the other sections use. |

## Verified

See "Tests run" in `PROJECT_IMPROVEMENT_LOG.md` for the commands and results.

## Not done / recommended next

- **Drafts and unpublished products.** Done on 2026-10-25 (migration 0062,
  `docs/audit/STORE_READINESS_AUDIT.md` S-1): a product is on sale only once
  published from the "Продажа" panel, with the owner's record of the right to
  sell it.
- **Roles for the whole console.** Staff roles (`lib/refunds/permissions.ts`)
  guard refunds and review requests only. Every other section is open to
  anyone with the shared login and second factor. Extending `requireStaff` to
  catalogue, order and settings writes is a policy decision for the owner.
- **The order list loads the newest `ADMIN_ORDERS_LIMIT` orders** and filters
  them in the browser. That is fine at today's volume. Server-side search and
  pagination will be needed as orders grow.
- **The product editor is still one long form.** It now has a sticky footer,
  required markers and inline errors. Splitting it into sections or steps is
  a larger redesign.
