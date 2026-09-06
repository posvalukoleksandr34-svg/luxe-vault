import { NextResponse, type NextRequest } from 'next/server'
import { listNotifications, markNotificationsRead } from '@/lib/server/notifications'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * The signed-in user's notifications.
 *
 * The user id comes from the verified session cookie via getUser(), never from
 * a query parameter. That is the whole access-control story here: a
 * `?userId=` would turn this endpoint into a way to read anyone's feed by
 * guessing a uuid.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  // 401 rather than an empty list: the bell needs to distinguish "signed out"
  // from "signed in with nothing new", and silently returning [] would hide a
  // broken session behind a plausible-looking empty state.
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rawLimit = Number(request.nextUrl.searchParams.get('limit'))
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 30

  try {
    const { notifications, unreadCount } = await listNotifications(user.id, limit)
    return NextResponse.json({ notifications, unreadCount })
  } catch (error) {
    console.error('[notifications] read failed:', error)
    return NextResponse.json({ error: 'Could not load notifications' }, { status: 500 })
  }
}

/**
 * Marks notifications read.
 *
 * Body:
 *   { ids: string[] }  mark these
 *   { all: true }      mark every unread one
 *
 * Read state is the only field a client may change, and marking read is
 * idempotent — the update is scoped to `is_read = false`, so a double-tap
 * updates nothing the second time rather than re-stamping read_at.
 */
export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { ids?: unknown; all?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const all = body.all === true
  const ids =
    Array.isArray(body.ids) && body.ids.every((v) => typeof v === 'string')
      ? (body.ids as string[])
      : undefined

  if (!all && (!ids || ids.length === 0)) {
    return NextResponse.json({ error: 'Provide ids[] or all:true' }, { status: 400 })
  }

  try {
    // markNotificationsRead scopes every query to this user id, so an id
    // belonging to somebody else simply matches no rows.
    const updated = await markNotificationsRead(user.id, all ? undefined : ids)
    const { unreadCount } = await listNotifications(user.id, 1)
    return NextResponse.json({ updated, unreadCount })
  } catch (error) {
    console.error('[notifications] mark read failed:', error)
    return NextResponse.json({ error: 'Could not update notifications' }, { status: 500 })
  }
}
