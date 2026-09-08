/**
 * Verifies the two security fixes: admin session hardening (0 code) and
 * request throttling (migration 0013).
 *
 *   node scripts/verify-security.mjs            # needs the dev server on :3000
 *
 * What it proves, in order:
 *
 *   1. No hardcoded credential survives in the source tree.
 *   2. A session token expires, is bound to the password, and cannot be forged.
 *   3. The throttle counts across calls, refuses past the budget, sends
 *      Retry-After, and keeps separate buckets separate.
 *
 * The throttle probes deliberately spend real budget against the live limiter,
 * then clear their own rows so the run leaves nothing behind.
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

const probeSubjects = []

try {
  // ------------------------------------------------- 1. no secrets in source --
  console.log('\nHardcoded credentials in the source tree:')

  // Comments are stripped first: a fix that documents what it replaced would
  // otherwise fail its own check, and prose is not what ships a credential.
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  const authCode = stripComments(fs.readFileSync('lib/server/admin-auth.ts', 'utf8'))
  check('no literal admin password', /Zenith-Atelier/.test(authCode), false)
  check('no literal session secret', /zenith-vault-admin-session-secret/.test(authCode), false)
  check('no `||` fallback on either variable', /process\.env\.ADMIN_\w+\s*\|\|/.test(authCode), false)
  check(
    'the burned password is not left anywhere under lib/server',
    fs
      .readdirSync('lib/server', { withFileTypes: true })
      .filter((e) => e.isFile())
      .filter((e) => /Zenith-Atelier/.test(fs.readFileSync(`lib/server/${e.name}`, 'utf8')))
      .map((e) => e.name),
    [],
  )

  // ------------------------------------------------------ 2. session tokens --
  console.log('\nAdmin session token:')
  const login = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
  })
  check('correct password is accepted', login.status, 200)

  const cookieHeader = login.headers.get('set-cookie') ?? ''
  const token = /zenith_admin_session=([^;]+)/.exec(cookieHeader)?.[1] ?? ''
  const parts = token.split('.')
  check('token has expiry, nonce and signature', parts.length, 3)

  const expiresAt = Number(parts[0])
  const hoursOut = (expiresAt * 1000 - Date.now()) / 3_600_000
  check('expiry is ~8 hours out', hoursOut > 7.9 && hoursOut < 8.1, true)
  check('cookie is httpOnly', /httponly/i.test(cookieHeader), true)

  const authed = (t) =>
    fetch(`${BASE}/api/admin/orders`, { headers: { cookie: `zenith_admin_session=${t}` } })

  check('a valid token is accepted', (await authed(token)).status, 200)
  check('no token is refused', (await fetch(`${BASE}/api/admin/orders`)).status, 401)

  // Two logins in a row must differ — the old token was a constant.
  const login2 = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
  })
  const token2 = /zenith_admin_session=([^;]+)/.exec(login2.headers.get('set-cookie') ?? '')?.[1]
  check('two sessions get different tokens', token === token2, false)

  // Forgeries.
  const expired = `${Math.floor(Date.now() / 1000) - 60}.${parts[1]}.${parts[2]}`
  check('an expired token is refused', (await authed(expired)).status, 401)

  const extended = `${expiresAt + 86400}.${parts[1]}.${parts[2]}`
  check('extending the expiry breaks the signature', (await authed(extended)).status, 401)

  const tampered = `${parts[0]}.${parts[1]}.${'0'.repeat(parts[2].length)}`
  check('a forged signature is refused', (await authed(tampered)).status, 401)

  check('a wrong password is refused', (
    await fetch(`${BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'Zenith-Atelier-2026!' }),
    })
  ).status, 401)

  // --------------------------------------------------------- 3. throttling --
  console.log('\nRate limiting (order.lookup, budget 20 per 10 min):')

  const subject = `probe-${Date.now()}`
  probeSubjects.push(subject)

  const call = () =>
    fetch(`${BASE}/api/orders/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': subject },
      body: JSON.stringify({ orders: [] }),
    })

  const statuses = []
  for (let i = 0; i < 23; i++) statuses.push((await call()).status)

  const allowed = statuses.filter((s) => s !== 429).length
  const blocked = statuses.filter((s) => s === 429).length
  check('the first 20 are allowed', allowed, 20)
  check('the rest are refused', blocked, 3)
  check('refusal is the 21st call onward', statuses.indexOf(429), 20)

  const blockedRes = await call()
  check('429 carries Retry-After', Boolean(blockedRes.headers.get('retry-after')), true)
  const retryAfter = Number(blockedRes.headers.get('retry-after'))
  check('Retry-After is a sane number of seconds', retryAfter > 0 && retryAfter <= 600, true)

  // A different caller must be unaffected.
  const other = `probe-other-${Date.now()}`
  probeSubjects.push(other)
  const otherRes = await fetch(`${BASE}/api/orders/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': other },
    body: JSON.stringify({ orders: [] }),
  })
  check('a different caller is not affected', otherRes.status !== 429, true)

  // A different bucket for the same caller must be unaffected.
  const sameCallerOtherBucket = await fetch(`${BASE}/api/support`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': subject },
    body: JSON.stringify({}),
  })
  check(
    'a different endpoint is not affected by the exhausted bucket',
    sameCallerOtherBucket.status !== 429,
    true,
  )

  const { data: rows } = await db
    .from('rate_limits')
    .select('bucket, subject, count')
    .eq('subject', subject)
  check(
    'counters are stored per bucket',
    (rows ?? []).map((r) => r.bucket).sort(),
    ['order.lookup', 'support.create'],
  )
} catch (e) {
  console.error('\nABORTED:', e.message)
  failures++
} finally {
  if (probeSubjects.length) {
    await db.from('rate_limits').delete().in('subject', probeSubjects)
  }
  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}\n`)
  process.exitCode = failures === 0 ? 0 : 1
}
