/**
 * Resolves lib/ui-strings.ts into one dictionary per language:
 *
 *   lib/ui-dict/<locale>.json   { "nav.shop": "Shop", … }
 *
 * The source table carries every language side by side, which is how it is
 * best edited and how the server and the admin console read it. A visitor
 * reads one language, so the storefront loads one of these instead
 * (lib/i18n-runtime.ts): the default language in the main bundle, any other in
 * a chunk of its own.
 *
 * Each value is resolved exactly as translate() in lib/i18n.ts resolves it —
 * the language itself, then en, it, fr, de — so a key missing a translation
 * reads the same here as it always has.
 *
 * Run by next.config.js on every `next build` and `next dev` (so no deploy
 * path can skip it), and by `npm run typecheck`. The output is generated, not
 * committed (.gitignore), so it can never drift from the source.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SOURCE = path.join(ROOT, 'lib', 'ui-strings.ts')
const OUT = path.join(ROOT, 'lib', 'ui-dict')
const LOCALES = ['ru', 'en', 'it', 'fr', 'de']

/** translate()'s order, lib/i18n.ts. */
function fallbackOrder(locale) {
  return locale === 'ru' ? ['ru', 'en', 'it', 'fr', 'de'] : [locale, 'en', 'it', 'fr', 'de']
}

/** The UI table, read as the plain object literal it is. */
function readTable() {
  const source = fs.readFileSync(SOURCE, 'utf8')
  const marker = 'export const UI = '
  const start = source.indexOf(marker)
  const end = source.lastIndexOf('} as const')
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${SOURCE}: expected "export const UI = { … } as const"`)
  }
  // Our own source file, and data only (strings and comments) — evaluating it
  // is how seed-catalog.mjs reads lib/data.ts, for the same reason.
  return new Function(`return (${source.slice(start + marker.length, end + 1)})`)()
}

function resolve(entry, locale) {
  for (const language of fallbackOrder(locale)) {
    const value = entry[language]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return ''
}

function generate() {
  const table = readTable()
  fs.mkdirSync(OUT, { recursive: true })
  for (const locale of LOCALES) {
    const dictionary = {}
    for (const [key, entry] of Object.entries(table)) dictionary[key] = resolve(entry, locale)
    const json = JSON.stringify(dictionary)
    const file = path.join(OUT, `${locale}.json`)
    // Written only when it changed, so a running dev server is not sent a
    // rebuild for nothing.
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== json) fs.writeFileSync(file, json)
  }
}

module.exports = { generate }

if (require.main === module) generate()
