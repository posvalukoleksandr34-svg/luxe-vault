import type { Variant } from '@/lib/types'

/**
 * How a product save turns the editor's variant grid into writes, without
 * overwriting stock that changed while the editor was open.
 *
 * The product form is loaded once and may sit open for an hour. Writing its
 * stock numbers back as absolute values would undo every sale made in the
 * meantime — a variant sold down to 0 would be "restocked" to what the form
 * remembered, and sold again. So each variant the editor sends carries
 * `stockBase`, the stock it was showing:
 *
 *  - stock === stockBase  → the admin did not touch the cell: stock is NOT
 *    written; the live value stands.
 *  - stock !== stockBase  → the admin typed a new number. It is written only
 *    if the live stock still equals stockBase (compare-and-set); otherwise it
 *    is a conflict, reported back, and nothing is saved.
 *  - no stockBase         → an older caller: the absolute value is written,
 *    as before.
 *
 * Pure: the database side is lib/server/catalog-store.ts.
 */

export type LiveVariant = { id: string; size: string; color: string; stock: number }

export type StockConflict = { size: string; color: string; expected: number; actual: number }

export type VariantRow = {
  size: string
  color: string
  stock: number
  low_stock_at: number
  sku: string | null
}

export type VariantPlan = {
  inserts: VariantRow[]
  updates: { id: string; size: string; color: string; patch: Partial<VariantRow>; expectedStock?: number }[]
  deletes: string[]
  conflicts: StockConflict[]
  /** The variants as they will be after the writes: what availability is derived from. */
  effective: Variant[]
}

const key = (size: string, color: string) => `${size}\u0000${color}`
const whole = (n: unknown, fallback = 0) => {
  const v = Math.trunc(Number(n))
  return Number.isFinite(v) ? Math.max(0, v) : fallback
}

export function planVariantWrites(submitted: Variant[], live: LiveVariant[]): VariantPlan {
  const liveByKey = new Map(live.map((v) => [key(v.size, v.color), v]))
  const plan: VariantPlan = { inserts: [], updates: [], deletes: [], conflicts: [], effective: [] }
  const seen = new Set<string>()

  for (const v of submitted) {
    const size = v.size.trim()
    const color = v.color.trim()
    if (!size || !color) continue
    const k = key(size, color)
    if (seen.has(k)) continue
    seen.add(k)

    const stock = whole(v.stock)
    const low = whole(v.lowStockAt ?? 5, 5)
    const sku = v.sku?.trim() || null
    const current = liveByKey.get(k)

    if (!current) {
      plan.inserts.push({ size, color, stock, low_stock_at: low, sku })
      plan.effective.push({ size, color, stock, lowStockAt: low, sku: sku ?? undefined })
      continue
    }

    const patch: Partial<VariantRow> = { low_stock_at: low, sku }
    let expectedStock: number | undefined
    let after = current.stock

    if (v.stockBase === undefined) {
      patch.stock = stock
      after = stock
    } else if (stock !== whole(v.stockBase)) {
      if (current.stock !== whole(v.stockBase)) {
        plan.conflicts.push({ size, color, expected: whole(v.stockBase), actual: current.stock })
        continue
      }
      patch.stock = stock
      expectedStock = whole(v.stockBase)
      after = stock
    }

    plan.updates.push({ id: current.id, size, color, patch, expectedStock })
    plan.effective.push({ id: current.id, size, color, stock: after, lowStockAt: low, sku: sku ?? undefined })
  }

  plan.deletes = live.filter((v) => !seen.has(key(v.size, v.color))).map((v) => v.id)
  return plan
}

/** One line per conflict, for the admin. */
export function describeConflicts(conflicts: StockConflict[]): string {
  return conflicts.map((c) => `${c.size} / ${c.color}: было ${c.expected}, сейчас ${c.actual}`).join('; ')
}
