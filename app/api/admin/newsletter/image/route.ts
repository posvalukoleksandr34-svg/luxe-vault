import { NextResponse, type NextRequest } from 'next/server'
import { MAX_UPLOAD_BYTES, uploadNewsletterImage } from '@/lib/server/product-images'
import { requireAdmin } from '@/lib/server/admin-guard'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

/**
 * One image for a newsletter campaign, uploaded from the composer. Returns its
 * public URL in the `newsletter-images` bucket (migration 0038).
 *
 * Proxied through the server like product photos (/api/admin/uploads): the
 * only credential that can write to Storage is the service-role key, and the
 * admin session middleware already checked is what authorises the upload.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Ожидалась загрузка файла.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Файл не получен.' }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `Файл весит ${(file.size / 1024 / 1024).toFixed(1)} МБ, максимум — ${MAX_UPLOAD_BYTES / 1024 / 1024} МБ.` },
      { status: 413 },
    )
  }

  const result = await uploadNewsletterImage(await file.arrayBuffer(), file.type)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ url: result.url })
}
