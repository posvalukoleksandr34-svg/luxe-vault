import 'server-only'

import { purgeExpiredEvidence } from '@/lib/server/refunds/evidence'
import { unsettledRows } from '@/lib/server/refunds/ledger'
import { retryNotifications } from '@/lib/server/refunds/notify'
import { reconcileRow } from '@/lib/server/refunds/payments'
import { activePolicy } from '@/lib/server/refunds/policy-store'
import { applyLedgerOutcome, endDeliveryWaits, escalateOverdue, expireOverdue } from '@/lib/server/refunds/workflow'

/**
 * The refund system's scheduled work, run by /api/cron/sweep (nightly) and
 * /api/cron/refunds (hourly, when an external scheduler calls it). Every job
 * is safe to run twice at once: case changes are compare-and-set, refund
 * checks never submit a second refund while one may exist, and notifications
 * are deduplicated.
 *
 * Each job runs in its own try block: one failing must not stop the others.
 */

export type RefundSweepResult = {
  expired: number
  deliveryWaitsEnded: number
  escalated: number
  refundsChecked: number
  refundsSettled: number
  notificationsRetried: number
  notificationsSent: number
  evidencePurged: number
  errors: string[]
}

const SYSTEM = { type: 'system' as const, label: 'reconciliation' }

export async function runRefundSweep(): Promise<RefundSweepResult> {
  const out: RefundSweepResult = {
    expired: 0,
    deliveryWaitsEnded: 0,
    escalated: 0,
    refundsChecked: 0,
    refundsSettled: 0,
    notificationsRetried: 0,
    notificationsSent: 0,
    evidencePurged: 0,
    errors: [],
  }
  const job = async (name: string, work: () => Promise<void>) => {
    try {
      await work()
    } catch (e) {
      out.errors.push(`refunds/${name}: ${(e as Error).message}`)
    }
  }

  let policy: Awaited<ReturnType<typeof activePolicy>> | null = null
  await job('policy', async () => {
    policy = await activePolicy()
  })

  // Refunds whose outcome is not known yet — the money question first.
  await job('reconcile', async () => {
    const rows = await unsettledRows(15 * 60 * 1000, 25)
    for (const row of rows) {
      out.refundsChecked++
      const result = await reconcileRow(row, SYSTEM)
      if (result.row && result.row.status !== row.status) {
        out.refundsSettled++
        await applyLedgerOutcome(result.row, SYSTEM)
      }
    }
  })

  await job('expire', async () => {
    out.expired = await expireOverdue()
  })
  await job('delivery-waits', async () => {
    out.deliveryWaitsEnded = await endDeliveryWaits()
  })
  await job('sla', async () => {
    const days = (policy as Awaited<ReturnType<typeof activePolicy>> | null)?.config.sla.decisionDays ?? 14
    out.escalated = await escalateOverdue(days)
  })
  await job('notifications', async () => {
    const r = await retryNotifications()
    out.notificationsRetried = r.retried
    out.notificationsSent = r.sent
  })
  // Last: it deletes files.
  await job('retention', async () => {
    const days = (policy as Awaited<ReturnType<typeof activePolicy>> | null)?.config.retention.evidenceDays
    if (days && days > 0) out.evidencePurged = await purgeExpiredEvidence(days)
  })
  return out
}
