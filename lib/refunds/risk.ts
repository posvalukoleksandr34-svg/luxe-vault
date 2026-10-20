import type { PolicyConfig, RiskRule } from '@/lib/refunds/policy'
import type { ClaimType, RiskLevel } from '@/lib/refunds/types'

/**
 * The refund risk assessment: which cases need a closer look, and WHY.
 *
 * It does not decide anything. A score sorts the queue and sets how much
 * scrutiny a case gets; a person decides every case (the published policy
 * promises it), and a high score only means "a person must look before
 * anything irreversible happens" — never "refuse".
 *
 * WHAT IT READS: the claim, the order, the shop's own fulfilment record and
 * the customer's history with the shop — transactions, claims, outcomes. It
 * does not read, and must never be given, anything about who the customer is:
 * name, nationality, address, language, age, or any other personal
 * characteristic. A shared or business address, a single request, a large
 * order, a "delivered" tracking status — none of these alone is evidence of
 * anything, and none can make a case high risk on its own:
 *
 *   * every rule's weight is capped at 40 by default, below the high
 *     threshold, and
 *   * a case is only HIGH when at least two different rules fired, whatever
 *     the weights are configured to (MIN_RULES_FOR_HIGH).
 *
 * Missing data is missing data: a rule whose fact is unknown does not fire.
 * The one exception is the shop's own fulfilment record being incomplete,
 * which flags that the claim CANNOT be verified — explained as the shop's gap,
 * not the customer's.
 *
 * Deterministic and versioned: the same facts, policy and ENGINE_VERSION give
 * the same result, and every assessment is stored with all three.
 */

export const ENGINE_VERSION = 'risk-v1'
export const MIN_RULES_FOR_HIGH = 2

export type HistoryCase = {
  id: string
  orderId: string
  claimType: ClaimType
  state: string
  createdAt: number
  amountMinor: number
  /** Staff's documented finding on that case, if any. */
  finding?: 'legitimate' | 'not_substantiated' | 'abuse_confirmed'
  /** The non-delivery investigation established the parcel was delivered. */
  deliveryConfirmed?: boolean
  returnTrackingNumber?: string
}

export type RiskFacts = {
  now: number
  claimType: ClaimType
  orderId: string
  /** What this claim is worth (calculator). */
  claimMinor: number
  /** Order lines this claim covers. */
  orderItemIds: string[]
  /** The customer's OTHER cases within the lookback window. */
  history: HistoryCase[]
  /** Units of this claim's lines already refunded by settled cases. */
  priorRefundedUnitsSameItems: number
  /** Facts in the claim that the shop's records contradict, already
   *  established by the caller (e.g. "missing item" on a single-item order
   *  that was claimed as received in full). */
  contradictions: string[]
  /** This case's return tracking number is on another case. */
  duplicateReturnTracking: boolean
  /** Files attached here whose hash matches another customer's or another
   *  case's evidence. */
  duplicateEvidence: number
  /** The shop's fulfilment record is incomplete for this claim (dispatched
   *  without a tracking number or dispatch date). */
  fulfilmentRecordsMissing: boolean
  /** Hours from the recorded delivery to this claim, when both are known. */
  hoursSinceDelivery?: number
}

export type RuleHit = {
  rule: RiskRule
  weight: number
  /** The facts the rule fired on — shown to staff, verbatim. */
  facts: Record<string, string | number | boolean>
  /** Which kind of finding this is: a pattern in the customer's history, a
   *  fact about this claim, or a gap in the SHOP's records. */
  basis: 'history' | 'claim' | 'shop_records'
}

export type RiskAssessment = {
  score: number
  level: RiskLevel
  hits: RuleHit[]
  /** True when the score reached high but fewer than MIN_RULES_FOR_HIGH rules
   *  fired, so the level was held at medium. */
  heldAtMedium: boolean
  engineVersion: string
}

const DAY = 86_400_000

export function assessRisk(facts: RiskFacts, policy: PolicyConfig): RiskAssessment {
  const cfg = policy.risk
  const hits: RuleHit[] = []
  const fire = (rule: RiskRule, basis: RuleHit['basis'], ruleFacts: RuleHit['facts']) => {
    const r = cfg.rules[rule]
    if (!r.enabled || r.weight === 0) return
    hits.push({ rule, weight: r.weight, facts: ruleFacts, basis })
  }

  const lookback = facts.now - cfg.lookbackDays * DAY
  const recent = facts.now - cfg.recentDays * DAY
  const history = facts.history.filter((c) => c.createdAt >= lookback)

  // Repeated non-delivery claims across different orders.
  if (facts.claimType === 'non_delivery') {
    const priorNonDelivery = history.filter((c) => c.claimType === 'non_delivery' && c.orderId !== facts.orderId)
    if (priorNonDelivery.length + 1 >= cfg.nonDeliveryCount) {
      fire('repeat_non_delivery', 'history', {
        nonDeliveryClaims: priorNonDelivery.length + 1,
        windowDays: cfg.lookbackDays,
        threshold: cfg.nonDeliveryCount,
      })
    }
    const confirmedAfterwards = priorNonDelivery.filter((c) => c.deliveryConfirmed).length
    if (confirmedAfterwards > 0) {
      fire('claims_after_confirmed_delivery', 'history', { earlierClaimsFoundDelivered: confirmedAfterwards })
    }
  }

  const recentCount = history.filter((c) => c.createdAt >= recent).length + 1
  if (recentCount >= cfg.recentRequestCount) {
    fire('many_recent_requests', 'history', { requests: recentCount, windowDays: cfg.recentDays, threshold: cfg.recentRequestCount })
  }

  const sameOrder = history.filter((c) => c.orderId === facts.orderId).length
  if (sameOrder >= 1) fire('repeat_requests_same_order', 'history', { otherRequestsOnThisOrder: sameOrder })

  if (facts.priorRefundedUnitsSameItems > 0) {
    fire('prior_refunds_same_item', 'history', { unitsAlreadyRefunded: facts.priorRefundedUnitsSameItems })
  }

  if (facts.claimMinor >= cfg.highValueMinor && cfg.highValueMinor > 0) {
    fire('high_value', 'claim', { claimMinor: facts.claimMinor, thresholdMinor: cfg.highValueMinor })
    const priorHigh = history.filter((c) => c.amountMinor >= cfg.highValueMinor).length
    if (priorHigh >= 1) fire('repeat_high_value', 'history', { earlierHighValueClaims: priorHigh })
  }

  if (facts.contradictions.length > 0) {
    fire('contradicts_records', 'claim', { contradictions: facts.contradictions.join(', ') })
  }
  if (facts.duplicateReturnTracking) fire('duplicate_return_tracking', 'claim', { returnTrackingOnAnotherCase: true })
  if (facts.duplicateEvidence > 0) fire('duplicate_evidence', 'claim', { filesSeenElsewhere: facts.duplicateEvidence })
  if (facts.fulfilmentRecordsMissing) fire('fulfilment_records_missing', 'shop_records', { shopRecordIncomplete: true })
  if (
    facts.claimType === 'non_delivery' &&
    facts.hoursSinceDelivery !== undefined &&
    facts.hoursSinceDelivery >= 0 &&
    facts.hoursSinceDelivery <= cfg.quickAfterDeliveryHours
  ) {
    fire('quick_after_delivery', 'claim', { hoursAfterRecordedDelivery: Math.round(facts.hoursSinceDelivery) })
  }

  const confirmed = history.filter((c) => c.finding === 'abuse_confirmed').length
  if (confirmed > 0) fire('prior_documented_findings', 'history', { documentedFindings: confirmed })

  const score = Math.min(100, hits.reduce((sum, h) => sum + h.weight, 0))
  const distinct = new Set(hits.map((h) => h.rule)).size
  let level: RiskLevel = score >= cfg.highThreshold ? 'high' : score >= cfg.mediumThreshold ? 'medium' : 'low'
  let heldAtMedium = false
  if (level === 'high' && distinct < MIN_RULES_FOR_HIGH) {
    level = 'medium'
    heldAtMedium = true
  }
  return { score, level, hits, heldAtMedium, engineVersion: ENGINE_VERSION }
}

/** Russian explanations for the console — one per rule, filled with its facts. */
export const RULE_EXPLANATION_RU: Record<RiskRule, string> = {
  repeat_non_delivery: 'Повторные заявления о недоставке по разным заказам',
  many_recent_requests: 'Много заявок за короткий период',
  repeat_requests_same_order: 'Уже есть другие заявки по этому заказу',
  prior_refunds_same_item: 'По этим позициям уже был возврат',
  high_value: 'Крупная сумма',
  repeat_high_value: 'Повторные крупные заявки',
  contradicts_records: 'Заявка расходится с данными заказа',
  duplicate_return_tracking: 'Трек-номер возврата уже указан в другой заявке',
  claims_after_confirmed_delivery: 'Раньше недоставку заявляли, а доставка потом подтвердилась',
  fulfilment_records_missing: 'Неполные данные об отправке у магазина — проверить нечем (это пробел магазина, не покупателя)',
  quick_after_delivery: 'Заявка сразу после отметки о доставке',
  duplicate_evidence: 'Файлы совпадают с файлами в других заявках',
  prior_documented_findings: 'Ранее подтверждённые (задокументированные) нарушения',
}
