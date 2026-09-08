import { NextResponse } from 'next/server'
import { sendWelcomeEmail } from '@/lib/server/emails/send-lifecycle'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Sends the welcome email, exactly once per account.
 *
 * Called by the client after a session first appears. That is a fine trigger
 * and a terrible guarantee — the same browser can call it on every sign-in,
 * and three devices can call it at once — so the "once" is enforced in the
 * database, not here.
 *
 * `welcome_sent_at is null` in the WHERE clause is the claim: the row is
 * updated by whichever request gets there first, and the others match nothing
 * and send nothing. The same predicate-under-row-lock shape as the stock
 * decrement in 0012 and the coupon counter in 0015.
 *
 * The stamp is set BEFORE the send. If Resend then fails the customer misses a
 * welcome, which costs nothing; stamping afterwards would risk sending the
 * same email on every page load for anyone whose first send failed.
 */
export async function POST() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data, error } = await admin
    .from('profiles')
    .update({ welcome_sent_at: new Date().toISOString() })
    .eq('id', user.id)
    .is('welcome_sent_at', null)
    .select('name, email')
    .maybeSingle()

  if (error) {
    // Missing column means 0016 has not been applied. Not worth failing a
    // sign-in over.
    console.error('[welcome] could not claim the stamp:', error.message)
    return NextResponse.json({ sent: false })
  }

  // Already welcomed. The common case on every sign-in after the first.
  if (!data) return NextResponse.json({ sent: false })

  const sent = await sendWelcomeEmail(
    (data.email as string) || user.email || '',
    (data.name as string) || '',
  )

  return NextResponse.json({ sent })
}
