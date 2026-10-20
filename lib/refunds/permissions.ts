import type { StaffRole } from '@/lib/refunds/types'

/**
 * What each staff role may do in the refund system. Checked on the server for
 * every request (lib/server/staff.ts requireStaff); the console hides what a
 * role cannot do, but hiding is a courtesy, not the control.
 *
 *   viewer  — reads cases, for someone who needs to see but not touch.
 *   agent   — handles cases: messages, notes, evidence, information requests,
 *             investigations, returns received and inspected. Decides nothing
 *             about money.
 *   manager — decides: authorises returns, approves or rejects, refunds.
 *   owner   — a manager who also sets the policy and manages staff.
 */
export const PERMISSIONS = [
  'case.view',
  'case.create',
  'case.message',
  'case.note',
  'case.assign',
  'case.triage',
  'case.return',
  'case.decide',
  'refund.execute',
  'refund.second_approve',
  'case.export',
  'customer.history',
  'policy.manage',
  'staff.manage',
] as const
export type Permission = (typeof PERMISSIONS)[number]

const AGENT: readonly Permission[] = [
  'case.view',
  'case.create',
  'case.message',
  'case.note',
  'case.assign',
  'case.triage',
  'case.return',
  'customer.history',
]
const MANAGER: readonly Permission[] = [...AGENT, 'case.decide', 'refund.execute', 'refund.second_approve', 'case.export']

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  viewer: ['case.view'],
  agent: AGENT,
  manager: MANAGER,
  owner: [...MANAGER, 'policy.manage', 'staff.manage'],
}

export function can(role: StaffRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

export const ROLE_LABEL_RU: Record<StaffRole, string> = {
  owner: 'Владелец',
  manager: 'Менеджер',
  agent: 'Оператор',
  viewer: 'Наблюдатель',
}
