# Motion and navigation

One motion vocabulary for the storefront: how pages hand over to each other,
how a product photo travels into its page, how results change in place, and
how drawers, dialogs and menus arrive and leave. This page is for whoever
adds the next page or component, and for checking the site by hand.

Where things live:

| What | File |
| --- | --- |
| Tokens (durations, curves, distances) | `app/globals.css` → "Motion system" (`--motion-*`, `--ease-*`); mirrored for script in `lib/motion.ts`; Tailwind names in `tailwind.config.ts` (`duration-fast`, `ease-emphasized`, …) |
| Page transitions, shared product photo, results transition | `lib/page-transition.ts` |
| Links that use them | `components/locale-link.tsx` (`Link`, `useLocaleRouter().push`) |
| Fallback page fade (history, slow pages, no API) | `components/page-transition.tsx` + `.page-enter` in `globals.css` |
| Overlays staying mounted through their exit | `lib/use-presence.ts` + the `.motion-*` classes in `globals.css` |
| Unit tests | `tests/store/motion.test.ts` (runs with `npm run test:store`, in CI) |

## Approach and compatibility

**Native View Transitions API, not React's `<ViewTransition>`.** The App
Router renders with the React build Next.js vendors (a 19.2 canary in Next
15.5), which has no `ViewTransition`; `experimental.viewTransition` would move
the whole app to React's experimental channel. The browser API needs nothing
from React: `document.startViewTransition` photographs the page, the router
update runs inside it, and CSS animates between the two pictures. No framework
upgrade, no new dependency, server components untouched.

**Progressive enhancement.** Same-document view transitions are in Chromium
(Chrome/Edge 111+, Android Chrome), Safari 18+ and Firefox 144+. Everywhere
else — and whenever a transition cannot run — the navigation simply happens
and the new page arrives with the short `.page-enter` opacity fade that was
already there. `view-transition-class` (used to style every product photo
group with one rule) is newer than the API itself; where it is missing the
photo still travels, with the default timing.

**What never waits on an animation.**

- A link click calls the router immediately inside the transition's update
  callback. The transition holds the old picture only while the next page
  would be loading anyway (the App Router keeps the old page on screen until
  the new one is ready), and **at most 900 ms**: if the address has not
  changed by then the transition is skipped (no animation of the old page into
  itself) and the page arrives with the fallback fade when it is ready.
- If the API is missing, motion is reduced, the tab is hidden, the target is
  another origin, the address would not change, or anything throws, the
  navigation runs directly. A safety timer navigates even if the browser never
  runs the update.
- Overlays close in state at once; only their unmount waits for the exit.

**What is never intercepted.** `Link` hands over to `pageTransition()` through
next/link's own `onNavigate`, which next/link only calls for a plain,
same-tab, client-side navigation. So Ctrl/Cmd/Shift/middle clicks, `target`
links, downloads and external links behave exactly as before. Full-page
navigations (`window.location` — the card/crypto payment success redirects,
account deletion) and form posts do not go through it at all. A link can opt
out with `data-transition="off"`.

**Back / Forward.** Browser history is deliberately not view-transitioned: on
`popstate` the App Router has usually rendered the restored page before the
browser could photograph the old one, so a transition would be the new page
fading into itself. History navigations keep the `.page-enter` fade and the
router's own scroll restoration.

## Tokens

| Token | Desktop | Phones (≤767px) | Used for |
| --- | --- | --- | --- |
| `--motion-instant` | 120ms | | press feedback |
| `--motion-fast` | 180ms | | small changes; anything leaving; the outgoing page |
| `--motion-base` | 240ms | | popovers, scrims, results in place |
| `--motion-panel` | 320ms | 280ms | drawers and dialogs arriving |
| `--motion-page` | 300ms | 260ms | the incoming page |
| `--motion-shared` | 420ms | 360ms | a product photo travelling card ↔ page |
| `--motion-rise` | 8px | 6px | how far a page or dialog settles |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | | most changes |
| `--ease-emphasized` | `cubic-bezier(0.16, 1, 0.3, 1)` | | arrivals |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | | departures |

Rules: only `opacity` and the individual `translate` / `scale` properties
move (they compose with Tailwind's centring transforms, so a dialog no longer
jumps when its entrance ends); never `transform` on an element that can
contain fixed children; never `transition: all` for new code.

## What moves, and how

| Interaction | Behaviour |
| --- | --- |
| Page → page (any `Link` / `useLocaleRouter().push`) | Old page fades out (`fast`); new page settles in with 8px of rise (`page`, emphasized). Going up the hierarchy (fewer path segments, locale prefix ignored) it settles *down* instead. Header, phone tab bar, support button, cookie banner and toasts are named for the duration and hold still. |
| Product card → product page | The clicked card's photo travels and resizes into the gallery (`shared`); the details column fades in one block after another (30–130ms apart, opacity only). The gallery image gets up to 220ms to decode first. |
| Product page → a listing (by link) | The gallery photo travels back to its card if that card is visible; otherwise it fades with the page. |
| Catalogue filters, chips, sort, clear | Only the results area crossfades and eases to its new height; the controls and the rest of the page change at once. The address still updates (`?inStock=1`, …). Price fields are continuous input and update without a transition. |
| Cart, account and support drawers | Slide in on the emphasized curve, out faster on the exit curve; scrim fades; inert while leaving; Escape, focus return and scroll lock unchanged. |
| Password recovery/reset, cancel-order dialog, chat window | Fade + 8px rise + 0.98 scale in, quicker out. |
| Language/currency, notifications, search suggestions | Drop 4px from the trigger, lift away on close. Outside click, Escape (in the search field Escape closes the suggestions and keeps the text). |
| Product photo zoom | Fades in and out. |
| Header search row | Fades in (it changes the header's height, so it does not slide). |
| Site menu | Its existing slide/drill-down, now on the tokens. |
| Primary buttons (`.btn-primary-lv`, `.btn-secondary-lv`, gold buttons, `.motion-press`) | Scale to 0.98 while pressed. |

Two existing bugs surfaced by the tests and fixed with this work: the
language/currency popover did not close on a click outside it (its
click-catcher sat inside the header, see "Adding to it"), and the first
Escape in the header search cleared the text and reopened the suggestions
instead of closing them.

## Reduced motion

`html[data-motion="reduce"]` is set from the OS setting and from the switch in
the account settings. With it: no view transitions are started (script), any that slip
through have their animations removed (CSS), CSS durations collapse to zero,
overlays unmount immediately (`exitDelay()` returns 0), the product details
do not stagger and buttons do not scale. Nothing is hidden or disabled —
every action works identically.

## Adding to it

- **A new page**: nothing to do. Every `Link` from `components/locale-link`
  transitions to it. Do not import `next/link` directly in storefront code.
- **A new persistent element** (fixed bar, floating button): give it a
  `data-vt-chrome="…"` attribute and a `view-transition-name` rule next to the
  others in `globals.css`, or it will crossfade with the page.
- **A new overlay**: `const presence = usePresence(open)`; render while
  `presence.mounted`; put `data-state={presence.state}`,
  `inert={!open || undefined}` and one of `.motion-scrim`, `.motion-fade`,
  `.motion-drawer-right|left`, `.motion-sheet`, `.motion-dialog`,
  `.motion-popover` on the element. Move focus when `state === 'open'`.
  Inside the header, close on outside click with a document listener: the
  header's `backdrop-filter` makes it the containing block for `fixed`
  children, so a full-screen click-catcher there only covers the header.
- **Results that change in place**: wrap them in `data-vt-results` and make
  the change through `resultsTransition(() => setState(...))` — one per
  discrete action, never per keystroke.
- **Another shared element**: follow the product pattern — a data attribute
  on each side, the name set only for the duration of the transition. Never a
  permanent `view-transition-name` on repeated items: two elements with one
  name abort the whole transition.

## Limitations, and what is still abrupt

- **Back/Forward** use the fade, not a view transition (reason above).
- **Admin console** and the **chat assistant's product links** use their own
  links and are not transitioned; the admin keeps its existing behaviour.
- **Language switch** (`router.replace`) changes the page in place without a
  transition: the content is the same page, re-rendered.
- **Full-page navigations** (payment redirects, account deletion,
  `window.location`) are untouched by design.
- **Slow pages** (more than 900ms to arrive) show the old page until the
  new one is ready, as the App Router always has, then the fade.
- **Rendering cost of the ambient background.** Measured in a GPU-less
  container (software rendering), the full-viewport blurred, multiply-blended
  `.ambient` layers hold the page to about 5–6 frames per second (61 on a blank
  page, 17 with `.ambient` hidden; pausing its animations made no difference).
  On a GPU these layers are composited once and are not expected to matter,
  but it has not been measured on a real mid-range phone here — worth one
  Chrome DevTools performance recording on a mid-range Android before launch.

## Manual test checklist

Run on a production build (`npm run build && npm start`), desktop at ~1280px
and a phone or emulation at 390px, in Chrome and Safari.

1. Catalogue → click a product: the photo travels into the gallery; header,
   tab bar and support button do not move; details settle in.
2. On the product page, click a breadcrumb or "Catalog" link back to the
   listing: the photo returns to its card (if visible).
3. Browser Back and Forward: correct pages, short fade, scroll position
   restored, no flash of the wrong page.
4. Ctrl/Cmd-click and middle-click a product: opens in a new tab, this tab does
   not animate.
5. Click "In stock only", a size, a colour, sort: only the results crossfade;
   the address updates; Back restores the previous filter.
6. Type in a price field: results update without flicker.
7. Open/close the cart (button, scrim, Escape): slides, focus returns to the
   cart button, page scroll locked while open and released after.
8. Same for the account panel and the support drawer; open the chat window.
9. Open the language/currency popover and the notifications: click the page
   outside to close; Escape closes.
10. Header search: open the row, type two letters (suggestions drop in),
    Escape (they lift away), choose a suggestion (navigates with a transition).
11. Product photo zoom: open and close.
12. Checkout: go from cart to checkout and complete a test payment — the
    redirect to the payment provider and back to the success page is an
    ordinary full-page navigation.
13. Turn on "Reduce motion" (OS, or the switch in the account settings): everything still works,
    nothing animates, drawers close instantly.
14. Throttle the network to "Slow 3G": clicking a product never freezes the
    screen for more than about a second; the page arrives with the fade.
15. Phone at 390px: no sideways scroll during any transition; the tab bar
    holds still.
16. DevTools console: no errors or hydration warnings during all of the above.
