import 'server-only'

/**
 * Checks that a file's first bytes match the MIME type it was declared with.
 *
 * Upload routes receive the type from the browser, which is only a claim:
 * an HTML or script file renamed to `photo.png` arrives as `image/png`. Stored
 * as-is, it is then served back with an image content type from our storage
 * bucket — harmless in a modern browser with nosniff, but it is still
 * attacker-chosen content sitting behind our links and in the admin console.
 * Matching the magic number closes that off for every format we accept.
 *
 * Unknown types return false, so a new format has to be added here before it
 * can be uploaded.
 */
export function matchesDeclaredType(bytes: Uint8Array, declaredType: string): boolean {
  const type = declaredType.toLowerCase()
  const at = (offset: number, sig: number[]) =>
    bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b)
  const ascii = (offset: number, text: string) =>
    at(
      offset,
      text.split('').map((c) => c.charCodeAt(0)),
    )
  // ISO-BMFF containers (HEIC/HEIF/AVIF): "ftyp" at 4, major brand at 8.
  const ftypBrand = () => (ascii(4, 'ftyp') ? String.fromCharCode(...Array.from(bytes.slice(8, 12))) : '')

  switch (type) {
    case 'image/jpeg':
      return at(0, [0xff, 0xd8, 0xff])
    case 'image/png':
      return at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/gif':
      return ascii(0, 'GIF87a') || ascii(0, 'GIF89a')
    case 'image/webp':
      return ascii(0, 'RIFF') && ascii(8, 'WEBP')
    case 'application/pdf':
      return ascii(0, '%PDF-')
    case 'image/avif':
      return ['avif', 'avis'].indexOf(ftypBrand()) !== -1
    case 'image/heic':
    case 'image/heif':
      return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].indexOf(ftypBrand()) !== -1
    default:
      return false
  }
}
