import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { UnsubscribeView } from '@/components/newsletter/unsubscribe-view'

// A personal link from an email: never indexed.
export const metadata: Metadata = {
  title: 'Newsletter',
  robots: { index: false, follow: false },
}

export default function UnsubscribePage() {
  return (
    <>
      <Header />
      <main id="main" className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center px-4 py-16 sm:px-6">
        <Suspense fallback={null}>
          <UnsubscribeView />
        </Suspense>
      </main>
      <Footer />
    </>
  )
}
