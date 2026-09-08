import './globals.css';
import type { Metadata } from 'next';
import { Inter, Bodoni_Moda } from 'next/font/google';
import { StoreProvider } from '@/lib/store';
import { readCatalog } from '@/lib/server/catalog-store';
import { AmbientBackground } from '@/components/ambient-background';
import { CookieConsent } from '@/components/cookie-consent';
import { GlobalPanels } from '@/components/global-panels';
import { ToastViewport } from '@/components/toast-viewport';

// Inter carries the small, spaced-out uppercase editorial subtext; Bodoni
// Moda is the heavy, high-contrast display serif used for every headline —
// the same family of cut that gives fashion-house wordmarks (Vogue, YSL,
// Gucci editorial spreads) their commanding weight.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const bodoni = Bodoni_Moda({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-display',
});

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

  alternates: {
    canonical: '/',
  },

  // Открытая разметка (OpenGraph) — именно она формирует красивую
  // превью-карточку со ссылкой в Telegram, WhatsApp, iMessage и других
  // мессенджерах: заголовок, описание, картинка и тип контента.
  // og:image подхватывается автоматически из файла app/opengraph-image.tsx
  // (файловая конвенция Next.js), поэтому его не нужно перечислять здесь
  // вручную — Next добавит правильный <meta property="og:image"> сам.
  openGraph: {
    type: 'website',
    url: SITE_URL,
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
  return (
    <html lang="ru" className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} ${bodoni.variable} font-sans`}>
        {/* Outside StoreProvider on purpose: it is decorative, has no state,
            and sits at z-index -1 so it never participates in the app's own
            stacking or event handling. */}
        <AmbientBackground />

        {/* Skip link. The header carries a logo, five nav items, a search box,
            a language menu and four icon buttons, so a keyboard or screen
            reader user previously had to tab through all of it on every page
            before reaching the content.

            Visually hidden until focused — `sr-only focus:not-sr-only` — so it
            costs sighted visitors nothing and appears the moment it is
            reachable. Rendered before everything else so it is the first stop
            in the tab order, which is the only position that helps. */}
        <a
          href="#main"
          className="sr-only left-4 top-4 z-[200] border border-gold bg-background px-4 py-2 text-[12px] uppercase tracking-[0.12em] text-gold focus:not-sr-only focus:absolute"
        >
          Skip to content
        </a>

        <StoreProvider initialCatalog={initialCatalog}>
          {children}
          {/* Cart / checkout / account drawers. Mounted here, not per page: a
              page that renders a trigger but not its panel is a dead end. */}
          <GlobalPanels />
          <ToastViewport />
          {/* Inside StoreProvider: the banner is localised via the store. It
              renders nothing until mounted, so it cannot flash for visitors
              who already answered. */}
          <CookieConsent />
        </StoreProvider>
      </body>
    </html>
  );
}
