/**
 * Verifies that a language change reaches Supabase auth metadata, so that
 * {{ .Data.language }} is populated BEFORE any password-recovery email is
 * rendered.
 *
 *   node scripts/check-language-metadata.mjs
 *
 * Three parts:
 *   A. Static — the wiring exists in lib/store.tsx and nobody has re-added the
 *      unsupported `data` option to resetPasswordForEmail.
 *   B. Live    — round-trips a throwaway account through the exact HTTP call
 *      supabase.auth.updateUser({ data: { language } }) makes, proving the
 *      write lands and that it MERGES rather than replacing (a replace would
 *      silently wipe `name`). The probe account is always deleted.
 *   C. Report  — which real users currently have a language stored.
 *
 * Exits non-zero if any check fails, so it can gate a deploy.
 */
import { readFileSync } from 'node:fs'

const PROBE_EMAIL = 'language-metadata-check@example.com'
const PROBE_PASSWORD = 'CheckPassword123!'

let failures = 0
const pass = (m) => console.log(`  PASS  ${m}`)
const fail = (m) => {
  failures++
  console.log(`  FAIL  ${m}`)
}

function env(key) {
  const raw = readFileSync('.env.local', 'utf8')
  const v = raw.match(new RegExp(`^\\s*${key}\\s*=(.*)$`, 'm'))?.[1]?.trim()
  if (!v) throw new Error(`${key} missing from .env.local`)
  return v
}

// ---------------------------------------------------------------- A. static
console.log('\nA. Wiring in lib/store.tsx')
const store = readFileSync('lib/store.tsx', 'utf8')

if (/setLocale\s*=\s*useCallback/.test(store) && /updateUser\(\{\s*data:\s*\{\s*language/.test(store)) {
  pass('setLocale writes language to auth metadata')
} else {
  fail('setLocale does NOT call updateUser({ data: { language } })')
}

// Assert on the shape of the mechanism, not one operator: the guard is an
// early-return comparison, and phrasing the check around `!==` made it fail
// against correct code.
const capturesStored = /setMetadataLanguage\(/.test(store)
const comparesToLocale = /metadataLanguage\s*===\s*locale|metadataLanguage\s*!==\s*locale/.test(store)
const reactsToBoth = /\[currentUserId, locale, metadataLanguage\]/.test(store)
if (capturesStored && comparesToLocale && reactsToBoth) {
  pass('sync-on-sign-in effect present (covers switching language while logged out)')
} else {
  fail(
    'no sign-in sync — a guest who picks a language then signs in never stores it ' +
      `(captures=${capturesStored} compares=${comparesToLocale} reacts=${reactsToBoth})`,
  )
}

if (/data:\s*\{\s*name:[^}]*language:/.test(store)) {
  pass('signUp stores language alongside name')
} else {
  fail('signUp does not store language')
}

// The option does not exist on resetPasswordForEmail; re-adding it is a
// TypeScript error and would be dropped at runtime.
const resetCall = store.slice(store.indexOf('resetPasswordForEmail('))
if (/resetPasswordForEmail\([\s\S]{0,200}?\bdata:/.test(resetCall)) {
  fail('resetPasswordForEmail was given a `data` option — unsupported, silently ignored')
} else {
  pass('resetPasswordForEmail carries no unsupported `data` option')
}

if (/type:\s*'recovery'/.test(store)) {
  pass("verifyOtp uses type: 'recovery'")
} else {
  fail("verifyOtp is missing type: 'recovery'")
}

// ------------------------------------------------------------------ B. live
console.log('\nB. Live round-trip against Supabase')
const url = env('NEXT_PUBLIC_SUPABASE_URL')
const anon = env('NEXT_PUBLIC_SUPABASE_ANON_KEY')
const key = env('SUPABASE_SERVICE_ROLE_KEY')
const adminHeaders = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

let probeId = null
try {
  // email_confirm skips delivery, so this sends no mail.
  let res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      email: PROBE_EMAIL,
      password: PROBE_PASSWORD,
      email_confirm: true,
      user_metadata: { name: 'Probe', language: 'ru' },
    }),
  })
  const created = await res.json()
  probeId = created.id
  if (!probeId) throw new Error(`could not create probe user: ${JSON.stringify(created).slice(0, 200)}`)

  res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: PROBE_EMAIL, password: PROBE_PASSWORD }),
  })
  const token = (await res.json()).access_token
  if (!token) throw new Error('could not sign in as probe user')

  // Byte-for-byte what supabase.auth.updateUser({ data: { language } }) sends.
  res = await fetch(`${url}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { language: 'it' } }),
  })
  const after = (await res.json()).user_metadata ?? {}

  if (after.language === 'it') pass('language write reaches auth metadata')
  else fail(`language not stored (got ${JSON.stringify(after.language)})`)

  if (after.name === 'Probe') pass('metadata MERGES — existing keys such as name survive')
  else fail('metadata was REPLACED — writing language would wipe name')
} catch (e) {
  fail(`live round-trip failed: ${e.message}`)
} finally {
  if (probeId) {
    await fetch(`${url}/auth/v1/admin/users/${probeId}`, { method: 'DELETE', headers: adminHeaders })
    console.log('  ....  probe account deleted')
  }
}

// ---------------------------------------------------------------- C. report
console.log('\nC. Real accounts')
try {
  const res = await fetch(`${url}/auth/v1/admin/users?per_page=100`, { headers: adminHeaders })
  const users = (await res.json()).users ?? []
  if (users.length === 0) console.log('  (no users yet)')
  for (const u of users) {
    const lang = u.user_metadata?.language
    console.log(
      `  ${lang ? `[${lang}]` : '[  ]'}  ${u.email}` +
        (lang ? '' : '  <- no language yet; will be set on next sign-in'),
    )
  }
} catch (e) {
  fail(`could not list users: ${e.message}`)
}

console.log(
  failures === 0
    ? '\nAll checks passed.\n'
    : `\n${failures} check(s) FAILED.\n`,
)
process.exit(failures === 0 ? 0 : 1)
