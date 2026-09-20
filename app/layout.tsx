import './globals.css';
import type { Metadata } from 'next';
import { StoreProvider } from '@/lib/store';
import { readCatalog } from '@/lib/server/catalog-store';
import { getShippingSettings } from '@/lib/server/store-settings';
import { AmbientBackground } from '@/components/ambient-background';
import { AnalyticsManagerLazy, AudioFeedbackLazy, CookieConsentLazy } from '@/components/deferred-ui';
import { PageTransition } from '@/components/page-transition';
import { PointerAtmosphereLazy } from '@/components/pointer-atmosphere-lazy';
import { GlobalPanels } from '@/components/global-panels';
import { ToastViewport } from '@/components/toast-viewport';
import { UiEnvironment } from '@/components/ui-environment';
import { SkipLink } from '@/components/skip-link';
import { BottomNav } from '@/components/bottom-nav';
import { WelcomeModal } from '@/components/welcome-modal';
import { ServiceWorkerRegister } from '@/components/service-worker-register';
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
const SITE_URL = 'https://luxe-vault.store';
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
 * Who publishes the site, as structured data: the seller (with a support
 * contact) and the WebSite. Once, in the root layout, so every page carries
 * it; product pages add their own Product graph on top.
 */
const SITE_JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer service',
        email: SUPPORT_EMAIL,
        availableLanguage: ['Russian', 'English', 'Italian', 'French', 'German'],
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      publisher: { '@id': `${SITE_URL}/#organization` },
      inLanguage: 'ru',
    },
  ],
};

/**
 * Without this the layout's catalogue read makes every page fully static and
 * bakes the product list into the build — an admin adding a product would not
 * see it until the next deploy, which is exactly what moving the catalogue
 * into Postgres was meant to end. Verified: `/` was emitted as ○ (static)
 * before this line, and ISR after it.
 *
 * 60s is the staleness ceiling for the FIRST PAINT only. StoreProvider still
 * runs loadCatalog() on mount, so a client corrects itself within a second of
 * hydrating; this only governs what a crawler or a cold visitor sees first.
 */
export const revalidate = 60

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
    // Matches <html lang="ru"> — the page still renders Russian by default, so
    // declaring en_US here would misreport the document to crawlers. See the
    // note in the handover about aligning these.
    locale: 'ru_RU',
    alternateLocale: ['en_US', 'it_IT', 'fr_FR', 'de_DE'],
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

  // The browser chrome on mobile in the storefront's black.
  themeColor: '#000000',
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
  // Read on the server so the storefront's first painted frame already has the
  // products. This is the fix for the only measured layout shift on the site:
  // the #shop section reflowing when a client-side /api/catalog call resolved.
  //
  // A failure degrades to the previous behaviour — the client fetch still runs
  // on mount — rather than taking down every page in the app.
  let initialCatalog
  try {
    initialCatalog = await readCatalog()
  } catch (error) {
    console.error('[layout] catalogue unavailable for SSR:', error)
  }
  // The admin's shipping fee, threshold and delivery window, for the cart,
  // checkout, product pages and footer. Never throws: it falls back to
  // config/shipping.ts when the database cannot be read.
  const shipping = await getShippingSettings()
  return (
    <html lang="ru" className="dark" suppressHydrationWarning>
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

        <StoreProvider initialCatalog={initialCatalog} initialShipping={shipping}>
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
          {/* First-launch welcome: waits for the cookie banner to be answered
              and never appears for a signed-in or returning visitor. */}
          <WelcomeModal />
          {/* The app-style tab bar. Phones only; hidden on /admin. */}
          <BottomNav />
        </StoreProvider>
      </body>
    </html>
  );
}
