import { ImageResponse } from 'next/server'
import { CATEGORY_LABELS } from '@/lib/i18n'
import { getProductBySlug } from '@/lib/server/catalog-store'
import { fetchWithTimeout, loadGoogleFont } from '@/lib/server/og-font'
import { getSiteUrl } from '@/lib/site-url'
import type { Product } from '@/lib/types'

/**
 * The link-preview card for a product page: its photo, name and price on the
 * brand's black, with a gold rule. Next wires this file up as the page's
 * og:image (and twitter:image) automatically, so sharing a product in
 * Telegram, WhatsApp, iMessage or on X shows this card instead of a bare photo.
 *
 * Edge runtime, like app/opengraph-image.tsx: under the Node runtime, Next
 * 13.5's bundled @vercel/og cannot resolve the path of its own default font on
 * Windows and renders an empty image. The product lookup is Edge-safe
 * (supabase-js over fetch).
 */
export const runtime = 'edge'

export const alt = 'LUXE VAULT'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * ImageResponse marks its output immutable for a year by default, and the
 * og:image URL does not change when the product does — so a new price or
 * photo would never reach a fresh share. Ten minutes at the CDN instead,
 * matching the product page's own revalidate window.
 */
const CACHE_CONTROL = 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400'

const GOLD = '#D4AF37'
const TEXT = '#E5E5E5'
const MUTED = '#8c8c8c'
const SERIF = 'Playfair Display'
const PHOTO_WIDTH = 504

/** Russian first, as for the page's own metadata (<html lang="ru">). */
function pick(text: Record<string, string> | undefined): string {
  if (!text) return ''
  return text.ru || text.en || Object.values(text)[0] || ''
}

/** Base64 without Node's Buffer, which the Edge runtime does not have. */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)))
  }
  return btoa(binary)
}

/**
 * One photo as a data URL, or null.
 *
 * Only PNG and JPEG are embedded. Next 13.5's renderer cannot decode WebP —
 * tried: the whole card comes out as an empty PNG — and admin uploads are
 * stored as WebP, so a WebP photo is skipped rather than allowed to blank the
 * card. A slow host or a missing photo is skipped the same way.
 */
async function photoDataUrl(src: string | undefined): Promise<string | null> {
  if (!src) return null
  try {
    const res = await fetchWithTimeout(new URL(src, getSiteUrl()), 4000)
    if (!res.ok) return null
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim()
    if (type !== 'image/jpeg' && type !== 'image/png') return null
    const buffer = await res.arrayBuffer()
    // A card is 630px tall; a multi-megabyte original is not worth inlining.
    if (buffer.byteLength > 6 * 1024 * 1024) return null
    return `data:${type};base64,${toBase64(buffer)}`
  } catch {
    return null
  }
}

/**
 * The first photo of the product the renderer can use — the main image, then
 * the gallery in order. Fetched together, so a WebP main image costs no extra
 * wait before a JPEG second angle is used instead.
 */
async function firstPhoto(product: Product | null): Promise<string | null> {
  if (!product) return null
  const candidates = Array.from(new Set([product.image, ...(product.images ?? [])].filter(Boolean))).slice(0, 4)
  const photos = await Promise.all(candidates.map((src) => photoDataUrl(src)))
  return photos.find((p): p is string => p !== null) ?? null
}

function priceLabel(price: number): string {
  const amount = Number.isInteger(price) ? String(price) : price.toFixed(2)
  return `CHF ${amount.replace(/\B(?=(\d{3})+(?!\d))/g, '’')}`
}

export default async function ProductOpengraphImage({ params }: { params: { slug: string } }) {
  let product: Product | null = null
  try {
    product = await getProductBySlug(params.slug)
  } catch {
    // Database unavailable: still answer with the brand card below.
  }

  const title = product ? pick(product.name).slice(0, 90) : 'LUXE VAULT'
  const category = product
    ? pick((CATEGORY_LABELS as Record<string, Record<string, string> | undefined>)[product.category])
    : ''
  const price = product ? priceLabel(product.price) : ''
  const titleSize = title.length <= 26 ? 64 : title.length <= 48 ? 52 : 42

  const [photo, serif] = await Promise.all([
    firstPhoto(product),
    loadGoogleFont(SERIF, 500, `${title}LUXEVAULT${price}`),
  ])

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          backgroundColor: '#000000',
          backgroundImage: 'radial-gradient(circle at 88% 12%, rgba(212,175,55,0.16), transparent 45%)',
          color: TEXT,
        }}
      >
        {photo && (
          <div style={{ display: 'flex', width: PHOTO_WIDTH, height: '100%' }}>
            {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
            <img
              src={photo}
              width={PHOTO_WIDTH}
              height={630}
              style={{ width: PHOTO_WIDTH, height: 630, objectFit: 'cover' }}
            />
          </div>
        )}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '64px 72px',
            borderLeft: photo ? '1px solid rgba(212,175,55,0.45)' : 'none',
          }}
        >
          <div style={{ display: 'flex', fontFamily: SERIF, fontSize: 28, letterSpacing: 10 }}>
            <span style={{ color: TEXT }}>LUXE</span>
            <span style={{ color: GOLD, marginLeft: 14 }}>VAULT</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {category && (
              <div style={{ fontSize: 20, letterSpacing: 6, textTransform: 'uppercase', color: MUTED }}>
                {category}
              </div>
            )}
            <div style={{ marginTop: 18, fontFamily: SERIF, fontSize: titleSize, lineHeight: 1.15, color: TEXT }}>
              {title}
            </div>
            {/* A real column, not a fragment: the renderer lays a fragment's
                children out as a row. */}
            {price && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ marginTop: 30, width: 72, height: 2, backgroundColor: GOLD }} />
                <div style={{ marginTop: 26, fontFamily: SERIF, fontSize: 38, color: GOLD }}>{price}</div>
              </div>
            )}
          </div>

          <div style={{ fontSize: 18, letterSpacing: 5, textTransform: 'uppercase', color: MUTED }}>
            luxe-vault.store
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: serif ? [{ name: SERIF, data: serif, weight: 500, style: 'normal' }] : undefined,
      headers: { 'cache-control': CACHE_CONTROL },
    },
  )
}
