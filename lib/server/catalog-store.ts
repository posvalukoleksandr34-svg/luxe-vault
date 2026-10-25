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

import { withDerivedAvailability } from '@/lib/availability'
import { isDeliveryDays } from '@/lib/fulfilment'
import { publishBlockers, type ListingStatus, type PublishBlocker, type RightsBasis } from '@/lib/listing'
import { referencePrice, type PricePoint } from '@/lib/price-reference'
import { planVariantWrites, type LiveVariant, type StockConflict, type VariantPlan } from '@/lib/stock-sync'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  Category,
  Collection,
  Color,
  LocalizedText,
  Product,
  Variant,
  SizeMeasurement,
  StatusKey,
} from '@/lib/types'

const COLLECTION_SELECT = 'id, slug, name, image_url, sort_order'
/** With the department's description (0064). Read first; COLLECTION_SELECT
 *  is the fallback for a database that has not had 0064 yet. */
const COLLECTION_SELECT_WITH_DESCRIPTION = `${COLLECTION_SELECT}, description`
const CATEGORY_SELECT = 'id, collection_id, slug, name, sort_order'
/** With the subcategory cover (0054). Read first; CATEGORY_SELECT is the
 *  fallback for a database that has not had 0054 yet. */
const CATEGORY_SELECT_WITH_IMAGE = `${CATEGORY_SELECT}, image_url`

/** Postgres / PostgREST "no such column". */
const isMissingColumn = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist/i.test(error.message ?? '')))
const PRODUCT_BASE_SELECT = `
  id, slug, name, description, price, old_price, image, images, sizes,
  colors, statuses, is_new, limited, size_chart, specs, brand, style_tags, delivery_days_min, delivery_days_max,
  created_at, listing_status, published_at,
  collection:collections ( slug ),
  category:categories ( slug )
`

const PRODUCT_SELECT = `${PRODUCT_BASE_SELECT},
  variants:product_variants ( id, size, color, stock, low_stock_at, sku )
`

/** Status keys this build can label. See rowToProduct. */
const KNOWN_STATUSES: StatusKey[] = [
  'in_stock',
  'out_of_stock',
  'limited_edition',
  'premium_quality',
]

const num = (v: string | number | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === 'number' ? v : parseFloat(v)

/** A stored delivery window, or undefined for "use the store default" —
 *  absent (pre-0026), null, or a pair the check constraint would refuse. */
function toDeliveryDays(min: unknown, max: unknown): { min: number; max: number } | undefined {
  if (min == null || max == null) return undefined
  const range = { min: Number(min), max: Number(max) }
  return isDeliveryDays(range) ? range : undefined
}

type Ref = { slug: string } | { slug: string }[] | null

/** PostgREST returns an embedded one-to-one as an object, but some versions
 *  return a single-element array. Accept both rather than crash on one. */
const refSlug = (ref: Ref): string =>
  Array.isArray(ref) ? (ref[0]?.slug ?? '') : (ref?.slug ?? '')

function rowToCollection(row: Record<string, unknown>): Collection {
  const description = row.description && typeof row.description === 'object' ? (row.description as LocalizedText) : undefined
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: (row.name ?? {}) as LocalizedText,
    image: (row.image_url as string | null) ?? undefined,
    sortOrder: (row.sort_order as number) ?? 0,
    ...(description && Object.values(description).some((v) => typeof v === 'string' && v.trim())
      ? { description }
      : {}),
  }
}

type VariantRow = {
  id?: string
  size: string
  color: string
  stock: number | string
  low_stock_at: number | string
  sku: string | null
}

function rowToProduct(row: Record<string, unknown>): Product {
  const variants: Variant[] = ((row.variants as VariantRow[] | null) ?? []).map((v) => ({
    // Lets the waitlist name the exact variant (actions/waitlist.ts).
    id: v.id,
    size: v.size,
    color: v.color,
    stock: Math.max(0, Math.trunc(num(v.stock))),
    lowStockAt: Math.max(0, Math.trunc(num(v.low_stock_at))),
    sku: v.sku ?? undefined,
  }))

  const rawColors = ((row.colors as Color[] | null) ?? []) as Color[]

  /**
   * Colour-level stock is the sum of that colour's sizes.
   *
   * The colour swatches and the sold-out styling already read `Color.stock`,
   * so deriving it here keeps every one of those call sites working unchanged
   * while the real numbers move to the variants table. Left undefined when the
   * product is untracked, because undefined and zero mean different things to
   * the components downstream.
   */
  const colors: Color[] = variants.length
    ? rawColors.map((c) => ({
        ...c,
        stock: variants
          .filter((v) => v.color === c.name)
          .reduce((sum, v) => sum + v.stock, 0),
      }))
    : rawColors

  const rights = Array.isArray(row.rights) ? row.rights[0] : row.rights
  const listing =
    typeof row.listing_status === 'string'
      ? {
          status: row.listing_status as ListingStatus,
          publishedAt: row.published_at ? Date.parse(row.published_at as string) : undefined,
          rights:
            rights && typeof rights === 'object'
              ? {
                  basis: (rights as Record<string, unknown>).basis as RightsBasis,
                  reference: String((rights as Record<string, unknown>).reference ?? ''),
                  confirmedAt: Date.parse(String((rights as Record<string, unknown>).confirmed_at ?? '')) || 0,
                }
              : undefined,
        }
      : undefined

  return {
    id: row.slug as string,
    listing,
    createdAt: row.created_at ? Date.parse(row.created_at as string) || undefined : undefined,
    variants: variants.length ? variants : undefined,
    name: (row.name ?? {}) as LocalizedText,
    description: (row.description ?? {}) as LocalizedText,
    group: refSlug(row.collection as Ref),
    category: refSlug(row.category as Ref),
    price: num(row.price as string),
    // The strike-through price comes from the price history (0063), never
    // from the typed products.old_price: only a price the shop really
    // charged may be shown as "was" (lib/price-reference.ts).
    oldPrice: Array.isArray(row.price_history)
      ? referencePrice(
          (row.price_history as { price: string | number; valid_from: string }[]).map(
            (h): PricePoint => ({ price: num(h.price), validFrom: Date.parse(h.valid_from) }),
          ),
          num(row.price as string),
          Date.now(),
        )
      : undefined,
    image: (row.image as string | null) ?? '',
    images: ((row.images as string[] | null) ?? []).length
      ? (row.images as string[])
      : undefined,
    sizes: (row.sizes as string[] | null) ?? [],
    colors,
    // Unknown keys are dropped rather than passed through. `mirror_quality`
    // was removed with the replica badge, and rows saved before that still
    // carry it — STATUS_LABELS has no entry, so rendering it would print
    // nothing useful at best. Filtering here means every consumer sees only
    // statuses it can actually label.
    statuses: ((row.statuses as string[] | null) ?? []).filter((s): s is StatusKey =>
      KNOWN_STATUSES.includes(s as StatusKey),
    ),
    // Null, absent (pre-0022) and whitespace all mean "no brand", so they
    // collapse to undefined here and the label is omitted downstream rather
    // than rendered empty.
    brand: ((row.brand as string | null | undefined) ?? '').trim() || undefined,
    // Absent (pre-0023) and null both mean "not tagged"; tagging derives a
    // fallback (lib/style-tags/tagging.ts) rather than dropping the product.
    styleTags:
      (row.style_tags as import('@/lib/style-tags/types').StyleTags | null | undefined) ?? undefined,
    // See deliveryDaysFor(): undefined falls back to the store default.
    deliveryDays: toDeliveryDays(row.delivery_days_min, row.delivery_days_max),
    isNew: Boolean(row.is_new),
    limited: Boolean(row.limited),
    sizeChart: (row.size_chart as SizeMeasurement[] | null) ?? undefined,
    specs: ((row.specs as { label: string; value: string }[] | null) ?? []).filter((s) => s?.label && s?.value),
  }
}

export type Catalog = {
  collections: Collection[]
  categories: Category[]
  products: Product[]
}

/**
 * Products, with variant stock when the inventory migration has been applied.
 *
 * The embedded `product_variants` join fails with PGRST200 ("could not find a
 * relationship") on a database still on 0011. Retrying without it means a
 * deploy that lands before the migration serves an untracked catalogue rather
 * than taking the entire shop down — every product simply reads as it did
 * before inventory existed.
 *
 * The retry can be deleted once 0012 is applied everywhere.
 */
/**
 * The product select this database can actually satisfy, probed once.
 *
 * Columns and relations arrive with migrations, and PostgREST rejects the
 * whole SELECT when one of them is unknown — so naming them unconditionally
 * makes a deploy that lands ahead of its migration take the shop down. This
 * asks the database what it has, once, and caches the answer.
 *
 * A retry-on-error version of this lived only inside readCatalog, which meant
 * getProductBySlug — the product page — still asked for everything and threw.
 * Resolving in one place is what stops the two drifting again.
 *
 * All three branches can be deleted once 0012, 0018 and 0022 are applied
 * everywhere.
 */
let productSelectCache: string | null = null

async function resolveProductSelect(): Promise<string> {
  if (productSelectCache) return productSelectCache

  const supabase = createAdminClient()

  const [variants, specs, brand, styleTags, deliveryDays, listing, priceHistory] = await Promise.all([
    supabase.from('product_variants').select('id').limit(1),
    supabase.from('products').select('specs').limit(1),
    supabase.from('products').select('brand').limit(1),
    supabase.from('products').select('style_tags').limit(1),
    supabase.from('products').select('delivery_days_min').limit(1),
    supabase.from('products').select('listing_status').limit(1),
    supabase.from('product_price_history').select('id').limit(1),
  ])

  let select = variants.error ? PRODUCT_BASE_SELECT : PRODUCT_SELECT

  if (variants.error) {
    console.error(
      '[catalog] product_variants is missing — stock is NOT being tracked. ' +
        'Apply supabase/migrations/0012_inventory.sql.',
    )
  }
  if (specs.error) {
    console.error('[catalog] products.specs is missing. Apply 0018_product_specs.sql.')
    select = select.replace(' specs,', '')
  }
  if (brand.error) {
    console.error('[catalog] products.brand is missing. Apply 0022_product_brand.sql.')
    select = select.replace(' brand,', '')
  }
  if (styleTags.error) {
    console.error('[catalog] products.style_tags is missing. Apply 0023_stylist_metadata.sql.')
    select = select.replace(' style_tags,', '')
  }
  if (deliveryDays.error) {
    console.error('[catalog] products.delivery_days_* is missing. Apply 0026_delivery_days_and_categories.sql.')
    select = select.replace(' delivery_days_min, delivery_days_max,', '')
  }
  if (listing.error) {
    // FAIL CLOSED. Without 0062 nothing records which products may be sold,
    // so the storefront sells none of them (publicFilter); the admin still
    // sees and edits everything.
    console.error(
      '[catalog] products.listing_status is missing — NO product is on sale. ' +
        'Apply supabase/migrations/0062_product_publication.sql, then publish products in the admin.',
    )
    select = select.replace(' listing_status, published_at,', '')
  }
  if (priceHistory.error) {
    // No history, no strike-through prices: nothing proves an earlier price.
    console.error('[catalog] product_price_history is missing — no "was" prices are shown. Apply 0063_price_history.sql.')
  } else {
    select = `${select},\n  price_history:product_price_history ( price, valid_from )`
  }

  productSelectCache = select
  return select
}

/**
 * Who is reading. 'public' — every storefront path, the search, the sitemap,
 * the cart and the checkout — sees published products only, with no listing
 * data. 'admin' sees every product with its listing state and rights record.
 */
export type CatalogScope = 'public' | 'admin'

/** True when migration 0062 is applied (products carry a listing status). */
export async function listingSupported(): Promise<boolean> {
  return (await resolveProductSelect()).includes(' listing_status,')
}

/** The select for this scope: the admin's adds the rights record (0062). */
async function selectFor(scope: CatalogScope): Promise<string> {
  const select = await resolveProductSelect()
  return scope === 'admin' && select.includes(' listing_status,')
    ? `${select},\n  rights:product_rights ( basis, reference, confirmed_at )`
    : select
}

/** A public product carries no listing data at all. */
function forScope(product: Product, scope: CatalogScope): Product {
  if (scope === 'admin') return product
  const { listing: _listing, ...rest } = product
  return rest
}

type ProductQueryResult = { data: unknown[] | null; error: { message: string } | null }

async function readProducts(supabase: ReturnType<typeof createAdminClient>, scope: CatalogScope): Promise<ProductQueryResult> {
  const select = await selectFor(scope)
  if (scope === 'public' && !select.includes(' listing_status,')) return { data: [], error: null }
  let query = supabase.from('products').select(select).order('created_at', { ascending: false })
  if (scope === 'public') query = query.eq('listing_status', 'published')
  return (await query) as unknown as ProductQueryResult
}

export type TaxonomyLists = Pick<Catalog, 'collections' | 'categories'>

async function readTaxonomyRows(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<TaxonomyLists> {
  const [withDescription, withImages] = await Promise.all([
    supabase.from('collections').select(COLLECTION_SELECT_WITH_DESCRIPTION).order('sort_order'),
    supabase.from('categories').select(CATEGORY_SELECT_WITH_IMAGE).order('sort_order'),
  ])
  // 0064 not applied yet: departments without a description.
  const collectionsRes: { data: Record<string, unknown>[] | null; error: { message: string } | null } =
    isMissingColumn(withDescription.error)
      ? await supabase.from('collections').select(COLLECTION_SELECT).order('sort_order')
      : (withDescription as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null })
  // 0054 not applied yet: the catalogue without subcategory covers.
  const categoriesRes: { data: Record<string, unknown>[] | null; error: { message: string } | null } =
    isMissingColumn(withImages.error)
      ? await supabase.from('categories').select(CATEGORY_SELECT).order('sort_order')
      : withImages

  if (collectionsRes.error) throw new Error(`Failed to read collections: ${collectionsRes.error.message}`)
  if (categoriesRes.error) throw new Error(`Failed to read categories: ${categoriesRes.error.message}`)

  const collections = (collectionsRes.data ?? []).map(rowToCollection)
  const byId = new Map(collections.map((c) => [c.id, c.slug]))

  const categories: Category[] = (categoriesRes.data ?? []).map((row) => ({
    id: row.id as string,
    collectionId: row.collection_id as string,
    collectionSlug: byId.get(row.collection_id as string) ?? '',
    slug: row.slug as string,
    name: (row.name ?? {}) as LocalizedText,
    sortOrder: (row.sort_order as number) ?? 0,
    image: (row.image_url as string | null | undefined) ?? undefined,
  }))

  return { collections, categories }
}

/**
 * Collections and categories only — the part of the catalogue every page
 * needs (navigation, labels, filters), without a single product row.
 *
 * What the root layout reads. It used to read the whole catalogue, which
 * serialised every product into every page and every prefetch.
 */
export async function readTaxonomyLists(): Promise<TaxonomyLists> {
  const supabase = createAdminClient()
  const [taxonomy, onSale] = await Promise.all([readTaxonomyRows(supabase), readPublishedPlacement(supabase)])
  return withCounts(taxonomy, onSale)
}

/** Where each product on sale sits: two ids per row, no product data. */
async function readPublishedPlacement(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{ collection_id: string; category_id: string }[]> {
  // Without 0062 nothing is on sale (readProducts), so nothing is counted.
  if (!(await listingSupported())) return []
  const { data, error } = await supabase
    .from('products')
    .select('collection_id, category_id')
    .eq('listing_status', 'published')
  if (error) throw new Error(`Failed to count products: ${error.message}`)
  return (data ?? []) as { collection_id: string; category_id: string }[]
}

/**
 * Each department and category with the number of products ON SALE in it —
 * published, sold out or not. The storefront's navigation shows only those
 * with at least one (lib/store.tsx `navTree`); a product that is temporarily
 * sold out still counts, so its category does not vanish with its stock.
 */
function withCounts(
  taxonomy: TaxonomyLists,
  onSale: { collection_id: string; category_id: string }[],
): TaxonomyLists {
  const byCollection = new Map<string, number>()
  const byCategory = new Map<string, number>()
  for (const row of onSale) {
    byCollection.set(row.collection_id, (byCollection.get(row.collection_id) ?? 0) + 1)
    byCategory.set(row.category_id, (byCategory.get(row.category_id) ?? 0) + 1)
  }
  return {
    collections: taxonomy.collections.map((c) => ({ ...c, count: byCollection.get(c.id) ?? 0 })),
    categories: taxonomy.categories.map((c) => ({ ...c, count: byCategory.get(c.id) ?? 0 })),
  }
}

/** The same counts, from products already read (slugs instead of ids). */
function withCountsFrom(taxonomy: TaxonomyLists, onSale: Product[]): TaxonomyLists {
  const collectionIds = new Map(taxonomy.collections.map((c) => [c.slug, c.id]))
  const categoryIds = new Map(taxonomy.categories.map((c) => [`${c.collectionSlug}/${c.slug}`, c.id]))
  return withCounts(
    taxonomy,
    onSale.map((p) => ({
      collection_id: collectionIds.get(p.group) ?? '',
      category_id: categoryIds.get(`${p.group}/${p.category}`) ?? '',
    })),
  )
}

/**
 * One round trip for the whole catalogue — it is small and always needed
 * together, so three queries beat N+1 and beat three separate requests.
 *
 * Public by default: only published products, and none of their listing
 * data. Pass `{ scope: 'admin' }` for the console's view of everything.
 */
export async function readCatalog({ scope = 'public' }: { scope?: CatalogScope } = {}): Promise<Catalog> {
  const supabase = createAdminClient()

  const [taxonomy, productsRes] = await Promise.all([readTaxonomyRows(supabase), readProducts(supabase, scope)])

  if (productsRes.error) throw new Error(`Failed to read products: ${productsRes.error.message}`)

  // The select string is chosen at runtime by readProducts(), which costs
  // PostgREST's compile-time row typing. rowToProduct reads every field
  // defensively, so the cast is safe.
  const productRows = (productsRes.data ?? []) as unknown as Record<string, unknown>[]

  const products = productRows.map((r) => forScope(rowToProduct(r), scope))
  // The public catalogue holds only products on sale; the admin's holds
  // everything, and counts the published ones — the same numbers either way.
  const onSale = scope === 'public' ? products : products.filter((p) => p.listing?.status === 'published')
  return { ...withCountsFrom(taxonomy, onSale), products }
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
  patch: { name?: Partial<LocalizedText>; image?: string | null; sortOrder?: number; description?: Partial<LocalizedText> },
): Promise<Collection | null> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.image !== undefined) row.image_url = patch.image
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder
  if (patch.description !== undefined) row.description = patch.description

  const { data, error } = await createAdminClient()
    .from('collections')
    .update(row)
    .eq('slug', slug)
    .select(patch.description !== undefined ? COLLECTION_SELECT_WITH_DESCRIPTION : COLLECTION_SELECT)
    .maybeSingle()

  if (error) {
    if (patch.description !== undefined && isMissingColumn(error)) {
      throw new Error('Department descriptions need migration 0064_collection_description.sql')
    }
    throw new Error(`Failed to update collection: ${error.message}`)
  }
  return data ? rowToCollection(data as unknown as Record<string, unknown>) : null
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

// ------------------------------------------------------------- categories ----

/**
 * Creates a category under an existing collection, appended after the
 * collection's current categories unless a sort order is given.
 */
export async function createCategory(input: {
  collectionSlug: string
  slug: string
  name: Partial<LocalizedText>
  sortOrder?: number
}): Promise<Category> {
  const supabase = createAdminClient()

  const { data: collection, error: collectionError } = await supabase
    .from('collections')
    .select('id, slug')
    .eq('slug', input.collectionSlug)
    .maybeSingle()
  if (collectionError) throw new Error(`Failed to read collection: ${collectionError.message}`)
  if (!collection) throw new Error(`Unknown collection "${input.collectionSlug}"`)

  let sortOrder = input.sortOrder
  if (sortOrder === undefined) {
    const { data: last } = await supabase
      .from('categories')
      .select('sort_order')
      .eq('collection_id', collection.id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    sortOrder = ((last?.sort_order as number | undefined) ?? -1) + 1
  }

  const { data, error } = await supabase
    .from('categories')
    .insert({
      collection_id: collection.id,
      slug: input.slug,
      name: input.name,
      sort_order: sortOrder,
    })
    .select(CATEGORY_SELECT)
    .single()

  if (error) throw new Error(`Failed to create category: ${error.message}`)
  return {
    id: data.id as string,
    collectionId: data.collection_id as string,
    collectionSlug: collection.slug as string,
    slug: data.slug as string,
    name: (data.name ?? {}) as LocalizedText,
    sortOrder: (data.sort_order as number) ?? 0,
  }
}

/**
 * Deletes a category. products.category_id is ON DELETE RESTRICT, so one that
 * still holds products fails here rather than taking them with it — surfaced
 * to the admin as a 409.
 *
 * Scoped to its department: since 0040 a slug is unique only within one
 * (Women, Men and Kids each have "clothing"), so the slug alone would match
 * several rows.
 */
export async function deleteCategory(slug: string, collectionSlug: string): Promise<boolean> {
  const supabase = createAdminClient()
  const collectionId = await collectionIdOf(supabase, collectionSlug)
  if (!collectionId) return false

  const { data, error } = await supabase
    .from('categories')
    .delete()
    .eq('slug', slug)
    .eq('collection_id', collectionId)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Failed to delete category: ${error.message}`)
  return Boolean(data)
}

/**
 * Renames, reorders, or sets or clears (null) the cover photograph of one
 * subcategory. By id: a slug is unique only within its department. The slug
 * itself never changes — it is in every link to the category.
 */
export async function updateCategory(
  id: string,
  patch: { image?: string | null; name?: Partial<LocalizedText>; sortOrder?: number },
): Promise<Category | null> {
  const supabase = createAdminClient()
  const row: Record<string, unknown> = {}
  if (patch.image !== undefined) row.image_url = patch.image
  if (patch.name !== undefined) row.name = patch.name
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder
  const { data, error } = await supabase
    .from('categories')
    .update(row)
    .eq('id', id)
    .select(patch.image !== undefined ? CATEGORY_SELECT_WITH_IMAGE : CATEGORY_SELECT)
    .maybeSingle()

  if (error) {
    if (isMissingColumn(error)) throw new Error('Subcategory covers need migration 0054_category_images.sql')
    throw new Error(`Failed to update category: ${error.message}`)
  }
  if (!data) return null
  const saved = data as unknown as Record<string, unknown>
  const collectionSlug =
    ((await supabase.from('collections').select('slug').eq('id', saved.collection_id as string).maybeSingle()).data
      ?.slug as string | undefined) ?? ''
  return {
    id: saved.id as string,
    collectionId: saved.collection_id as string,
    collectionSlug,
    slug: saved.slug as string,
    name: (saved.name ?? {}) as LocalizedText,
    sortOrder: (saved.sort_order as number) ?? 0,
    image: (saved.image_url as string | null) ?? undefined,
  }
}

async function collectionIdOf(
  supabase: ReturnType<typeof createAdminClient>,
  slug: string,
): Promise<string | null> {
  const { data, error } = await supabase.from('collections').select('id').eq('slug', slug).maybeSingle()
  if (error) throw new Error(`Failed to read collection: ${error.message}`)
  return (data?.id as string | undefined) ?? null
}

/** Resolves the uuids a product row needs from the slugs the app speaks. */
async function resolveRefs(groupSlug: string, categorySlug: string) {
  const supabase = createAdminClient()
  const c = await supabase.from('collections').select('id').eq('slug', groupSlug).maybeSingle()
  if (c.error || !c.data) throw new Error(`Unknown collection "${groupSlug}"`)
  // Looked up WITHIN the collection. Since 0040 a slug is unique only per
  // department — Women, Men and Kids each have "clothing" — so the slug alone
  // matched several rows, maybeSingle() failed, and every product saved into
  // one of those categories was refused as "Unknown category".
  const cat = await supabase
    .from('categories')
    .select('id')
    .eq('collection_id', c.data.id)
    .eq('slug', categorySlug)
    .maybeSingle()
  if (cat.error || !cat.data) {
    // Also what a category from ANOTHER collection gets: filed under the wrong
    // department, a product would vanish from both filters.
    throw new Error(`Unknown category "${categorySlug}" in "${groupSlug}"`)
  }
  return { collectionId: c.data.id as string, categoryId: cat.data.id as string }
}

// --------------------------------------------------------------- products ----

/**
 * The row to write for a product.
 *
 * Async because it has to ask which columns this database actually has. The
 * read path already degrades when a migration has not landed yet; the write
 * path did not, so a deploy ahead of its migration served the catalogue fine
 * and then rejected every admin save with "column does not exist". Dropping
 * the unknown keys means an admin can still edit a price on a database that
 * has no `brand` or `specs` column — they simply cannot set those two.
 *
 * Both guards can go once 0018 and 0022 are applied everywhere.
 */
async function productToRow(product: Product, collectionId: string, categoryId: string) {
  const select = await resolveProductSelect()

  const row: Record<string, unknown> = {
    slug: product.id,
    name: product.name,
    description: product.description,
    collection_id: collectionId,
    category_id: categoryId,
    price: product.price,
    // old_price is no longer written: the "was" price is computed from the
    // price history (0063). The column keeps whatever it held.
    image: product.image || null,
    images: product.images ?? [],
    sizes: product.sizes ?? [],
    colors: product.colors ?? [],
    // Availability follows stock whenever the product tracks it — never the
    // admin's toggle or the browser's word for it (lib/availability.ts). The
    // same filter as syncVariants, so the tag describes exactly the rows that
    // get written. A payload without variants leaves stock alone, and so the
    // tag as sent; the database re-derives it from the stored rows (0032).
    statuses: product.variants
      ? withDerivedAvailability(
          product.statuses ?? [],
          product.variants.filter((v) => v.size.trim() && v.color.trim()),
        )
      : (product.statuses ?? []),
    is_new: Boolean(product.isNew),
    limited: Boolean(product.limited),
    size_chart: product.sizeChart ?? null,
    specs: (product.specs ?? []).filter((s) => s.label?.trim() && s.value?.trim()),
    // Empty writes back as null, not '', so "no brand" has one representation
    // in the column instead of two the reads would have to keep untangling.
    brand: product.brand?.trim() || null,
    style_tags: product.styleTags ?? null,
    // Both null = the store default. Always written as a pair, matching the
    // check constraint in 0026.
    delivery_days_min: product.deliveryDays?.min ?? null,
    delivery_days_max: product.deliveryDays?.max ?? null,
  }

  if (!select.includes(' specs,')) delete row.specs
  if (!select.includes(' brand,')) delete row.brand
  if (!select.includes(' style_tags,')) delete row.style_tags
  if (!select.includes(' delivery_days_min,')) {
    delete row.delivery_days_min
    delete row.delivery_days_max
  }

  return row
}

/**
 * Writes the product's variant rows, adding, updating and removing as needed.
 *
 * Deliberately NOT a delete-then-insert. Deleting every row and re-creating it
 * would take each variant's stock to zero and back on every save, and any
 * checkout landing in that window would be told the item is sold out — an
 * admin editing a description must not be able to reject a customer's order.
 *
 * Passing `undefined` for variants leaves the table alone entirely, so callers
 * that know nothing about stock cannot wipe it.
 *
 * Stock is written only where the editor changed it, and then only if nobody
 * else did meanwhile (lib/stock-sync.ts): an untouched cell keeps the live
 * value, so a save can never undo a sale made while the form was open.
 */

/** Stock the editor changed had already changed in the database. */
export class StockConflictError extends Error {
  readonly conflicts: StockConflict[]
  /** True when the product's other fields were already saved. */
  readonly partial: boolean
  constructor(conflicts: StockConflict[], partial = false) {
    super('Stock changed while the product was being edited')
    this.conflicts = conflicts
    this.partial = partial
  }
}

async function readLiveVariants(productUuid: string): Promise<LiveVariant[]> {
  const { data, error } = await createAdminClient()
    .from('product_variants')
    .select('id, size, color, stock')
    .eq('product_id', productUuid)
  if (error) throw new Error(`Failed to read variants: ${error.message}`)
  return ((data ?? []) as { id: string; size: string; color: string; stock: number }[]).map((r) => ({
    id: r.id,
    size: r.size,
    color: r.color,
    stock: Number(r.stock) || 0,
  }))
}

async function applyVariantPlan(productUuid: string, plan: VariantPlan): Promise<StockConflict[]> {
  const supabase = createAdminClient()
  if (plan.inserts.length > 0) {
    const { error } = await supabase
      .from('product_variants')
      .insert(plan.inserts.map((r) => ({ ...r, product_id: productUuid })))
    if (error) throw new Error(`Failed to save variants: ${error.message}`)
  }

  // One row at a time: a stock change carries its own compare-and-set.
  const late: StockConflict[] = []
  for (const u of plan.updates) {
    let q = supabase.from('product_variants').update(u.patch).eq('id', u.id)
    if (u.expectedStock !== undefined) q = q.eq('stock', u.expectedStock)
    const { data, error } = await q.select('id')
    if (error) throw new Error(`Failed to save variants: ${error.message}`)
    if (u.expectedStock !== undefined && !(data ?? []).length) {
      // Sold (or restocked) between the check and this write.
      const { data: now } = await supabase.from('product_variants').select('stock').eq('id', u.id).maybeSingle()
      late.push({ size: u.size, color: u.color, expected: u.expectedStock, actual: Number((now as { stock?: number } | null)?.stock ?? 0) })
    }
  }

  // Combinations the admin removed. After the writes, so a variant that was
  // only renamed is never briefly absent.
  if (plan.deletes.length > 0) {
    const { error } = await supabase.from('product_variants').delete().in('id', plan.deletes)
    if (error) throw new Error(`Failed to remove variants: ${error.message}`)
  }
  return late
}

export async function createProduct(product: Product): Promise<Product> {
  const plan = product.variants ? planVariantWrites(product.variants, []) : null
  const { collectionId, categoryId } = await resolveRefs(product.group, product.category)
  const { data, error } = await createAdminClient()
    .from('products')
    .insert(await productToRow(plan ? { ...product, variants: plan.effective } : product, collectionId, categoryId))
    .select(await resolveProductSelect())
    .single()

  if (error) throw new Error(`Failed to create product: ${error.message}`)

  if (plan) await applyVariantPlan((data as unknown as { id: string }).id, plan)

  // Re-read so the returned product carries the variants that were just
  // written, rather than the empty set the insert saw.
  return (await getProductBySlug(product.id, { scope: 'admin' })) ?? rowToProduct(data as unknown as Record<string, unknown>)
}

export async function updateProduct(product: Product): Promise<Product | null> {
  const supabase = createAdminClient()
  const { data: existing, error: findError } = await supabase.from('products').select('id').eq('slug', product.id).maybeSingle()
  if (findError) throw new Error(`Failed to update product: ${findError.message}`)
  if (!existing) return null
  const productUuid = (existing as { id: string }).id

  // Checked before anything is written: a conflict saves nothing, so the
  // admin can look at the live numbers and save again.
  const plan = product.variants ? planVariantWrites(product.variants, await readLiveVariants(productUuid)) : null
  if (plan?.conflicts.length) throw new StockConflictError(plan.conflicts)

  const { collectionId, categoryId } = await resolveRefs(product.group, product.category)
  const { data, error } = await supabase
    .from('products')
    // Availability is derived from the stock as it will be after this save —
    // the live value for every cell the admin did not change.
    .update(await productToRow(plan ? { ...product, variants: plan.effective } : product, collectionId, categoryId))
    .eq('id', productUuid)
    .select(await resolveProductSelect())
    .maybeSingle()

  if (error) throw new Error(`Failed to update product: ${error.message}`)
  if (!data) return null

  if (plan) {
    const late = await applyVariantPlan(productUuid, plan)
    if (late.length) throw new StockConflictError(late, true)
  }

  return (await getProductBySlug(product.id, { scope: 'admin' })) ?? rowToProduct(data as unknown as Record<string, unknown>)
}

/**
 * Writes only a product's name and description. The translation backfill uses
 * it so it can never touch a price, stock or anything else an admin may be
 * editing at the same moment.
 */
export async function updateProductText(
  slug: string,
  name: LocalizedText,
  description: LocalizedText,
): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('products')
    .update({ name, description })
    .eq('slug', slug)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`Failed to update product text: ${error.message}`)
  return Boolean(data)
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

/**
 * One product by its slug — the value stored in `products.slug`, which is also
 * `Product.id` in the app and the segment in /product/[slug].
 *
 * A single-row query rather than filtering readCatalog(): a product page is
 * rendered per request per product, and pulling the whole catalogue to throw
 * away all but one row makes every product page pay for every other product.
 *
 * Returns null for an unknown slug so the caller can render notFound() rather
 * than a 500 — a mistyped URL is a 404, not a server error.
 */
export async function getProductBySlug(
  slug: string,
  { scope = 'public' }: { scope?: CatalogScope } = {},
): Promise<Product | null> {
  const select = await selectFor(scope)
  if (scope === 'public' && !select.includes(' listing_status,')) return null
  let query = createAdminClient().from('products').select(select).eq('slug', slug)
  if (scope === 'public') query = query.eq('listing_status', 'published')
  const { data, error } = await query.maybeSingle()

  if (error) throw new Error(`Failed to read product: ${error.message}`)
  return data ? forScope(rowToProduct(data as unknown as Record<string, unknown>), scope) : null
}

/**
 * The products with these slugs, in one query. Unknown slugs are simply
 * absent from the result — a withdrawn product and a mistyped id look the
 * same, and both mean "not for sale".
 */
export async function getProductsBySlugs(
  slugs: string[],
  { scope = 'public' }: { scope?: CatalogScope } = {},
): Promise<Product[]> {
  if (slugs.length === 0) return []
  const select = await selectFor(scope)
  if (scope === 'public' && !select.includes(' listing_status,')) return []
  let query = createAdminClient().from('products').select(select).in('slug', slugs)
  if (scope === 'public') query = query.eq('listing_status', 'published')
  const { data, error } = await query

  if (error) throw new Error(`Failed to read products: ${error.message}`)
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => forScope(rowToProduct(r), scope))
}

/**
 * Every product slug, for the sitemap.
 *
 * Selects only the two columns it needs: a sitemap of a large catalogue would
 * otherwise transfer every description and image array to emit a list of URLs.
 * `updated_at` becomes each entry's <lastmod>, which is the honest signal —
 * using the build time would tell Google every product changed on every deploy
 * and teach it to ignore the field.
 */
export async function listProductSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
  // Published products only: a draft or withdrawn piece must not be indexed.
  if (!(await listingSupported())) return []
  const { data, error } = await createAdminClient()
    .from('products')
    .select('slug, updated_at')
    .eq('listing_status', 'published')
    .order('updated_at', { ascending: false })

  if (error) throw new Error(`Failed to list product slugs: ${error.message}`)
  return (data ?? []).map((row) => ({
    slug: row.slug as string,
    updatedAt: new Date((row.updated_at as string) ?? Date.now()),
  }))
}

// ---------------------------------------------------------------- listing ----

/** Migration 0062 is not applied: nothing can be published yet. */
export class ListingUnavailableError extends Error {
  constructor() {
    super('Публикация товаров требует миграции 0062_product_publication.sql')
  }
}

/** The product is missing what a buyer needs; nothing was changed. */
export class PublishBlockedError extends Error {
  readonly blockers: PublishBlocker[]
  constructor(blockers: PublishBlocker[]) {
    super('Товар нельзя опубликовать: не заполнены обязательные поля')
    this.blockers = blockers
  }
}

export type ListingChange =
  | { action: 'publish'; basis: RightsBasis; reference: string }
  | { action: 'withdraw' }

/**
 * Puts a product on sale or takes it off.
 *
 * Publishing re-checks, on the product as stored, everything publishBlockers()
 * lists, records the owner's rights entry and then flips the status; the
 * database trigger (0062) refuses the flip if the rights entry is missing, so
 * the order of the two writes cannot be raced into a published product with
 * no record. Withdrawing keeps the rights entry: the owner may republish.
 *
 * Returns the admin's view of the product, or null for an unknown slug.
 */
export async function setProductListing(slug: string, change: ListingChange): Promise<Product | null> {
  if (!(await listingSupported())) throw new ListingUnavailableError()
  const supabase = createAdminClient()
  const { data: row, error: findError } = await supabase.from('products').select('id').eq('slug', slug).maybeSingle()
  if (findError) throw new Error(`Failed to read product: ${findError.message}`)
  if (!row) return null
  const productUuid = (row as { id: string }).id

  if (change.action === 'publish') {
    const product = await getProductBySlug(slug, { scope: 'admin' })
    if (!product) return null
    const blockers = publishBlockers(product)
    if (blockers.length) throw new PublishBlockedError(blockers)

    const now = new Date().toISOString()
    const { error: rightsError } = await supabase.from('product_rights').upsert(
      { product_id: productUuid, basis: change.basis, reference: change.reference.trim(), confirmed_at: now, updated_at: now },
      { onConflict: 'product_id' },
    )
    if (rightsError) throw new Error(`Failed to record sale rights: ${rightsError.message}`)

    const { error } = await supabase.from('products').update({ listing_status: 'published' }).eq('id', productUuid)
    if (error) throw new Error(`Failed to publish product: ${error.message}`)
  } else {
    const { error } = await supabase
      .from('products')
      .update({ listing_status: 'withdrawn' })
      .eq('id', productUuid)
      .eq('listing_status', 'published')
    if (error) throw new Error(`Failed to withdraw product: ${error.message}`)
  }

  return getProductBySlug(slug, { scope: 'admin' })
}
