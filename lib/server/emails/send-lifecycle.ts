import 'server-only'

import { lifecycleEmail, welcomeEmail } from '@/lib/server/emails/lifecycle'
import { FROM_ADDRESS, isMailConfigured, sendEmail } from '@/lib/server/resend'
import type { Order, OrderStatus } from '@/lib/types'

/**
 * Sends the lifecycle emails, and never lets one break the operation that
 * triggered it.
 *
 * Every caller here is finishing something that already succeeded — a status
 * was written, a refund was issued, an account was created. Throwing because
 * Resend had a bad second would roll back nothing and report failure for work
 * that actually completed, so failures are logged and swallowed.
 *
 * Fire-and-forget is deliberate at the call sites too: an admin marking twenty
 * orders as shipped should not wait on twenty SMTP round trips.
 */

export async function sendOrderStatusEmail(
  order: Order,
  status: OrderStatus,
): Promise<boolean> {
  if (!isMailConfigured) return false

  const to = order.customer.email?.trim()
  if (!to) {
    // Guest orders may have no email. Not an error — there is simply nobody
    // to tell.
    return false
  }

  const message = lifecycleEmail(order, status)
  if (!message) return false

  try {
    const result = await sendEmail({
      to,
      from: FROM_ADDRESS,
      subject: message.subject,
      html: message.html,
      text: message.text,
    })
    if (!result.ok) {
      console.warn(`[emails] ${status} notice for ${order.id} not sent: ${result.message}`)
      return false
    }
    return true
  } catch (e) {
    console.warn(`[emails] ${status} notice for ${order.id} threw:`, e)
    return false
  }
}

export async function sendWelcomeEmail(to: string, name: string): Promise<boolean> {
  if (!isMailConfigured || !to.trim()) return false

  const message = welcomeEmail(name)
  try {
    const result = await sendEmail({
      to,
      from: FROM_ADDRESS,
      subject: message.subject,
      html: message.html,
      text: message.text,
    })
    if (!result.ok) {
      console.warn(`[emails] welcome not sent: ${result.message}`)
      return false
    }
    return true
  } catch (e) {
    console.warn('[emails] welcome threw:', e)
    return false
  }
}
