import { NextResponse, type NextRequest } from 'next/server'

import { caseNumberSchema, customerActionSchema } from '@/lib/refunds/schemas'
import { readJsonObject } from '@/lib/server/http'
import { enforceUserLimit } from '@/lib/server/rate-limit'
import { getCaseByNumber } from '@/lib/server/refunds/cases'
import { customerCaseDetail } from '@/lib/server/refunds/customer-view'
import { runCustomerCommand } from '@/lib/server/refunds/workflow'
import { getCurrentUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * What a customer can do on their own request: answer a question, add the
 * return's tracking number, withdraw, ask for a review once, write a message.
 * Each is a command of the case workflow, checked against the state machine
 * like a staff action — a customer can never approve, change an amount or
 * touch another customer's case.
 */
export async function POST(request: NextRequest, props: { params: Promise<{ caseNumber: string }> }) {
  const { caseNumber } = await props.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limited = await enforceUserLimit('refunds.write', user.id)
  if (limited) return limited

  const number = caseNumberSchema.safeParse(caseNumber)
  const c = number.success ? await getCaseByNumber(number.data) : null
  if (!c || c.userId !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const parsed = customerActionSchema.safeParse((await readJsonObject(request)) ?? {})
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400 })
  const { command, ...input } = parsed.data

  const result = await runCustomerCommand(c.id, command, input, { type: 'customer', userId: user.id, label: 'customer' })
  if (!result.ok) return NextResponse.json({ error: result.code, message: result.message }, { status: result.status })
  return NextResponse.json({ case: await customerCaseDetail(result.case) })
}
