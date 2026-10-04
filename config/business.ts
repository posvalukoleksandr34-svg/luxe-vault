import { SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_PHONE_HOURS, TELEGRAM_ADMIN } from '@/lib/data'

/**
 * Who runs the shop — the one place the seller's identity is configured.
 *
 * Read by the Imprint (/legal/imprint), the About and Contact pages, the
 * footer, and the Organization structured data. Every field is the OWNER'S
 * real information or empty: nothing here may be invented.
 *
 * AN EMPTY FIELD IS HIDDEN, NEVER SHOWN AS A PLACEHOLDER. Customers never see
 * "[YOUR NAME]". Until the fields are filled the Imprint shows only what is
 * known (the trading name, that the seller is in Switzerland, and how to get
 * in touch), and the admin console lists what is missing
 * (missingBusinessFields).
 *
 * Set them as environment variables (Vercel → Settings → Environment
 * Variables, all environments) so a private address never has to live in the
 * repository. They are NEXT_PUBLIC_ because they are published on the site
 * anyway; a change needs a redeploy.
 *
 *   NEXT_PUBLIC_SELLER_NAME         [YOUR NAME OR COMPANY NAME]
 *   NEXT_PUBLIC_SELLER_STREET       [FULL STREET ADDRESS]
 *   NEXT_PUBLIC_SELLER_POSTCODE     [POSTCODE]
 *   NEXT_PUBLIC_SELLER_CITY         [CITY]
 *   NEXT_PUBLIC_SELLER_UID          [UID IF APPLICABLE] e.g. CHE-123.456.789
 *   NEXT_PUBLIC_SELLER_RESPONSIBLE  [NAME OF THE RESPONSIBLE PERSON]
 *   NEXT_PUBLIC_SUPPORT_PHONE       [PHONE NUMBER] (already used by /contact)
 *   NEXT_PUBLIC_INSTAGRAM_URL       only if the account exists and is yours
 *   NEXT_PUBLIC_TIKTOK_URL          only if the account exists and is yours
 */

function env(value: string | undefined): string {
  return (value ?? '').trim()
}

/** A social profile is linked only when it is a real https URL. */
function profileUrl(value: string | undefined): string {
  const v = env(value)
  return /^https:\/\/[^\s]+$/.test(v) ? v : ''
}

export const BUSINESS = {
  /** The name customers know the shop by. */
  tradingName: 'Luxe Vault',
  /** Seller's legal name: a person's full name or a registered company. */
  legalName: env(process.env.NEXT_PUBLIC_SELLER_NAME),
  street: env(process.env.NEXT_PUBLIC_SELLER_STREET),
  postcode: env(process.env.NEXT_PUBLIC_SELLER_POSTCODE),
  city: env(process.env.NEXT_PUBLIC_SELLER_CITY),
  /** Where the seller is based and orders ship from — a fact, not a field. */
  country: 'Switzerland',
  countryCode: 'CH',
  /** Swiss enterprise identification number (UID), when there is one. */
  uid: env(process.env.NEXT_PUBLIC_SELLER_UID),
  responsiblePerson: env(process.env.NEXT_PUBLIC_SELLER_RESPONSIBLE),
  email: SUPPORT_EMAIL,
  phone: SUPPORT_PHONE,
  phoneHours: SUPPORT_PHONE_HOURS,
  telegram: TELEGRAM_ADMIN,
  telegramUrl: `https://t.me/${TELEGRAM_ADMIN.replace('@', '')}`,
  /** The carrier every order ships with (lib/fulfilment.ts). */
  carrier: 'Swiss Post',
  social: {
    instagram: profileUrl(process.env.NEXT_PUBLIC_INSTAGRAM_URL),
    tiktok: profileUrl(process.env.NEXT_PUBLIC_TIKTOK_URL),
  },
} as const

/** True when a full postal address has been configured. */
export function hasPostalAddress(): boolean {
  return Boolean(BUSINESS.street && BUSINESS.postcode && BUSINESS.city)
}

/**
 * What the owner still has to provide before the Imprint is complete. Swiss
 * law (UWG art. 3(1)(s)) requires an online seller's identity and address;
 * the console shows this list until it is empty.
 */
export function missingBusinessFields(): string[] {
  const missing: string[] = []
  if (!BUSINESS.legalName) missing.push('NEXT_PUBLIC_SELLER_NAME')
  if (!BUSINESS.street) missing.push('NEXT_PUBLIC_SELLER_STREET')
  if (!BUSINESS.postcode) missing.push('NEXT_PUBLIC_SELLER_POSTCODE')
  if (!BUSINESS.city) missing.push('NEXT_PUBLIC_SELLER_CITY')
  if (!BUSINESS.responsiblePerson) missing.push('NEXT_PUBLIC_SELLER_RESPONSIBLE')
  return missing
}
