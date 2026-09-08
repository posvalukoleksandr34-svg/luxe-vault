/**
 * Verifies migrations 0014 (shipping + tax) and 0015 (coupons).
 *
 *   node scripts/verify-commerce.mjs      # needs the dev server on :3000
 *
 * Coupons are money, so they get the same treatment inventory got: the
 * interesting test is not "a valid code gives a discount" but that every way
 * of cheating one fails — an expired code, a code below its minimum, a code
 * belonging to someone else, and two people racing for the last redemption of
 * a single-use code.
 *
 * Creates its own throwaway coupons and removes them afterwards.
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

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(
    `${ok ? '  PASS' : '  FAIL'}  ${label}` +
      (ok ? '' : `  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`),
  )
  if (!ok) failures++
}

const codes = []

async function redeem(code, subtotal, opts = {}) {
  const { data, error } = await db.rpc('redeem_coupon', {
    p_code: code,
    p_subtotal: subtotal,
    p_user_id: opts.userId ?? null,
    p_product_slugs: opts.productSlugs ?? [],
    p_commit: opts.commit ?? false,
  })
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data[0] : data
}

async function makeCoupon(row) {
  codes.push(row.code)
  const { error } = await db.from('coupons').insert(row)
  if (error) throw new Error(`could not create ${row.code}: ${error.message}`)
}

try {
  // ------------------------------------------------- 1. shipping + tax cols --
  console.log('\nOrder money columns:')
  const { data: cols, error: colErr } = await db
    .from('orders')
    .select('shipping_cost, tax, coupon_id')
    .limit(1)
  check('shipping_cost, tax and coupon_id exist', colErr === null, true)
  if (colErr) throw new Error(`0014/0015 not applied: ${colErr.message}`)
  void cols

  // ------------------------------------------------------ 2. discount kinds --
  console.log('\nDiscount kinds:')
  await makeCoupon({ code: 'PROBEPCT', kind: 'percent', value: 25, active: true })
  await makeCoupon({ code: 'PROBEFIX', kind: 'fixed', value: 30, active: true })

  check('percentage discount', Number((await redeem('PROBEPCT', 200)).discount), 50)
  check('fixed discount', Number((await redeem('PROBEFIX', 200)).discount), 30)
  // A fixed coupon worth more than the basket must not create a negative total.
  check('fixed discount is capped at the basket', Number((await redeem('PROBEFIX', 10)).discount), 10)
  check('lower-case input matches', (await redeem('probepct', 200)).ok, true)

  // --------------------------------------------------------- 3. every guard --
  console.log('\nRules that must refuse:')
  await makeCoupon({ code: 'PROBEOFF', kind: 'percent', value: 10, active: false })
  await makeCoupon({
    code: 'PROBEEXP', kind: 'percent', value: 10, active: true,
    expires_at: new Date(Date.now() - 86400000).toISOString(),
  })
  await makeCoupon({
    code: 'PROBESOON', kind: 'percent', value: 10, active: true,
    starts_at: new Date(Date.now() + 86400000).toISOString(),
  })
  await makeCoupon({ code: 'PROBEMIN', kind: 'percent', value: 10, active: true, min_order_total: 500 })
  await makeCoupon({ code: 'PROBESCOPE', kind: 'percent', value: 10, active: true, product_slugs: ['some-other-product'] })

  check('unknown code', (await redeem('PROBENOPE', 200)).reason, 'NOT_FOUND')
  check('inactive code', (await redeem('PROBEOFF', 200)).reason, 'INACTIVE')
  check('expired code', (await redeem('PROBEEXP', 200)).reason, 'EXPIRED')
  check('not yet started', (await redeem('PROBESOON', 200)).reason, 'NOT_STARTED')
  check('below minimum order', (await redeem('PROBEMIN', 200)).reason, 'BELOW_MINIMUM')
  check('above minimum order', (await redeem('PROBEMIN', 600)).ok, true)
  check(
    'scoped to other products',
    (await redeem('PROBESCOPE', 200, { productSlugs: ['not-that-one'] })).reason,
    'NOT_APPLICABLE',
  )
  check(
    'scoped code applies to its own product',
    (await redeem('PROBESCOPE', 200, { productSlugs: ['some-other-product'] })).ok,
    true,
  )

  // A personal coupon must look identical to a nonexistent one from outside,
  // or the error message becomes a way to hunt for real codes.
  const someoneElse = '00000000-0000-0000-0000-0000000000ff'
  await makeCoupon({ code: 'PROBEMINE', kind: 'percent', value: 10, active: true, user_id: null })
  const { data: users } = await db.auth.admin.listUsers({ perPage: 1 })
  const realUser = users?.users?.[0]?.id
  if (realUser) {
    await db.from('coupons').update({ user_id: realUser }).eq('code', 'PROBEMINE')
    check('another customer sees NOT_FOUND, not "not yours"', (await redeem('PROBEMINE', 200, { userId: someoneElse })).reason, 'NOT_FOUND')
    check('anonymous sees NOT_FOUND', (await redeem('PROBEMINE', 200)).reason, 'NOT_FOUND')
    check('the owner can use it', (await redeem('PROBEMINE', 200, { userId: realUser })).ok, true)
  } else {
    console.log('  SKIP  per-customer coupon (no auth users to bind one to)')
  }

  // ------------------------------------------- 4. the race for the last use --
  console.log('\n8 simultaneous redemptions of a single-use code:')
  await makeCoupon({ code: 'PROBEONCE', kind: 'percent', value: 10, active: true, max_redemptions: 1 })

  const race = await Promise.all(
    Array.from({ length: 8 }, () => redeem('PROBEONCE', 200, { commit: true })),
  )
  check('exactly one redemption succeeded', race.filter((r) => r.ok).length, 1)
  check('the rest were told it is exhausted', race.filter((r) => r.reason === 'EXHAUSTED').length, 7)

  const { data: after } = await db.from('coupons').select('times_used').eq('code', 'PROBEONCE').single()
  check('times_used is exactly 1', after.times_used, 1)

  // ------------------------------------------------- 5. preview never spends --
  console.log('\nPreviewing does not consume a redemption:')
  await makeCoupon({ code: 'PROBEPREV', kind: 'percent', value: 10, active: true, max_redemptions: 1 })
  for (let i = 0; i < 5; i++) await redeem('PROBEPREV', 200, { commit: false })
  const { data: prev } = await db.from('coupons').select('times_used').eq('code', 'PROBEPREV').single()
  check('five previews left times_used at 0', prev.times_used, 0)
  check('the code is still usable afterwards', (await redeem('PROBEPREV', 200, { commit: true })).ok, true)

  // ------------------------------------------ 6. the public validate endpoint --
  console.log('\n/api/coupons/validate:')
  const call = (body) =>
    fetch('http://localhost:3000/api/coupons/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json())

  check('valid code returns its discount', (await call({ code: 'PROBEPCT', subtotal: 200 })).discount, 50)
  check('expired code is refused', (await call({ code: 'PROBEEXP', subtotal: 200 })).reason, 'EXPIRED')

  // The endpoint must never consume, whatever it is asked.
  await makeCoupon({ code: 'PROBEEP', kind: 'percent', value: 10, active: true, max_redemptions: 1 })
  await call({ code: 'PROBEEP', subtotal: 200, commit: true })
  const { data: ep } = await db.from('coupons').select('times_used').eq('code', 'PROBEEP').single()
  check('endpoint cannot be made to consume a redemption', ep.times_used, 0)
} catch (e) {
  console.error('\nABORTED:', e.message)
  failures++
} finally {
  if (codes.length) await db.from('coupons').delete().in('code', codes)
  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}\n`)
  process.exitCode = failures === 0 ? 0 : 1
}
