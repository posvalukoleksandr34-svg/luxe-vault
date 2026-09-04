import { ImageResponse } from 'next/server'

export const runtime = 'edge'
export const alt = 'LUXE VAULT — Premium Apparel & Accessories'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * Next.js automatically wires this file up as the `og:image` (and
 * `twitter:image`) for every page under this segment via the file-based
 * Metadata API — nothing else needs to reference it manually. When a link
 * to the site is shared in Telegram, WhatsApp, etc., the messenger fetches
 * this route and renders the resulting 1200x630 PNG as the preview card.
 */
export default function OpengraphImage() {
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
          backgroundColor: '#0a0a0a',
          backgroundImage:
            'radial-gradient(circle at 25% 20%, rgba(212,175,55,0.18), transparent 45%), radial-gradient(circle at 80% 80%, rgba(212,175,55,0.12), transparent 40%)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 14,
          }}
        >
          <span
            style={{
              fontSize: 96,
              fontWeight: 600,
              letterSpacing: 12,
              color: '#f5f5f0',
            }}
          >
            LUXE
          </span>
          <span
            style={{
              fontSize: 96,
              fontWeight: 600,
              letterSpacing: 12,
              color: '#d4af37',
            }}
          >
            VAULT
          </span>
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 28,
            fontWeight: 400,
            letterSpacing: 3,
            color: '#a3a3a3',
            textTransform: 'uppercase',
          }}
        >
          Premium Apparel &amp; Accessories
        </div>
        <div
          style={{
            marginTop: 40,
            display: 'flex',
            gap: 40,
            fontSize: 20,
            color: '#d4af37',
            letterSpacing: 2,
            textTransform: 'uppercase',
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
    { ...size },
  )
}
