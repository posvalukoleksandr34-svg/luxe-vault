// Server-only persistence for customer support messages — same lightweight
// JSON-file "database" pattern as lib/server/orders-store.ts.
import { promises as fs } from 'fs'
import path from 'path'
import type { SupportTicket, SupportTicketStatus } from '@/lib/types'

const DATA_DIR = path.join(process.cwd(), 'data')
const SUPPORT_FILE = path.join(DATA_DIR, 'support.json')

async function ensureFile(): Promise<void> {
  try {
    await fs.access(SUPPORT_FILE)
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true })
    await fs.writeFile(SUPPORT_FILE, JSON.stringify([], null, 2), 'utf-8')
  }
}

export async function readTickets(): Promise<SupportTicket[]> {
  await ensureFile()
  try {
    const raw = await fs.readFile(SUPPORT_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeTickets(tickets: SupportTicket[]): Promise<void> {
  await ensureFile()
  await fs.writeFile(SUPPORT_FILE, JSON.stringify(tickets, null, 2), 'utf-8')
}

export async function addTicket(ticket: SupportTicket): Promise<void> {
  const tickets = await readTickets()
  await writeTickets([ticket, ...tickets])
}

export async function setTicketStatus(
  id: string,
  status: SupportTicketStatus,
): Promise<SupportTicket | null> {
  const tickets = await readTickets()
  let updated: SupportTicket | null = null
  const next = tickets.map((t) => {
    if (t.id !== id) return t
    updated = { ...t, status }
    return updated
  })
  if (updated) await writeTickets(next)
  return updated
}

export async function deleteTicket(id: string): Promise<boolean> {
  const tickets = await readTickets()
  const next = tickets.filter((t) => t.id !== id)
  const removed = next.length !== tickets.length
  if (removed) await writeTickets(next)
  return removed
}
