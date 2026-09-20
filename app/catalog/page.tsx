import type { Metadata } from 'next'
import { CatalogView } from '@/components/products/catalog-view'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'

export const metadata: Metadata = {
  title: 'Catalogue',
  description:
    'The full LUXE VAULT catalogue: apparel, footwear and accessories, filtered by department and category.',
  alternates: { canonical: '/catalog' },
}

/**
 * The catalogue as a page of its own.
 *
 * It replaces the `/catalog → /#shop` redirect that used to send every visitor
 * to the homepage's shop section — an intermediate screen between choosing a
 * department and seeing the products.
 */
export default function CatalogPage() {
  return (
    <>
      <Header />
      <main id="main">
        <CatalogView />
        <Footer />
      </main>
    </>
  )
}
