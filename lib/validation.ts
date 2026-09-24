// Isomorphic checkout validation — the exact same rules run in the browser
// (for instant field-level feedback) and again on the server before an order
// is ever written, so a hand-crafted request can't bypass them.
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

/** Deliberately stricter than the HTML5 default: requires a dot-separated
 * TLD of at least two letters and forbids consecutive/leading/trailing dots
 * in either part, which the browser's own `type="email"` check allows. */
const EMAIL_REGEX =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 254) return false
  return EMAIL_REGEX.test(trimmed)
}

/**
 * Validates a phone number against libphonenumber's real per-country rules
 * (length, prefixes, allocated ranges) — not just "looks like digits".
 * `value` is expected in international form, e.g. "+41 79 123 45 67".
 */
export function isValidPhone(value: string, country?: CountryCode): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  const parsed = parsePhoneNumberFromString(trimmed, country)
  return Boolean(parsed?.isValid())
}

/** Normalises a valid number to E.164-backed international formatting so
 * every stored order carries the same, unambiguous shape. */
export function formatPhone(value: string, country?: CountryCode): string | null {
  const parsed = parsePhoneNumberFromString(value.trim(), country)
  if (!parsed?.isValid()) return null
  return parsed.formatInternational()
}

/**
 * Cheap gibberish guard: real street names and cities have some variety of
 * characters and no long runs of one key held down. Intentionally lenient —
 * it only rejects the obviously-mashed ("aaaaaa", "xxxx xxxx"), never a real
 * address in any script.
 */
export function looksLikeGibberish(value: string): boolean {
  const cleaned = value.trim().toLowerCase()
  if (!cleaned) return true
  const letters = cleaned.replace(/[^\p{L}\p{N}]/gu, '')
  if (letters.length === 0) return true
  const distinct = new Set(letters).size
  if (distinct < 3) return true
  if (/(.)\1{3,}/u.test(cleaned)) return true
  return false
}

export type AddressParts = {
  street: string
  postalCode: string
  city: string
  country?: string
}

export type AddressFieldError = 'street' | 'postalCode' | 'city'

/**
 * Structural address checks: a street line with a house number, a plausible
 * postal code (exactly four digits for Switzerland, the boutique's home
 * market) and a city name without digits.
 */
export function validateAddress(parts: AddressParts): AddressFieldError[] {
  const errors: AddressFieldError[] = []

  const street = parts.street.trim()
  if (
    street.length < 5 ||
    street.length > 120 ||
    !/\p{L}/u.test(street) ||
    !/\d/u.test(street) ||
    looksLikeGibberish(street)
  ) {
    errors.push('street')
  }

  const postalCode = parts.postalCode.trim()
  const isSwiss = (parts.country ?? 'CH').toUpperCase() === 'CH'
  if (isSwiss ? !/^\d{4}$/.test(postalCode) : !/^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/.test(postalCode)) {
    errors.push('postalCode')
  }

  const city = parts.city.trim()
  if (
    city.length < 2 ||
    city.length > 60 ||
    /\d/u.test(city) ||
    !/^[\p{L}\p{M}\s'’.-]+$/u.test(city) ||
    looksLikeGibberish(city)
  ) {
    errors.push('city')
  }

  return errors
}

/** Single-line form used for admin display, shipping labels and every order
 * record written before the structured fields existed. */
export function composeAddress(parts: AddressParts): string {
  const country = parts.country?.trim()
  return [parts.street.trim(), `${parts.postalCode.trim()} ${parts.city.trim()}`.trim(), country]
    .filter(Boolean)
    .join(', ')
}

export function isValidName(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length >= 2 && trimmed.length <= 80 && !looksLikeGibberish(trimmed)
}

/**
 * One half of a name: a first name or a surname, as checkout asks for them.
 *
 * Deliberately NOT looksLikeGibberish(), which wants three different letters:
 * a real name is often shorter than that — Li, Wu, Bo, Ng, Al. Instead:
 * 2–50 characters, starting with a letter, containing only letters and the
 * joiners names actually use (space, hyphen, apostrophe, full stop), and no
 * letter four times in a row.
 */
export function isValidNamePart(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 2 || trimmed.length > 50) return false
  if (!/^\p{L}[\p{L}\p{M} '’.-]*$/u.test(trimmed)) return false
  if ((trimmed.match(/\p{L}/gu) ?? []).length < 2) return false
  return !/(.)\1{3,}/u.test(trimmed.toLowerCase())
}

/** "First Last" from the two halves, with runs of spaces collapsed. */
export function joinName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g, ' ')
}

/**
 * A best guess at the two halves of a single stored name — for pre-filling
 * the checkout from an address saved before it asked for them separately.
 * The first word is the first name and the rest the surname; the customer
 * sees both fields and can correct a guess before ordering.
 */
export function splitFullName(full: string | undefined | null): { firstName: string; lastName: string } {
  const words = (full ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { firstName: '', lastName: '' }
  return { firstName: words[0], lastName: words.slice(1).join(' ') }
}
