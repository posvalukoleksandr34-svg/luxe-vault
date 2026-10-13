import { NextResponse, type NextRequest } from 'next/server'
import { releaseExpiredReservations } from '@/lib/server/reservations'
import { hasBearerSecret } from '@/lib/server/secure-compare'
import { securityEvent } from '@/lib/server/security-events'
import { clientIp } from '@/lib/server/client-ip'
import { reportCriticalError } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

/**
 * Releases the stock of unpaid orders whose reservation has lapsed
 * (lib/server/reservations.ts, migration 0056). Hourly from
 * .github/workflows/abandoned-carts-cron.yml, and from the nightly sweep as a
 * fallback.
 *
 * Authenticated like every cron route — the shared secret as a bearer token —
 * and failing closed without it: an open version would let anyone cancel
 * customers' unpaid orders.
 *
 *   ?dry=1   lists what WOULD be released and changes nothing — for checking
 *            the policy against real orders before (or after) relying on it.
 *
 * The answer lists order numbers only, never customer details. A run that
 * could not reach Stripe for some orders still answers 200 (those orders are
 * retried next run) but alerts the operations chat. A run in which the
 * DATABASE failed for an order — the cancellation, or putting its units back
 * — answers 500 as well as alerting, so the hourly workflow turns red: units
 * may be off the shelf with no order holding them until a run succeeds.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" "https://www.luxe-vault.store/api/cron/reservations?dry=1"
 */
async function run(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron] CRON_SECRET is not set — reservation expiry is disabled.')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }
  if (!hasBearerSecret(request.headers.get('authorization'), secret)) {
    securityEvent('cron_unauthorized', { route: 'reservations', ip: clientIp(request.headers) })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = request.nextUrl.searchParams.get('dry') === '1'
  try {
    const result = await releaseExpiredReservations({ dryRun })
    if (result.status === 'unmigrated') {
      return NextResponse.json({ ...result, error: 'Apply migration 0056' }, { status: 503 })
    }
    if (result.status === 'ok') {
      console.log(
        `[reservations] ${dryRun ? 'dry run: ' : ''}${result.candidates.length} lapsed, ${result.released.length} released, ` +
          `${result.paymentInFlight.length} paying, ${result.providerError.length} Stripe errors, ${result.changed.length} changed, ` +
          `${result.failed.length} failed, ${result.restockRepaired.length} restocks repaired, ${result.restockFailed.length} restocks failed`,
      )
      if (result.providerError.length > 0) {
        await reportCriticalError(
          'Reservation expiry',
          `Stripe could not confirm the cancellation of ${result.providerError.length} order(s); their stock stays held and is retried next run: ${result.providerError.join(', ')}`,
        )
      }
      const broken = [...result.failed, ...result.restockFailed]
      if (broken.length > 0) {
        await reportCriticalError(
          'Reservation expiry',
          `The database failed for ${broken.length} order(s); retried next run: ${broken.join(', ')}`,
        )
        return NextResponse.json(result, { status: 500 })
      }
    }
    return NextResponse.json(result)
  } catch (e) {
    await reportCriticalError('Reservation expiry', e)
    return NextResponse.json({ error: 'Reservation run failed' }, { status: 503 })
  }
}

/** Schedulers issue a GET; see /api/cron/sweep for why that is fine here. */
export const GET = run
export const POST = run
