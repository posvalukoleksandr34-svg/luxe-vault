// Server-only persistence for customer support messages, backed by Postgres.
//
// Replaces the previous JSON-file store, which could never work in
// production: Vercel's filesystem is read-only outside /tmp, so fs.writeFile
// threw on every submission and the customer saw "Failed to send message".
//
// Reads and writes go through the service-role client. The table's RLS grants
// INSERT to anyone but no general SELECT, so the ticket queue is readable only
// by the server — a publicly readable contact-form table would be a
// scrapeable list of customer email addresses.
import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { SupportTicket, SupportTicketStatus } from '@/lib/types'

const TICKET_SELECT = 'id, created_at, name, email, message, status'

function rowToTicket(row: Record<string, unknown>): SupportTicket {
  return {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    message: row.message as string,
    createdAt: new Date(row.created_at as string).getTime(),
    status: row.status as SupportTicketStatus,
  }
}

export async function readTickets(): Promise<SupportTicket[]> {
  const { data, error } = await createAdminClient()
    .from('support_tickets')
    .select(TICKET_SELECT)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to read support tickets: ${error.message}`)
  return (data ?? []).map(rowToTicket)
}

/**
 * Stores a ticket and returns the row Postgres actually wrote.
 *
 * The caller's `id` and `createdAt` are ignored: the database owns both
 * (`gen_random_uuid()` and `now()`), so two submissions in the same
 * millisecond can no longer collide the way the old `sup-${Date.now()}` ids
 * could. `userId` is attached when the sender happens to be signed in, which
 * lets them see their own tickets later.
 */
export async function addTicket(
  ticket: SupportTicket,
  userId?: string,
): Promise<SupportTicket> {
  const { data, error } = await createAdminClient()
    .from('support_tickets')
    .insert({
      name: ticket.name,
      email: ticket.email,
      message: ticket.message,
      status: ticket.status ?? 'open',
      user_id: userId ?? null,
    })
    .select(TICKET_SELECT)
    .single()

  if (error) throw new Error(`Failed to save support ticket: ${error.message}`)
  return rowToTicket(data)
}

export async function setTicketStatus(
  id: string,
  status: SupportTicketStatus,
): Promise<SupportTicket | null> {
  const { data, error } = await createAdminClient()
    .from('support_tickets')
    .update({ status })
    .eq('id', id)
    .select(TICKET_SELECT)
    .maybeSingle()

  if (error) throw new Error(`Failed to update support ticket: ${error.message}`)
  return data ? rowToTicket(data) : null
}

export async function deleteTicket(id: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('support_tickets')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Failed to delete support ticket: ${error.message}`)
  return Boolean(data)
}
