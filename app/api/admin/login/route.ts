import { NextResponse, type NextRequest } from 'next/server'
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  isAdminConfigured,
  verifyAdminPassword,
} from '@/lib/server/admin-auth'
import { enforceLimit } from '@/lib/server/rate-limit'

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
  try {
    const body = await request.json()
    password = typeof body?.password === 'string' ? body.password : ''
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  }

  if (!(await verifyAdminPassword(password))) {
    return NextResponse.json({ error: 'Неверный пароль' }, { status: 401 })
  }

  const token = await createSessionToken()
  const response = NextResponse.json({ ok: true })
  response.cookies.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // Matches the expiry signed into the token itself. The cookie's lifetime
    // is a browser convenience; the token's is what the server enforces.
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  })
  return response
}
