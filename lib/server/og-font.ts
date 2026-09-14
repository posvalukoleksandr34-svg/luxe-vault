import 'server-only'

/**
 * A fetch that gives up after `ms`. A plain AbortController timer rather than
 * AbortSignal.timeout(), which the Edge runtime the preview cards run on does
 * not reliably provide.
 */
export async function fetchWithTimeout(input: string | URL, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(input, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A font for next/og, fetched from Google Fonts at render time and subset to
 * the characters actually drawn.
 *
 * The renderer (Satori) reads TTF/OTF/WOFF but not WOFF2, which is all the
 * site self-hosts, so the preview cards cannot reuse public/fonts. This runs
 * on the server when a card is first rendered — never in a visitor's browser
 * and never during `next build` — and the card is then cached.
 *
 * Returns null on any failure or timeout; the card then renders in the
 * renderer's built-in sans instead of failing.
 */
export async function loadGoogleFont(
  family: string,
  weight: number,
  text: string,
): Promise<ArrayBuffer | null> {
  try {
    const url =
      `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weight}` +
      `&text=${encodeURIComponent(text)}`
    const css = await (await fetchWithTimeout(url, 3000)).text()
    const src = css.match(/src: url\(([^)]+)\) format\('(?:opentype|truetype)'\)/)?.[1]
    if (!src) return null
    const res = await fetchWithTimeout(src, 3000)
    return res.ok ? await res.arrayBuffer() : null
  } catch {
    return null
  }
}
