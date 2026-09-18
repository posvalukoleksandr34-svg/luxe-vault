import 'server-only'

import { revalidatePath } from 'next/cache'

/**
 * After any catalogue write in the admin console (products, categories,
 * collections): every storefront page reads the catalogue through the root
 * layout, and the client store refetches /api/catalog, so both are dropped
 * from the cache together.
 */
export function revalidateStorefront(): void {
  revalidatePath('/', 'layout')
  revalidatePath('/api/catalog')
}
