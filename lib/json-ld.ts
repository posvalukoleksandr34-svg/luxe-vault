/**
 * Serialise structured data for an inline `<script type="application/ld+json">`.
 *
 * JSON.stringify alone is NOT safe here. It leaves `<`, `>` and `&` as they
 * are, so a product name, description or category label containing
 * `</script><script>…` — typed into the admin console, imported from a CSV, or
 * machine-translated — closes the JSON block and runs as markup on every page
 * that renders it. Escaping those characters as < / > / & keeps
 * the JSON byte-for-byte equivalent for any parser while making it impossible
 * to leave the script element. U+2028 / U+2029 are escaped too: valid in JSON,
 * but line terminators to older JavaScript engines.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
