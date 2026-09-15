// Reads what the support forms send: multipart (with attachments) or JSON.
import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { SUPPORT_CATEGORIES, type SupportCategory } from '@/lib/types'
import { MAX_ATTACHMENTS, SupportInputError, type IncomingFile } from '@/lib/server/support-store'

export const FIELD_LIMITS = { name: 60, email: 254, subject: 150, body: 5000, order: 40 }

// Deliberately permissive: a contact form, not an auth boundary. Rejecting an
// unusual-but-valid address is worse than accepting a junk one.
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Vercel refuses bodies above ~4.5 MB before the function runs; saying so
 *  here gives the customer a readable answer instead of a platform error. */
const MAX_BODY_BYTES = 4.5 * 1024 * 1024

export type SupportForm = { fields: Record<string, string>; files: IncomingFile[] }

export async function readSupportForm(request: NextRequest): Promise<SupportForm | NextResponse> {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Attachments together must be under 4 MB.' }, { status: 413 })
  }

  const fields: Record<string, string> = {}
  const files: IncomingFile[] = []
  const type = request.headers.get('content-type') ?? ''
  try {
    if (type.includes('multipart/form-data')) {
      const form = await request.formData()
      const entries: [string, FormDataEntryValue][] = []
      form.forEach((value, key) => entries.push([key, value]))
      for (const [key, value] of entries) {
        if (typeof value === 'string') {
          fields[key] = value
        } else if (key === 'files' && files.length <= MAX_ATTACHMENTS) {
          files.push({
            name: value.name || 'file',
            type: value.type,
            bytes: Buffer.from(await value.arrayBuffer()),
          })
        }
      }
    } else {
      const body = (await request.json()) as Record<string, unknown>
      for (const [key, value] of Object.entries(body ?? {})) {
        if (typeof value === 'string') fields[key] = value
      }
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  return { fields, files }
}

export const clip = (value: string | undefined, max: number) => (value ?? '').trim().slice(0, max)

export function category(value: string | undefined): SupportCategory {
  return (SUPPORT_CATEGORIES as string[]).indexOf(value ?? '') !== -1 ? (value as SupportCategory) : 'other'
}

/** Order numbers are LV- plus characters; anything else is dropped rather
 *  than stored. */
export function orderNumber(value: string | undefined): string | undefined {
  const v = clip(value, FIELD_LIMITS.order).toUpperCase()
  return /^[A-Z0-9-]{4,40}$/.test(v) ? v : undefined
}

export function inputError(e: unknown): NextResponse | null {
  return e instanceof SupportInputError ? NextResponse.json({ error: e.message }, { status: 400 }) : null
}

/** The display name of a signed-in customer. */
export function nameOf(user: { email?: string | null; user_metadata?: Record<string, unknown> }): string {
  const meta = user.user_metadata ?? {}
  const raw = [meta.full_name, meta.name].find((v) => typeof v === 'string' && v.trim()) as string | undefined
  return (raw ?? user.email?.split('@')[0] ?? 'Customer').trim().slice(0, FIELD_LIMITS.name)
}
