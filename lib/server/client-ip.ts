// Who is on the other end of a request, and whether it came through the edge.
//
// Runs in the Edge middleware AND in Node route handlers, so nothing here may
// use node:crypto or `server-only`.
//
// WHY THIS EXISTS
//
// The domain is proxied by Cloudflare, and Vercel overwrites X-Forwarded-For
// with the address that connected to it — which, behind Cloudflare, is a
// Cloudflare edge server, not the customer. Every limit in rate-limit.ts was
// therefore counting Cloudflare machines: strangers shared one bucket, and a
// script got a fresh budget whenever its traffic landed on another edge IP.
//
// Cloudflare sends the real address in CF-Connecting-IP. That header is only
// trustworthy on a request that actually passed through Cloudflare: the
// deployment is also reachable directly at *.vercel.app, where anyone can set
// CF-Connecting-IP to whatever they like and mint unlimited rate-limit
// buckets. So the header is believed only when the request also carries the
// shared secret a Cloudflare Transform Rule adds to every request it forwards
// (docs/security/phase-1-perimeter.md). With EDGE_ORIGIN_SECRET unset nothing
// changes: the behaviour is exactly the X-Forwarded-For reading it replaces.

/** The header the Cloudflare Transform Rule sets. */
export const EDGE_AUTH_HEADER = 'x-edge-auth'

type HeaderSource = { get(name: string): string | null }

function edgeOriginSecret(): string {
  return process.env.EDGE_ORIGIN_SECRET?.trim() ?? ''
}

/** True when the origin lock is configured. */
export function isEdgeLockConfigured(): boolean {
  return edgeOriginSecret().length > 0
}

/**
 * Constant-time string comparison that runs on the Edge runtime.
 *
 * The loop covers the longer of the two strings and folds the length
 * difference into the result, so it neither exits early on the first wrong
 * character nor on a length mismatch.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0)
  }
  return diff === 0
}

/** True when the request carries the edge secret, i.e. came through Cloudflare. */
export function cameThroughEdge(headers: HeaderSource): boolean {
  const secret = edgeOriginSecret()
  const presented = headers.get(EDGE_AUTH_HEADER)
  if (!secret || !presented) return false
  return constantTimeEqual(presented, secret)
}

/**
 * The client's address, or '' when there is none to be had.
 *
 * CF-Connecting-IP when the request is proven to have come through
 * Cloudflare; otherwise the platform's X-Forwarded-For, then X-Real-IP.
 */
export function clientIp(headers: HeaderSource): string {
  if (cameThroughEdge(headers)) {
    const edgeIp = headers.get('cf-connecting-ip')?.trim()
    if (edgeIp) return edgeIp
  }
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    ''
  )
}
