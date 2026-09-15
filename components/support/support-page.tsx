'use client'

import { useCallback } from 'react'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { SupportCenter } from '@/components/support/support-center'
import { useStore, type SupportEntry } from '@/lib/store'

/** /support and /support/tickets/[number]: the support center as a page. */
export function SupportPage({ entry }: { entry?: SupportEntry }) {
  const { t } = useStore()

  // The emailed link carries the ticket's access token. Once it has opened
  // the conversation it is kept on this device, so it comes off the address
  // bar — a URL is the thing people copy and share.
  const onTicketOpened = useCallback((number: string) => {
    if (window.location.search) {
      window.history.replaceState(null, '', `/support/tickets/${encodeURIComponent(number)}`)
    }
  }, [])

  return (
    <>
      <Header />
      <main id="main" className="mx-auto w-full max-w-[760px] px-4 py-10 sm:px-6 lg:py-14">
        <Breadcrumbs
          trail={[
            { name: 'Luxe Vault', url: '/' },
            { name: t('support.title'), url: '/support' },
          ]}
        />
        <SupportCenter
          initial={entry}
          layout="page"
          onTicketOpened={entry?.view === 'ticket' ? onTicketOpened : undefined}
        />
      </main>
      <Footer />
    </>
  )
}
