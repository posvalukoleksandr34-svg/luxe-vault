import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { stockAlerts, type VariantStock } from '@/lib/admin-attention'
import { ADMIN_NAV, activeNavKey, tabFrom } from '@/lib/admin-nav'
import { productSlug, slugifyName } from '@/lib/product-slug'
import { describeConflicts, planVariantWrites, type LiveVariant } from '@/lib/stock-sync'
import type { Variant } from '@/lib/types'

const live: LiveVariant[] = [
  { id: 'v-m', size: 'M', color: 'Black', stock: 3 },
  { id: 'v-l', size: 'L', color: 'Black', stock: 0 },
]
const v = (size: string, color: string, stock: number, stockBase?: number, extra: Partial<Variant> = {}): Variant => ({
  size,
  color,
  stock,
  lowStockAt: 5,
  ...(stockBase === undefined ? {} : { stockBase }),
  ...extra,
})

describe('product save: stock is never overwritten by a stale form', () => {
  it('an untouched cell is not written — a sale made meanwhile stands', () => {
    // The form loaded M at 5; two were sold since (live 3). The admin edited
    // only the description.
    const plan = planVariantWrites([v('M', 'Black', 5, 5), v('L', 'Black', 0, 0)], live)
    assert.equal(plan.conflicts.length, 0)
    const m = plan.updates.find((u) => u.id === 'v-m')!
    assert.equal(m.patch.stock, undefined, 'stock not in the write')
    assert.equal(m.expectedStock, undefined)
    assert.equal(plan.effective.find((e) => e.size === 'M')!.stock, 3, 'availability is derived from the live 3')
  })

  it('a changed cell is written only against the value the admin saw (compare-and-set)', () => {
    const plan = planVariantWrites([v('M', 'Black', 10, 3)], live)
    const m = plan.updates.find((u) => u.id === 'v-m')!
    assert.equal(m.patch.stock, 10)
    assert.equal(m.expectedStock, 3)
  })

  it('a changed cell whose live stock moved meanwhile is a conflict, and nothing is planned for it', () => {
    const plan = planVariantWrites([v('M', 'Black', 10, 5)], live)
    assert.deepEqual(plan.conflicts, [{ size: 'M', color: 'Black', expected: 5, actual: 3 }])
    assert.ok(!plan.updates.some((u) => u.id === 'v-m'))
    assert.match(describeConflicts(plan.conflicts), /M \/ Black: было 5, сейчас 3/)
  })

  it('an older caller without stockBase still writes absolute stock, as before', () => {
    const plan = planVariantWrites([v('M', 'Black', 7)], live)
    assert.equal(plan.updates.find((u) => u.id === 'v-m')!.patch.stock, 7)
    assert.equal(plan.updates.find((u) => u.id === 'v-m')!.expectedStock, undefined)
  })

  it('new combinations are inserted; removed ones deleted; blank rows ignored', () => {
    const plan = planVariantWrites([v('M', 'Black', 3, 3), v('S', 'Ivory', 4), v(' ', 'Black', 9)], live)
    assert.deepEqual(plan.inserts, [{ size: 'S', color: 'Ivory', stock: 4, low_stock_at: 5, sku: null }])
    assert.deepEqual(plan.deletes, ['v-l'])
  })

  it('negative or fractional input never reaches the database', () => {
    const plan = planVariantWrites([v('XL', 'Black', -4.7)], [])
    assert.equal(plan.inserts[0].stock, 0)
    const plan2 = planVariantWrites([v('XL', 'Black', 2.9)], [])
    assert.equal(plan2.inserts[0].stock, 2)
  })
})

describe('new product addresses', () => {
  it('are readable, Latin and URL-safe', () => {
    assert.equal(slugifyName('Cashmere Coat — Onyx'), 'cashmere-coat-onyx')
    assert.equal(slugifyName('Кашемировое пальто'), 'kashemirovoe-palto')
    assert.equal(slugifyName('Écharpe en soie'), 'echarpe-en-soie')
    assert.equal(slugifyName('Straßenschuh'), 'strassenschuh')
  })

  it('prefer the English name and carry a short tail against collisions', () => {
    const slug = productSlug({ ru: 'Пальто', en: 'Wool Coat' }, 'x7k2')
    assert.equal(slug, 'wool-coat-x7k2')
    assert.match(productSlug({ ru: 'Пальто' }), /^palto-[a-z0-9]{4}$/)
  })

  it('always match the API slug rule', () => {
    const rule = /^[a-z0-9]+(-[a-z0-9]+)*$/
    for (const name of [{ en: '!!!' }, { ru: '' }, { en: 'A'.repeat(200) }, { de: 'Größe 42 / Schwarz' }]) {
      const slug = productSlug(name)
      assert.match(slug, rule, slug)
      assert.ok(slug.length <= 80, slug)
    }
  })
})

describe('console navigation', () => {
  it('every section is reachable, once', () => {
    const keys = ADMIN_NAV.flatMap((g) => g.items.map((i) => i.key))
    assert.equal(new Set(keys).size, keys.length)
    for (const k of ['dashboard', 'orders', 'returns', 'reconciliation', 'customers', 'promos', 'products', 'collections', 'inventory', 'support', 'productReviews', 'reviews', 'reviewRequests', 'newsletter', 'shipping']) {
      assert.ok(keys.includes(k), k)
    }
  })

  it('knows where you are, including sub-pages and tabs', () => {
    assert.equal(activeNavKey('/admin', null), 'dashboard')
    assert.equal(activeNavKey('/admin', 'inventory'), 'inventory')
    assert.equal(activeNavKey('/admin', 'nonsense'), 'dashboard')
    assert.equal(activeNavKey('/admin/returns/abc', null), 'returns')
    assert.equal(activeNavKey('/admin/orders', null), 'orders')
    assert.equal(activeNavKey('/admin/reconciliation', null), 'reconciliation')
    assert.equal(activeNavKey('/admin/settings', null), 'shipping')
    assert.equal(tabFrom('products'), 'products')
    assert.equal(tabFrom(undefined), 'dashboard')
  })
})

describe('stock alerts on the dashboard', () => {
  const row = (id: string, stock: number, low: number | null, name = id): VariantStock => ({
    id,
    size: 'M',
    color: 'Black',
    stock,
    low_stock_at: low,
    product: { slug: id, name: { ru: name } },
  })

  it('counts out of stock and low separately, most urgent first', () => {
    const r = stockAlerts([row('a', 4, 5), row('b', 0, 5), row('c', 9, 5), row('d', 5, 5)])
    assert.equal(r.out, 1)
    assert.equal(r.low, 2)
    assert.deepEqual(r.items.map((i) => i.variantId), ['b', 'a', 'd'])
  })

  it('a threshold of 0 means "only warn at zero"', () => {
    const r = stockAlerts([row('a', 1, 0), row('b', 0, 0)])
    assert.equal(r.low, 0)
    assert.equal(r.out, 1)
  })

  it('caps the list but not the counts', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(`v${i}`, 0, 5))
    const r = stockAlerts(rows, 8)
    assert.equal(r.out, 20)
    assert.equal(r.items.length, 8)
  })
})
