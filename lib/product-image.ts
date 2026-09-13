/**
 * A product image that can never break the layout.
 *
 * next/image throws on an empty `src`, so one product saved without a photo
 * used to take down every grid it appeared in. Every product image goes
 * through productImage(): a missing one becomes this placeholder — the shop's
 * dark ground, a hairline frame and a gold "LV" — instead of an error or a
 * broken-image icon. A data: URI, so it needs no file, no request and no
 * image-optimiser configuration (next/image serves data: URIs as they are).
 */
const PLACEHOLDER_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 400'>" +
  "<rect width='300' height='400' fill='#15130f'/>" +
  "<rect x='12.5' y='12.5' width='275' height='375' fill='none' stroke='#3a3326'/>" +
  "<text x='150' y='210' text-anchor='middle' font-family='Georgia,serif' font-size='30' letter-spacing='8' fill='#8c7331'>LV</text>" +
  '</svg>'

export const PRODUCT_PLACEHOLDER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PLACEHOLDER_SVG)}`

export function productImage(src: string | null | undefined): string {
  return typeof src === 'string' && src.trim() ? src : PRODUCT_PLACEHOLDER
}
