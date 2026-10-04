import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { StoreProvider } from '@/lib/store';
import { readTaxonomyLists } from '@/lib/server/catalog-store';
import { getShippingSettings } from '@/lib/server/store-settings';
import { AmbientBackground } from '@/components/ambient-background';
import { AnalyticsManagerLazy, AudioFeedbackLazy, CookieConsentLazy, SiteRibbonsLazy } from '@/components/deferred-ui';
import { PageTransition } from '@/components/page-transition';
import { PointerAtmosphereLazy } from '@/components/pointer-atmosphere-lazy';
import { GlobalPanels } from '@/components/global-panels';
import { ToastViewport } from '@/components/toast-viewport';
import { UiEnvironment } from '@/components/ui-environment';
import { SkipLink } from '@/components/skip-link';
import { AppWelcome } from '@/components/app-welcome';
import { BottomNav } from '@/components/bottom-nav';
import { ServiceWorkerRegister } from '@/components/service-worker-register';
import { DEFAULT_LOCALE } from '@/lib/i18n';
import { SITE_ORIGIN, siteJsonLd } from '@/lib/seo';
import { MOTION_BOOT_SCRIPT } from '@/lib/motion-boot';
import { SUPPORT_EMAIL } from '@/lib/data';
import { serializeJsonLd } from '@/lib/json-ld'

// Inter carries the small, spaced-out uppercase editorial subtext; Bodoni
// Moda is the heavy, high-contrast display serif used for every headline —
// the same family of cut that gives fashion-house wordmarks (Vogue, YSL,
// Gucci editorial spreads) their commanding weight.
//
// Both are self-hosted: the files live in public/fonts and are declared in
// app/globals.css, which also sets the --font-inter / --font-display
// variables Tailwind reads. They used to come from next/font/google, which
// downloads them from Google during `next build` — on Vercel that request
// timed out (ETIMEDOUT) and failed the deploy. They are the same files
// next/font was serving, so nothing renders differently.
//
// Preloaded, as next/font did: the latin file of each family. The hero
// wordmark (Bodoni) is the LCP element and Inter sets the body copy; every
// other subset downloads only when a page uses its characters.
const FONT_PRELOADS = ['/fonts/bodoni-moda-latin.woff2', '/fonts/inter-latin.woff2'];

// The canonical production origin. Used to build absolute URLs for canonical
// links and Open Graph / Twitter preview images (og:image must be absolute
// for Telegram, WhatsApp, etc. to render the preview card).
//
// Must match NEXT_PUBLIC_SITE_URL and the Supabase Site URL exactly — a
// mismatch produces canonical tags pointing at a domain that redirects, and
// auth links that land on the wrong origin.
const SITE_URL = SITE_ORIGIN;
const SITE_NAME = 'LUXE VAULT';
const SITE_TITLE = 'LUXE VAULT — Premium Apparel & Luxury Fashion';

// The meta description is the single most public claim the site makes — it is
// what appears verbatim in Google results and in every link preview.
//
// It deliberately does NOT say "authenticity guaranteed" or "designer items".
// Both would assert that the goods are genuine branded product, which flatly
// contradicts the Terms of Use ("Мы продаём премиальные реплики, а не
// оригинальную продукцию брендов"), the replica badge on every product card,
// and the disclosure in every product modal. A store whose search snippet
// promises authenticity while its own terms deny it is not merely inconsistent
// — that gap is what a consumer-protection complaint or a payment-processor
// review is built on.
//
// "Designer-inspired" is the honest phrasing that keeps the premium register.
const SITE_DESCRIPTION =
  'Discover exclusive premium replicas — designer-inspired apparel, footwear and accessories. Meticulous craftsmanship, limited drops, shipped from Switzerland.';

// Shorter variant for link previews, where Telegram/WhatsApp truncate hard.
const SITE_DESCRIPTION_SHORT =
  'Discover exclusive premium replicas — designer-inspired apparel, footwear and accessories from Luxe Vault.';

/**
 * Who publishes the site, as structured data: the seller, the brand and the
 * WebSite, as one @id-linked graph. Once, in the root layout, so every page
 * carries it; product and category pages add their own graphs on top and
 * reference these @ids rather than repeating them.
 *
 * Built in lib/seo.ts — see the note there on what is deliberately left out.
 */
const SITE_JSON_LD = siteJsonLd(SITE_DESCRIPTION);

/**
 * Without this the layout's taxonomy read makes every page fully static and
 * bakes the navigation into the build — an admin adding a collection would
 * not see it until the next deploy, which is exactly what moving the
 * catalogue into Postgres was meant to end. Verified: `/` was emitted as ○
 * (static) before this line, and ISR after it.
 *
 * A route's revalidate is the LOWEST of its segments', so this 60 s is also
 * the staleness ceiling for every page beneath: a listing page's products and
 * stock badges, a product page's stock. That is the window the storefront
 * has always had; the pages that set 600 get 60 through this.
 */
export const revalidate = 60

/**
 * The viewport and the browser chrome's colour. Next 15 reads these from this
 * export only — set inside `metadata` they are ignored (with a build warning),
 * and the page silently falls back to Next's default viewport.
 */
export const viewport: Viewport = {
  /**
   * Zoom is disabled, for the app-like feel: no pinch, no double-tap scale.
   *
   * Two things to know about it:
   *  - iOS Safari has deliberately IGNORED user-scalable/maximum-scale in the
   *    browser since iOS 10, on accessibility grounds. It is honoured in a
   *    home-screen (standalone) launch. The touch-action rule in globals.css
   *    is what enforces the same policy in Chrome, Edge and Android.
   *  - It stops anyone magnifying the page, so small type and the checkout's
   *    figures cannot be enlarged. Removing `maximumScale` and `userScalable`
   *    is all it takes to hand zoom back.
   */
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // The browser chrome on mobile in the storefront's background colour.
  themeColor: '#FAF8F5',
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),

  title: {
    default: SITE_TITLE,
    // Individual sections can override this via their own generateMetadata
    // in the future (e.g. app/product/[id]/page.tsx) — %s is replaced by
    // that page's own title, keeping the "— LUXE VAULT" suffix consistent
    // everywhere.
    template: '%s — LUXE VAULT',
  },
  description: SITE_DESCRIPTION,
  // Ignored by Google since 2009; kept because a few smaller engines and
  // internal search tools still read it. English, to match the description.
  keywords: [
    'LUXE VAULT',
    'premium replicas',
    'designer-inspired apparel',
    'replica sneakers',
    'limited collections',
    'luxury fashion online',
  ],
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,

  // No canonical here. Set in the root layout it was inherited by every page
  // that did not set its own — checkout, the account, shared capsules — so
  // those declared themselves duplicates of the homepage. Each indexable page
  // now declares its own; the homepage's is in app/page.tsx.

  // Открытая разметка (OpenGraph) — именно она формирует красивую
  // превью-карточку со ссылкой в Telegram, WhatsApp, iMessage и других
  // мессенджерах: заголовок, описание, картинка и тип контента.
  // og:image подхватывается автоматически из файла app/opengraph-image.tsx
  // (файловая конвенция Next.js), поэтому его не нужно перечислять здесь
  // вручную — Next добавит правильный <meta property="og:image"> сам.
  openGraph: {
    type: 'website',
    // No `url` here. This object is inherited by every page that does not
    // declare its own openGraph (/stylist, the legal pages, …), and a
    // site-wide og:url told Facebook, WhatsApp and Telegram that each of those
    // pages WAS the homepage. Pages that need one (products, categories) set
    // their own; without one, scrapers use the shared URL — which is correct.
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION_SHORT,
    // Matches <html lang> below, which is the storefront's default language.
    // Misreporting it here would tell a crawler the document is in a language
    // it is not — the bug this pair used to have while the site defaulted to
    // Russian and declared English.
    locale: 'en_US',
    alternateLocale: ['it_IT', 'fr_FR', 'de_DE'],
  },

  // Twitter Card — часть мессенджеров и соцсетей (в т.ч. X/Twitter) читают
  // именно эти теги, если специфичных og-тегов недостаточно.
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION_SHORT,
    creator: '@luxevault_orders',
  },

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
    },
  },

  category: 'shopping',

  // iOS otherwise turns sizes, prices and article numbers that look like
  // phone numbers into tel: links.
  formatDetection: { telephone: false, email: false, address: false },
  // "Add to Home Screen" on iOS: the name under the icon (apple-icon.png is
  // linked by Next's file convention) and a black status bar, not white.
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: 'black' },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Collections and categories — the navigation, labels and filters every
  // page draws on its first frame. NOT the products: the layout used to read
  // the whole catalogue here, which serialised every product into every page
  // and every link prefetch (~5 KB per product, on the terms page too).
  // Listing pages read their own products now; see ListingProvider.
  //
  // A failure leaves the built-in taxonomy (lib/data.ts) in place rather than
  // taking down every page in the app.
  let initialTaxonomy
  try {
    initialTaxonomy = await readTaxonomyLists()
  } catch (error) {
    console.error('[layout] taxonomy unavailable for SSR:', error)
  }
  // The admin's shipping fee, threshold and delivery window, for the cart,
  // checkout, product pages and footer. Never throws: it falls back to
  // config/shipping.ts when the database cannot be read.
  const shipping = await getShippingSettings()
  return (
    // The storefront's default language. The document is server-rendered
    // before anyone's stored choice is known, so this is what a crawler and a
    // screen reader get; the client updates nothing, because every language
    // the switcher offers is written in the same Latin script.
    <html lang={DEFAULT_LOCALE} suppressHydrationWarning>
      <head>
        {/* Before first paint: a visitor who chose "reduce animations" must
            not see a single frame of the entrance animations. See
            lib/motion-boot.ts. */}
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT_SCRIPT }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(SITE_JSON_LD) }}
        />
        {FONT_PRELOADS.map((href) => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="" />
        ))}
      </head>
      <body className="font-sans">
        {/* The motion preference and the on-screen-keyboard flag, mirrored
            onto <html> for the CSS. Stateless, renders nothing. */}
        <UiEnvironment />
        {/* Outside StoreProvider on purpose: it is decorative, has no state,
            and sits at z-index -1 so it never participates in the app's own
            stacking or event handling. */}
        <AmbientBackground />

        {/* The ribbon glow, behind every storefront page: above the smoke,
            below the cursor light and all content. Outside StoreProvider for
            the same reasons as the layers around it. */}
        <SiteRibbonsLazy />

        {/* Rendered AFTER the ambient layer and at the same negative z-index,
            so the cursor light pools on top of the drifting smoke rather than
            under it. Also outside StoreProvider: decorative, stateless, and
            it must never re-render when the cart does. */}
        <PointerAtmosphereLazy />

        {/* UI sound, delegated from the document — one listener set for the
            whole app rather than handlers on every control. Outside
            StoreProvider: it reads no store state and must not re-render when
            the cart does. Loaded after hydration (components/deferred-ui.tsx). */}
        <AudioFeedbackLazy />

        {/* GA4 and the Meta Pixel, each only with its consent category and
            only once the browser is idle. Stateless; outside StoreProvider. */}
        <AnalyticsManagerLazy />
        {/* PWA: static-asset cache, offline page, installability (public/sw.js). */}
        <ServiceWorkerRegister />

        {/* Skip link. The header carries a logo, five nav items, a search box,
            a language menu and four icon buttons, so a keyboard or screen
            reader user previously had to tab through all of it on every page
            before reaching the content.

            Visually hidden until focused — `sr-only focus:not-sr-only` — so it
            costs sighted visitors nothing and appears the moment it is
            reachable. Rendered before everything else so it is the first stop
            in the tab order, which is the only position that helps. */}

        {/* The first render of a page in a language this browser has not
            fetched yet suspends in StoreProvider until its dictionary arrives
            (lib/i18n-runtime.ts). This boundary is what lets React keep the
            server's HTML — already in that language — on screen meanwhile,
            rather than failing the hydration. On the server nothing suspends,
            so the fallback is never rendered. */}
        <Suspense fallback={null}>
          <StoreProvider initialTaxonomy={initialTaxonomy} initialShipping={shipping}>
            {/* The skip link (see the note above), in the visitor's language —
                still first in the tab order: nothing before it is focusable. */}
            <SkipLink />
            {/* The page itself, with room at the foot of a phone screen for the
                tab bar below — without it, the last button on every page would
                sit under the bar. `md:pb-0` because the bar is phones only. */}
            <div className="pb-20 md:pb-0">
              <PageTransition>{children}</PageTransition>
            </div>
            {/* Cart / checkout / account drawers. Mounted here, not per page: a
                page that renders a trigger but not its panel is a dead end. */}
            <GlobalPanels />
            <ToastViewport />
            {/* Inside StoreProvider: the banner is localised via the store. It
                renders nothing until mounted, so it cannot flash for visitors
                who already answered. */}
            <CookieConsentLazy />
            {/* The app-style tab bar. Phones only; hidden on /admin. */}
            <BottomNav />
            {/* The installed app's personal promo code, issued on its first
                launch after sign-in. Renders nothing; inert in a browser tab. */}
            <AppWelcome />
          </StoreProvider>
        </Suspense>
      </body>
    </html>
  );
}
