import type { Metadata } from 'next'
import { CartReminderOptOut } from '@/components/cart-reminder-optout'

export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function CartReminderOptOutPage(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  return <CartReminderOptOut token={params.token} />
}
