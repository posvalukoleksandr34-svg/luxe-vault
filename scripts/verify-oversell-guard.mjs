/**
 * Proves the oversell guard from migration 0012.
 *
 *   node scripts/verify-oversell-guard.mjs
 *
 * The claim being tested is not "stock goes down when you buy something" —
 * that is easy and would pass even with the broken read-modify-write it
 * replaced. The claim is that N buyers racing for the last unit produce
 * exactly one order, which is the only version that matters and the only one
 * application code cannot deliver on its own.
 *
 * Creates its own throwaway variant on an existing product, exercises it, and
 * removes everything it made. Safe to run against the live database.
 */

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const unquote = (v) => v.replace(/^["'](.*)["']$/, '$1')
const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), unquote(l.slice(i + 1).trim())]
    }),
)

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const SIZE = '__probe__'
const COLOR = '__probe__'
const RACERS = 8

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`}`)
  if (!ok) failures++
}

const orderNumbers = []
let variantId = null
let product = null

async function stockNow() {
  const { data } = await db.from('product_variants').select('stock').eq('id', variantId).single()
  return data?.stock ?? null
}

function orderPayload(n) {
  return {
    order_number: n,
    user_id: '',
    lookup_token: `probe-${n}`,
    status: 'pending',
    customer_name: 'Oversell Probe',
    customer_email: '',
    customer_phone: '+41000000000',
    address_line: 'Probe',
    street: '',
    postal_code: '',
    city: '',
    country: '',
    subtotal: 1,
    discount: 0,
    total: 1,
    promo: '',
    payment: 'probe',
    payment_status: '',
    shipping_type: 'standard',
    delivery_estimate_min: '',
    delivery_estimate_max: '',
  }
}

function itemPayload() {
  return [
    {
      product_id: product.slug,
      name: 'Oversell probe',
      image: '',
      unit_price: 1,
      size: SIZE,
      color: COLOR,
      qty: 1,
    },
  ]
}

async function cleanup() {
  if (orderNumbers.length) {
    await db.from('orders').delete().in('order_number', orderNumbers)
  }
  if (variantId) {
    await db.from('product_variants').delete().eq('id', variantId)
  }
}

try {
  const { data: products, error: pErr } = await db.from('products').select('id, slug').limit(1)
  if (pErr) throw pErr
  if (!products?.length) throw new Error('No products in the catalogue to test against.')
  product = products[0]

  console.log(`\nProbing against product "${product.slug}" (${SIZE} / ${COLOR})\n`)

  // ---------------------------------------------------------------- setup --
  const { data: variant, error: vErr } = await db
    .from('product_variants')
    .insert({ product_id: product.id, size: SIZE, color: COLOR, stock: 1, low_stock_at: 1 })
    .select('id')
    .single()
  if (vErr) throw new Error(`Could not create the probe variant — is 0012 applied? ${vErr.message}`)
  variantId = variant.id

  // -------------------------------------------------- 1. the actual race --
  console.log(`${RACERS} simultaneous buyers, 1 unit in stock:`)

  const results = await Promise.all(
    Array.from({ length: RACERS }, (_, i) => {
      const n = `PROBE-${Date.now().toString(36)}-${i}`
      orderNumbers.push(n)
      return db
        .rpc('place_order', { p_order: orderPayload(n), p_items: itemPayload() })
        .then((r) => (r.error ? { ok: false, message: r.error.message } : { ok: true }))
    }),
  )

  const won = results.filter((r) => r.ok).length
  const refused = results.filter((r) => !r.ok && r.message.includes('INSUFFICIENT_STOCK')).length
  const other = results.filter((r) => !r.ok && !r.message.includes('INSUFFICIENT_STOCK'))

  check('exactly one order succeeded', won, 1)
  check('everyone else was refused for stock', refused, RACERS - 1)
  check('no unexpected errors', other.map((o) => o.message), [])
  check('stock is now zero', await stockNow(), 0)

  // ------------------------------------------- 2. a sold-out variant sells nothing --
  console.log('\nBuying again at zero stock:')
  const n2 = `PROBE-${Date.now().toString(36)}-again`
  orderNumbers.push(n2)
  const retry = await db.rpc('place_order', { p_order: orderPayload(n2), p_items: itemPayload() })
  check('refused', Boolean(retry.error?.message.includes('INSUFFICIENT_STOCK')), true)
  check('stock unchanged', await stockNow(), 0)

  // --------------------------------------------------- 3. restock on cancel --
  console.log('\nCancelling the winning order:')
  const { data: placed } = await db
    .from('orders')
    .select('order_number')
    .in('order_number', orderNumbers)
    .limit(1)
    .single()

  const first = await db.rpc('restore_order_stock', { p_order_number: placed.order_number })
  check('restock reported success', first.data, true)
  check('the unit came back', await stockNow(), 1)

  console.log('\nCancelling the same order a second time:')
  const second = await db.rpc('restore_order_stock', { p_order_number: placed.order_number })
  check('restock declined to run twice', second.data, false)
  check('stock was not double-credited', await stockNow(), 1)

  // ------------------------------------------------ 4. untracked is untouched --
  console.log('\nUntracked variant (no row for this size/colour):')
  const n3 = `PROBE-${Date.now().toString(36)}-untracked`
  orderNumbers.push(n3)
  const untracked = await db.rpc('place_order', {
    p_order: orderPayload(n3),
    p_items: [{ ...itemPayload()[0], product_id: 'definitely-not-a-real-product' }],
  })
  check('order for an untracked product still succeeds', !untracked.error, true)
} catch (e) {
  console.error('\nABORTED:', e.message)
  failures++
} finally {
  await cleanup()
  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}\n`)
  process.exitCode = failures === 0 ? 0 : 1
}
