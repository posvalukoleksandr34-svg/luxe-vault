/**
 * One-time seed: copies the products that used to live in lib/data.ts into
 * public.products.
 *
 *   node scripts/seed-catalog.mjs
 *
 * Idempotent — products are matched on their slug, so re-running updates
 * rather than duplicating. Requires 0005_catalog.sql to have been applied
 * (the collections and categories it seeds are what these products reference).
 *
 * Uses the service-role key and therefore must only ever be run locally.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function env(key) {
  const raw = readFileSync('.env.local', 'utf8')
  const m = raw.match(new RegExp(`^\\s*${key}\\s*=(.*)$`, 'm'))
  const v = m?.[1]?.trim()
  if (!v) throw new Error(`${key} missing from .env.local`)
  return v
}

const URL_ = env('NEXT_PUBLIC_SUPABASE_URL')
const KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
}

async function rest(path, init = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

// lib/data.ts is TypeScript; read the seed array out of it without a compiler
// by evaluating just the literal. Simpler and more robust here than adding a
// build step for a script that runs once.
const dataTs = readFileSync('lib/data.ts', 'utf8')
const start = dataTs.indexOf('export const SEED_PRODUCTS: Product[] = [')
if (start === -1) {
  console.error(
    'SEED_PRODUCTS not found in lib/data.ts.\n' +
      'If you have already seeded and removed it, nothing to do.',
  )
  process.exit(0)
}
const arrayStart = dataTs.indexOf('[', start)
// Walk brackets to find the matching close, so nested arrays do not confuse us.
let depth = 0
let end = arrayStart
for (; end < dataTs.length; end++) {
  const ch = dataTs[end]
  if (ch === '[') depth++
  else if (ch === ']') {
    depth--
    if (depth === 0) break
  }
}
const literal = dataTs.slice(arrayStart, end + 1)
// eslint-disable-next-line no-eval
const products = eval(literal)

console.log(`Found ${products.length} products in lib/data.ts`)

const collections = await rest('collections?select=id,slug')
const categories = await rest('categories?select=id,slug')
const colBySlug = new Map(collections.map((c) => [c.slug, c.id]))
const catBySlug = new Map(categories.map((c) => [c.slug, c.id]))

if (colBySlug.size === 0) {
  console.error('No collections found — run supabase/migrations/0005_catalog.sql first.')
  process.exit(1)
}

let ok = 0
for (const p of products) {
  const collection_id = colBySlug.get(p.group)
  const category_id = catBySlug.get(p.category)
  if (!collection_id || !category_id) {
    console.warn(`  skip ${p.id}: unknown group "${p.group}" / category "${p.category}"`)
    continue
  }

  await rest('products?on_conflict=slug', {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      slug: p.id,
      name: p.name ?? {},
      description: p.description ?? {},
      collection_id,
      category_id,
      price: p.price,
      old_price: p.oldPrice ?? null,
      image: p.image ?? null,
      images: p.images ?? [],
      sizes: p.sizes ?? [],
      colors: p.colors ?? [],
      statuses: p.statuses ?? [],
      is_new: Boolean(p.isNew),
      limited: Boolean(p.limited),
      size_chart: p.sizeChart ?? null,
    }),
  })
  ok++
  console.log(`  seeded ${p.id}`)
}

console.log(`\nDone: ${ok}/${products.length} products in public.products.`)
console.log('You can now delete SEED_PRODUCTS from lib/data.ts.')
