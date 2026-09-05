import { NextResponse } from 'next/server'
import { readCatalog } from '@/lib/server/catalog-store'

// The catalogue changes whenever an admin edits it, and the storefront reads
// this on mount. Serving a build-time snapshot would reintroduce exactly the
// staleness this migration set out to fix.
export const dynamic = 'force-dynamic'

/** Public catalogue: collections, categories and products in one payload. */
export async function GET() {
  try {
    const catalog = await readCatalog()
    return NextResponse.json(catalog)
  } catch (e) {
    console.error('[catalog] read failed:', e)
    return NextResponse.json({ error: 'Could not load catalogue' }, { status: 500 })
  }
}
