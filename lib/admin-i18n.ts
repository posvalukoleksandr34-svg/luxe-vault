import { ADMIN_LOCALE, UI, translate, type UIKey } from './i18n'
import type { LocalizedText } from './types'

/**
 * The admin console's language, which is Russian and only Russian.
 *
 * The console used to read `t` and `localize` off the store, so switching the
 * storefront to Italian switched the console to Italian with it — one setting
 * driving two unrelated interfaces. These are the console's own bindings: same
 * dictionary, fixed to ADMIN_LOCALE, no connection to what a visitor chose.
 *
 * Plain functions rather than a hook, because there is nothing to react to.
 * The console's language cannot change at runtime — that is the point — so a
 * component calling `t('admin.orders')` is as stable as a string literal, and
 * these can be called from anywhere, including outside React.
 *
 * Admin components import them aliased to the names they already used:
 *
 *   import { adminT as t, adminLocalize as localize } from '@/lib/admin-i18n'
 *
 * so the console's call sites read the same as they always did while no longer
 * touching storefront state.
 */

/** A UI key in the console's language. */
export const adminT = (key: UIKey): string => translate(UI[key], ADMIN_LOCALE)

/** A UI key with `{placeholder}` substitution, in the console's language. */
export const adminTf = (key: UIKey, vars: Record<string, string | number>): string =>
  Object.entries(vars).reduce(
    (out, [name, value]) => out.split(`{${name}}`).join(String(value)),
    adminT(key),
  )

/** Catalogue text — a product name, a category label — in the console's
 *  language. Falls back exactly as `translate` does, so a product with no
 *  Russian name still shows its English one to the admin rather than a blank. */
export const adminLocalize = (text: LocalizedText | Partial<LocalizedText> | null | undefined): string =>
  translate(text, ADMIN_LOCALE)
