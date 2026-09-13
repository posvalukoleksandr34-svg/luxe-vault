import { CARD_PAYMENT_METHOD, CRYPTO_PAYMENT_METHOD } from '@/lib/data'

type LabelKey = 'checkout.methodCard' | 'checkout.methodCrypto'

/**
 * A payment method, labelled in the visitor's language.
 *
 * The method VALUES are Russian strings ('Карта онлайн', 'Криптовалюта') and
 * cannot simply be translated: they are what /api/orders validates against
 * and what every order row stores, and the crypto flow stores a longer form —
 * 'Криптовалюта — USDT (TRC-20)'. So the value stays a value, and this is the
 * only place it becomes words. Anything unrecognised is shown as stored.
 */
export function paymentMethodLabel(
  value: string | undefined,
  t: (key: LabelKey) => string,
): string {
  if (!value) return ''
  if (value === CARD_PAYMENT_METHOD) return t('checkout.methodCard')
  if (value.startsWith(CRYPTO_PAYMENT_METHOD)) {
    // Keep the network detail — " — USDT (TRC-20)" is a ticker, not Russian.
    return t('checkout.methodCrypto') + value.slice(CRYPTO_PAYMENT_METHOD.length)
  }
  return value
}
