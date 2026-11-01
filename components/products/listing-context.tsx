'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { Product } from '@/lib/types'

/**
 * The products a listing page shows, handed down from the server page.
 *
 * WHY NOT THE STORE
 *
 * The root layout used to put the whole catalogue in the store, which
 * serialised every product into every page — the terms page and checkout
 * included — and into every link prefetch. Now each listing page reads what
 * it lists and passes it here, so the grid and the sidebar still render fully
 * in the server HTML (no layout shift, crawlable links) while every other page
 * carries no products at all.
 *
 * The store's own `products` stays the whole catalogue or nothing, never a
 * subset: the cart reconciles against it, and a partial list would read as
 * "everything else was deleted".
 */
export type Listing = {
  products: Product[]
  /** Product counts by `group` and `group/category`, for the whole
   *  catalogue — a department page lists one department but its sidebar
   *  counts all of them. See listingCounts(). */
  counts: Record<string, number>
  /** A department page's best sellers: product ids ranked by units sold in
   *  paid orders (lib/server/popular-products.ts). Ids only — the page never
   *  carries sales figures. Absent or empty when there are no sales to rank. */
  bestsellers?: string[]
}

const ListingContext = createContext<Listing | null>(null)

export function ListingProvider({
  products,
  counts,
  bestsellers,
  children,
}: Listing & { children: ReactNode }) {
  return (
    <ListingContext.Provider value={{ products, counts, bestsellers }}>{children}</ListingContext.Provider>
  )
}

/** The page's listing, or null outside a listing page. */
export function useListing(): Listing | null {
  return useContext(ListingContext)
}
