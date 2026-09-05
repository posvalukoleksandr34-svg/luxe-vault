// Server-only persistence for the catalogue: collections, categories and
// products. Backed by Postgres (Supabase).
//
// Replaces lib/data.ts + localStorage. The old arrangement wrote products to
// the admin's own browser storage, which no customer's browser could ever
// read — this module is what makes an admin edit actually reach the shop.
//
// Naming note, mirroring orders-store.ts: at the application level a product's
// `id` stays its human-readable slug ('p-hoodie-noir'), which is what
// order_items.product_id and reviews.product_id already store. The uuid
// primary key is internal. Same for collections/categories, which the app
// refers to by slug throughout.
import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type {
  Category,
  Collection,
  Color,
  LocalizedText,
  Product,
  SizeMeasurement,
  StatusKey,
} from '@/lib/types'

const COLLECTION_SELECT = 'id, slug, name, image_url, sort_order'
const CATEGORY_SELECT = 'id, collection_id, slug, name, sort_order'
const PRODUCT_SELECT = `
  id, slug, name, description, price, old_price, image, images, sizes,
  colors, statuses, is_new, limited, size_chart,
  collection:collections ( slug ),
  category:categories ( slug )
`

const num = (v: string | number | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === 'number' ? v : parseFloat(v)

type Ref = { slug: string } | { slug: string }[] | null

/** PostgREST returns an embedded one-to-one as an object, but some versions
 *  return a single-element array. Accept both rather than crash on one. */
const refSlug = (ref: Ref): string =>
  Array.isArray(ref) ? (ref[0]?.slug ?? '') : (ref?.slug ?? '')

function rowToCollection(row: Record<string, unknown>): Collection {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: (row.name ?? {}) as LocalizedText,
    image: (row.image_url as string | null) ?? undefined,
    sortOrder: (row.sort_order as number) ?? 0,
  }
}

function rowToProduct(row: Record<string, unknown>): Product {
  return {
    id: row.slug as string,
    name: (row.name ?? {}) as LocalizedText,
    description: (row.description ?? {}) as LocalizedText,
    group: refSlug(row.collection as Ref),
    category: refSlug(row.category as Ref),
    price: num(row.price as string),
    oldPrice: row.old_price == null ? undefined : num(row.old_price as string),
    image: (row.image as string | null) ?? '',
    images: ((row.images as string[] | null) ?? []).length
      ? (row.images as string[])
      : undefined,
    sizes: (row.sizes as string[] | null) ?? [],
    colors: ((row.colors as Color[] | null) ?? []) as Color[],
    statuses: ((row.statuses as string[] | null) ?? []) as StatusKey[],
    isNew: Boolean(row.is_new),
    limited: Boolean(row.limited),
    sizeChart: (row.size_chart as SizeMeasurement[] | null) ?? undefined,
  }
}

export type Catalog = {
  collections: Collection[]
  categories: Category[]
  products: Product[]
}

/** One round trip for the whole catalogue — it is small and always needed
 *  together, so three queries beat N+1 and beat three separate requests. */
export async function readCatalog(): Promise<Catalog> {
  const supabase = createAdminClient()

  const [collectionsRes, categoriesRes, productsRes] = await Promise.all([
    supabase.from('collections').select(COLLECTION_SELECT).order('sort_order'),
    supabase.from('categories').select(CATEGORY_SELECT).order('sort_order'),
    supabase.from('products').select(PRODUCT_SELECT).order('created_at', { ascending: false }),
  ])

  if (collectionsRes.error) throw new Error(`Failed to read collections: ${collectionsRes.error.message}`)
  if (categoriesRes.error) throw new Error(`Failed to read categories: ${categoriesRes.error.message}`)
  if (productsRes.error) throw new Error(`Failed to read products: ${productsRes.error.message}`)

  const collections = (collectionsRes.data ?? []).map(rowToCollection)
  const byId = new Map(collections.map((c) => [c.id, c.slug]))

  const categories: Category[] = (categoriesRes.data ?? []).map((row) => ({
    id: row.id as string,
    collectionId: row.collection_id as string,
    collectionSlug: byId.get(row.collection_id as string) ?? '',
    slug: row.slug as string,
    name: (row.name ?? {}) as LocalizedText,
    sortOrder: (row.sort_order as number) ?? 0,
  }))

  return { collections, categories, products: (productsRes.data ?? []).map(rowToProduct) }
}

// ------------------------------------------------------------ collections ----

export async function createCollection(input: {
  slug: string
  name: LocalizedText
  image?: string
  sortOrder?: number
}): Promise<Collection> {
  const { data, error } = await createAdminClient()
    .from('collections')
    .insert({
      slug: input.slug,
      name: input.name,
      image_url: input.image ?? null,
      sort_order: input.sortOrder ?? 0,
    })
    .select(COLLECTION_SELECT)
    .single()

  if (error) throw new Error(`Failed to create collection: ${error.message}`)
  return rowToCollection(data)
}

export async function updateCollection(
  slug: string,
  patch: { name?: LocalizedText; image?: string | null; sortOrder?: number },
): Promise<Collection | null> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.image !== undefined) row.image_url = patch.image
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder

  const { data, error } = await createAdminClient()
    .from('collections')
    .update(row)
    .eq('slug', slug)
    .select(COLLECTION_SELECT)
    .maybeSingle()

  if (error) throw new Error(`Failed to update collection: ${error.message}`)
  return data ? rowToCollection(data) : null
}

/**
 * Deletes a collection. The FK from products is ON DELETE RESTRICT, so a
 * collection that still holds products fails here rather than silently taking
 * the catalogue with it — that error is surfaced to the admin as a 409.
 */
export async function deleteCollection(slug: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('collections')
    .delete()
    .eq('slug', slug)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Failed to delete collection: ${error.message}`)
  return Boolean(data)
}

/** Resolves the uuids a product row needs from the slugs the app speaks. */
async function resolveRefs(groupSlug: string, categorySlug: string) {
  const supabase = createAdminClient()
  const [c, cat] = await Promise.all([
    supabase.from('collections').select('id').eq('slug', groupSlug).maybeSingle(),
    supabase.from('categories').select('id, collection_id').eq('slug', categorySlug).maybeSingle(),
  ])
  if (c.error || !c.data) throw new Error(`Unknown collection "${groupSlug}"`)
  if (cat.error || !cat.data) throw new Error(`Unknown category "${categorySlug}"`)
  if (cat.data.collection_id !== c.data.id) {
    // Rejected here rather than stored: a product filed under a category that
    // belongs to a different collection would vanish from both filters.
    throw new Error(`Category "${categorySlug}" does not belong to "${groupSlug}"`)
  }
  return { collectionId: c.data.id as string, categoryId: cat.data.id as string }
}

// --------------------------------------------------------------- products ----

function productToRow(product: Product, collectionId: string, categoryId: string) {
  return {
    slug: product.id,
    name: product.name,
    description: product.description,
    collection_id: collectionId,
    category_id: categoryId,
    price: product.price,
    old_price: product.oldPrice ?? null,
    image: product.image || null,
    images: product.images ?? [],
    sizes: product.sizes ?? [],
    colors: product.colors ?? [],
    statuses: product.statuses ?? [],
    is_new: Boolean(product.isNew),
    limited: Boolean(product.limited),
    size_chart: product.sizeChart ?? null,
  }
}

export async function createProduct(product: Product): Promise<Product> {
  const { collectionId, categoryId } = await resolveRefs(product.group, product.category)
  const { data, error } = await createAdminClient()
    .from('products')
    .insert(productToRow(product, collectionId, categoryId))
    .select(PRODUCT_SELECT)
    .single()

  if (error) throw new Error(`Failed to create product: ${error.message}`)
  return rowToProduct(data)
}

export async function updateProduct(product: Product): Promise<Product | null> {
  const { collectionId, categoryId } = await resolveRefs(product.group, product.category)
  const { data, error } = await createAdminClient()
    .from('products')
    .update(productToRow(product, collectionId, categoryId))
    .eq('slug', product.id)
    .select(PRODUCT_SELECT)
    .maybeSingle()

  if (error) throw new Error(`Failed to update product: ${error.message}`)
  return data ? rowToProduct(data) : null
}

export async function deleteProduct(slug: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('products')
    .delete()
    .eq('slug', slug)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Failed to delete product: ${error.message}`)
  return Boolean(data)
}
