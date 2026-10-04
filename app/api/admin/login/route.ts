import { NextResponse, type NextRequest } from 'next/server'
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createSession,
  isAdminConfigured,
  verifyAdminPassword,
} from '@/lib/server/admin-auth'
import { recordSession } from '@/lib/server/admin-sessions'
import { checkTotp, isTotpConfigured } from '@/lib/server/admin-totp'
import { clientIp } from '@/lib/server/client-ip'
import { enforceLimit } from '@/lib/server/rate-limit'

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

  if (!(await verifyAdminPassword(password))) return refused

  // The code is checked (and spent) only after the password, so someone
  // without it cannot burn the admin's current code.
  let second: Awaited<ReturnType<typeof checkTotp>>
  try {
    second = await checkTotp(code)
  } catch (e) {
    console.error('[admin/login]', (e as Error).message)
    return NextResponse.json({ error: 'Вход временно недоступен' }, { status: 503 })
  }
  if (second === 'invalid') return refused
  if (second === 'unconfigured' && process.env.VERCEL_ENV === 'production') {
    console.warn('[admin/login] signed in with the password alone — set ADMIN_TOTP_SECRET (scripts/admin-totp-setup.mjs).')
  }

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
  response.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Lax, not Strict: a link to the console from a Telegram alert or an
    // email must arrive signed in. Cross-site WRITES are refused by the CSRF
    // guard in middleware.ts regardless.
    sameSite: 'lax',
    // '/', not '/admin': the console's API lives under /api/admin, and a
    // cookie has one path. (The __Host- prefix in production requires '/'.)
    path: '/',
    // Matches the expiry signed into the token itself. The cookie's lifetime
    // is a browser convenience; the token's is what the server enforces.
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  })
  return response
}
