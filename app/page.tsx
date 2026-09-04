'use client'

import dynamic from 'next/dynamic'
import { About } from '@/components/about'
import { CartPanel } from '@/components/cart-panel'
import { Collections } from '@/components/collections'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { Hero } from '@/components/hero'
import { ProductModal } from '@/components/products/product-modal'
import { ProductGrid } from '@/components/products/product-grid'
import { Reviews } from '@/components/reviews'
import { SupportWidget } from '@/components/support-widget'
import { UserPanel } from '@/components/user-panel'

// Checkout carries the international phone metadata and the payment screen —
// several tens of kilobytes that no visitor needs until they actually open
// it, so it is loaded on demand rather than with the storefront.
const CheckoutPanel = dynamic(
  () => import('@/components/checkout-panel').then((m) => m.CheckoutPanel),
  { ssr: false },
)

export default function Home() {
  return (
    <>
      <Header />

      <main>
        <Hero />
        <Collections />
        <ProductGrid />
        <About />
        <Reviews />
        <Footer />
      </main>

      <ProductModal />
      <CartPanel />
      <CheckoutPanel />
      <UserPanel />
      <SupportWidget />
    </>
  )
}
