import { revalidatePath } from 'next/cache'
import { NextResponse, type NextRequest } from 'next/server'
import { readCatalog, updateProductText } from '@/lib/server/catalog-store'
import {
  isTranslationConfigured,
  mergeTranslations,
  sourceLocale,
  staleLocales,
  translateProductCopy,
} from '@/lib/server/translate'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Auth is enforced by middleware.ts for every /api/admin/* path.

/** Products per request. Small, so one request stays well inside a
 *  serverless time limit; the admin button calls again until `done`. */
const BATCH = 3

/**
 * Translates the existing catalogue, a few products per call.
 *
 * Every product saved before per-language copy existed holds its Russian
 * name and description in all five languages. This fills the ones that are
 * empty or still that untouched copy — never a translation that differs from
 * the source, which is someone's work. Writes only name and description.
 *
 * Body: { offset } — position in the catalogue, sorted by product id so pages
 * stay stable between calls. Each product is visited once per run, even when
 * its translation comes back identical (a name that is only a brand).
 */
export async function POST(request: NextRequest) {
  if (!isTranslationConfigured()) {
    return NextResponse.json(
      { error: 'Автоперевод не настроен: задайте GEMINI_API_KEY' },
      { status: 503 },
    )
  }

  let offset = 0
  try {
    const body = (await request.json()) as { offset?: unknown }
    offset = Math.max(0, Math.trunc(Number(body?.offset) || 0))
  } catch {
    // No body: start from the beginning.
  }

  const { products } = await readCatalog()
  const ordered = products.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const batch = ordered.slice(offset, offset + BATCH)

  let translated = 0
  let skipped = 0
  const failed: { id: string; error: string }[] = []

  for (const product of batch) {
    const source = sourceLocale(product.name) ?? sourceLocale(product.description)
    if (!source) {
      skipped++
      continue
    }
    const targets = staleLocales(product.name, source).concat(staleLocales(product.description, source))
    if (targets.length === 0) {
      skipped++
      continue
    }

    try {
      const result = await translateProductCopy(
        { name: product.name[source] ?? '', description: product.description[source] ?? '' },
        source,
        targets,
      )
      const merged = mergeTranslations(product.name, product.description, source, result)
      if (!merged.changed) {
        skipped++
        continue
      }
      await updateProductText(product.id, merged.name, merged.description)
      translated++
    } catch (e) {
      failed.push({ id: product.id, error: e instanceof Error ? e.message.slice(0, 160) : 'failed' })
    }
  }

  if (translated > 0) {
    revalidatePath('/', 'layout')
    revalidatePath('/api/catalog')
  }

  const nextOffset = offset + batch.length
  return NextResponse.json({
    total: ordered.length,
    nextOffset,
    done: nextOffset >= ordered.length,
    translated,
    skipped,
    failed,
  })
}
