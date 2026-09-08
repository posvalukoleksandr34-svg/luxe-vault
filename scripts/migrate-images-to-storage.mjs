/**
 * One-off backfill: base64 data URIs in Postgres → files in Supabase Storage.
 *
 *   node scripts/migrate-images-to-storage.mjs --dry
 *   node scripts/migrate-images-to-storage.mjs
 *
 * Columns rewritten:
 *   products.image        text
 *   products.images       text[]
 *   collections.image_url text
 *   order_items.image     text     ← historical snapshots; skipped by default
 *
 * SAFE TO RE-RUN. Every row is matched on the `data:image/` prefix and skipped
 * once it holds a URL, so a second run does nothing. A row is only written
 * after all of its images have uploaded successfully, so an interrupted run
 * leaves the row untouched rather than half-migrated. Orphaned objects from an
 * interrupted run are harmless — they cost storage, not correctness.
 *
 * ORDER ITEMS are opt-in behind --with-orders. They are purchase-time
 * snapshots, deliberately frozen (see the comment on the table), and rewriting
 * them edits historical records. Without the flag old orders keep their inline
 * thumbnails, which still render — they are simply heavy. With it, they are
 * moved too and old order pages get much lighter.
 */

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const DRY = process.argv.includes('--dry')
const WITH_ORDERS = process.argv.includes('--with-orders')
const BUCKET = 'product-images'

const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`

const EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
}

const stats = { scanned: 0, uploaded: 0, skipped: 0, failed: 0, bytesFreed: 0 }

const isDataUri = (v) => typeof v === 'string' && v.startsWith('data:image/')

function randomId(n) {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]
  return s
}

/** Uploads one data URI and returns its public URL, or null on failure. */
async function migrateOne(uri, folder) {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(uri)
  if (!m) {
    console.warn('  ! unrecognised data URI, leaving as-is')
    stats.failed++
    return null
  }

  const contentType = m[1].toLowerCase()
  const ext = EXT[contentType]
  if (!ext) {
    console.warn(`  ! unsupported type ${contentType}, leaving as-is`)
    stats.failed++
    return null
  }

  const bytes = Buffer.from(m[2], 'base64')
  const name = `${folder}/${Date.now().toString(36)}-${randomId(10)}.${ext}`

  if (DRY) {
    console.log(`  · would upload ${(bytes.length / 1024).toFixed(0)} KB → ${name}`)
    stats.uploaded++
    stats.bytesFreed += uri.length
    return `${PUBLIC_PREFIX}${name}`
  }

  const { error } = await db.storage.from(BUCKET).upload(name, bytes, {
    contentType,
    upsert: false,
    cacheControl: '31536000',
  })
  if (error) {
    console.error(`  ! upload failed: ${error.message}`)
    stats.failed++
    return null
  }

  console.log(`  ✓ ${(bytes.length / 1024).toFixed(0)} KB → ${name}`)
  stats.uploaded++
  stats.bytesFreed += uri.length
  return `${PUBLIC_PREFIX}${name}`
}

async function migrateProducts() {
  const { data, error } = await db.from('products').select('id, slug, image, images')
  if (error) throw error

  for (const row of data) {
    stats.scanned++
    const patch = {}

    if (isDataUri(row.image)) {
      const url = await migrateOne(row.image, 'products')
      if (!url) continue
      patch.image = url
    }

    if (Array.isArray(row.images) && row.images.some(isDataUri)) {
      const next = []
      let ok = true
      for (const img of row.images) {
        if (!isDataUri(img)) {
          next.push(img)
          continue
        }
        const url = await migrateOne(img, 'products')
        if (!url) {
          ok = false
          break
        }
        next.push(url)
      }
      // Partial failure leaves the row alone rather than writing a gallery
      // that is half URLs and half base64.
      if (!ok) continue
      patch.images = next
    }

    if (Object.keys(patch).length === 0) {
      stats.skipped++
      continue
    }

    console.log(`products/${row.slug}: rewriting ${Object.keys(patch).join(', ')}`)
    if (!DRY) {
      const { error: upErr } = await db.from('products').update(patch).eq('id', row.id)
      if (upErr) {
        console.error(`  ! row update failed: ${upErr.message}`)
        stats.failed++
      }
    }
  }
}

async function migrateCollections() {
  const { data, error } = await db.from('collections').select('id, slug, image_url')
  if (error) throw error

  for (const row of data) {
    stats.scanned++
    if (!isDataUri(row.image_url)) {
      stats.skipped++
      continue
    }
    const url = await migrateOne(row.image_url, 'collections')
    if (!url) continue

    console.log(`collections/${row.slug}: rewriting image_url`)
    if (!DRY) {
      const { error: upErr } = await db
        .from('collections')
        .update({ image_url: url })
        .eq('id', row.id)
      if (upErr) {
        console.error(`  ! row update failed: ${upErr.message}`)
        stats.failed++
      }
    }
  }
}

async function migrateOrderItems() {
  const { data, error } = await db.from('order_items').select('id, name, image')
  if (error) throw error

  for (const row of data) {
    stats.scanned++
    if (!isDataUri(row.image)) {
      stats.skipped++
      continue
    }
    const url = await migrateOne(row.image, 'products')
    if (!url) continue

    console.log(`order_items/${row.id}: rewriting image (${row.name})`)
    if (!DRY) {
      const { error: upErr } = await db
        .from('order_items')
        .update({ image: url })
        .eq('id', row.id)
      if (upErr) {
        console.error(`  ! row update failed: ${upErr.message}`)
        stats.failed++
      }
    }
  }
}

console.log(DRY ? '— DRY RUN, nothing will be written —\n' : '— migrating —\n')

await migrateProducts()
await migrateCollections()
if (WITH_ORDERS) await migrateOrderItems()
else console.log('\n(order_items skipped — pass --with-orders to migrate historical snapshots)')

console.log(
  `\nscanned ${stats.scanned} · uploaded ${stats.uploaded} · already-migrated ${stats.skipped} · failed ${stats.failed}`,
)
console.log(`removed ~${(stats.bytesFreed / 1024 / 1024).toFixed(2)} MB of base64 from the database`)
if (stats.failed > 0) process.exitCode = 1
