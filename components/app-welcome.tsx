'use client'

import { useEffect } from 'react'
import { appDiscountLabel } from '@/components/account/app-code-section'
import type { AppCodeView } from '@/lib/promo-codes'
import { isStandalone } from '@/lib/pwa'
import { useStore } from '@/lib/store'

const ANNOUNCED_KEY = 'lv.appCode.announced'

/**
 * Issues the customer's personal app code the first time the INSTALLED app
 * is opened while they are signed in, and says so once.
 *
 * Renders nothing. Does nothing in a browser tab (the code is the app's), or
 * signed out (it waits for sign-in, then runs). The "announced" flag is per
 * account and per device, set only once a code actually exists — so a
 * launch that could not issue one (programme off, network down) tries again
 * next time. The server holds the real rule: one code per account.
 */
export function AppWelcome() {
  const { currentUser, pushToast, t, tf } = useStore()
  const userId = currentUser?.id

  useEffect(() => {
    if (!userId || !isStandalone()) return
    const key = `${ANNOUNCED_KEY}.${userId}`
    try {
      if (window.localStorage.getItem(key)) return
    } catch {
      // Storage blocked: carry on — at worst the toast shows again next launch.
    }

    let cancelled = false
    fetch('/api/app/welcome-code', { method: 'POST', cache: 'no-store' })
      .then((res) => res.json() as Promise<AppCodeView>)
      .then((view) => {
        if (cancelled || !view || !('code' in view)) return
        try {
          window.localStorage.setItem(key, '1')
        } catch {
          // See above.
        }
        if (view.status === 'ready') {
          pushToast({
            title: t('appCode.readyToast'),
            description: tf('appCode.readyToastDesc', { discount: appDiscountLabel(view.kind, view.value) }),
            variant: 'gold',
          })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // Once per signed-in account; t/tf/pushToast are stable enough not to matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  return null
}
