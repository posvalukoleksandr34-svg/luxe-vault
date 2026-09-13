import { NextResponse, type NextRequest } from 'next/server'
import { PREVIEW_TEMPLATES, previewIndexHtml, renderPreview, type PreviewTemplate } from '@/lib/server/emails/preview'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

/**
 * Renders a transactional email with sample data, for review in the browser.
 *
 *   /api/admin/email-preview                               — index of all
 *   /api/admin/email-preview?template=refund&lang=it       — one email
 *
 * Sends nothing.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const template = url.searchParams.get('template')
  if (!template) {
    return new NextResponse(previewIndexHtml(url.pathname), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  if ((PREVIEW_TEMPLATES as readonly string[]).indexOf(template) === -1) {
    return NextResponse.json({ error: 'Unknown template' }, { status: 404 })
  }
  const { html } = renderPreview(template as PreviewTemplate, url.searchParams.get('lang'))
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
