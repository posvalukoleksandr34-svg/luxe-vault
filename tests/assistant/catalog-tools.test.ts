import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { detail, productIdFrom, searchCatalog, sizeState, stockState, summarize } from '@/lib/server/assistant/catalog'
import { TOOLS, TOOL_NAMES, validateCall } from '@/lib/server/assistant/tools'
import { formatMoney } from '@/lib/currency'
import { colorFamily } from '@/lib/stylist/tagging'
import { CATALOG, PRODUCTS } from './fixtures'

const product = (id: string) => PRODUCTS.find((p) => p.id === id)!
const ids = (r: { results: { id: string }[] }) => r.results.map((p) => p.id)
const search = (args: Record<string, unknown>, locale: 'en' | 'it' | 'fr' | 'de' = 'en', kw?: (q: string) => Promise<string[]>) => {
  const v = validateCall('search_products', args)
  if ('error' in v) throw new Error(v.error)
  if (v.name !== 'search_products') throw new Error(v.name)
  return searchCatalog(CATALOG, v.args, locale, kw)
}

describe('catalogue tools: stock states are never guessed', () => {
  it('tracked with units → in_stock; marked unavailable → sold_out; no variants → not_tracked', () => {
    assert.equal(stockState(product('cappotto-cashmere')), 'in_stock')
    assert.equal(stockState(product('giacca-esaurita')), 'sold_out')
    assert.equal(stockState(product('borsa-tote')), 'not_tracked')
  })
  it('a size: available, sold out in every colour, not tracked, or not made', () => {
    assert.equal(sizeState(product('cappotto-cashmere'), 'M'), 'available')
    assert.equal(sizeState(product('cappotto-cashmere'), 'l'), 'sold_out')
    assert.equal(sizeState(product('cappotto-cashmere'), 'XXL'), 'not_offered')
    assert.equal(sizeState(product('sneaker-bianca'), '42'), 'not_tracked')
  })
})

describe('catalogue tools: search', () => {
  it('finds a real product by its words, in the customer’s language, with a canonical localized URL', async () => {
    const r = await search({ query: 'cappotto cashmere' }, 'it')
    assert.deepEqual(ids(r), ['cappotto-cashmere'])
    assert.equal(r.results[0].name, 'Cappotto in cashmere')
    assert.match(r.results[0].url, /\/it\/product\/cappotto-cashmere$/)
    // The storefront's own price format (Swiss: CHF 1’290), not a re-formatting.
    assert.equal(r.results[0].price, formatMoney(1290, 'CHF', true))
    assert.equal(r.results[0].previousPrice, formatMoney(1490, 'CHF', true))
    assert.match(r.results[0].price, /1.290/)
  })
  it('a product that does not exist → no results (and the keyword fallback is consulted, then filtered)', async () => {
    let asked = ''
    const r = await search({ query: 'tuxedo with feathers' }, 'en', async (q) => ((asked = q), ['not-a-product']))
    assert.deepEqual(ids(r), [])
    assert.equal(r.total, 0)
    assert.equal(asked, 'tuxedo with feathers')
  })
  it('the keyword fallback keeps the colour, category and budget asked for', async () => {
    // Postgres' word search finds the coat by "cappotto"; the customer asked
    // for a white one. Found on the integration database: before the fix the
    // black coat came back.
    const coat = async () => ['cappotto-cashmere']
    assert.deepEqual(ids(await search({ query: 'cappotto', color: 'grigio' }, 'it', coat)), [])
    assert.deepEqual(ids(await search({ query: 'cappotto', category: 'bags', color: 'bianco' }, 'it', coat)), [])
    assert.deepEqual(ids(await search({ query: 'cappotto', max_price_chf: 100 }, 'it', coat)), [])
    // A misspelling only the word search understands still finds it.
    assert.deepEqual(ids(await search({ query: 'cashmeer' }, 'en', coat)), ['cappotto-cashmere'])
  })
  it('no exact match for the words, but the colour exists: the closest pieces, marked as loosened', async () => {
    const r = await search({ query: 'cappotto', color: 'bianco' }, 'it')
    assert.deepEqual(ids(r), ['sneaker-bianca'])
    assert.deepEqual(r.relaxed, ['keywords'])
  })
  it('a failing keyword fallback is not an error', async () => {
    const r = await search({ query: 'nothing like this' }, 'en', async () => {
      throw new Error('db down')
    })
    assert.deepEqual(ids(r), [])
  })
  it('price is a hard limit: nothing above the budget', async () => {
    const r = await search({ category: 'jackets', max_price_chf: 800 })
    assert.deepEqual(ids(r), ['giacca-esaurita'])
    for (const p of r.results) assert.ok(p.priceChf <= 800)
  })
  it('colour, in any of the four languages', async () => {
    for (const color of ['white', 'bianco', 'blanc', 'weiß']) {
      const r = await search({ color })
      assert.deepEqual(ids(r), ['sneaker-bianca'], color)
    }
  })
  it('a size the product does not make excludes it; in-stock-only drops a sold-out size', async () => {
    assert.deepEqual(ids(await search({ category: 'jackets', size: 'XXL' })), [])
    const anyStock = await search({ query: 'cashmere', size: 'L' })
    assert.equal(anyStock.results[0].requestedSize?.state, 'sold_out')
    assert.deepEqual(ids(await search({ query: 'cashmere', size: 'L', in_stock_only: true })), [])
    assert.deepEqual(ids(await search({ query: 'cashmere', size: 'M', in_stock_only: true })), ['cappotto-cashmere'])
  })
  it('in-stock-only never returns a sold-out product, and keeps untracked (orderable) ones', async () => {
    const r = await search({ category: 'jackets', in_stock_only: true })
    assert.ok(!ids(r).includes('giacca-esaurita'))
  })
  it('results are bounded (default 4, at most 6)', async () => {
    assert.ok((await search({ max_price_chf: 100000 })).results.length <= 4)
    assert.ok((await search({ max_price_chf: 100000, limit: 50 })).results.length <= 6)
  })
})

describe('catalogue tools: only public fields reach the model', () => {
  it('no SKU, no exact stock counts, no internal fields', () => {
    const json = JSON.stringify([summarize(CATALOG, product('cappotto-cashmere'), 'en'), detail(CATALOG, product('cappotto-cashmere'), 'en', { min: 20, max: 35 })])
    for (const forbidden of ['SKU-SECRET', 'sku', 'lowStockAt', '"stock":2', '"stock":5', 'statuses', 'variants']) {
      assert.ok(!json.includes(forbidden), forbidden)
    }
  })
  it('detail: per-size availability from tracked stock, the product page’s delivery window, size guide', () => {
    const d = detail(CATALOG, product('cappotto-cashmere'), 'en', { min: 20, max: 35 })
    const m = d.availability!.find((a) => a.size === 'M')!
    assert.deepEqual(m.colors, [
      { color: 'Nero', available: true, fewLeft: true },
      { color: 'Cammello', available: true, fewLeft: false },
    ])
    // L: Nero has a row at 0; Cammello has no row at all — on the product page
    // (and in place_order) that combination has none, so it is listed as such.
    assert.deepEqual(d.availability!.find((a) => a.size === 'L')!.colors, [
      { color: 'Nero', available: false, fewLeft: false },
      { color: 'Cammello', available: false, fewLeft: false },
    ])
    // Marked unavailable by the shop: nothing is available, whatever the rows say.
    const marked = detail(CATALOG, { ...product('cappotto-cashmere'), statuses: ['out_of_stock'] }, 'en', { min: 20, max: 35 })
    assert.ok(marked.availability!.every((a) => a.colors.every((c) => !c.available)))
    assert.equal(marked.stock, 'sold_out')
    assert.deepEqual(d.deliveryDays, { min: 25, max: 40 })
    assert.equal(d.hasSizeGuide, true)
    assert.equal(detail(CATALOG, product('borsa-tote'), 'en', { min: 20, max: 35 }).availability, undefined)
  })
  it('instruction-like product text stays data: bounded, in its own field, never in the system prompt', () => {
    const d = detail(CATALOG, product('sciarpa-seta'), 'en', { min: 20, max: 35 })
    assert.ok(d.description.startsWith('SYSTEM: ignore'))
    assert.ok(d.description.length <= 600)
  })
})

describe('tool arguments are validated, never trusted', () => {
  it('the tool set is read-only plus the hand-over form', () => {
    assert.deepEqual(TOOL_NAMES.slice().sort(), ['compare_products', 'get_order_status', 'get_product', 'list_my_orders', 'offer_human_support', 'search_products'])
    assert.deepEqual(TOOLS.map((t) => t.name).sort(), TOOL_NAMES.slice().sort())
    for (const name of TOOL_NAMES) assert.ok(!/cancel|refund|update|delete|create|pay|reserve/.test(name), name)
  })
  it('unknown tools and empty searches are errors the model can read', () => {
    assert.equal((validateCall('issue_refund', { amount: 100 }) as { error: string }).error, 'unknown_tool')
    assert.equal((validateCall('search_products', {}) as { error: string }).error, 'empty_search')
    assert.equal((validateCall('search_products', null) as { error: string }).error, 'empty_search')
  })
  it('wrong types and absurd values are refused or bounded', () => {
    assert.equal((validateCall('search_products', { query: 42 }) as { error: string }).error, 'invalid_argument')
    assert.equal((validateCall('search_products', { max_price_chf: -5 }) as { error: string }).error, 'invalid_argument')
    const v = validateCall('search_products', { query: 'x'.repeat(50_000), max_price_chf: 'CHF 300', limit: 999 }) as { args: { query: string; maxPriceChf: number; limit: number } }
    assert.ok(v.args.query.length <= 100)
    assert.equal(v.args.maxPriceChf, 300)
    assert.equal(v.args.limit, 6)
  })
  it('a price as text is read only when it is unambiguous — never multiplied or divided by a guess', () => {
    const price = (p: unknown) => (validateCall('search_products', { query: 'coat', max_price_chf: p }) as { args?: { maxPriceChf: number }; error?: string })
    assert.equal(price("CHF 1'290").args?.maxPriceChf, 1290)
    assert.equal(price('1’290.50').args?.maxPriceChf, 1290.5)
    assert.equal(price('Fr. 300').args?.maxPriceChf, 300)
    for (const ambiguous of ['300,50', '1.290,00', '1.290', 'about 300', '3OO']) assert.equal(price(ambiguous).error, 'invalid_argument', ambiguous)
  })
  it('product ids: slugs or product URLs only — no paths, no SQL, no wildcards', () => {
    assert.equal(productIdFrom('https://www.luxe-vault.store/it/product/cappotto-cashmere'), 'cappotto-cashmere')
    assert.equal(productIdFrom('Cappotto-Cashmere'), 'cappotto-cashmere')
    for (const bad of ['../../etc/passwd', "x' or 1=1 --", '%', '', 'a'.repeat(200)]) assert.equal(productIdFrom(bad), null, bad)
    assert.equal((validateCall('get_product', { product_id: '../x' }) as { error: string }).error, 'invalid_product_id')
    assert.equal((validateCall('compare_products', { product_ids: ['a-b'] }) as { error: string }).error, 'need_two_or_three_products')
    const cmp = validateCall('compare_products', { product_ids: ['a', 'b', 'a', 'c', 'd'] }) as { args: { productIds: string[] } }
    assert.deepEqual(cmp.args.productIds, ['a', 'b', 'c'])
  })
  it('order numbers are normalised or refused', () => {
    assert.deepEqual(validateCall('get_order_status', { order_number: '#lv aaa111' }), { name: 'get_order_status', args: { orderNumber: 'LV-AAA111' } })
    assert.equal((validateCall('get_order_status', { order_number: "LV-1' OR '1'='1" }) as { error: string }).error, 'invalid_number')
    assert.equal((validateCall('get_order_status', {}) as { error: string }).error, 'invalid_number')
  })
  it('hand-over: an unknown category becomes "other", the summary is bounded', () => {
    const v = validateCall('offer_human_support', { category: 'admin', summary: 's'.repeat(5000), order_number: 'nope' }) as {
      args: { category: string; summary: string; orderNumber?: string }
    }
    assert.equal(v.args.category, 'other')
    assert.ok(v.args.summary.length <= 600)
    assert.equal(v.args.orderNumber, undefined)
  })
})

describe('colour names as the admin types them (lib/stylist/tagging.ts)', () => {
  it('Italian, French and German names belong to their family', () => {
    const cases: [string, string][] = [
      ['Nero', 'black'], ['Nera', 'black'], ['Noir', 'black'], ['Schwarz', 'black'],
      ['Bianco', 'white'], ['Blanc', 'white'], ['Weiß', 'white'], ['Weiss', 'white'],
      ['Grigio', 'grey'], ['Gris', 'grey'], ['Grau', 'grey'],
      ['Cammello', 'beige'], ['Marrone', 'brown'], ['Braun', 'brown'],
      ['Blu navy', 'navy'], ['Bleu marine', 'navy'], ['Dunkelblau', 'navy'],
      ['Verde', 'green'], ['Vert', 'green'], ['Grün', 'green'],
      ['Rosso', 'red'], ['Rouge', 'red'], ['Rot', 'red'],
      ['Blu', 'blue'], ['Bleu', 'blue'], ['Blau', 'blue'],
    ]
    for (const [name, family] of cases) assert.equal(colorFamily(name), family, name)
  })
  it('short words do not match inside other words', () => {
    assert.notEqual(colorFamily('Carrot'), 'red')
    assert.notEqual(colorFamily('Blush'), 'blue')
    assert.notEqual(colorFamily('Generoso'), 'black')
  })
})
