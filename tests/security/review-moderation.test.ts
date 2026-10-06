import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { moderateReview, type ModerationFlag } from '@/lib/server/review-moderation'

const flags = (rating: number, comment?: string): ModerationFlag[] => moderateReview({ rating, comment }).flags
const approved = (rating: number, comment?: string) => moderateReview({ rating, comment }).decision === 'approve'

describe('review moderation: published at once', () => {
  const genuine = [
    'Lovely coat, true to size. The wool feels soft and the stitching is neat.',
    'Arrived in 4 days, well packed. Would buy again!',
    'Cappotto bellissimo, taglia perfetta. Spedizione veloce, consigliato!',
    'Perfettooooo!! 😍',
    'Très belle veste, conforme aux photos. Livraison rapide.',
    'Toller Schnitt, schnell geliefert. Die Herbstschuhe passen perfekt.',
    'Sehr schöner Mantel, Strümpfe auch top.',
    'Отличное пальто, размер подошёл.',
    'Ok',
    '👍👍',
    'Ordered on 05.10.2026, arrived 12.10.2026. Great.',
    'Saw it on Instagram and the cocktail dress is even nicer in person. Dickens would approve.',
    'Excellent quality, rhythm of the knit is regular. Strength of the seams is good.',
    '这件大衣非常好',
  ]
  for (const text of genuine) {
    it(`5★ "${text.slice(0, 40)}"`, () => assert.deepEqual(flags(5, text), []))
  }
  it('a rating with no text', () => {
    assert.equal(approved(5), true)
    assert.equal(approved(4, '   '), true)
  })
})

describe('review moderation: held for a person', () => {
  it('1–3 stars, however polite', () => {
    for (const r of [1, 2, 3]) assert.deepEqual(flags(r, 'Nice coat but the parcel took three weeks.'), ['low_rating'])
    assert.deepEqual(flags(3), ['low_rating'])
  })

  it('profanity in every language, disguised or not', () => {
    for (const text of [
      'This is fucking great',
      'what a piece of shit',
      'F.U.C.K this shop',
      'f u c k',
      'sh1t quality',
      'fuuuuuck yes',
      'Che cazzo di cappotto',
      'una merda',
      'Vaffanculo',
      'Quelle merde',
      'putain de veste',
      'So eine Scheiße',
      'Arschlöcher',
      'это пиздец',
      'хуйня полная',
      'блядь',
    ]) {
      assert.ok(flags(5, text).includes('profanity'), text)
      assert.equal(approved(5, text), false, text)
    }
  })

  it('links, emails, phone numbers and handles', () => {
    for (const text of [
      'Great! Visit https://cheap-bags.example for more',
      'better prices at www.replicas.xyz',
      'go to bestreplica.shop now',
      'write me: seller99@mail.com',
      'Call +41 79 123 45 67',
      'whatsapp 0791234567',
      'follow @bagdeals_official',
      'join t.me/replicas',
    ]) {
      assert.ok(flags(5, text).includes('contact_or_link'), text)
    }
  })

  it('spam vocabulary', () => {
    for (const text of ['Best online casino bonus', 'cheap viagra', 'Make money from home', 'Clicca qui per vincere']) {
      assert.ok(flags(5, text).includes('spam'), text)
    }
  })

  it('gibberish', () => {
    for (const text of [
      'asdfghjkl',
      'qwertyuiop',
      'aaaaaaaaaaaaaa',
      'good good good good good',
      'xkcd prtsk mnbvg',
      'hjkdfh sdfgsdfg',
      '.......!!!!!!!',
      'zzzzzzzzzzzzzzzz',
    ]) {
      assert.ok(flags(5, text).includes('gibberish'), text)
    }
  })

  it('reasons add up', () => {
    assert.deepEqual(flags(1, 'shit, see www.other-shop.com'), ['low_rating', 'profanity', 'contact_or_link'])
  })
})
