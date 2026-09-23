import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/server/admin-guard'
import { renderOrderPdf, type PdfKind } from '@/lib/server/invoice/pdf'
import { getOrderById } from '@/lib/server/orders-store'

// pdfkit and fontkit need Node's Buffer and zlib; the edge runtime has neither.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

/**
 * An order's invoice as a PDF download.
 *
 *   GET /api/admin/orders/LV-8K2Q4M/invoice                → the invoice
 *   GET /api/admin/orders/LV-8K2Q4M/invoice?type=packing   → the packing slip
 *
 * Rendered on every request rather than stored: the order can still change —
 * a refund, a corrected address — and the document should say what the order
 * says now. Never cached, by the browser or anything between, because it
 * carries a customer's name and address.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const order = await getOrderById(params.id)
  if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 })

  const kind: PdfKind = request.nextUrl.searchParams.get('type') === 'packing' ? 'packing' : 'invoice'

  let pdf: Buffer
  try {
    pdf = await renderOrderPdf(order, kind)
  } catch (e) {
    console.error(`[invoice] could not render ${kind} for ${order.id}:`, (e as Error).message)
    return NextResponse.json({ error: 'Не удалось создать PDF' }, { status: 500 })
  }

  // Order numbers are LV- plus letters and digits; anything else is dropped
  // so the header can never be broken by what is inside it.
  const safeId = order.id.replace(/[^A-Za-z0-9-]/g, '')
  const filename = `LuxeVault-${kind === 'invoice' ? 'Invoice' : 'PackingSlip'}-${safeId}.pdf`

  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'private, no-store',
    },
  })
}
