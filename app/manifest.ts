import type { MetadataRoute } from 'next'

import { DEFAULT_LOCALE } from '@/lib/i18n'

/**
 * The web app manifest, served at /manifest.webmanifest and linked from every
 * page by Next's file-based metadata. It is what Android and desktop Chrome
 * read when the shop is added to a home screen or installed: the name under
 * the icon, the splash colour, and which icon to use for which mask.
 *
 * The icons come from scripts/brand/generate_brand_assets.py. "any" icons are
 * full-bleed; the "maskable" one keeps the monogram inside the central 80%
 * safe zone, so Android's circle/squircle masks never clip it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // A stable identity for the installed app, independent of start_url.
    id: '/',
    name: 'LUXE VAULT — Premium Apparel & Luxury Fashion',
    short_name: 'LUXE VAULT',
    description:
      'Designer-inspired apparel, footwear and accessories. Limited drops, shipped from Switzerland.',
    // Tagged so analytics can tell launches of the installed app apart.
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    lang: DEFAULT_LOCALE,
    dir: 'ltr',
    prefer_related_applications: false,
    orientation: 'portrait',
    // The storefront's black, so the splash screen and the status bar match
    // the site rather than flashing white.
    background_color: '#000000',
    theme_color: '#000000',
    categories: ['shopping', 'lifestyle'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Long-press on the installed icon (Android, desktop Chrome/Edge).
    shortcuts: [
      // A manifest is one static file for every visitor, so these cannot
      // follow the language switch — they are in `lang` above, the
      // storefront's default.
      { name: 'Catalogue', short_name: 'Catalogue', url: '/catalog', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'My account', short_name: 'Account', url: '/account', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Support', short_name: 'Support', url: '/support', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  }
}
