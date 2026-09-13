import { NextResponse, type NextRequest } from 'next/server'
import { PRODUCT_LOCALES, isTranslationConfigured, translateProductCopy } from '@/lib/server/translate'
import type { Locale } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Auth is enforced by middleware.ts for every /api/admin/* path.

const MAX_NAME = 300
const MAX_DESCRIPTION = 5000

const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && PRODUCT_LOCALES.indexOf(value as Locale) !== -1

/**
 * Translates one product's name and description for the admin form's
 * "Перевести" button. Returns the translations; stores nothing — the admin
 * reviews them in the form and saves as usual.
 *
 * Body: { source, targets, name, description }
 */
export async function POST(request: NextRequest) {
  if (!isTranslationConfigured()) {
    return NextResponse.json(
      { error: 'Автоперевод не настроен: задайте GEMINI_API_KEY' },
      { status: 503 },
    )
  }

  let body: { source?: unknown; targets?: unknown; name?: unknown; description?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!isLocale(body.source)) return NextResponse.json({ error: 'Unknown source language' }, { status: 400 })
  const targets = Array.isArray(body.targets) ? body.targets.filter(isLocale) : []
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''

  if (!name && !description) return NextResponse.json({ error: 'Nothing to translate' }, { status: 400 })
  if (name.length > MAX_NAME || description.length > MAX_DESCRIPTION) {
    return NextResponse.json({ error: 'Text is too long to translate' }, { status: 400 })
  }

  try {
    const translations = await translateProductCopy({ name, description }, body.source, targets)
    return NextResponse.json({ translations })
  } catch (e) {
    console.error('[admin/translate] failed:', e instanceof Error ? e.message.slice(0, 200) : e)
    return NextResponse.json({ error: 'Перевод не удался — попробуйте ещё раз' }, { status: 502 })
  }
}
