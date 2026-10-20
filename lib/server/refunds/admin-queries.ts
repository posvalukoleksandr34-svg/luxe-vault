import 'server-only'

import { CASE_STATES, CLAIM_TYPES, RISK_LEVELS, type CaseState, type ClaimType, type RiskLevel } from '@/lib/refunds/types'
import { CASE_SELECT, toCase, type CaseRecord } from '@/lib/server/refunds/cases'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The console's lists and figures. Filtering, sorting and paging happen in
 * the database — the browser never receives more rows than one page — and
 * every filter value is checked against a closed list before it reaches a
 * query.
 */

export type CaseFilter = {
  states?: CaseState[]
  claimTypes?: ClaimType[]
  risk?: RiskLevel[]
  assigned?: 'me' | 'none' | string
  escalated?: boolean
  overdue?: boolean
  pendingApproval?: boolean
  q?: string
  from?: number
  to?: number
  sort?: 'newest' | 'oldest' | 'amount' | 'risk' | 'updated'
  page?: number
  pageSize?: number
}

const OPEN: CaseState[] = [
  'requested',
  'under_review',
  'awaiting_customer_info',
  'awaiting_return_shipment',
  'return_in_transit',
  'return_delivered',
  'awaiting_inspection',
  'approved',
  'refund_processing',
  'disputed',
]

export function parseFilter(params: URLSearchParams, meStaffId: string | null): CaseFilter {
  const list = <T extends string>(key: string, allowed: readonly T[]): T[] | undefined => {
    const raw = params.get(key)
    if (!raw) return undefined
    const values = raw.split(',').filter((v): v is T => (allowed as readonly string[]).includes(v))
    return values.length ? values : undefined
  }
  const stateParam = params.get('state')
  const states = stateParam === 'open' ? OPEN : list('state', CASE_STATES)
  const assigned = params.get('assigned')
  const num = (key: string) => {
    const v = Number(params.get(key))
    return Number.isFinite(v) && v > 0 ? v : undefined
  }
  const sort = params.get('sort')
  return {
    states,
    claimTypes: list('claim', CLAIM_TYPES),
    risk: list('risk', RISK_LEVELS),
    assigned: assigned === 'me' ? (meStaffId ?? 'none') : assigned === 'none' ? 'none' : assigned && /^[0-9a-f-]{36}$/i.test(assigned) ? assigned : undefined,
    escalated: params.get('escalated') === '1' ? true : undefined,
    overdue: params.get('overdue') === '1' ? true : undefined,
    pendingApproval: params.get('pending') === '1' ? true : undefined,
    q: params.get('q')?.trim().slice(0, 80) || undefined,
    from: num('from'),
    to: num('to'),
    sort: sort === 'oldest' || sort === 'amount' || sort === 'risk' || sort === 'updated' ? sort : 'newest',
    page: Math.min(Math.max(Math.trunc(num('page') ?? 1), 1), 1000),
    pageSize: Math.min(Math.max(Math.trunc(num('pageSize') ?? 25), 5), 100),
  }
}

export async function listCases(filter: CaseFilter, slaDecisionDays: number): Promise<{ rows: CaseRecord[]; total: number; page: number; pageSize: number }> {
  const page = filter.page ?? 1
  const pageSize = filter.pageSize ?? 25
  let q = createAdminClient().from('return_requests').select(CASE_SELECT, { count: 'exact' })
  if (filter.states) q = q.in('state', filter.states)
  if (filter.claimTypes) q = q.in('claim_type', filter.claimTypes)
  if (filter.risk) q = q.in('risk_level', filter.risk)
  if (filter.assigned === 'none') q = q.is('assigned_to', null)
  else if (filter.assigned) q = q.eq('assigned_to', filter.assigned)
  if (filter.escalated) q = q.not('escalated_at', 'is', null)
  if (filter.pendingApproval) q = q.not('pending_approval', 'is', null)
  if (filter.overdue) {
    q = q.in('state', OPEN).lt('created_at', new Date(Date.now() - slaDecisionDays * 86_400_000).toISOString())
  }
  if (filter.from) q = q.gte('created_at', new Date(filter.from).toISOString())
  if (filter.to) q = q.lte('created_at', new Date(filter.to).toISOString())
  if (filter.q) {
    const term = filter.q
    if (/^RC-[A-Z0-9]+$/i.test(term)) q = q.ilike('case_number', `${term.toUpperCase()}%`)
    else if (/^LV-[A-Z0-9]+$/i.test(term)) q = q.ilike('orders.order_number', `${term.toUpperCase()}%`)
    else if (term.includes('@')) q = q.ilike('orders.customer_email', `%${term.replace(/[%_]/g, '')}%`)
    else q = q.ilike('orders.customer_name', `%${term.replace(/[%_]/g, '')}%`)
  }
  switch (filter.sort) {
    case 'oldest':
      q = q.order('created_at', { ascending: true })
      break
    case 'amount':
      q = q.order('requested_amount_minor', { ascending: false, nullsFirst: false })
      break
    case 'risk':
      q = q.order('risk_score', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
      break
    case 'updated':
      q = q.order('updated_at', { ascending: false })
      break
    default:
      q = q.order('created_at', { ascending: false })
  }
  const { data, error, count } = await q.range((page - 1) * pageSize, page * pageSize - 1)
  if (error) throw new Error(`Failed to list cases: ${error.message}`)
  return { rows: (data ?? []).map((r) => toCase(r as Record<string, unknown>)), total: count ?? 0, page, pageSize }
}

export type Overview = {
  open: number
  newToday: number
  awaitingDecision: number
  awaitingCustomer: number
  returnsInTransit: number
  awaitingInspection: number
  awaitingSecondApproval: number
  approvedNotPaid: number
  refundProcessing: number
  highRiskOpen: number
  escalated: number
  overdue: number
  disputed: number
  nonDeliveryOpen: number
  refundsFailed30d: number
  refundsUnknown: number
  refunded30dMinor: number
  refundedCount30d: number
  medianResolutionHours?: number
  byClaim90d: Record<string, number>
}

export async function overview(slaDecisionDays: number): Promise<Overview> {
  const admin = createAdminClient()
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString()
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const count = async (build: (q: ReturnType<typeof base>) => ReturnType<typeof base>): Promise<number> => {
    const { count: n, error } = await build(base())
    if (error) throw new Error(`Failed to count cases: ${error.message}`)
    return n ?? 0
  }
  const base = () => admin.from('return_requests').select('id', { count: 'exact', head: true })

  const [
    open,
    newToday,
    awaitingDecision,
    awaitingCustomer,
    returnsInTransit,
    awaitingInspection,
    awaitingSecondApproval,
    approvedNotPaid,
    refundProcessing,
    highRiskOpen,
    escalated,
    overdue,
    disputed,
    nonDeliveryOpen,
  ] = await Promise.all([
    count((q) => q.in('state', OPEN)),
    count((q) => q.gte('created_at', today.toISOString())),
    count((q) => q.in('state', ['requested', 'under_review'])),
    count((q) => q.in('state', ['awaiting_customer_info', 'awaiting_return_shipment'])),
    count((q) => q.in('state', ['return_in_transit', 'return_delivered'])),
    count((q) => q.eq('state', 'awaiting_inspection')),
    count((q) => q.not('pending_approval', 'is', null)),
    count((q) => q.eq('state', 'approved')),
    count((q) => q.eq('state', 'refund_processing')),
    count((q) => q.in('state', OPEN).eq('risk_level', 'high')),
    count((q) => q.in('state', OPEN).not('escalated_at', 'is', null)),
    count((q) => q.in('state', OPEN).lt('created_at', new Date(Date.now() - slaDecisionDays * 86_400_000).toISOString())),
    count((q) => q.eq('state', 'disputed')),
    count((q) => q.in('state', OPEN).eq('claim_type', 'non_delivery')),
  ])

  const [failed, unknown, refunded, closed, claims] = await Promise.all([
    admin.from('refund_transactions').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', since30),
    admin.from('refund_transactions').select('id', { count: 'exact', head: true }).in('status', ['unknown', 'submitted', 'pending_submission']),
    admin.from('refund_transactions').select('amount_minor').eq('status', 'succeeded').gte('settled_at', since30).limit(5000),
    admin.from('return_requests').select('created_at, closed_at').not('closed_at', 'is', null).gte('closed_at', since90).limit(2000),
    admin.from('return_requests').select('claim_type').gte('created_at', since90).limit(5000),
  ])
  for (const r of [failed, unknown, refunded, closed, claims]) if (r.error) throw new Error(`Failed to read figures: ${r.error.message}`)

  const hours = (closed.data ?? [])
    .map((r) => (Date.parse(r.closed_at as string) - Date.parse(r.created_at as string)) / 3_600_000)
    .filter((h) => h >= 0)
    .sort((a, b) => a - b)
  const byClaim90d: Record<string, number> = {}
  for (const r of claims.data ?? []) byClaim90d[r.claim_type as string] = (byClaim90d[r.claim_type as string] ?? 0) + 1

  return {
    open,
    newToday,
    awaitingDecision,
    awaitingCustomer,
    returnsInTransit,
    awaitingInspection,
    awaitingSecondApproval,
    approvedNotPaid,
    refundProcessing,
    highRiskOpen,
    escalated,
    overdue,
    disputed,
    nonDeliveryOpen,
    refundsFailed30d: failed.count ?? 0,
    refundsUnknown: unknown.count ?? 0,
    refunded30dMinor: (refunded.data ?? []).reduce((a, r) => a + Number(r.amount_minor), 0),
    refundedCount30d: (refunded.data ?? []).length,
    medianResolutionHours: hours.length ? Math.round(hours[Math.floor(hours.length / 2)]) : undefined,
    byClaim90d,
  }
}

/** A customer's history with the shop, for the case screen: their orders' claims and outcomes. */
export async function customerHistory(c: CaseRecord): Promise<{
  orders: number
  totalSpentMinor: number
  cases: { caseNumber: string; id: string; orderNumber: string; claimType: string; state: string; createdAt: number; amountMinor?: number; finding?: string }[]
}> {
  const admin = createAdminClient()
  const filters: string[] = []
  if (c.userId) filters.push(`user_id.eq.${c.userId}`)
  if (c.customerEmail && /^[^\s,()]+@[^\s,()]+$/.test(c.customerEmail)) filters.push(`customer_email.eq.${c.customerEmail}`)
  if (filters.length === 0) return { orders: 0, totalSpentMinor: 0, cases: [] }
  const { data: orders, error } = await admin
    .from('orders')
    .select('id, total, payment_status')
    .or(filters.join(','))
    .limit(500)
  if (error) throw new Error(`Failed to read the customer's orders: ${error.message}`)
  const ids = (orders ?? []).map((o) => o.id as string)
  const paid = (orders ?? []).filter((o) => ['paid', 'partially_refunded', 'refunded'].includes(o.payment_status as string))
  const { data: cases, error: ce } = ids.length
    ? await admin
        .from('return_requests')
        .select('id, case_number, claim_type, state, created_at, requested_amount_minor, approved_amount_minor, finding, orders!inner(order_number)')
        .in('order_id', ids)
        .order('created_at', { ascending: false })
        .limit(100)
    : { data: [], error: null }
  if (ce) throw new Error(`Failed to read the customer's cases: ${ce.message}`)
  return {
    orders: (orders ?? []).length,
    totalSpentMinor: paid.reduce((a, o) => a + Math.round(Number(o.total) * 100), 0),
    cases: (cases ?? []).map((r) => {
      const order = (Array.isArray(r.orders) ? r.orders[0] : r.orders) as { order_number: string } | undefined
      return {
        id: r.id as string,
        caseNumber: r.case_number as string,
        orderNumber: order?.order_number ?? '',
        claimType: r.claim_type as string,
        state: r.state as string,
        createdAt: Date.parse(r.created_at as string),
        amountMinor: Number(r.approved_amount_minor ?? r.requested_amount_minor ?? 0) || undefined,
        finding: (r.finding as string | null) ?? undefined,
      }
    }),
  }
}

/**
 * One CSV cell. Quoted, quotes doubled, and a value a spreadsheet would run
 * as a formula (= + - @, tab, CR) prefixed with an apostrophe.
 */
export function csvCell(v: unknown): string {
  let s = v === undefined || v === null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

/** CSV of a filtered list — at most 5000 rows, no free-text fields a spreadsheet could execute. */
export async function exportCsv(filter: CaseFilter, slaDecisionDays: number): Promise<string> {
  const rows: CaseRecord[] = []
  for (let page = 1; page <= 50 && rows.length < 5000; page++) {
    const chunk = await listCases({ ...filter, page, pageSize: 100 }, slaDecisionDays)
    rows.push(...chunk.rows)
    if (chunk.rows.length < 100) break
  }
  const money = (m?: number) => (m === undefined ? '' : (m / 100).toFixed(2))
  const header = ['case', 'order', 'created', 'claim', 'state', 'resolution', 'requested_chf', 'approved_chf', 'refunded_chf', 'risk', 'assignee', 'closed']
  const lines = rows.map((c) =>
    [
      c.caseNumber,
      c.orderNumber,
      new Date(c.createdAt).toISOString(),
      c.claimType,
      c.state,
      c.approvedResolution ?? c.requestedResolution,
      money(c.requestedAmountMinor),
      money(c.approvedAmountMinor),
      money(c.refundedAmountMinor),
      c.riskLevel ?? '',
      c.assignedLabel ?? '',
      c.closedAt ? new Date(c.closedAt).toISOString() : '',
    ]
      .map(csvCell)
      .join(','),
  )
  return [header.join(','), ...lines].join('\r\n')
}
