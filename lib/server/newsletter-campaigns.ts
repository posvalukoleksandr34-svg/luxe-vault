// Newsletter administration and delivery (migrations 0034 + 0037): the
// subscriber list, manual status changes, unsubscribe links and the campaign
// log. Sign-ups themselves are lib/server/newsletter.ts.
import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { CampaignContent } from '@/lib/newsletter/campaign'

export type SubscriberStatus = 'active' | 'unsubscribed'

export type SubscriberRow = {
  id: string
  email: string
  status: SubscriberStatus
  locale: string
  source: string
  createdAt: string
}

export type CampaignRow = {
  id: string
  createdAt: string
  subject: string
  status: 'sending' | 'sent' | 'partial' | 'failed'
  mode: 'live' | 'test'
  recipients: number
  sent: number
  failed: number
}

/** 'tables' — 0034 is missing; 'columns' — 0034 is there, 0037 is not. */
export type NewsletterSchemaGap = 'tables' | 'columns' | null

function schemaGap(error: { code?: string } | null): NewsletterSchemaGap {
  if (!error?.code) return null
  if (error.code === '42P01' || error.code === 'PGRST205') return 'tables'
  if (error.code === '42703' || error.code === 'PGRST204') return 'columns'
  return null
}

export async function listSubscribers(limit = 2000): Promise<
  | { ok: true; total: number; active: number; rows: SubscriberRow[]; campaigns: CampaignRow[] }
  | { ok: false; gap: NewsletterSchemaGap; error?: string }
> {
  const supabase = createAdminClient()
  const [rows, active, total, campaigns] = await Promise.all([
    supabase
      .from('newsletter_subscribers')
      .select('id, email, status, locale, source, created_at')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase.from('newsletter_subscribers').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('newsletter_subscribers').select('id', { count: 'exact', head: true }),
    supabase
      .from('newsletter_campaigns')
      .select('id, created_at, subject, status, mode, recipients, sent, failed')
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const error = rows.error ?? active.error ?? total.error ?? campaigns.error
  if (error) {
    const gap = schemaGap(error)
    if (!gap) console.error('[newsletter/admin] list failed:', error.message)
    return { ok: false, gap, error: gap ? undefined : error.message }
  }

  return {
    ok: true,
    total: total.count ?? 0,
    active: active.count ?? 0,
    rows: (rows.data ?? []).map((r) => ({
      id: r.id as string,
      email: r.email as string,
      status: r.status as SubscriberStatus,
      locale: (r.locale as string) ?? 'ru',
      source: (r.source as string) ?? '',
      createdAt: r.created_at as string,
    })),
    campaigns: (campaigns.data ?? []).map((c) => ({
      id: c.id as string,
      createdAt: c.created_at as string,
      subject: c.subject as string,
      status: c.status as CampaignRow['status'],
      mode: c.mode as CampaignRow['mode'],
      recipients: Number(c.recipients) || 0,
      sent: Number(c.sent) || 0,
      failed: Number(c.failed) || 0,
    })),
  }
}

export async function setSubscriberStatus(id: string, status: SubscriberStatus): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('newsletter_subscribers')
    .update({ status })
    .eq('id', id)
    .select('id')
  if (error) {
    console.error('[newsletter/admin] status change failed:', error.message)
    return false
  }
  return (data ?? []).length === 1
}

export type Recipient = { email: string; token: string; locale: string }

/** Every active subscriber, read in pages so a large list is not one query. */
export async function activeRecipients(): Promise<Recipient[]> {
  const supabase = createAdminClient()
  const page = 1000
  const out: Recipient[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('newsletter_subscribers')
      .select('email, unsubscribe_token, locale')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .range(from, from + page - 1)
    if (error) throw new Error(`Could not read subscribers: ${error.message}`)
    for (const r of data ?? []) {
      out.push({ email: r.email as string, token: r.unsubscribe_token as string, locale: (r.locale as string) ?? 'ru' })
    }
    if (!data || data.length < page) break
  }
  return out
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isToken(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** The unsubscribe link: unsubscribes, or resubscribes someone who changed
 *  their mind on the same page. */
export async function setStatusByToken(
  token: string,
  status: SubscriberStatus,
): Promise<'ok' | 'not_found' | 'failed'> {
  if (!isToken(token)) return 'not_found'
  const patch: Record<string, unknown> = { status }
  // Coming back through their own link is fresh consent.
  if (status === 'active') patch.consented_at = new Date().toISOString()
  const { data, error } = await createAdminClient()
    .from('newsletter_subscribers')
    .update(patch)
    .eq('unsubscribe_token', token)
    .select('id')
  if (error) {
    console.error('[newsletter] unsubscribe failed:', error.message)
    return 'failed'
  }
  return (data ?? []).length === 1 ? 'ok' : 'not_found'
}

/** Opens the campaign's log row. Returns null when this composition was
 *  already sent (the unique client key) — the caller must not send again. */
export async function openCampaign(input: {
  clientKey: string
  content: CampaignContent
  mode: 'live' | 'test'
  recipients: number
}): Promise<{ id: string } | { duplicate: true } | { error: string }> {
  const { content } = input
  const { data, error } = await createAdminClient()
    .from('newsletter_campaigns')
    .insert({
      client_key: input.clientKey,
      subject: content.subject,
      preheader: content.preheader,
      content: {
        title: content.title,
        body: content.body,
        imageUrl: content.imageUrl,
        ctaLabel: content.ctaLabel,
        ctaUrl: content.ctaUrl,
      },
      mode: input.mode,
      recipients: input.recipients,
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') return { duplicate: true }
    return { error: error.message }
  }
  return { id: data.id as string }
}

export async function closeCampaign(
  id: string,
  result: { sent: number; failed: number; error?: string },
): Promise<void> {
  const status = result.failed === 0 ? 'sent' : result.sent === 0 ? 'failed' : 'partial'
  const { error } = await createAdminClient()
    .from('newsletter_campaigns')
    .update({
      status,
      sent: result.sent,
      failed: result.failed,
      finished_at: new Date().toISOString(),
      error: result.error?.slice(0, 1000) ?? null,
    })
    .eq('id', id)
  if (error) console.error('[newsletter] campaign close failed:', error.message)
}
