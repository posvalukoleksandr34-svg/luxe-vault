import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { amountsIn, checkReply, collectEvidence, detectLanguage, expectedLanguage, redactPersonalData, REPLY_MAX_CHARS, type Evidence } from '@/lib/server/assistant/guard'
import { SITE_ORIGIN } from '@/lib/site-origin'

const evidence = (over: Partial<Evidence> = {}): Evidence => ({
  catalogIds: new Set(['cappotto-cashmere', 'borsa-tote']),
  toolUrls: new Set(),
  amounts: new Set(),
  ...over,
})

describe('personal data is taken out before the model provider sees it', () => {
  it('card numbers (Luhn-valid only), IBANs, e-mail addresses and phone numbers', () => {
    const out = redactPersonalData(
      'Card 4111 1111 1111 1111, IBAN CH93 0076 2011 6238 5295 7, write to anna.muster@example.com or call +41 79 123 45 67.',
    )
    for (const leaked of ['4111', 'CH93', 'anna.muster', '79 123']) assert.ok(!out.includes(leaked), `${leaked} in ${out}`)
    assert.match(out, /\[card number removed\]/)
    assert.match(out, /\[IBAN removed\]/)
    assert.match(out, /\[email removed\]/)
    assert.match(out, /\[phone removed\]/)
  })
  it('order numbers, prices, sizes and dates stay — they are what the answer needs', () => {
    const text = 'Order LV-AAA111 placed on 2026-10-01 for CHF 1’290, size 42, ordered 3 days ago.'
    assert.equal(redactPersonalData(text), text)
    // A 16-digit number that fails the Luhn check is not a card number, and a
    // tracking number is not a phone number.
    assert.equal(redactPersonalData('Reference 1234 5678 9012 3456'), 'Reference 1234 5678 9012 3456')
    assert.equal(redactPersonalData('Tracking 99.00.123456.78901234'), 'Tracking 99.00.123456.78901234')
  })
  it('phone numbers in the forms customers write them', () => {
    for (const phone of ['+41 79 123 45 67', '079 123 45 67', '0041 79 123 45 67', '+41 (0)79 123 45 67', '+33 6 12 34 56 78', '+49 151 23456789']) {
      assert.equal(redactPersonalData(`call me on ${phone} please`), 'call me on [phone removed] please', phone)
    }
  })
})

describe('language of a reply', () => {
  it('recognises each of the four languages, and Spanish as not one of them', () => {
    assert.equal(detectLanguage('Where is my order? I would like to know when it will arrive.'), 'en')
    assert.equal(detectLanguage('Dove è il mio ordine? Vorrei sapere quando arriva, grazie.'), 'it')
    assert.equal(detectLanguage('Où est ma commande ? Je voudrais savoir quand elle arrive, merci.'), 'fr')
    assert.equal(detectLanguage('Wo ist meine Bestellung? Ich möchte wissen, wann sie ankommt, danke.'), 'de')
    assert.equal(detectLanguage('¿Dónde está mi pedido? Quiero saber cuándo llega, gracias.'), 'es')
  })
  it('short or mixed text decides nothing', () => {
    assert.equal(detectLanguage('LV-AAA111?'), null)
    assert.equal(detectLanguage('Cappotto cashmere nero'), null)
  })
  it('the answer language: the customer’s when clear and supported, otherwise the page’s', () => {
    assert.equal(expectedLanguage('Wo ist meine Bestellung? Ich warte seit Tagen, danke.', 'it'), 'de')
    assert.equal(expectedLanguage('¿Dónde está mi pedido? Quiero saber cuándo llega, gracias.', 'fr'), 'fr')
    assert.equal(expectedLanguage('LV-AAA111', 'it'), 'it')
  })
})

describe('CHF amounts', () => {
  it('Swiss, English and continental spellings, decimals and the Swiss .–', () => {
    assert.deepEqual(amountsIn('CHF 1’290 or CHF 1,290.00 or 1.290,00 CHF or CHF 14.90 or CHF 14.9 or CHF 300.– or 1 290 CHF'), [
      '1290.00',
      '1290.00',
      '1290.00',
      '14.90',
      '14.90',
      '300.00',
      '1290.00',
    ])
  })
  it('a following number is not part of the amount', () => {
    assert.deepEqual(amountsIn('Shipping is CHF 14.90 2 days after dispatch'), ['14.90'])
  })
  it('evidence collects every amount and URL a tool returned', () => {
    const into = { amounts: new Set<string>(), toolUrls: new Set<string>() }
    collectEvidence({ price: 'CHF 1’290', priceChf: 1290, tracking: { url: 'https://service.post.ch/track?n=99' } }, into)
    assert.deepEqual(Array.from(into.amounts), ['1290.00'])
    assert.deepEqual(Array.from(into.toolUrls), ['https://service.post.ch/track?n=99'])
  })
})

describe('reply check: links and products are grounded', () => {
  it('a real product link stays and becomes a card; an invented one is removed', () => {
    const r = checkReply(
      `The coat: ${SITE_ORIGIN}/it/product/cappotto-cashmere. Also ${SITE_ORIGIN}/product/invented-bag and ${SITE_ORIGIN}/product/borsa-tote.`,
      evidence(),
    )!
    assert.deepEqual(r.linkedProducts, ['cappotto-cashmere', 'borsa-tote'])
    assert.equal(r.removedLinks, 1)
    assert.ok(!r.text.includes('invented-bag'))
  })
  it('a bare shop path becomes a full link and is checked like any other', () => {
    const r = checkReply('See /it/product/cappotto-cashmere and /product/nope-nope.', evidence())!
    assert.ok(r.text.includes(`${SITE_ORIGIN}/it/product/cappotto-cashmere`))
    assert.ok(!r.text.includes('nope-nope'))
    assert.deepEqual(r.linkedProducts, ['cappotto-cashmere'])
  })
  it('external links: only those a tool returned (tracking) survive', () => {
    const tracking = 'https://service.post.ch/ekp-web/ui/entry/shipping/99.00.123456'
    const r = checkReply(`Track it at ${tracking}. Or pay at https://evil.example/pay now.`, evidence({ toolUrls: new Set([tracking]) }))!
    assert.ok(r.text.includes(tracking))
    assert.ok(!r.text.includes('evil.example'))
    assert.equal(r.removedLinks, 1)
  })
  it('the shop’s own non-product pages are kept', () => {
    const r = checkReply(`Our returns policy: ${SITE_ORIGIN}/legal/refunds`, evidence())!
    assert.equal(r.removedLinks, 0)
  })
  it('Markdown becomes plain text; a Markdown link keeps its text and its checked URL', () => {
    const r = checkReply(`**Yes.** ## Note\n* one\n[the coat](${SITE_ORIGIN}/product/cappotto-cashmere)`, evidence())!
    assert.ok(!r.text.includes('**'))
    assert.ok(!r.text.includes('['))
    assert.ok(r.text.includes(`the coat (${SITE_ORIGIN}/product/cappotto-cashmere)`))
  })
  it('amounts not in the evidence are counted', () => {
    const r = checkReply('It costs CHF 1’290, now CHF 990.', evidence({ amounts: new Set(['1290.00']) }))!
    assert.equal(r.unverifiedAmounts, 1)
  })
  it('the reply is bounded at a sentence end; empty → null', () => {
    const long = 'This is one sentence about the coat. '.repeat(80)
    const r = checkReply(long, evidence())!
    assert.ok(r.text.length <= REPLY_MAX_CHARS)
    assert.ok(r.text.endsWith('.'))
    assert.equal(checkReply('   ', evidence()), null)
    assert.equal(checkReply('https://evil.example/x', evidence()), null)
  })
})
