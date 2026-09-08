import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Auth is enforced by middleware.ts for every /api/admin/* path.

/**
 * CSV import and export for size-level availability.
 *
 * FORMAT
 *
 *   product_id,size,in_stock
 *   p-hoodie-noir,M,false
 *
 * `product_id` is the catalogue slug — the same value in the URL, in
 * order_items and in the admin's product list. `in_stock` accepts
 * true/false, 1/0, yes/no and da/net, because a spreadsheet exported from
 * Excel in another locale will not have used the word the code expects.
 *
 * WHY in_stock AND NOT A QUANTITY
 *
 * A boolean is what a stockroom check produces: someone looks at a rail and
 * says "no mediums left". Importing that must not destroy a real count, so:
 *
 *   in_stock=false  →  stock 0. Unambiguous, and what makes the size sold out.
 *   in_stock=true   →  stock is RAISED to 1 only if it is currently 0.
 *                      A variant already showing 7 stays at 7 — a bulk
 *                      availability file has no idea there were seven, and
 *                      overwriting it would silently destroy the count the
 *                      oversell guard depends on.
 *
 * A COLOUR IS REQUIRED, AND THE CSV DOES NOT CARRY ONE
 *
 * Stock lives per (product, size, colour) — see migration 0012 — because
 * selling the last medium in black is not the same as having mediums in
 * white. A row naming only a size therefore applies to EVERY colour of that
 * size, which is the honest reading of "size M is out of stock". An optional
 * fourth `color` column narrows it when that is not what was meant.
 */

type Row = { productId: string; size: string; inStock: boolean; color?: string }

const TRUE_WORDS = new Set(['true', '1', 'yes', 'y', 'in_stock', 'instock', 'да', 'есть'])
const FALSE_WORDS = new Set(['false', '0', 'no', 'n', 'out_of_stock', 'oos', 'нет'])

/**
 * A deliberately small CSV reader.
 *
 * Handles quoted fields, escaped quotes and CRLF, which is everything Excel
 * emits for this shape of data. A parser library would be a dependency and a
 * bundle cost for three columns of text.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  // Strip a UTF-8 BOM: Excel writes one, and it would otherwise become part
  // of the first header name and break the column lookup.
  const input = text.replace(/^﻿/, '')

  for (let i = 0; i < input.length; i++) {
    const c = input[i]

    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += c
      }
      continue
    }

    if (c === '"') quoted = true
    else if (c === ',' || c === ';') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') {
      field += c
    }
  }

  if (field || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

export async function POST(request: NextRequest) {
  let text: string

  const contentType = request.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'No file was sent.' }, { status: 400 })
      }
      if (file.size > 2 * 1024 * 1024) {
        return NextResponse.json({ error: 'File is larger than 2 MB.' }, { status: 413 })
      }
      text = await file.text()
    } else {
      // Also accepts a raw CSV body, which is what a script or a curl call
      // will send.
      text = await request.text()
    }
  } catch {
    return NextResponse.json({ error: 'Could not read the upload.' }, { status: 400 })
  }

  const rows = parseCsv(text)
  if (rows.length < 2) {
    return NextResponse.json(
      { error: 'The file needs a header row and at least one data row.' },
      { status: 400 },
    )
  }

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const col = {
    productId: header.indexOf('product_id'),
    size: header.indexOf('size'),
    inStock: header.indexOf('in_stock'),
    color: header.indexOf('color'),
  }

  if (col.productId < 0 || col.size < 0 || col.inStock < 0) {
    return NextResponse.json(
      { error: 'Header must contain product_id, size and in_stock.' },
      { status: 400 },
    )
  }

  const parsed: Row[] = []
  const rejected: { line: number; reason: string }[] = []

  rows.slice(1).forEach((cells, i) => {
    const line = i + 2 // 1-indexed, and the header is line 1.
    const productId = (cells[col.productId] ?? '').trim()
    const size = (cells[col.size] ?? '').trim()
    const raw = (cells[col.inStock] ?? '').trim().toLowerCase()

    if (!productId || !size) {
      rejected.push({ line, reason: 'product_id and size are both required' })
      return
    }

    const inStock = TRUE_WORDS.has(raw) ? true : FALSE_WORDS.has(raw) ? false : null
    if (inStock === null) {
      rejected.push({ line, reason: `in_stock "${cells[col.inStock] ?? ''}" is not a yes/no value` })
      return
    }

    parsed.push({
      productId,
      size,
      inStock,
      color: col.color >= 0 ? (cells[col.color] ?? '').trim() || undefined : undefined,
    })
  })

  if (parsed.length === 0) {
    return NextResponse.json({ error: 'No usable rows.', rejected }, { status: 400 })
  }

  const supabase = createAdminClient()

  // One lookup for every slug in the file rather than one per row.
  const slugs = Array.from(new Set(parsed.map((r) => r.productId)))
  const { data: products, error: productError } = await supabase
    .from('products')
    .select('id, slug')
    .in('slug', slugs)

  if (productError) {
    console.error('[inventory/import] product lookup failed:', productError.message)
    return NextResponse.json({ error: 'Could not read the catalogue.' }, { status: 500 })
  }

  const idBySlug = new Map((products ?? []).map((p) => [p.slug as string, p.id as string]))

  let updated = 0
  const unknown: string[] = []
  const missingVariant: string[] = []

  for (const row of parsed) {
    const productUuid = idBySlug.get(row.productId)
    if (!productUuid) {
      if (!unknown.includes(row.productId)) unknown.push(row.productId)
      continue
    }

    let query = supabase
      .from('product_variants')
      .select('id, stock')
      .eq('product_id', productUuid)
      .eq('size', row.size)
    if (row.color) query = query.eq('color', row.color)

    const { data: variants } = await query
    if (!variants || variants.length === 0) {
      // The import does not CREATE variants. A row for a size that was never
      // set up is far more often a typo in the spreadsheet than an intent to
      // add a new one, and inventing rows from a typo is how a catalogue
      // grows sizes nobody sells.
      missingVariant.push(`${row.productId} / ${row.size}${row.color ? ` / ${row.color}` : ''}`)
      continue
    }

    for (const v of variants) {
      const current = Number(v.stock) || 0
      // See the note at the top: marking available must not overwrite a real
      // count, so it only lifts a zero off the floor.
      const next = row.inStock ? (current > 0 ? current : 1) : 0
      if (next === current) continue

      const { error } = await supabase
        .from('product_variants')
        .update({ stock: next })
        .eq('id', v.id as string)

      if (!error) updated++
    }
  }

  return NextResponse.json({
    updated,
    rows: parsed.length,
    // Reported rather than silently dropped: an import that says "done" while
    // ignoring half the file is how a shop discovers at the till that its
    // stock is wrong.
    rejected,
    unknownProducts: unknown,
    missingVariants: missingVariant,
  })
}

/**
 * Exports the current availability in exactly the shape the importer accepts,
 * so the round trip is edit-in-Excel-and-upload rather than hand-building a
 * file that matches a format documented somewhere else.
 */
export async function GET() {
  const { data, error } = await createAdminClient()
    .from('product_variants')
    .select('size, color, stock, product:products ( slug )')
    .order('size')

  if (error) {
    console.error('[inventory/import] export failed:', error.message)
    return NextResponse.json({ error: 'Could not read inventory.' }, { status: 500 })
  }

  const escape = (v: string) => (/[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

  const lines = ['product_id,size,color,in_stock,stock_quantity']
  for (const v of data ?? []) {
    const raw = v.product as unknown
    const product = (Array.isArray(raw) ? raw[0] : raw) as { slug: string } | null
    if (!product?.slug) continue
    const stock = Number(v.stock) || 0
    lines.push(
      [
        escape(product.slug),
        escape(v.size as string),
        escape(v.color as string),
        stock > 0 ? 'true' : 'false',
        String(stock),
      ].join(','),
    )
  }

  return new NextResponse(`﻿${lines.join('\r\n')}\r\n`, {
    headers: {
      // The BOM above and CRLF endings are what make Excel open this as a
      // table with correct accents rather than one mojibake column.
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="luxe-vault-inventory-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
