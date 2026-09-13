import 'server-only'

import { emailLang, type EmailLang } from '@/lib/server/emails/copy'
import { lifecycleEmail, welcomeEmail } from '@/lib/server/emails/lifecycle'
import { getOrderLocale } from '@/lib/server/order-locale'
import { FROM_ADDRESS, isMailConfigured, sendEmail } from '@/lib/server/resend'
import type { Order, OrderStatus } from '@/lib/types'

/**
 * Sends the lifecycle emails, and never lets one break the operation that
 * triggered it.
 *
 * Every caller here is finishing something that already succeeded — a status
 * was written, a refund was issued, an account was created. Throwing because
 * the mail provider had a bad second would roll back nothing and report
 * failure for work that actually completed, so failures are logged and
 * swallowed.
 *
 * Fire-and-forget is deliberate at the call sites too: an admin marking twenty
 * orders as shipped should not wait on twenty SMTP round trips.
 */

export async function sendOrderStatusEmail(order: Order, status: OrderStatus): Promise<boolean> {
  if (!isMailConfigured) return false

  const to = order.customer.email?.trim()
  // Guest orders may have no email. Not an error — there is simply nobody to tell.
  if (!to) return false

  try {
    const lang = emailLang(await getOrderLocale(order.id))
    const message = lifecycleEmail(order, status, lang)
    if (!message) return false

    const result = await sendEmail({ to, from: FROM_ADDRESS, ...message })
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

export async function sendWelcomeEmail(to: string, name: string, lang: EmailLang = 'en'): Promise<boolean> {
  if (!isMailConfigured || !to.trim()) return false

  const message = welcomeEmail(name, lang)
  try {
    const result = await sendEmail({ to, from: FROM_ADDRESS, ...message })
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
