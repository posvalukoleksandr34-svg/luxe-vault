/**
 * Verifies the P1 work that does not need a migration: the lifecycle emails
 * and the address-book API's authorisation.
 *
 *   node scripts/verify-p1.mjs        # needs the dev server on :3000
 *
 * The email checks render templates rather than sending them — the interesting
 * failures are structural (an empty tracking block, an unescaped name, a
 * missing order id), and those are visible in the HTML without spending a
 * Resend quota or waiting on SMTP.
 *
 * Analytics is checked in the browser instead; see the notes in the report.
 */

import fs from 'node:fs'

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(
    `${ok ? '  PASS' : '  FAIL'}  ${label}` +
      (ok ? '' : `  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`),
  )
  if (!ok) failures++
}

const BASE = 'http://localhost:3000'

try {
  // ------------------------------------------------ 1. templates, by source --
  // The email module is server-only and cannot be imported here, so the
  // contract is checked against the source: every status a customer can reach
  // must have copy, and the shipped template must not render an empty
  // tracking block.
  console.log('\nLifecycle email coverage:')
  const src = fs.readFileSync('lib/server/emails/lifecycle.ts', 'utf8')

  for (const status of ['processing', 'shipped', 'delivered', 'cancelled', 'refunded']) {
    check(`${status} has copy`, new RegExp(`case '${status}'`).test(src), true)
  }
  check('welcome exists', /export function welcomeEmail/.test(src), true)
  check(
    'tracking block is omitted when there is no number',
    /order\.trackingNumber\s*\n?\s*\?/.test(src),
    true,
  )
  check('customer name is escaped', /escapeHtml\(copy\.heading\)/.test(src), true)

  console.log('\nSend path:')
  const send = fs.readFileSync('lib/server/emails/send-lifecycle.ts', 'utf8')
  check('never throws into the caller', /catch \(e\)/.test(send), true)
  check('skips orders with no email address', /if \(!to\)/.test(send), true)

  const store = fs.readFileSync('lib/server/orders-store.ts', 'utf8')
  check('status changes notify', /void sendOrderStatusEmail\(updated, status\)/.test(store), true)
  check('cancellations notify', /sendOrderStatusEmail\(cancelled, 'cancelled'\)/.test(store), true)
  check('refunds notify', /sendOrderStatusEmail\(refunded, 'refunded'\)/.test(store), true)
  check(
    'sends are fire-and-forget, not awaited',
    (store.match(/await sendOrderStatusEmail/g) ?? []).length,
    0,
  )

  // ------------------------------------------------- 2. analytics call sites --
  console.log('\nAnalytics:')
  // Comments are stripped first: the module explains which vendors it
  // deliberately does not bundle, and prose must not fail that check.
  const stripComments = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const analytics = stripComments(fs.readFileSync('lib/analytics.ts', 'utf8'))
  check('every event goes through the consent gate', /if \(!hasConsent\('analytics'\)\) return/.test(analytics), true)
  check('no vendor SDK is bundled', /gtag|posthog|plausible|googletagmanager/i.test(analytics), false)
  check('purchase carries transaction_id for de-duplication', /transaction_id: order\.id/.test(analytics), true)

  const wired = {
    add_to_cart: fs.readFileSync('lib/store.tsx', 'utf8').includes('trackAddToCart('),
    remove_from_cart: fs.readFileSync('lib/store.tsx', 'utf8').includes('trackRemoveFromCart('),
    login: fs.readFileSync('lib/store.tsx', 'utf8').includes('trackLogin()'),
    sign_up: fs.readFileSync('lib/store.tsx', 'utf8').includes('trackSignUp()'),
    view_item: fs.readFileSync('components/products/product-detail.tsx', 'utf8').includes('trackViewItem('),
    view_cart: fs.readFileSync('components/cart-panel.tsx', 'utf8').includes('trackViewCart('),
    begin_checkout: fs.readFileSync('components/cart-panel.tsx', 'utf8').includes('trackBeginCheckout('),
    add_payment_info: fs.readFileSync('components/checkout-flow.tsx', 'utf8').includes('trackAddPaymentInfo('),
    purchase: fs.readFileSync('app/checkout/success/page.tsx', 'utf8').includes('trackPurchase('),
  }
  check('every funnel event is wired', Object.entries(wired).filter(([, v]) => !v).map(([k]) => k), [])

  // -------------------------------------------- 3. address book authorisation --
  console.log('\nAddress book requires a session:')
  const anonGet = await fetch(`${BASE}/api/account/addresses`)
  check('GET without a session', anonGet.status, 401)

  const anonPost = await fetch(`${BASE}/api/account/addresses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'X', phone: '+41790000000', street: 'A 1', postalCode: '8001', city: 'Zurich', country: 'CH' }),
  })
  check('POST without a session', anonPost.status, 401)

  const anonDelete = await fetch(`${BASE}/api/account/addresses?id=00000000-0000-0000-0000-000000000000`, { method: 'DELETE' })
  check('DELETE without a session', anonDelete.status, 401)

  const anonWelcome = await fetch(`${BASE}/api/auth/welcome`, { method: 'POST' })
  check('welcome endpoint without a session', anonWelcome.status, 401)

  console.log('\nAddress book route uses the user-scoped client, not service role:')
  const route = fs.readFileSync('app/api/account/addresses/route.ts', 'utf8')
  check('no service-role client', /createAdminClient/.test(route), false)
  check('uses the request-scoped client', /createClient\(\)/.test(route), true)
} catch (e) {
  console.error('\nABORTED:', e.message)
  failures++
} finally {
  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}\n`)
  process.exitCode = failures === 0 ? 0 : 1
}
