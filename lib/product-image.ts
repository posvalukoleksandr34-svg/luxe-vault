/**
 * A product image that can never break the layout.
 *
 * next/image throws on an empty `src`, so one product saved without a photo
 * used to take down every grid it appeared in. Every product image goes
 * through productImage(): a missing one becomes this placeholder — the cards'
 * own pale grey ground and the keyhole mark in a darker grey, no frame —
 * instead of an error or a broken-image icon. A data: URI, so it needs no
 * file, no request and no image-optimiser configuration (next/image serves
 * data: URIs as they are).
 */
const PLACEHOLDER_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 400'>" +
  "<rect width='300' height='400' fill='#f5f5f5'/>" +
  // The shop's keyhole mark (scripts/brand/generate_brand_assets.py), small.
  // It was an "LV" in serif capitals, which on a replica shop reads as a
  // designer's trade mark.
  "<circle cx='150' cy='190' r='12' fill='#bfbfbf'/>" +
  "<path d='M144 196H156L162 226H138Z' fill='#bfbfbf'/>" +
  '</svg>'

export const PRODUCT_PLACEHOLDER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PLACEHOLDER_SVG)}`

export function productImage(src: string | null | undefined): string {
  return typeof src === 'string' && src.trim() ? src : PRODUCT_PLACEHOLDER
}
