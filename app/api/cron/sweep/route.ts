import { NextResponse, type NextRequest } from 'next/server'
import { sendRecoveryEmail, sendRestockEmail } from '@/lib/server/emails/campaigns'
import { getOrderById } from '@/lib/server/orders-store'
import { readCatalog } from '@/lib/server/catalog-store'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * The scheduled sweep: unpaid-order reminders and back-in-stock alerts.
 *
 * Both jobs claim their work in the database before doing it (see 0019), so
 * this endpoint is safe to call more often than necessary, and safe to have
 * two invocations overlap — `for update skip locked` divides the rows rather
 * than duplicating them. Nobody gets two emails.
 *
 * AUTHENTICATION
 *
 * A shared secret in the Authorization header. This is not an admin route:
 * it is called by a scheduler with no session, so the admin cookie gate does
 * not apply and it lives outside /api/admin deliberately.
 *
 * Without CRON_SECRET set, the endpoint refuses every request. Failing closed
 * matters more here than usual — an open version is a button anyone can press
 * to mail your customers.
 *
 * Set it up on Vercel with a vercel.json cron entry, or any external
 * scheduler:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://luxe-vault.store/api/cron/sweep
 */
async function runSweep(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron] CRON_SECRET is not set — the sweep is disabled.')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const result = { recovery: 0, restock: 0, errors: [] as string[] }

  // ------------------------------------------------ unpaid-order reminders --
  try {
    const { data, error } = await supabase.rpc('claim_recoverable_orders', {})
    if (error) throw new Error(error.message)

    const numbers = (data ?? []) as string[]
    for (const number of numbers) {
      const order = await getOrderById(number)
      // The claim already stamped recovery_sent_at, so a send that fails here
      // is not retried. That is the intended trade: one missed reminder costs
      // far less than a customer receiving the same nudge every hour because
      // a transient failure kept the row eligible.
      if (order && (await sendRecoveryEmail(order))) result.recovery++
    }
  } catch (e) {
    result.errors.push(`recovery: ${(e as Error).message}`)
  }

  // ------------------------------------------------- back-in-stock alerts --
  try {
    const { data, error } = await supabase.rpc('claim_restock_alerts', {})
    if (error) throw new Error(error.message)

    const alerts = (data ?? []) as {
      email: string
      product_id: string
      size: string
      color: string
    }[]

    if (alerts.length > 0) {
      // One catalogue read for the whole batch rather than one per alert.
      const { products } = await readCatalog()
      const names = new Map(
        products.map((p) => [p.id, p.name.ru || p.name.en || p.id]),
      )

      for (const a of alerts) {
        const sent = await sendRestockEmail({
          email: a.email,
          productId: a.product_id,
          productName: names.get(a.product_id) ?? a.product_id,
          size: a.size,
          color: a.color,
        })
        if (sent) result.restock++
      }
    }
  } catch (e) {
    result.errors.push(`restock: ${(e as Error).message}`)
  }

  return NextResponse.json(result)
}

/**
 * Vercel Cron issues a GET, and when CRON_SECRET exists it sends that value
 * as an `Authorization: Bearer` header automatically — which is exactly what
 * runSweep checks, so no extra configuration is needed beyond setting the
 * variable.
 *
 * A side-effectful GET is normally wrong. It is right here: the caller is a
 * scheduler that cannot be told to use another verb, the endpoint is
 * authenticated, and both jobs claim their rows before acting — so a
 * prefetcher or a retry cannot produce a duplicate send.
 */
export const GET = runSweep

/** For manual runs and any scheduler that can choose its verb. */
export const POST = runSweep
