// Server-only persistence for the support center: tickets, their messages and
// attachments (migration 0030).
//
// Everything goes through the service-role client — the tables have RLS on and
// no policies. A customer reaches a ticket through the API, which checks that
// it is theirs: by the signed-in session (user_id), or by the ticket's
// access_token for a request filed without an account (the emailed link).
import 'server-only'

import { randomInt } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  SupportAttachment,
  SupportCategory,
  SupportMessage,
  SupportTicket,
  SupportTicketDetail,
  SupportTicketStatus,
} from '@/lib/types'

const BUCKET = 'support-attachments'

/** Per request, after the browser has downscaled photos. Vercel refuses request
 *  bodies above ~4.5 MB, so the limit is set under it. */
export const MAX_ATTACHMENTS = 4
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
export const MAX_REQUEST_ATTACHMENT_BYTES = 4 * 1024 * 1024

const ALLOWED_TYPES = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/heic', 'heic'],
  ['image/heif', 'heif'],
  ['application/pdf', 'pdf'],
])

/** Signed attachment links live this long — enough to read a thread. */
const SIGNED_URL_SECONDS = 60 * 60

const COLUMNS =
  'id, ticket_number, created_at, last_message_at, last_message_by, customer_last_read_at, staff_last_read_at, ' +
  'user_id, name, email, subject, category, order_number, status, locale, access_token, message'

export type TicketRow = {
  id: string
  ticket_number: string
  created_at: string
  last_message_at: string | null
  last_message_by: 'customer' | 'staff' | null
  customer_last_read_at: string | null
  staff_last_read_at: string | null
  user_id: string | null
  name: string
  email: string
  subject: string | null
  category: SupportCategory
  order_number: string | null
  status: SupportTicketStatus
  locale: string | null
  access_token: string
  message: string
}

export type IncomingFile = { name: string; type: string; bytes: Buffer }

export class SupportInputError extends Error {}

const ms = (value: string | null | undefined) => (value ? new Date(value).getTime() : 0)

function toTicket(row: TicketRow, viewer: 'customer' | 'staff'): SupportTicket {
  const lastMessageAt = ms(row.last_message_at) || ms(row.created_at)
  const lastBy = row.last_message_by ?? 'customer'
  const readAt = viewer === 'customer' ? ms(row.customer_last_read_at) : ms(row.staff_last_read_at)
  const fromOtherSide = viewer === 'customer' ? lastBy === 'staff' : lastBy === 'customer'
  return {
    id: row.id,
    number: row.ticket_number,
    createdAt: ms(row.created_at),
    lastMessageAt,
    lastMessageBy: lastBy,
    status: row.status,
    category: row.category,
    subject: row.subject || row.message.slice(0, 80),
    orderNumber: row.order_number ?? undefined,
    name: row.name,
    email: row.email,
    unread: fromOtherSide && readAt < lastMessageAt,
  }
}

// ------------------------------------------------------------ attachments --

/** Validates what the browser sent. Throws SupportInputError with a message
 *  the customer can act on. */
export function checkFiles(files: IncomingFile[]): void {
  if (files.length > MAX_ATTACHMENTS) {
    throw new SupportInputError(`Up to ${MAX_ATTACHMENTS} files can be attached.`)
  }
  let total = 0
  for (const f of files) {
    if (!ALLOWED_TYPES.has(f.type)) throw new SupportInputError(`"${f.name}": only photos and PDF files can be attached.`)
    if (f.bytes.byteLength === 0) throw new SupportInputError(`"${f.name}" is empty.`)
    if (f.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new SupportInputError(`"${f.name}" is larger than 4 MB.`)
    total += f.bytes.byteLength
  }
  if (total > MAX_REQUEST_ATTACHMENT_BYTES) throw new SupportInputError('Attachments together must be under 4 MB.')
}

function randomName(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < 12; i++) out += alphabet[randomInt(alphabet.length)]
  return out
}

async function uploadFiles(ticketId: string, files: IncomingFile[]): Promise<SupportAttachment[]> {
  const storage = createAdminClient().storage.from(BUCKET)
  const saved: SupportAttachment[] = []
  for (const f of files) {
    const path = `tickets/${ticketId}/${Date.now().toString(36)}-${randomName()}.${ALLOWED_TYPES.get(f.type)}`
    const { error } = await storage.upload(path, f.bytes, { contentType: f.type, upsert: false })
    if (error) {
      if (saved.length) await storage.remove(saved.map((s) => s.path))
      throw new Error(`Attachment upload failed: ${error.message}`)
    }
    saved.push({ path, name: f.name.slice(0, 120) || 'file', type: f.type, size: f.bytes.byteLength })
  }
  return saved
}

async function signAttachments(messages: SupportMessage[]): Promise<void> {
  const paths = messages.flatMap((m) => m.attachments.map((a) => a.path))
  if (paths.length === 0) return
  const { data } = await createAdminClient().storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)
  const urls = new Map((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]))
  for (const m of messages) for (const a of m.attachments) a.url = urls.get(a.path) ?? undefined
}

// ---------------------------------------------------------------- tickets --

function ticketNumber(): string {
  // No 0/O or 1/I: the number is read out on the phone and typed from paper.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 6; i++) out += alphabet[randomInt(alphabet.length)]
  return `LVS-${out}`
}

async function readMessages(ticketId: string): Promise<SupportMessage[]> {
  const { data, error } = await createAdminClient()
    .from('support_messages')
    .select('id, created_at, author, body, attachments')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Failed to read messages: ${error.message}`)
  return (data ?? []).map((m) => ({
    id: m.id as string,
    createdAt: ms(m.created_at as string),
    author: m.author as 'customer' | 'staff',
    body: m.body as string,
    attachments: Array.isArray(m.attachments) ? (m.attachments as SupportAttachment[]) : [],
  }))
}

export async function createTicket(input: {
  userId?: string
  name: string
  email: string
  category: SupportCategory
  subject: string
  orderNumber?: string
  locale?: string
  body: string
  files: IncomingFile[]
}): Promise<{ row: TicketRow; ticket: SupportTicket }> {
  checkFiles(input.files)
  const supabase = createAdminClient()

  let row: TicketRow | null = null
  for (let attempt = 0; attempt < 5 && !row; attempt++) {
    const { data, error } = await supabase
      .from('support_tickets')
      .insert({
        ticket_number: ticketNumber(),
        user_id: input.userId ?? null,
        name: input.name,
        email: input.email,
        category: input.category,
        subject: input.subject,
        order_number: input.orderNumber ?? null,
        locale: input.locale ?? null,
        message: input.body,
        status: 'open',
        last_message_by: 'customer',
      })
      .select(COLUMNS)
      .single()
    if (!error) row = data as unknown as TicketRow
    else if (!(error.code === '23505' && /ticket_number/.test(error.message))) {
      throw new Error(`Failed to save support ticket: ${error.message}`)
    }
  }
  if (!row) throw new Error('Could not allocate a ticket number')

  try {
    const attachments = await uploadFiles(row.id, input.files)
    const { error } = await supabase
      .from('support_messages')
      .insert({ ticket_id: row.id, author: 'customer', body: input.body, attachments })
    if (error) throw new Error(error.message)
  } catch (e) {
    // No ticket without its first message.
    await supabase.from('support_tickets').delete().eq('id', row.id)
    throw e
  }
  return { row, ticket: toTicket(row, 'customer') }
}

/** The ticket if this customer may see it — by session or by access token. */
export async function findCustomerTicket(
  number: string,
  access: { userId?: string; token?: string },
): Promise<TicketRow | null> {
  const { data, error } = await createAdminClient()
    .from('support_tickets')
    .select(COLUMNS)
    .eq('ticket_number', number.trim().toUpperCase())
    .maybeSingle()
  if (error) throw new Error(`Failed to read ticket: ${error.message}`)
  const row = data as unknown as TicketRow | null
  if (!row) return null
  const mine = Boolean(access.userId && row.user_id === access.userId)
  const tokenOk = Boolean(access.token && row.access_token === access.token)
  return mine || tokenOk ? row : null
}

export async function findTicketById(id: string): Promise<TicketRow | null> {
  const { data, error } = await createAdminClient().from('support_tickets').select(COLUMNS).eq('id', id).maybeSingle()
  if (error) throw new Error(`Failed to read ticket: ${error.message}`)
  return (data as unknown as TicketRow | null) ?? null
}

export async function ticketDetail(row: TicketRow, viewer: 'customer' | 'staff'): Promise<SupportTicketDetail> {
  const messages = await readMessages(row.id)
  await signAttachments(messages)
  return { ...toTicket(row, viewer), messages }
}

/** Opening a ticket clears its unread mark for that side. */
export async function markRead(row: TicketRow, viewer: 'customer' | 'staff'): Promise<void> {
  await createAdminClient()
    .from('support_tickets')
    .update(viewer === 'customer' ? { customer_last_read_at: new Date().toISOString() } : { staff_last_read_at: new Date().toISOString() })
    .eq('id', row.id)
}

/**
 * Adds a message. A customer writing to a ticket that was waiting on them, or
 * marked resolved, reopens it; a staff reply sets it to `status` (by default
 * "waiting for the customer"). Closed tickets take no replies — the caller
 * refuses before getting here.
 */
export async function addMessage(
  row: TicketRow,
  author: 'customer' | 'staff',
  body: string,
  files: IncomingFile[],
  status?: SupportTicketStatus,
): Promise<SupportMessage> {
  checkFiles(files)
  const supabase = createAdminClient()
  const attachments = await uploadFiles(row.id, files)
  const { data, error } = await supabase
    .from('support_messages')
    .insert({ ticket_id: row.id, author, body, attachments })
    .select('id, created_at')
    .single()
  if (error) {
    if (attachments.length) await supabase.storage.from(BUCKET).remove(attachments.map((a) => a.path))
    throw new Error(`Failed to save message: ${error.message}`)
  }

  const now = new Date().toISOString()
  const nextStatus: SupportTicketStatus =
    author === 'staff'
      ? status ?? 'waiting_user'
      : row.status === 'waiting_user' || row.status === 'resolved'
        ? 'open'
        : row.status
  await supabase
    .from('support_tickets')
    .update({
      last_message_at: now,
      last_message_by: author,
      updated_at: now,
      status: nextStatus,
      ...(author === 'staff'
        ? { last_staff_reply_at: now, staff_last_read_at: now }
        : { customer_last_read_at: now }),
    })
    .eq('id', row.id)

  row.status = nextStatus
  return { id: data.id as string, createdAt: ms(data.created_at as string), author, body, attachments }
}

// ----------------------------------------------------------- customer lists --

export async function listForUser(userId: string): Promise<SupportTicket[]> {
  const { data, error } = await createAdminClient()
    .from('support_tickets')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('last_message_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(`Failed to read tickets: ${error.message}`)
  return ((data ?? []) as unknown as TicketRow[]).map((r) => toTicket(r, 'customer'))
}

/** Tickets a guest filed on this device, proven by their access tokens. */
export async function listByTokens(refs: { number: string; token: string }[]): Promise<SupportTicket[]> {
  const clean = refs.filter((r) => typeof r.number === 'string' && typeof r.token === 'string').slice(0, 30)
  if (clean.length === 0) return []
  const { data, error } = await createAdminClient()
    .from('support_tickets')
    .select(COLUMNS)
    .in('ticket_number', clean.map((r) => r.number.toUpperCase()))
  if (error) throw new Error(`Failed to read tickets: ${error.message}`)
  const tokens = new Map(clean.map((r) => [r.number.toUpperCase(), r.token]))
  return ((data ?? []) as unknown as TicketRow[])
    .filter((r) => tokens.get(r.ticket_number) === r.access_token)
    .map((r) => toTicket(r, 'customer'))
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
}

// ------------------------------------------------------------------ admin --

export async function listForAdmin(filters: {
  status?: SupportTicketStatus
  category?: SupportCategory
  q?: string
}): Promise<SupportTicket[]> {
  let query = createAdminClient()
    .from('support_tickets')
    .select(COLUMNS)
    .order('last_message_at', { ascending: false })
    .limit(300)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.category) query = query.eq('category', filters.category)
  const q = filters.q?.replace(/[,()%*]/g, ' ').trim()
  if (q) query = query.or(`ticket_number.ilike.%${q}%,email.ilike.%${q}%,subject.ilike.%${q}%,name.ilike.%${q}%`)
  const { data, error } = await query
  if (error) throw new Error(`Failed to read tickets: ${error.message}`)
  return ((data ?? []) as unknown as TicketRow[]).map((r) => toTicket(r, 'staff'))
}

/** How many tickets sit in each status — the admin's filter chips. */
export async function countByStatus(): Promise<Record<SupportTicketStatus, number>> {
  const counts: Record<SupportTicketStatus, number> = { open: 0, in_progress: 0, waiting_user: 0, resolved: 0, closed: 0 }
  const { data, error } = await createAdminClient().from('support_tickets').select('status').limit(5000)
  if (error) throw new Error(`Failed to count tickets: ${error.message}`)
  for (const r of data ?? []) {
    const s = r.status as SupportTicketStatus
    if (s in counts) counts[s]++
  }
  return counts
}

export async function setTicketStatus(id: string, status: SupportTicketStatus): Promise<TicketRow | null> {
  const now = new Date().toISOString()
  const { data, error } = await createAdminClient()
    .from('support_tickets')
    .update({ status, updated_at: now, closed_at: status === 'closed' ? now : null })
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle()
  if (error) throw new Error(`Failed to update ticket: ${error.message}`)
  return (data as unknown as TicketRow | null) ?? null
}

export async function deleteTicket(id: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data: files } = await supabase.storage.from(BUCKET).list(`tickets/${id}`, { limit: 100 })
  const { data, error } = await supabase.from('support_tickets').delete().eq('id', id).select('id').maybeSingle()
  if (error) throw new Error(`Failed to delete ticket: ${error.message}`)
  if (data && files?.length) await supabase.storage.from(BUCKET).remove(files.map((f) => `tickets/${id}/${f.name}`))
  return Boolean(data)
}

export function customerView(row: TicketRow): SupportTicket {
  return toTicket(row, 'customer')
}

export function staffView(row: TicketRow): SupportTicket {
  return toTicket(row, 'staff')
}
