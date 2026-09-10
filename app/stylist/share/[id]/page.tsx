import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Footer } from '@/components/footer'
import { Header } from '@/components/header'
import { SharedCapsule } from '@/components/stylist/shared-capsule'
import { readCatalog } from '@/lib/server/catalog-store'
import { itemForProduct } from '@/lib/server/stylist/engine'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Look } from '@/lib/stylist/types'
import type { Product } from '@/lib/types'

/**
 * A shared capsule: /stylist/share/<id>.
 *
 * NOT under a [locale] segment: this project keeps the language in client
 * state, not in the URL, and the link a customer copies is exactly this path.
 *
 * Read on the server with the service role, one row by primary key, and
 * user_id is never selected. That is how "anyone with the link can view it"
 * is enforced — see 0024 for why there is deliberately no public RLS select
 * policy (one would let the anon key list every saved look).
 */

// A capsule is a snapshot, but its products' stock and prices are live, so a
// short window: cheap to serve repeatedly, never more than a minute stale.
export const revalidate = 60
export const dynamicParams = true

/** Rejects anything that is not a uuid before it reaches Postgres, which would
 *  answer a malformed one with an error rather than "not found". */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type SavedLookRow = {
  id: string
  notes: string
  product_ids: string[]
  created_at: string
}

async function loadLook(id: string): Promise<SavedLookRow | null> {
  if (!UUID.test(id)) return null
  const { data, error } = await createAdminClient()
    .from('saved_looks')
    .select('id, notes, product_ids, created_at')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[share] could not read saved look:', error.message)
    return null
  }
  return (data as SavedLookRow | null) ?? null
}

export async function generateMetadata({
  params,
}: {
  params: { id: string }
}): Promise<Metadata> {
  const look = await loadLook(params.id)
  return {
    title: 'Capsule',
    description: look
      ? `A Luxe Vault capsule of ${look.product_ids.length} pieces.`
      : 'Luxe Vault capsule',
    // A private link, not a landing page: nothing here should be indexed.
    robots: { index: false, follow: false },
  }
}

export default async function SharedLookPage({ params }: { params: { id: string } }) {
  const look = await loadLook(params.id)
  if (!look) notFound()

  const { products } = await readCatalog()
  const byId: Record<string, Product> = {}
  for (const p of products) byId[p.id] = p

  // In the order they were saved. A product deleted since is skipped and
  // counted, never substituted — same rule as the stylist.
  const found = look.product_ids.map((id) => byId[id]).filter((p): p is Product => Boolean(p))

  const capsule: Look = {
    id: look.id,
    kind: 'primary',
    items: found.map(itemForProduct),
    total: found.reduce((sum, p) => sum + p.price, 0),
    rationale: look.notes,
    relaxed: [],
  }

  return (
    <>
      <Header />
      <main id="main" className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6 lg:px-10 lg:py-16">
        <SharedCapsule
          look={capsule}
          createdAt={look.created_at}
          missing={look.product_ids.length - found.length}
        />
      </main>
      <Footer />
    </>
  )
}
