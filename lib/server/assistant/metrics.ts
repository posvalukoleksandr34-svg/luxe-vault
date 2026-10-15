import 'server-only'

/**
 * Quality signals for the concierge, as one JSON line per event in the
 * platform log — the same pattern as lib/server/security-events.ts.
 *
 * AGGREGATES, NOT TRANSCRIPTS. A line says what happened (answered, handed
 * over, fell back and why), how long it took and which tools ran — never what
 * was asked or answered, never an order number, token, address or IP. That is
 * enough to answer "how often does the chat fall back, and why", "how slow is
 * it", "do people find it helpful", without storing anyone's conversation.
 *
 *   {"assistant_event":"answered","ms":2310,"rounds":2,"tools":{"search_products":1},…}
 *
 * Search the log for "assistant_event". docs/support-assistant.md lists the
 * fields.
 */

export type FallbackReason =
  | 'unconfigured'
  | 'timeout'
  | 'cancelled'
  | 'rate_limited'
  | 'provider_error'
  | 'invalid_response'
  | 'wrong_language'

export type TurnMetrics = {
  ms: number
  rounds: number
  toolCalls: number
  tools: Record<string, number>
  rejectedCalls: number
  removedLinks: number
  unverifiedAmounts: number
  languageRetry: boolean
  handoff: boolean
  products: number
  /** Why a model reply could not be used (fallback 'invalid_response' or
   *  'wrong_language'): MAX_TOKENS, SAFETY, EMPTY, TOOL_CALL, NO_CONTENT,
   *  EMPTY_AFTER_CHECK. An enum, never text. */
  finishReason?: string
  /** The provider's HTTP status on 'provider_error' / 'rate_limited': 404 = the
   *  model is not available to this key, 400/403 = the key or the request. */
  providerStatus?: number
  /** The main model was overloaded or slow and the fallback model answered. */
  modelFallback?: boolean
}

export function emptyMetrics(): TurnMetrics {
  return {
    ms: 0,
    rounds: 0,
    toolCalls: 0,
    tools: {},
    rejectedCalls: 0,
    removedLinks: 0,
    unverifiedAmounts: 0,
    languageRetry: false,
    handoff: false,
    products: 0,
  }
}

type Event =
  | { event: 'answered'; locale: string; model: string; metrics: TurnMetrics }
  | { event: 'fallback'; locale: string; model: string; reason: FallbackReason; metrics: TurnMetrics }
  | { event: 'feedback'; rating: 'helpful' | 'not_helpful'; outcome?: string }

export function assistantEvent(e: Event): void {
  const { event, ...rest } = e
  const flat = 'metrics' in rest ? { ...rest, ...rest.metrics, metrics: undefined } : rest
  try {
    console.info(JSON.stringify({ assistant_event: event, at: new Date().toISOString(), ...flat }))
  } catch {
    // Logging must never break an answer.
  }
}
