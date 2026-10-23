import 'server-only'

import { summarizeOrders, type DashboardMetrics, type MetricsRow } from '@/lib/admin-metrics'
import { createAdminClient } from '@/lib/supabase/admin'

const PAGE = 1000

export async function loadDashboardMetrics(now = Date.now()): Promise<DashboardMetrics> {
  const admin = createAdminClient()
  const rows: MetricsRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('orders')
      .select('total, refunded_amount, status, payment_status, created_at')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Failed to read orders for the dashboard: ${error.message}`)
    rows.push(...((data ?? []) as MetricsRow[]))
    if (!data || data.length < PAGE) break
  }
  return summarizeOrders(rows, now)
}
