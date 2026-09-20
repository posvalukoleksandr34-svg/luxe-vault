import type { Metadata } from 'next'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { WishlistView } from '@/components/wishlist-view'

export const metadata: Metadata = {
  title: 'Wishlist',
  // The contents live in one browser's localStorage, so there is nothing here
  // for a crawler to index and nothing that would be the same for two people.
  robots: { index: false, follow: true },
  alternates: { canonical: '/wishlist' },
}

export default function WishlistPage() {
  return (
    <>
      <Header />
      <main id="main">
        <WishlistView />
        <Footer />
      </main>
    </>
  )
}
