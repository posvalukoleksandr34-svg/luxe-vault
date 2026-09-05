import './globals.css';
import type { Metadata } from 'next';
import { Inter, Bodoni_Moda } from 'next/font/google';
import { StoreProvider } from '@/lib/store';
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
const SITE_TITLE = 'LUXE VAULT — Premium Apparel & Accessories';
const SITE_DESCRIPTION =
  'Премиальная одежда, обувь и аксессуары. Зеркальное качество, лимитированные коллекции, доставка по всей Евразии за 4–5 рабочих дней.';

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
  keywords: [
    'LUXE VAULT',
    'премиальная одежда',
    'дизайнерская одежда',
    'лимитированные коллекции',
    'зеркальное качество',
    'кроссовки премиум',
    'модная одежда онлайн',
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
    description: SITE_DESCRIPTION,
    locale: 'ru_RU',
    alternateLocale: ['en_US', 'it_IT', 'fr_FR', 'de_DE'],
  },

  // Twitter Card — часть мессенджеров и соцсетей (в т.ч. X/Twitter) читают
  // именно эти теги, если специфичных og-тегов недостаточно.
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} ${bodoni.variable} font-sans`}>
        <StoreProvider>
          {children}
          <ToastViewport />
        </StoreProvider>
      </body>
    </html>
  );
}
