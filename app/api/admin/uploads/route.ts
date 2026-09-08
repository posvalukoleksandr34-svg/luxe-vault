import { NextResponse, type NextRequest } from 'next/server'
import { MAX_UPLOAD_BYTES, uploadImage } from '@/lib/server/product-images'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

/**
 * Accepts image files from the admin console and returns their public URLs.
 *
 * Replaces the previous approach of base64-encoding images in the browser and
 * writing them into the product row — see lib/server/product-images.ts for the
 * measurements that motivated the change.
 *
 * Uploads are proxied through this route rather than sent to Storage directly
 * so that no bucket-writing credential ever reaches the browser: the only key
 * involved is the service-role key on the server, and the admin session cookie
 * that middleware already verified is what authorises the write.
 */
export async function POST(request: NextRequest) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json(
      { error: 'Expected a multipart form upload.' },
      { status: 400 },
    )
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return NextResponse.json({ error: 'No files were sent.' }, { status: 400 })
  }
  if (files.length > 10) {
    return NextResponse.json(
      { error: 'Up to 10 images can be uploaded at once.' },
      { status: 400 },
    )
  }

  const folderRaw = form.get('folder')
  const folder = folderRaw === 'collections' ? 'collections' : 'products'

  const urls: string[] = []
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
        },
        { status: 413 },
      )
    }

    const result = await uploadImage(await file.arrayBuffer(), file.type, folder)
    if (!result.ok) {
      // Partial success is reported as failure: the caller gets one clear
      // error rather than a half-filled gallery it has to reconcile. The
      // already-uploaded objects are orphaned in the bucket, which is cheap
      // and harmless compared with a product row pointing at a missing image.
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    urls.push(result.url)
  }

  return NextResponse.json({ urls })
}
