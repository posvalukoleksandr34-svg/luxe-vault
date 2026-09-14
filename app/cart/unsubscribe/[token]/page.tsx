import type { Metadata } from 'next'
import { CartReminderOptOut } from '@/components/cart-reminder-optout'

export const metadata: Metadata = { robots: { index: false, follow: false } }

export default function CartReminderOptOutPage({ params }: { params: { token: string } }) {
  return <CartReminderOptOut token={params.token} />
}
