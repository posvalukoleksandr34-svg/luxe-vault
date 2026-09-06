import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Address autocomplete, proxied server-side.
 *
 * Why a proxy rather than calling the geocoder from the browser:
 *
 *  1. If a paid provider is configured, its key stays on the server. A
 *     browser-side Places call would expose the key to anyone with devtools.
 *  2. It keeps a single response shape, so swapping providers never touches
 *     the component.
 *  3. The customer's IP is not handed to the geocoder on every keystroke.
 *
 * Default provider is Photon (Komoot's OpenStreetMap geocoder): free, needs no
 * key, and is explicitly built for type-ahead. Nominatim was rejected — its
 * usage policy forbids autocomplete-style querying.
 *
 * Set GOOGLE_PLACES_API_KEY to switch to Google Places Autocomplete, which
 * returns markedly better results for apartment-level addresses.
 */

const PHOTON_ENDPOINT = 'https://photon.komoot.io/api/'
const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY?.trim()

export type AddressSuggestion = {
  /** Single-line label shown in the dropdown. */
  label: string
  /** Street plus house number, for the street field. */
  street: string
  postalCode: string
  city: string
  /** ISO-3166 alpha-2, upper case. */
  country: string
}

type PhotonFeature = {
  properties?: {
    name?: string
    street?: string
    housenumber?: string
    postcode?: string
    city?: string
    town?: string
    village?: string
    district?: string
    state?: string
    countrycode?: string
    country?: string
  }
}

function fromPhoton(feature: PhotonFeature): AddressSuggestion | null {
  const p = feature.properties
  if (!p) return null

  // Photon puts the street in `street` when a house number is present and in
  // `name` when it is not (i.e. the result is the street itself).
  const streetName = p.street || p.name || ''
  const street = [streetName, p.housenumber].filter(Boolean).join(' ').trim()
  const city = p.city || p.town || p.village || p.district || ''
  const postalCode = p.postcode || ''
  const country = (p.countrycode || '').toUpperCase()

  if (!street && !city) return null

  const label = [street, [postalCode, city].filter(Boolean).join(' '), p.country]
    .filter(Boolean)
    .join(', ')

  return { label, street, postalCode, city, country }
}

async function queryPhoton(q: string, country: string | null): Promise<AddressSuggestion[]> {
  const url = new URL(PHOTON_ENDPOINT)
  url.searchParams.set('q', q)
  url.searchParams.set('limit', '6')
  // Photon's OSM data has no address layer filter, but `osm_tag` narrows to
  // things that can actually be posted to.
  url.searchParams.set('layer', 'house')
  if (country) url.searchParams.set('lang', 'en')

  const res = await fetch(url, {
    headers: { 'User-Agent': 'luxe-vault.store address autocomplete' },
    // Nothing here is worth caching across customers, and a stale suggestion
    // list is worse than none.
    cache: 'no-store',
  })
  if (!res.ok) return []

  const data = (await res.json()) as { features?: PhotonFeature[] }
  const all = (data.features ?? []).map(fromPhoton).filter((s): s is AddressSuggestion => s !== null)

  // Photon ignores a country filter, so it is applied here. Results outside
  // the country the customer picked are noise, not options.
  return country ? all.filter((s) => !s.country || s.country === country) : all
}

type GooglePrediction = {
  description?: string
  place_id?: string
  structured_formatting?: { main_text?: string; secondary_text?: string }
}

async function queryGoogle(q: string, country: string | null): Promise<AddressSuggestion[]> {
  const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json')
  url.searchParams.set('input', q)
  url.searchParams.set('types', 'address')
  url.searchParams.set('key', GOOGLE_KEY!)
  if (country) url.searchParams.set('components', `country:${country.toLowerCase()}`)

  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return []

  const data = (await res.json()) as { predictions?: GooglePrediction[] }
  // Autocomplete predictions carry no structured postcode; resolving one costs
  // a second billed Place Details call per selection. The label is returned as
  // the street and the customer completes postcode/city, which they can
  // already do — better than silently spending on every keystroke.
  return (data.predictions ?? []).slice(0, 6).map((p) => ({
    label: p.description ?? '',
    street: p.structured_formatting?.main_text ?? p.description ?? '',
    postalCode: '',
    city: (p.structured_formatting?.secondary_text ?? '').split(',')[0]?.trim() ?? '',
    country: country ?? '',
  }))
}

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim()
  const country = (request.nextUrl.searchParams.get('country') ?? '').trim().toUpperCase() || null

  // Below three characters every geocoder returns noise, and querying on the
  // first keystroke is what gets an app rate-limited.
  if (q.length < 3) return NextResponse.json({ suggestions: [] })

  try {
    const suggestions = GOOGLE_KEY ? await queryGoogle(q, country) : await queryPhoton(q, country)
    return NextResponse.json({ suggestions })
  } catch {
    // Autocomplete is a convenience. If the geocoder is down the customer must
    // still be able to type an address and check out, so this never 500s.
    return NextResponse.json({ suggestions: [] })
  }
}
