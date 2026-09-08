'use client'

import { About } from '@/components/about'
import { Collections } from '@/components/collections'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { Hero } from '@/components/hero'
import { ProductGrid } from '@/components/products/product-grid'
import { Reviews } from '@/components/reviews'
import { SupportWidget } from '@/components/support-widget'

export default function Home() {
  return (
    <>
      <Header />

      <main id="main">
        <Hero />
        <Collections />
        <ProductGrid />
        <About />
        <Reviews />
        <Footer />
      </main>

      <SupportWidget />
    </>
  )
}
