'use client'

import { useEffect } from 'react'
import { SUPPORT_UNREAD_EVENT, fetchMyTickets, readTicketRefs } from '@/lib/support/client'
import { useStore } from '@/lib/store'

const EVERY_MS = 120_000

/**
 * Keeps the unread-replies count on the support buttons current.
 *
 * Asks only when there is something to ask about — a signed-in customer, or
 * requests this device filed — so a visitor who never wrote to us costs no
 * request at all. Then every two minutes while the tab is visible, when it
 * becomes visible again, and whenever a ticket is opened.
 */
export function SupportUnreadWatcher() {
  const { currentUser, setSupportUnread } = useStore()
  const userId = currentUser?.id

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function check() {
      if (stopped || document.visibilityState !== 'visible') return
      if (!userId && readTicketRefs().length === 0) {
        setSupportUnread(0)
        return
      }
      const r = await fetchMyTickets()
      if (r.ok && !stopped) setSupportUnread(r.unread)
    }
    function loop() {
      timer = setTimeout(() => {
        void check().finally(loop)
      }, EVERY_MS)
    }

    const first = setTimeout(() => {
      void check()
      loop()
    }, 3000)
    const onChange = () => void check()
    window.addEventListener(SUPPORT_UNREAD_EVENT, onChange)
    document.addEventListener('visibilitychange', onChange)
    return () => {
      stopped = true
      clearTimeout(first)
      if (timer) clearTimeout(timer)
      window.removeEventListener(SUPPORT_UNREAD_EVENT, onChange)
      document.removeEventListener('visibilitychange', onChange)
    }
  }, [userId, setSupportUnread])

  return null
}
