import 'server-only'

import { createHmac } from 'node:crypto'

/**
 * One JSON line per security-relevant event, for the platform logs and any
 * log drain behind them: `{"security_event":"admin_login_failed",...}`.
 * Searchable and countable — repeated admin login failures, bursts of 429s,
 * forged webhooks, probes of the cron routes — without a monitoring service.
 *
 * Never a secret, a token, an email or a raw IP address: the address is
 * reduced to a keyed hash (stable, so repeats from one source can be counted,
 * but not reversible), and only fixed, known field names are written.
 */
export type SecurityEvent =
  | 'admin_login_failed'
  | 'admin_login_refused_config'
  | 'rate_limited'
  | 'rate_limiter_unavailable'
  | 'webhook_signature_invalid'
  | 'cron_unauthorized'
  | 'admin_staff_bind_failed'

function sourceHash(ip: string | null | undefined): string | undefined {
  const key = process.env.PAYMENT_FRAUD_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!key || !ip) return undefined
  return createHmac('sha256', key).update(`lv-security-ip:${ip}`).digest('hex').slice(0, 16)
}

export function securityEvent(
  event: SecurityEvent,
  fields: { ip?: string | null; route?: string; bucket?: string; reason?: string } = {},
): void {
  const line: Record<string, string> = { security_event: event, at: new Date().toISOString() }
  const source = sourceHash(fields.ip)
  if (source) line.source = source
  if (fields.route) line.route = fields.route.slice(0, 120)
  if (fields.bucket) line.bucket = fields.bucket.slice(0, 60)
  if (fields.reason) line.reason = fields.reason.slice(0, 120)
  console.warn(JSON.stringify(line))
}
