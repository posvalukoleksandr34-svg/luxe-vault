/**
 * Verifies the P3 work: the scheduled sweep, back-in-stock alerts, lint, and
 * the accessibility fixes.
 *
 *   node scripts/verify-p3.mjs        # needs the dev server on :3000
 *
 * The sweep and the alerts are the interesting ones, and for the same reason
 * the coupon and stock work was: the failure that matters is not "does it
 * send" but "can it send twice". Both claim their rows in the database before
 * sending, so the test is that two concurrent sweeps still produce one send.
 */

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const BASE = 'http://localhost:3000'
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

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(
    `${ok ? '  PASS' : '  FAIL'}  ${label}` +
      (ok ? '' : `  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`),
  )
  if (!ok) failures++
}

const probeEmails = []

try {
  // ------------------------------------------------------- 1. lint is back --
  console.log('\nLint:')
  const config = fs.readFileSync('next.config.js', 'utf8')
  check('ignoreDuringBuilds is off', /ignoreDuringBuilds:\s*false/.test(config), true)

  // ------------------------------------------------- 2. accessibility fixes --
  console.log('\nAccessibility:')
  const layout = fs.readFileSync('app/layout.tsx', 'utf8')
  check('skip link exists', /href="#main"/.test(layout), true)
  check('skip link is hidden until focused', /sr-only[^"]*focus:not-sr-only/.test(layout), true)

  const home = await fetch(`${BASE}/`).then((r) => r.text())
  check('skip link is in the server HTML', /href="#main"/.test(home), true)
  check('the skip target exists', /<main[^>]*id="main"/.test(home), true)

  const checkout = fs.readFileSync('components/checkout-flow.tsx', 'utf8')
  check('field errors are associated with their input', /aria-describedby=\{error \? errorId/.test(checkout), true)

  for (const file of ['components/cart-panel.tsx', 'components/user-panel.tsx']) {
    const src = fs.readFileSync(file, 'utf8')
    const name = file.split('/').pop()
    check(`${name} is announced as a dialog`, /aria-modal="true"/.test(src), true)
    check(`${name} closes on Escape`, /e\.key === 'Escape'/.test(src), true)
  }

  const autocomplete = fs.readFileSync('components/address-autocomplete.tsx', 'utf8')
  check('combobox points at its listbox', /aria-controls=\{listboxId\}/.test(autocomplete), true)

  // -------------------------------------------------- 3. the sweep is gated --
  console.log('\nScheduled sweep:')
  const noAuth = await fetch(`${BASE}/api/cron/sweep`, { method: 'POST' })
  // 401 when a secret is configured, 503 when it is not. Both are refusals;
  // what must never happen is a 200 for an unauthenticated caller.
  check('refuses an unauthenticated caller', [401, 503].includes(noAuth.status), true)

  const wrongAuth = await fetch(`${BASE}/api/cron/sweep`, {
    method: 'POST',
    headers: { authorization: 'Bearer definitely-not-the-secret' },
  })
  check('refuses a wrong secret', [401, 503].includes(wrongAuth.status), true)

  // ------------------------------------------------ 4. back-in-stock alerts --
  console.log('\nBack-in-stock alerts:')

  const { data: products } = await db.from('products').select('id, slug').limit(1)
  const product = products?.[0]
  if (!product) throw new Error('No products to test against.')

  const SIZE = '__p3probe__'
  const COLOR = '__p3probe__'
  const email = `p3probe-${Date.now()}@example.com`
  probeEmails.push(email)

  // A sold-out variant to subscribe to.
  const { data: variant, error: vErr } = await db
    .from('product_variants')
    .insert({ product_id: product.id, size: SIZE, color: COLOR, stock: 0 })
    .select('id')
    .single()
  if (vErr) throw new Error(`could not create the probe variant: ${vErr.message}`)

  const subscribe = (body) =>
    fetch(`${BASE}/api/stock-alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const bad = await subscribe({ productId: product.slug, size: SIZE, color: COLOR, email: 'nope' })
  check('rejects a malformed email', bad.status, 400)

  const first = await subscribe({ productId: product.slug, size: SIZE, color: COLOR, email })
  check('accepts a subscription to a sold-out variant', first.status, 201)

  const again = await subscribe({ productId: product.slug, size: SIZE, color: COLOR, email })
  const againBody = await again.json()
  check('a repeat subscription is idempotent', [again.status, againBody.already], [200, true])

  const unknown = await subscribe({ productId: 'not-a-product', size: SIZE, color: COLOR, email })
  check('rejects an unknown variant', unknown.status, 404)

  // Subscribing to something already in stock would fire on the next sweep and
  // read as spam about a product they could simply have bought.
  await db.from('product_variants').update({ stock: 5 }).eq('id', variant.id)
  const inStock = await subscribe({
    productId: product.slug, size: SIZE, color: COLOR, email: `other-${email}`,
  })
  check('refuses to subscribe to something in stock', inStock.status, 409)

  // ------------------------------------- 5. the claim cannot double-send --
  console.log('\nTwo concurrent sweeps claiming the same alert:')
  const claims = await Promise.all([
    db.rpc('claim_restock_alerts', { p_limit: 50 }),
    db.rpc('claim_restock_alerts', { p_limit: 50 }),
  ])

  const claimed = claims.flatMap((c) => (c.error ? [] : (c.data ?? [])))
  const mine = claimed.filter((r) => r.email === email)
  check('the alert was claimed exactly once', mine.length, 1)

  const { data: after } = await db
    .from('stock_alerts')
    .select('notified_at')
    .eq('email', email)
    .single()
  check('it is stamped as notified', Boolean(after?.notified_at), true)

  // A third sweep must find nothing left to do for it.
  const third = await db.rpc('claim_restock_alerts', { p_limit: 50 })
  check(
    'a later sweep does not re-claim it',
    ((third.data ?? [])).filter((r) => r.email === email).length,
    0,
  )

  await db.from('product_variants').delete().eq('id', variant.id)
} catch (e) {
  console.error('\nABORTED:', e.message)
  failures++
} finally {
  if (probeEmails.length) {
    await db.from('stock_alerts').delete().in('email', probeEmails)
    await db.from('stock_alerts').delete().like('email', 'other-p3probe-%')
  }
  await db.from('product_variants').delete().eq('size', '__p3probe__')
  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}\n`)
  process.exitCode = failures === 0 ? 0 : 1
}
