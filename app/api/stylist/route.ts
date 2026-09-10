import { NextResponse, type NextRequest } from 'next/server'
import { readCatalog } from '@/lib/server/catalog-store'
import { buildLooks, refineBrief } from '@/lib/server/stylist/engine'
import { describeLooks } from '@/lib/server/stylist/rationale'
import { enforceLimit } from '@/lib/server/rate-limit'
import { COLOR_FAMILIES, OCCASIONS, STYLES } from '@/lib/stylist/types'
import type { ColorFamily, Occasion, Refinement, StyleKey, StylistBrief } from '@/lib/stylist/types'

/**
 * The AI Stylist endpoint.
 *
 * Server-side because the catalogue read uses the service-role key and any
 * model key must never reach the browser. The client sends a brief and gets
 * back looks made of real catalogue products; it never sends product data in,
 * so a tampered request cannot inject a product that does not exist.
 */

export const dynamic = 'force-dynamic'

/** Whitelist every enum coming off the wire. Anything unrecognised is dropped
 *  rather than rejected — a brief is advisory, and half a brief still styles. */
function sanitise(raw: unknown): StylistBrief {
  const body = (raw ?? {}) as Record<string, unknown>
  const brief: StylistBrief = {}

  const occasion = body.occasion
  if (typeof occasion === 'string' && (OCCASIONS as readonly string[]).indexOf(occasion) !== -1) {
    brief.occasion = occasion as Occasion
  }

  const style = body.style
  if (typeof style === 'string' && (STYLES as readonly string[]).indexOf(style) !== -1) {
    brief.style = style as StyleKey
  }

  if (Array.isArray(body.colors)) {
    const colors = body.colors
      .filter((c): c is string => typeof c === 'string')
      .filter((c) => (COLOR_FAMILIES as readonly string[]).indexOf(c) !== -1)
      .slice(0, 4) as ColorFamily[]
    if (colors.length) brief.colors = colors
  }

  const budget = Number(body.budget)
  if (Number.isFinite(budget) && budget > 0) brief.budget = Math.min(budget, 1_000_000)

  if (Array.isArray(body.sizes)) {
    const sizes = body.sizes
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 8)
    if (sizes.length) brief.sizes = sizes
  }

  if (typeof body.notes === 'string' && body.notes.trim()) {
    brief.notes = body.notes.trim().slice(0, 300)
  }

  if (typeof body.anchorProductId === 'string' && body.anchorProductId.trim()) {
    brief.anchorProductId = body.anchorProductId.trim().slice(0, 120)
  }

  return brief
}

export async function POST(request: NextRequest) {
  // The endpoint reads the whole catalogue and may call a model, so it is
  // worth the same throttle the other public POSTs get.
  const limited = await enforceLimit('stylist', request)
  if (limited) return limited

  let payload: Record<string, unknown>
  try {
    payload = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  let brief = sanitise(payload.brief)
  const refinement = payload.refinement
  if (
    typeof refinement === 'string' &&
    ['another', 'more_minimal', 'more_streetwear', 'cheaper', 'more_premium', 'different_colors'].indexOf(
      refinement,
    ) !== -1
  ) {
    brief = refineBrief(brief, refinement as Refinement)
  }

  const seedRaw = Number(payload.seed)
  const seed = Number.isFinite(seedRaw) ? Math.max(0, Math.min(50, Math.trunc(seedRaw))) : 0

  try {
    const catalog = await readCatalog()
    const result = buildLooks(catalog.products, brief, seed)
    // Prose last, on the finished looks — see rationale.ts for why the model
    // never gets to choose the products.
    const looks = await describeLooks(result.looks, brief)
    return NextResponse.json({ ...result, looks, brief })
  } catch (error) {
    console.error('[stylist] failed:', error)
    return NextResponse.json(
      { error: 'Stylist unavailable' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
