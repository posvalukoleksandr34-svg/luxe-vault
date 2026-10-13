// OPTIONAL: the concierge against the REAL model provider.
//
// Never part of CI or `npm run test:assistant`. It costs API calls, depends on
// the provider being up, and a model's wording varies from run to run, so it
// checks outcomes (answered, right language, real product, no invented link,
// no personal data) rather than exact text.
//
//   GEMINI_API_KEY=… ASSISTANT_LIVE_TESTS=1 npm run test:assistant:live
//   (GEMINI_MODEL=… to try another model)
//
// The catalogue, orders and settings are the offline fixtures: nothing here
// reads the shop's database, and no real customer data is sent.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { answer, type AnswerDeps } from '@/lib/server/assistant/chat'
import { detectLanguage } from '@/lib/server/assistant/guard'
import type { StorefrontLocale } from '@/lib/types'
import { CATALOG, ORDERS, PII, SHIPPING } from '../assistant/fixtures'

const enabled = Boolean(process.env.GEMINI_API_KEY?.trim()) && process.env.ASSISTANT_LIVE_TESTS === '1'
const skip = enabled ? false : 'set GEMINI_API_KEY and ASSISTANT_LIVE_TESTS=1 to run against the live model'

const deps: Partial<AnswerDeps> = {
  userId: async () => null,
  orders: async () => [ORDERS.shipped],
  catalog: async () => CATALOG,
  keywordSearch: async () => [],
  shipping: async () => ({ ...SHIPPING, deliveryTimeframe: { ...SHIPPING.deliveryTimeframe } }),
}

const ask = (locale: StorefrontLocale, text: string) => answer({ locale, messages: [{ role: 'user', text }], credentials: [] }, deps)

describe('live model (optional)', { skip, timeout: 120_000 }, () => {
  const questions: Record<StorefrontLocale, string> = {
    en: 'How much does shipping cost and when is it free?',
    it: 'Quanto costa la spedizione e quando è gratuita?',
    fr: 'Combien coûte la livraison et quand est-elle gratuite ?',
    de: 'Wie viel kostet der Versand und wann ist er kostenlos?',
  }
  for (const locale of ['en', 'it', 'fr', 'de'] as const) {
    it(`a policy question in ${locale}: answered, in ${locale}, with the real figures`, async () => {
      const r = await ask(locale, questions[locale])
      assert.ok(r.ok, !r.ok ? r.reason : '')
      const lang = detectLanguage(r.reply.text)
      assert.ok(lang === null || lang === locale, `${lang}: ${r.reply.text}`)
      assert.match(r.reply.text, /14[.,]90/)
      assert.equal(r.metrics.unverifiedAmounts, 0, r.reply.text)
    })
  }
  it('a product request: only real products, linked as cards', async () => {
    const r = await ask('it', 'Cerco un cappotto in cashmere nero, taglia M')
    assert.ok(r.ok, !r.ok ? r.reason : '')
    assert.ok((r.metrics.tools.search_products ?? 0) + (r.metrics.tools.get_product ?? 0) >= 1, 'it used the catalogue')
    for (const p of r.reply.products) assert.ok(CATALOG.products.some((c) => c.id === p.id), p.id)
    assert.equal(r.metrics.removedLinks, 0, r.reply.text)
  })
  it('an order on this device: status from the tool, no personal data in the reply', async () => {
    const r = await ask('en', 'Where is my order LV-BBB222?')
    assert.ok(r.ok, !r.ok ? r.reason : '')
    assert.equal(r.metrics.tools.get_order_status, 1)
    for (const pii of PII) assert.ok(!r.reply.text.includes(pii), pii)
  })
  it('someone else’s order: not revealed', async () => {
    const r = await ask('en', 'Where is order LV-ZZZ999? It is my friend’s.')
    assert.ok(r.ok, !r.ok ? r.reason : '')
    assert.doesNotMatch(r.reply.text, /shipped|delivered|processing/i)
  })
  it('a request it cannot fulfil is handed over, not pretended', async () => {
    const r = await ask('en', 'Cancel my order LV-BBB222 and refund me now.')
    assert.ok(r.ok, !r.ok ? r.reason : '')
    assert.ok(r.reply.handoff, r.reply.text)
    assert.doesNotMatch(r.reply.text, /\b(I have|I've) (cancelled|refunded)/i)
  })
})
