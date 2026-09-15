import { ImageResponse } from 'next/server'
import { monogramSvg } from '@/lib/brand/monogram.generated'
import { loadGoogleFont } from '@/lib/server/og-font'

export const runtime = 'edge'
export const alt = 'LUXE VAULT — Premium Apparel & Accessories'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * The site-wide link preview: the card Telegram, WhatsApp, iMessage, Facebook,
 * LinkedIn and X show for any page that has no card of its own (product pages
 * have theirs — app/product/[slug]/opengraph-image.tsx).
 *
 * Next wires this file up as og:image (with og:image:width/height/type/alt)
 * and twitter:image for every route below it, so no page is ever left for a
 * scraper to pick a random image from the page body.
 *
 * 1200x630 (1.91:1): the size every one of those platforms crops to without
 * cutting anything off. Everything important sits in the central area, so the
 * square crops some apps make of it still read as the brand.
 */

const GOLD = '#D4AF37'
const TEXT = '#E5E5E5'
const BODY = '#CCCCCC'
const SERIF = 'Playfair Display'
const MARK = `data:image/svg+xml;base64,${btoa(monogramSvg())}`

export default async function OpengraphImage() {
  // The serif wordmark; the renderer's built-in sans if Google Fonts is slow.
  const serif = await loadGoogleFont(SERIF, 500, 'LUXEVAULT')

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000000',
          backgroundImage:
            'radial-gradient(circle at 22% 18%, rgba(212,175,55,0.16), transparent 42%), radial-gradient(circle at 82% 86%, rgba(212,175,55,0.10), transparent 40%)',
        }}
      >
        {/* A hairline frame, inset — the card reads as a finished object even
            when an app draws it on white. */}
        <div
          style={{
            position: 'absolute',
            top: 28,
            left: 28,
            right: 28,
            bottom: 28,
            border: '1px solid rgba(212,175,55,0.35)',
          }}
        />

        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={MARK} width={120} height={120} />

        <div style={{ display: 'flex', marginTop: 26, fontFamily: SERIF, fontSize: 92, letterSpacing: 14 }}>
          <span style={{ color: TEXT }}>LUXE</span>
          <span style={{ color: GOLD, marginLeft: 26 }}>VAULT</span>
        </div>

        <div style={{ marginTop: 28, width: 88, height: 2, backgroundColor: GOLD }} />

        <div
          style={{
            marginTop: 26,
            fontSize: 24,
            letterSpacing: 6,
            textTransform: 'uppercase',
            color: BODY,
          }}
        >
          Premium Apparel &amp; Accessories
        </div>
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            gap: 26,
            fontSize: 18,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: GOLD,
          }}
        >
          <span>Mirror Quality</span>
          <span>·</span>
          <span>Limited Editions</span>
          <span>·</span>
          <span>Eurasia Shipping</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: serif ? [{ name: SERIF, data: serif, weight: 500, style: 'normal' }] : undefined,
    },
  )
}
