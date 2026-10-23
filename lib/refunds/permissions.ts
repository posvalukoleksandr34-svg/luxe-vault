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
 *
 * Review requests use the same roles: every role sees the queue, a manager
 * may retry, cancel and send a test email, only the owner changes settings.
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
  // Post-delivery review requests (app/admin/review-requests): seeing the
  // queue; retrying, cancelling and test emails; the feature's settings.
  'review_requests.view',
  'review_requests.manage',
  'review_requests.settings',
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
  'review_requests.view',
]
const MANAGER: readonly Permission[] = [
  ...AGENT,
  'case.decide',
  'refund.execute',
  'refund.second_approve',
  'case.export',
  'review_requests.manage',
]

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  viewer: ['case.view', 'review_requests.view'],
  agent: AGENT,
  manager: MANAGER,
  owner: [...MANAGER, 'policy.manage', 'staff.manage', 'review_requests.settings'],
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
