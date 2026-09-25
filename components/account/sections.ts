// The account's sections, in one list: the header menu, the dashboard cards
// and the account page's section rail all read it, so a section cannot be
// added to one and forgotten in the others.
import type { UIKey } from '@/lib/i18n'

export type AccountSectionKey =
  | 'orders'
  | 'credits'
  | 'details'
  | 'settings'
  | 'referral'
  | 'app'
  | 'addresses'
  | 'looks'

export type AccountSection = {
  key: AccountSectionKey
  labelKey: UIKey
  /** In the header menu. */
  inMenu: boolean
  /** A card on the dashboard: its title and description. */
  card?: { titleKey: UIKey; descKey: UIKey }
}

/** In header-menu order. The dashboard shows the ones with a card, in
 *  `CARD_ORDER`. */
export const ACCOUNT_SECTIONS: AccountSection[] = [
  { key: 'orders', labelKey: 'acct.orders', inMenu: true, card: { titleKey: 'acct.orders', descKey: 'acct.ordersDesc' } },
  { key: 'credits', labelKey: 'acct.credits', inMenu: true },
  { key: 'details', labelKey: 'acct.details', inMenu: true, card: { titleKey: 'acct.details', descKey: 'acct.detailsDesc' } },
  { key: 'settings', labelKey: 'acct.settings', inMenu: true },
  { key: 'referral', labelKey: 'acct.referral', inMenu: true, card: { titleKey: 'acct.referral', descKey: 'acct.referralDesc' } },
  // The installed app's personal promo code (and, in a browser, how to get it).
  { key: 'app', labelKey: 'acct.appCode', inMenu: true },
  { key: 'addresses', labelKey: 'acct.addresses', inMenu: false, card: { titleKey: 'acct.addresses', descKey: 'acct.addressesDesc' } },
  // Saved capsules from the stylist. Not in the brief's menu, but an existing
  // part of the account — reachable from the section rail.
  { key: 'looks', labelKey: 'acct.savedLooks', inMenu: false },
]

/** Dashboard card order, as the brief lists them. */
export const CARD_ORDER: AccountSectionKey[] = ['orders', 'details', 'addresses', 'referral']

export function accountHref(key: AccountSectionKey): string {
  return `/account?section=${key}`
}

export function isAccountSection(value: string | null): value is AccountSectionKey {
  return ACCOUNT_SECTIONS.some((s) => s.key === value)
}
