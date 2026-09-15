// Browser side of the support center: the tickets this device filed, and the
// calls to /api/support/*. Guests have no account to find their requests by,
// so each ticket's number and access token is kept here — the same idea as
// lib/order-registry.ts for orders.
import type { SupportMessage, SupportTicket, SupportTicketDetail, SupportTicketStatus } from '@/lib/types'

export const TICKET_REGISTRY_KEY = 'luxe-vault-tickets'
/** Fired on window whenever the unread count may have changed. */
export const SUPPORT_UNREAD_EVENT = 'lv:support-unread'

export const MAX_FILES = 4
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']

export type TicketRef = { number: string; token: string }

export function readTicketRefs(): TicketRef[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TICKET_REGISTRY_KEY) ?? '[]')
    return Array.isArray(raw)
      ? raw.filter((r) => r && typeof r.number === 'string' && typeof r.token === 'string').slice(0, 30)
      : []
  } catch {
    return []
  }
}

export function rememberTicket(ref: TicketRef): void {
  try {
    const rest = readTicketRefs().filter((r) => r.number !== ref.number)
    localStorage.setItem(TICKET_REGISTRY_KEY, JSON.stringify([ref, ...rest].slice(0, 30)))
  } catch {
    // Private mode: the emailed link still opens the ticket.
  }
}

export function ticketToken(number: string): string | undefined {
  return readTicketRefs().find((r) => r.number === number.toUpperCase())?.token
}

async function errorOf(res: Response): Promise<string | undefined> {
  const data = await res.json().catch(() => null)
  return typeof data?.error === 'string' ? data.error : undefined
}

export type MineResult =
  | { ok: true; tickets: SupportTicket[]; unread: number; signedIn: boolean }
  | { ok: false }

export async function fetchMyTickets(): Promise<MineResult> {
  try {
    const res = await fetch('/api/support/mine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refs: readTicketRefs() }),
    })
    if (!res.ok) return { ok: false }
    const data = await res.json()
    if (!Array.isArray(data.tickets)) return { ok: false }
    return { ok: true, tickets: data.tickets, unread: Number(data.unread) || 0, signedIn: Boolean(data.signedIn) }
  } catch {
    return { ok: false }
  }
}

export async function fetchTicket(
  number: string,
  token?: string,
): Promise<{ ok: true; ticket: SupportTicketDetail; token: string } | { ok: false; status: number }> {
  const t = token ?? ticketToken(number)
  try {
    const res = await fetch(
      `/api/support/tickets/${encodeURIComponent(number)}${t ? `?t=${encodeURIComponent(t)}` : ''}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return { ok: false, status: res.status }
    const data = await res.json()
    // Opening a ticket by its emailed link on a new device keeps it in
    // "My requests" from then on.
    if (data.token) rememberTicket({ number: data.ticket.number, token: data.token })
    window.dispatchEvent(new Event(SUPPORT_UNREAD_EVENT))
    return { ok: true, ticket: data.ticket, token: data.token }
  } catch {
    return { ok: false, status: 0 }
  }
}

export async function submitTicket(
  form: FormData,
): Promise<{ ok: true; ticket: SupportTicket; token: string } | { ok: false; error?: string; status: number }> {
  try {
    const res = await fetch('/api/support/tickets', { method: 'POST', body: form })
    if (!res.ok) return { ok: false, error: await errorOf(res), status: res.status }
    const data = await res.json()
    rememberTicket({ number: data.ticket.number, token: data.token })
    return { ok: true, ticket: data.ticket, token: data.token }
  } catch {
    return { ok: false, status: 0 }
  }
}

export async function submitReply(
  number: string,
  form: FormData,
): Promise<
  { ok: true; message: SupportMessage; status: SupportTicketStatus } | { ok: false; error?: string; status: number }
> {
  try {
    const res = await fetch(`/api/support/tickets/${encodeURIComponent(number)}/messages`, { method: 'POST', body: form })
    if (!res.ok) return { ok: false, error: await errorOf(res), status: res.status }
    const data = await res.json()
    return { ok: true, message: data.message, status: data.status }
  } catch {
    return { ok: false, status: 0 }
  }
}

/**
 * Phone photos are often 3–8 MB — over the request limit on their own. JPEG,
 * PNG and WebP above ~1.2 MB are redrawn at up to 2000 px as JPEG, which keeps
 * a label or a seam perfectly legible at a fraction of the size. HEIC cannot
 * be drawn by most browsers and PDFs are left alone; both go as they are.
 */
export async function prepareAttachment(file: File): Promise<File> {
  const drawable = ['image/jpeg', 'image/png', 'image/webp'].indexOf(file.type) !== -1
  if (!drawable || file.size <= 1.2 * 1024 * 1024) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

export function formatBytes(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}
