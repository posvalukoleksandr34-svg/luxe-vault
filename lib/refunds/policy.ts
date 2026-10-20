import { z } from 'zod'

import { CLAIM_TYPES, RESOLUTIONS, type ClaimType, type Resolution } from '@/lib/refunds/types'

// No compiled validators: Zod 4 otherwise probes with `Function("")`, which the
// CSP (no 'unsafe-eval') reports. See lib/returns/schema.ts.
z.config({ jitless: true })

/**
 * The refund policy as configuration — every number and rule the workflow
 * applies, in one validated object, versioned in public.refund_policies.
 *
 * DEFAULTS ARE THE PUBLISHED POLICY (app/legal/_content/refunds.ts): 14 days
 * to withdraw after delivery, 14 more to send the item back, return postage on
 * the buyer except for a faulty or wrong item, the original shipping refunded
 * when the whole order is withdrawn, faulty items replaced or refunded in full
 * at the customer's choice, every request reviewed by a person. Changing a
 * value here changes what the workflow does, not what the published policy
 * says — an owner who widens a window should update the legal page too, and
 * nothing here may narrow a customer's statutory rights: the fault-report
 * window, for one, only moves a late claim to manual review, it never refuses
 * it.
 *
 * WHAT IS NOT CONFIGURABLE, on purpose: whether a person decides. There is no
 * "automatic approval" switch — the published policy promises a human review
 * of every refund request, and a risk score never decides alone.
 */

const days = (max: number) => z.number().int().min(0).max(max)
const minorAmount = z.number().int().min(0).max(100_000_000)

const claimRuleSchema = z.object({
  /** Offered to customers. Staff can still file any type on their behalf. */
  enabled: z.boolean(),
  /** The item must come back before money does. */
  requireReturn: z.boolean(),
  allowedResolutions: z.array(z.enum(RESOLUTIONS)).min(1),
  /** Photos the customer must attach. 0 = optional. */
  minPhotos: z.number().int().min(0).max(6),
})
export type ClaimRule = z.infer<typeof claimRuleSchema>

export const RISK_RULES = [
  'repeat_non_delivery',
  'many_recent_requests',
  'repeat_requests_same_order',
  'prior_refunds_same_item',
  'high_value',
  'repeat_high_value',
  'contradicts_records',
  'duplicate_return_tracking',
  'claims_after_confirmed_delivery',
  'fulfilment_records_missing',
  'quick_after_delivery',
  'duplicate_evidence',
  'prior_documented_findings',
] as const
export type RiskRule = (typeof RISK_RULES)[number]

const riskRuleSchema = z.object({
  enabled: z.boolean(),
  /** Points this rule adds when it fires. The score is capped at 100. */
  weight: z.number().int().min(0).max(100),
})

export const policyConfigSchema = z
  .object({
    windows: z.object({
      /** Days after delivery to withdraw (Policy §2). */
      withdrawalDays: days(365),
      /** Days after delivery to report a faulty or wrong item with photos
       *  (Policy §7). Past it a claim goes to manual review — never refused
       *  on the date alone, because statutory rights outlast it. */
      faultReportDays: days(730),
      /** Days after dispatch within which a non-delivery claim is handled
       *  normally; later ones go to manual review. */
      nonDeliveryReportMaxDays: days(730),
      /** Days added to the latest expected delivery date before a
       *  non-delivery claim is judged; earlier claims wait. */
      deliveryGraceDays: days(30),
      /** Days to send an authorised return (Policy §2). */
      returnShipmentDays: days(90),
      /** Days to answer a request for information before the case expires. */
      customerResponseDays: days(90),
      /** Days after a rejection in which the customer may ask for it to be
       *  looked at again, once. */
      appealDays: days(365),
    }),
    claims: z.record(z.enum(CLAIM_TYPES), claimRuleSchema),
    shipping: z.object({
      /** Refund the original delivery charge when every unit of the order
       *  comes back under a withdrawal (Policy §6). */
      refundOnFullWithdrawal: z.boolean(),
      /** Refund the original delivery charge on a seller-fault claim
       *  (Policy §7: "refunded in full including postage"). */
      refundOnSellerFault: z.boolean(),
    }),
    restrictions: z.object({
      /** Excluded from withdrawal (Policy §4: made-to-measure, broken hygiene
       *  seal, vouchers). A faulty item is always claimable. */
      nonReturnableProductSlugs: z.array(z.string().min(1).max(120)).max(500),
      nonReturnableCategorySlugs: z.array(z.string().min(1).max(120)).max(200),
    }),
    approvals: z.object({
      /** A refund of at least this many minor units needs a second staff
       *  member's approval. null = no second approval. */
      secondApprovalMinor: minorAmount.nullable(),
      /** A high-risk case's approval must carry a written justification. */
      highRiskRequiresJustification: z.boolean(),
      /** High-risk cases also need a second approver. */
      highRiskRequiresSecondApproval: z.boolean(),
    }),
    risk: z.object({
      /** Score at which a case is medium risk (more verification). */
      mediumThreshold: z.number().int().min(1).max(100),
      /** Score at which a case is high risk (human review before anything
       *  irreversible, escalated). */
      highThreshold: z.number().int().min(1).max(100),
      /** How far back a customer's history is read. */
      lookbackDays: days(3650),
      /** "Recent" for many_recent_requests. */
      recentDays: days(365),
      /** Requests in recentDays that make "many". */
      recentRequestCount: z.number().int().min(2).max(50),
      /** Non-delivery claims in lookbackDays that make a pattern. */
      nonDeliveryCount: z.number().int().min(2).max(50),
      /** A claim at or above this many minor units is high value. */
      highValueMinor: minorAmount,
      /** A claim within this many hours of delivery is "quick". */
      quickAfterDeliveryHours: z.number().int().min(0).max(720),
      rules: z.record(z.enum(RISK_RULES), riskRuleSchema),
    }),
    sla: z.object({
      /** Hours to a first staff action on a new case. */
      firstResponseHours: z.number().int().min(1).max(720),
      /** Days to a decision; past it an open case is escalated. */
      decisionDays: days(365),
      /** Hours a refund may sit with the provider before it is flagged. */
      processingAlertHours: z.number().int().min(1).max(720),
    }),
    retention: z.object({
      /** Days after a case closes before its photos and documents are deleted
       *  (the ledger and the audit trail are kept: accounting records). */
      evidenceDays: z.number().int().min(30).max(3650),
    }),
    /** Shown to the customer with return instructions. Policy §5: the return
     *  address is a private one and is not published in advance. */
    returnInstructions: z.string().max(2000),
  })
  .superRefine((p, ctx) => {
    if (p.risk.highThreshold <= p.risk.mediumThreshold) {
      ctx.addIssue({ code: 'custom', path: ['risk', 'highThreshold'], message: 'The high threshold must be above the medium one' })
    }
    for (const type of CLAIM_TYPES) {
      if (!p.claims[type]) ctx.addIssue({ code: 'custom', path: ['claims', type], message: 'Missing claim rule' })
    }
    for (const rule of RISK_RULES) {
      if (!p.risk.rules[rule]) ctx.addIssue({ code: 'custom', path: ['risk', 'rules', rule], message: 'Missing risk rule' })
    }
  })

export type PolicyConfig = z.infer<typeof policyConfigSchema>

const claim = (requireReturn: boolean, allowedResolutions: Resolution[], minPhotos = 0, enabled = true): ClaimRule => ({
  enabled,
  requireReturn,
  allowedResolutions,
  minPhotos,
})

export const DEFAULT_POLICY: PolicyConfig = {
  windows: {
    withdrawalDays: 14,
    faultReportDays: 14,
    nonDeliveryReportMaxDays: 90,
    deliveryGraceDays: 3,
    returnShipmentDays: 14,
    customerResponseDays: 14,
    appealDays: 30,
  },
  claims: {
    // A parcel that never came: money back or the parcel sent again.
    non_delivery: claim(false, ['refund', 'reshipment']),
    // Faulty or wrong (Policy §7): replacement or a full refund, the
    // customer's choice, with photographs.
    damaged: claim(false, ['refund', 'return_and_refund', 'replacement'], 1),
    defective: claim(false, ['refund', 'return_and_refund', 'replacement'], 1),
    wrong_item: claim(true, ['return_and_refund', 'replacement'], 1),
    missing_item: claim(false, ['refund', 'reshipment'], 0),
    not_as_described: claim(true, ['return_and_refund', 'replacement'], 1),
    // Withdrawal (Policy §2–3): the item comes back first.
    wrong_size: claim(true, ['return_and_refund']),
    changed_mind: claim(true, ['return_and_refund']),
    // Paid, not yet dispatched (Policy §1): a full refund, nothing to return.
    cancel_before_dispatch: claim(false, ['refund']),
    other: claim(true, ['return_and_refund', 'refund', 'replacement']),
  },
  shipping: {
    refundOnFullWithdrawal: true,
    refundOnSellerFault: true,
  },
  restrictions: {
    nonReturnableProductSlugs: [],
    nonReturnableCategorySlugs: [],
  },
  approvals: {
    // Off by default: the shop is run by one person, and a second approver
    // that cannot exist would block every large refund. An owner turns it on
    // once there are two staff members who can approve.
    secondApprovalMinor: null,
    highRiskRequiresJustification: true,
    highRiskRequiresSecondApproval: false,
  },
  risk: {
    mediumThreshold: 30,
    highThreshold: 60,
    lookbackDays: 365,
    recentDays: 90,
    recentRequestCount: 3,
    nonDeliveryCount: 2,
    highValueMinor: 100_000, // CHF 1'000
    quickAfterDeliveryHours: 2,
    rules: {
      repeat_non_delivery: { enabled: true, weight: 30 },
      many_recent_requests: { enabled: true, weight: 15 },
      repeat_requests_same_order: { enabled: true, weight: 15 },
      prior_refunds_same_item: { enabled: true, weight: 25 },
      high_value: { enabled: true, weight: 10 },
      repeat_high_value: { enabled: true, weight: 15 },
      contradicts_records: { enabled: true, weight: 25 },
      duplicate_return_tracking: { enabled: true, weight: 40 },
      claims_after_confirmed_delivery: { enabled: true, weight: 20 },
      fulfilment_records_missing: { enabled: true, weight: 10 },
      quick_after_delivery: { enabled: true, weight: 5 },
      duplicate_evidence: { enabled: true, weight: 30 },
      prior_documented_findings: { enabled: true, weight: 30 },
    },
  },
  sla: {
    firstResponseHours: 48,
    decisionDays: 14,
    processingAlertHours: 72,
  },
  retention: {
    evidenceDays: 730,
  },
  returnInstructions: '',
}

/** Version 0 is the built-in default above; stored versions start at 1. */
export const DEFAULT_POLICY_VERSION = 0

export type PolicyVersion = { version: number; config: PolicyConfig }

/**
 * Reads a stored config defensively: a version saved before a field existed
 * gets that field's default rather than failing every case that uses it.
 */
export function parsePolicyConfig(raw: unknown): PolicyConfig {
  const merged = deepMerge(DEFAULT_POLICY, raw)
  return policyConfigSchema.parse(merged)
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return (patch === undefined ? base : (patch as T)) ?? base
  }
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return patch as T
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue
    out[key] = key in out ? deepMerge(out[key], value) : value
  }
  return out as T
}

export function claimRule(policy: PolicyConfig, type: ClaimType): ClaimRule {
  return policy.claims[type]
}
