import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * An old referral link: /r/REF-XXXXXX.
 *
 * The referral programme is switched off (October 2026). Links customers
 * already shared still lead somewhere: the homepage, with no click recorded
 * and no code remembered. A browser that still holds the old `lv_ref`
 * cookie has it removed here.
 */
export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/', request.url), 307)
  response.headers.set('X-Robots-Tag', 'noindex')
  if (request.cookies.has('lv_ref')) response.cookies.delete('lv_ref')
  return response
}
