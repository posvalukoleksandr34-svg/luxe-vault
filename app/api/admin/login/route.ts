import { NextResponse, type NextRequest } from 'next/server'
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
  createSession,
  isAdminConfigured,
  verifyAdminPassword,
  verifySessionToken,
} from '@/lib/server/admin-auth'
import { recordSession, revokeSession } from '@/lib/server/admin-sessions'
import { checkTotp, isTotpConfigured } from '@/lib/server/admin-totp'
import { clientIp } from '@/lib/server/client-ip'
import { enforceLimit } from '@/lib/server/rate-limit'
import { securityEvent } from '@/lib/server/security-events'

/** Whether the sign-in form must ask for the 6-digit code (lib/server/admin-totp.ts). */
export function GET() {
  return NextResponse.json({ mfa: isTotpConfigured() }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  // Shared across instances now — see lib/server/rate-limit.ts. The previous
  // in-memory throttle lived in one lambda's heap and did nothing about a
  // distributed or simply lucky attempt.
  const limited = await enforceLimit('admin.login', request)
  if (limited) return limited

  // Answered before any credential work so a misconfigured deployment says so
  // plainly instead of failing as though the password were wrong.
  if (!isAdminConfigured()) {
    console.error(
      '[admin/login] ADMIN_PASSWORD and/or ADMIN_SESSION_SECRET are not set. ' +
        'The console has no default credentials.',
    )
    return NextResponse.json(
      { error: 'Админ-панель не настроена' },
      { status: 503 },
    )
  }

  let password = ''
  let code: unknown
  try {
    const body = await request.json()
    password = typeof body?.password === 'string' ? body.password : ''
    code = body?.code
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  }

  // With the second factor on, a refusal never says WHICH of the two was
  // wrong — otherwise the password could be guessed on its own.
  const mfa = isTotpConfigured()
  const refused = NextResponse.json({ error: mfa ? 'Неверный пароль или код' : 'Неверный пароль' }, { status: 401 })

  if (!(await verifyAdminPassword(password))) {
    securityEvent('admin_login_failed', { ip: clientIp(request.headers), reason: 'password' })
    return refused
  }

  // The code is checked (and spent) only after the password, so someone
  // without it cannot burn the admin's current code.
  let second: Awaited<ReturnType<typeof checkTotp>>
  try {
    second = await checkTotp(code)
  } catch (e) {
    console.error('[admin/login]', (e as Error).message)
    securityEvent('admin_login_refused_config', { ip: clientIp(request.headers), reason: 'second factor unavailable' })
    return NextResponse.json({ error: 'Вход временно недоступен' }, { status: 503 })
  }
  if (second === 'invalid') {
    securityEvent('admin_login_failed', { ip: clientIp(request.headers), reason: 'code' })
    return refused
  }
  if (second === 'unconfigured' && process.env.VERCEL_ENV === 'production') {
    console.warn('[admin/login] signed in with the password alone — set ADMIN_TOTP_SECRET (scripts/admin-totp-setup.mjs).')
  }

  // A session this browser already held is revoked, not just overwritten: a
  // copy of the old cookie must not outlive the sign-in that replaced it.
  const previous = await verifySessionToken(request.cookies.get(ADMIN_SESSION_COOKIE)?.value)
  if (previous) await revokeSession(previous.nonce).catch(() => {})

  const { token, nonce, expiresAt } = await createSession()
  // Recorded server-side so signing out can revoke it (admin-sessions.ts).
  try {
    await recordSession({
      nonce,
      expiresAt,
      ip: clientIp(request.headers),
      userAgent: request.headers.get('user-agent') ?? undefined,
    })
  } catch (e) {
    console.error('[admin/login]', (e as Error).message)
    return NextResponse.json({ error: 'Вход временно недоступен' }, { status: 503 })
  }

  const response = NextResponse.json({ ok: true })
  // HttpOnly, Secure in production, SameSite=Lax, Path=/ — the reasons are
  // with adminSessionCookieOptions().
  response.cookies.set(ADMIN_SESSION_COOKIE, token, adminSessionCookieOptions())
  return response
}
