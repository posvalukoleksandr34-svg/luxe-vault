/**
 * Verifies the hierarchical catalogue: /category/[collection]/[subcategory].
 *
 *   node scripts/verify-catalog-routes.mjs                 # dev server on :3000
 *   BASE=http://localhost:50349 node scripts/verify-catalog-routes.mjs
 *
 * The catalogue used to be one page: the collection cards set a store filter
 * and scrolled to #shop, so there was no URL for "Clothing" to link, share or
 * index. These checks are therefore mostly about the things a URL is FOR —
 * that it resolves, that it 404s when it should, that the title, canonical and
 * BreadcrumbList describe it, and that it is in the sitemap.
 *
 * Two of them are about the refactor rather than the routes:
 *
 *   - the homepage grid is UNCHANGED. ProductGrid gained optional props, and
 *     the risk of that approach (over forking the component) is that the
 *     homepage quietly loses its taxonomy chips.
 *
 *   - a stale store filter does NOT leak into a category page. The route pins
 *     the taxonomy, so a customer who filtered to Shoes on the homepage and
 *     then opened Clothing must see clothing.
 */

import fs from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:3000'

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(
    `${ok ? '  PASS' : '  FAIL'}  ${label}` +
      (ok ? '' : `  (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`),
  )
  if (!ok) failures++
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' })
  return { status: res.status, html: await res.text() }
}

/** The catalogue's real taxonomy, read the same way the routes read it. */
async function taxonomy() {
  const res = await fetch(`${BASE}/api/catalog`)
  const data = await res.json()
  const products = data.products ?? []
  const collections = (data.collections ?? []).map((c) => ({
    slug: c.slug,
    // The default locale, which is what SSR renders before hydration.
    label: c.name?.ru ?? c.name?.en ?? c.slug,
    count: products.filter((p) => p.group === c.slug).length,
    categories: (data.categories ?? [])
      .filter((cat) => cat.collectionSlug === c.slug)
      .map((cat) => ({
        slug: cat.slug,
        count: products.filter((p) => p.group === c.slug && p.category === cat.slug).length,
      })),
  }))
  return collections
}

try {
  const tree = await taxonomy()
  const populated = tree.filter((c) => c.count > 0)
  if (populated.length === 0) throw new Error('no collection has any products; nothing to verify')

  const collection = populated[0]
  const sub = collection.categories.find((c) => c.count > 0)

  // ------------------------------------------------------ 1. routes exist --
  console.log('\nRouting:')
  for (const node of populated) {
    const { status } = await get(`/category/${node.slug}`)
    check(`/category/${node.slug} resolves`, status, 200)
  }
  if (sub) {
    const { status } = await get(`/category/${collection.slug}/${sub.slug}`)
    check(`/category/${collection.slug}/${sub.slug} resolves`, status, 200)
  }

  check('an unknown collection 404s', (await get('/category/not-a-collection')).status, 404)

  // A subcategory is only valid under its own parent. Rendering it anywhere
  // would be a second URL for the same products and a breadcrumb that lies.
  if (sub) {
    const wrongParent = populated.find((n) => n.slug !== collection.slug)
    if (wrongParent) {
      check(
        'a subcategory under the wrong collection 404s',
        (await get(`/category/${wrongParent.slug}/${sub.slug}`)).status,
        404,
      )
    }
  }

  // ------------------------------------------------------------ 2. the SEO --
  console.log('\nMetadata and structured data:')
  const page = await get(`/category/${collection.slug}`)
  check(
    'the collection page has its own <title>',
    /<title>(?!LUXE VAULT — Premium)[^<]+— LUXE VAULT<\/title>/.test(page.html),
    true,
  )
  check(
    'it declares a canonical URL for itself',
    page.html.includes(`https://luxe-vault.store/category/${collection.slug}"`),
    true,
  )
  check('it emits a BreadcrumbList', page.html.includes('"@type":"BreadcrumbList"'), true)
  check(
    'the trail is rendered in the HTML, not only as JSON-LD',
    page.html.includes('aria-label="Breadcrumb"'),
    true,
  )
  check('the page has exactly one <h1>', (page.html.match(/<h1[\s>]/g) ?? []).length, 1)

  if (sub) {
    const subPage = await get(`/category/${collection.slug}/${sub.slug}`)
    check(
      'the subcategory canonical is the subcategory, not the parent',
      subPage.html.includes(`https://luxe-vault.store/category/${collection.slug}/${sub.slug}"`),
      true,
    )
    check(
      'its breadcrumb has three levels',
      (subPage.html.match(/"@type":"ListItem"/g) ?? []).length,
      3,
    )
  }

  // --------------------------------------------------------- 3. navigation --
  console.log('\nNavigation:')
  check(
    'the homepage collection cards are real links',
    (await get('/')).html.includes(`href="/category/${collection.slug}"`),
    true,
  )
  check(
    'the category page links to its own subcategories',
    sub ? page.html.includes(`/category/${collection.slug}/${sub.slug}`) : true,
    true,
  )
  check(
    'it links back to the other collections',
    populated.every((n) => page.html.includes(`href="/category/${n.slug}"`)),
    true,
  )

  // ----------------------------------------------- 4. the homepage is intact --
  console.log('\nThe homepage grid is unchanged:')
  const home = (await get('/')).html
  check('the #shop section still exists', home.includes('id="shop"'), true)
  // By label, not by "· count": React splits `· {count}` into separate text
  // nodes in SSR output, so the rendered HTML never contains that substring.
  check(
    'its taxonomy chips are still rendered',
    populated.every((n) => home.includes(n.label)),
    true,
  )

  // --------------------------------------------------- 5. the lock is real --
  console.log('\nThe route pins the taxonomy:')
  const other = populated.find((n) => n.slug !== collection.slug)
  if (other) {
    // Server-rendered, so no store filter is involved at all — which is the
    // point: the grid on this page cannot be narrowed by state from elsewhere.
    const a = await get(`/category/${collection.slug}`)
    const b = await get(`/category/${other.slug}`)
    check(
      'each collection page renders its own product count',
      a.html === b.html,
      false,
    )
  }

  const source = fs.readFileSync('components/products/product-grid.tsx', 'utf8')
  check(
    'the grid ignores filter.group when locked',
    /const activeGroup = locked \? lockedGroup : filter\.group/.test(source),
    true,
  )
  check(
    'the taxonomy chips are hidden when locked',
    source.includes('{!locked && (') && source.includes('{!locked && categories.length > 0 && ('),
    true,
  )
  check(
    'sort, size, colour, price, availability and paging are NOT hidden when locked',
    /filter\.sort/.test(source) &&
      source.includes('STANDARD_SIZES.map') &&
      source.includes('paletteColors.map') &&
      source.includes('priceBounds.max > priceBounds.min') &&
      source.includes('filter.inStockOnly') &&
      source.includes('setVisible((v) => v + PAGE_SIZE)'),
    true,
  )

  // ------------------------------------------------------------ 6. sitemap --
  console.log('\nSitemap:')
  const sitemap = (await get('/sitemap.xml')).html
  for (const node of populated) {
    check(`lists /category/${node.slug}`, sitemap.includes(`/category/${node.slug}<`), true)
  }
  // Empty categories are routable but not submitted — a page with no products
  // is the "crawled, currently not indexed" outcome the sitemap avoids.
  const empty = tree.flatMap((n) => n.categories.filter((c) => c.count === 0).map((c) => `${n.slug}/${c.slug}`))
  check(
    'empty subcategories are omitted',
    empty.filter((path) => sitemap.includes(`/category/${path}<`)).length,
    0,
  )
} catch (e) {
  console.error('\nABORTED:', e.message)
  failures++
} finally {
  console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}\n`)
  process.exitCode = failures === 0 ? 0 : 1
}
