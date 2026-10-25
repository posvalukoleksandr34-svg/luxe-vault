'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { useStore } from '@/lib/store'

/**
 * /cart, typed or bookmarked. The basket is a drawer over any page, not a
 * page of its own, so this opens the drawer and puts the home page beneath
 * it, instead of a 404 for a URL people reasonably try. Once the saved cart
 * has been read (cartReady), so the drawer never opens empty for a frame.
 */
export default function CartPage() {
  const { cartReady, setPanel } = useStore()
  const router = useRouter()

  useEffect(() => {
    if (!cartReady) return
    setPanel('cart')
    router.replace('/', { scroll: false })
  }, [cartReady, setPanel, router])

  return (
    <>
      <Header />
      <main id="main" aria-busy className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-5 animate-spin text-foreground/70" />
      </main>
      <Footer />
    </>
  )
}
