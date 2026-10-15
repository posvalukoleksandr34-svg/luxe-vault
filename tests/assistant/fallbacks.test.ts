// When the concierge answers with a template instead of the model, and when
// it must not. Each case here once turned a good model answer — or a
// question that never reached the model — into a prepared help-centre reply.
import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { answer, assistantStatus, isAssistantConfigured, DEFAULT_MODEL, FALLBACK_MODEL, LIMITS, fallbackModelName, modelName } from '@/lib/server/assistant/chat'
import { CATALOG, SHIPPING, say, scripted } from './fixtures'
import type { AnswerDeps, Generate } from '@/lib/server/assistant/chat'
import type { StorefrontLocale } from '@/lib/types'

let logged: string[] = []
const original = { info: console.info, warn: console.warn }
const env = { key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL, off: process.env.SUPPORT_ASSISTANT_AI, fb: process.env.GEMINI_FALLBACK_MODEL }
beforeEach(() => {
  logged = []
  console.info = (...a: unknown[]) => void logged.push(a.map(String).join(' '))
  console.warn = (...a: unknown[]) => void logged.push(a.map(String).join(' '))
})
afterEach(() => {
  console.info = original.info
  console.warn = original.warn
  for (const [k, v] of [['GEMINI_API_KEY', env.key], ['GEMINI_MODEL', env.model], ['SUPPORT_ASSISTANT_AI', env.off], ['GEMINI_FALLBACK_MODEL', env.fb]] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

const turn = (generate: Generate, text: string, locale: StorefrontLocale = 'it', extra: Partial<AnswerDeps> = {}) =>
  answer(
    { locale, messages: [{ role: 'user', text }], credentials: [] },
    {
      generate,
      catalog: async () => CATALOG,
      shipping: async () => ({ ...SHIPPING, deliveryTimeframe: { ...SHIPPING.deliveryTimeframe } }),
      model: 'test-model',
      ...extra,
    },
  )
const event = () => JSON.parse(logged.find((l) => l.includes('"assistant_event"'))!)

describe('the answer language never turns a good answer into a template', () => {
  it('a short English question on an Italian page, answered in English, is shown — not rewritten, not replaced', async () => {
    // Four words or fewer cannot be classified with confidence, so the page
    // language (Italian) was "expected" — and an English answer to an English
    // question was rejected twice and replaced by the Italian help centre.
    const g = scripted(say('Yes, we have a black cashmere coat in sizes S to L, and it is in stock.'))
    const r = await turn(g, 'Any black coats?')
    assert.ok(r.ok, !r.ok ? r.reason : '')
    assert.equal(r.metrics.languageRetry, false)
    assert.equal(g.calls, 1)
  })
  it('an answer in the page language to a short question is shown', async () => {
    const r = await turn(scripted(say('Sì, abbiamo un cappotto nero in cashmere, ed è disponibile nelle taglie dalla S alla L.')), 'Any black coats?')
    assert.ok(r.ok)
  })
  it('a reply in a language the customer did not use is still rewritten', async () => {
    const g = scripted(
      say('Sí, tenemos un abrigo negro de cachemir y está disponible para usted, gracias por su pedido.'),
      say('Sì, abbiamo un cappotto nero in cashmere ed è disponibile per lei.'),
    )
    // Long and clear enough to be Italian for certain.
    const r = await turn(g, 'Vorrei sapere se il cappotto nero è disponibile, grazie')
    assert.ok(r.ok)
    assert.equal(r.metrics.languageRetry, true)
  })
})

describe('configuration never switches the concierge off by itself', () => {
  it('GEMINI_MODEL as other tools write it — "models/…", quoted, padded — is understood', () => {
    for (const [raw, want] of [
      ['models/gemini-3.8-flash', 'gemini-3.8-flash'],
      ['"gemini-3.6-flash"', 'gemini-3.6-flash'],
      ["  'gemini-3.6-flash'  ", 'gemini-3.6-flash'],
    ] as const) {
      process.env.GEMINI_MODEL = raw
      assert.equal(modelName(), want, raw)
    }
  })
  it('an unusable GEMINI_MODEL falls back to the default model, with a warning — it does not turn the AI off', () => {
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.GEMINI_MODEL = 'gemini 3.6 flash!'
    assert.equal(modelName(), DEFAULT_MODEL)
    assert.equal(isAssistantConfigured(), true)
    assert.ok(logged.some((l) => l.includes('GEMINI_MODEL') && !l.includes('test-key')))
  })
  it('the status says WHY the concierge is off, without any value', () => {
    delete process.env.GEMINI_API_KEY
    assert.deepEqual(assistantStatus(), { on: false, reason: 'no_key' })
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.SUPPORT_ASSISTANT_AI = 'off'
    assert.deepEqual(assistantStatus(), { on: false, reason: 'disabled' })
    delete process.env.SUPPORT_ASSISTANT_AI
    assert.deepEqual(assistantStatus(), { on: true })
  })
})

describe('a template answer always says why, in the log', () => {
  it('room for the model to think and still answer: thinking tokens count against the output cap', () => {
    // 3.x Flash spends part of maxOutputTokens on reasoning; at 700–1024 a
    // longer turn could stop with MAX_TOKENS and no text — and the turn was
    // replaced by a template.
    assert.ok(LIMITS.maxOutputTokens >= 4096, String(LIMITS.maxOutputTokens))
  })
  it('a cut-off or blocked reply logs its finish reason', async () => {
    await turn(scripted(say('', 'MAX_TOKENS')), 'Che cosa mi consiglia per una cena elegante?')
    const e = event()
    assert.equal(e.reason, 'invalid_response')
    assert.equal(e.finishReason, 'MAX_TOKENS')
  })
  it('a provider error logs its HTTP status (404: the model name; 400/403: the key) — never the message', async () => {
    await turn(async () => {
      throw Object.assign(new Error('models/gemini-x is not found for API version v1beta. key=AIza-secret'), { status: 404 })
    }, 'Ciao')
    const e = event()
    assert.equal(e.reason, 'provider_error')
    assert.equal(e.providerStatus, 404)
    assert.ok(!logged.find((l) => l.includes('"assistant_event"'))!.includes('AIza'))
  })
})

describe('an overloaded model hands the turn to the fallback model, not to a template', () => {
  // Production, 2026-10-15: every gemini-3.8-flash turn got 503 "This model is
  // currently experiencing high demand" or ran out of time.
  const overloaded = () => {
    let calls = 0
    const fn = (async () => {
      calls++
      throw Object.assign(new Error('This model is currently experiencing high demand.'), { status: 503 })
    }) as unknown as Generate & { calls: () => number }
    fn.calls = () => calls
    return fn
  }
  it('503 from the main model: the fallback answers, and keeps answering for the rest of the turn', async () => {
    const main = overloaded()
    const fallback = scripted(
      { text: '', calls: [{ id: 'c0', name: 'search_products', args: { query: 'cappotto' } }], finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: { name: 'search_products', args: { query: 'cappotto' } } }] } },
      say('Sì, abbiamo un cappotto in cashmere.'),
    )
    const r = await turn(main, 'Avete cappotti?', 'it', { fallback, fallbackModel: 'fallback-model' })
    assert.ok(r.ok, !r.ok ? r.reason : '')
    assert.equal(main.calls(), 1, 'the overloaded model is not asked again in the same turn')
    assert.equal(fallback.calls, 2)
    assert.equal(r.metrics.modelFallback, true)
    const e = event()
    assert.equal(e.model, 'fallback-model')
    assert.equal(e.providerStatus, 503)
  })
  it('a main model that does not answer in time: the fallback answers within the turn', async () => {
    const hang: Generate = (req) => new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    const r = await turn(hang, 'Avete cappotti?', 'it', { fallback: scripted(say('Sì, certo.')), fallbackModel: 'fallback-model', primaryCallMs: 50 })
    assert.ok(r.ok, !r.ok ? r.reason : '')
    assert.equal(r.metrics.modelFallback, true)
  })
  it('a key problem (400/403) is not an overload: no fallback, the error is reported', async () => {
    const fallback = scripted(say('never'))
    const r = await turn(async () => {
      throw Object.assign(new Error('API key not valid'), { status: 400 })
    }, 'Ciao', 'it', { fallback })
    assert.equal(!r.ok && r.reason, 'provider_error')
    assert.equal(fallback.calls, 0)
  })
  it('the fallback model: gemini-3.6-flash by default, configurable, never the main model itself', () => {
    delete process.env.GEMINI_FALLBACK_MODEL
    delete process.env.GEMINI_MODEL
    assert.equal(fallbackModelName(), FALLBACK_MODEL)
    process.env.GEMINI_FALLBACK_MODEL = 'models/gemini-x-flash'
    assert.equal(fallbackModelName(), 'gemini-x-flash')
    process.env.GEMINI_FALLBACK_MODEL = 'off'
    assert.equal(fallbackModelName(), null)
    delete process.env.GEMINI_FALLBACK_MODEL
    process.env.GEMINI_MODEL = FALLBACK_MODEL
    assert.equal(fallbackModelName(), null)
  })
})
