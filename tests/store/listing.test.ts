import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { isPublished, publishBlockers, rightsProblem } from '@/lib/listing'
import type { Product } from '@/lib/types'

/** A product with everything a buyer needs. */
function complete(overrides: Partial<Product> = {}): Product {
  return {
    id: 'wool-coat',
    name: { ru: 'Пальто', en: 'Wool coat', it: '', fr: '', de: '' },
    description: { ru: 'Описание', en: 'A wool coat.', it: '', fr: '', de: '' },
    group: 'women',
    category: 'coats',
    price: 390,
    sizes: ['S', 'M', 'L'],
    colors: [{ name: 'Black', hex: '#000' }],
    image: '/coat.jpg',
    statuses: ['in_stock'],
    specs: [{ label: 'Composition', value: '100% wool' }],
    sizeChart: [{ size: 'S', length: 100, chest: 90, shoulder: 40, sleeve: 60 }],
    ...overrides,
  }
}

describe('publishBlockers', () => {
  it('a complete product has none', () => {
    assert.deepEqual(publishBlockers(complete()), [])
  })

  it('a product with no photo is not publishable', () => {
    assert.deepEqual(publishBlockers(complete({ image: '', images: [] })), ['image'])
  })

  it('a photo in the gallery is enough', () => {
    assert.deepEqual(publishBlockers(complete({ image: '', images: ['/a.jpg'] })), [])
  })

  it('a name only in Russian does not count: no visitor can read it', () => {
    const blockers = publishBlockers(complete({ name: { ru: 'Пальто', en: '', it: '', fr: '', de: '' } }))
    assert.ok(blockers.includes('name'))
  })

  it('a description only in Russian does not count either', () => {
    const blockers = publishBlockers(complete({ description: { ru: 'Описание', en: ' ', it: '', fr: '', de: '' } }))
    assert.ok(blockers.includes('description'))
  })

  it('a description in German alone is enough', () => {
    assert.deepEqual(publishBlockers(complete({ description: { ru: '', en: '', it: '', fr: '', de: 'Ein Mantel.' } })), [])
  })

  it('price 0, negative, or an implausible typo is refused', () => {
    for (const price of [0, -5, 25000, Number.NaN]) {
      assert.ok(publishBlockers(complete({ price })).includes('price'), `price ${price}`)
    }
  })

  it('sizes and colours are required', () => {
    const blockers = publishBlockers(complete({ sizes: [], colors: [] }))
    assert.ok(blockers.includes('sizes'))
    assert.ok(blockers.includes('colors'))
  })

  it('materials are required (at least one specification row)', () => {
    assert.ok(publishBlockers(complete({ specs: [] })).includes('specs'))
    assert.ok(publishBlockers(complete({ specs: [{ label: 'Composition', value: ' ' }] })).includes('specs'))
  })

  it('letter-sized clothing needs measurements; shoes and one-size items do not', () => {
    assert.ok(publishBlockers(complete({ sizeChart: [] })).includes('sizeChart'))
    assert.deepEqual(publishBlockers(complete({ sizes: ['40', '41'], sizeChart: [] })), [])
    assert.deepEqual(publishBlockers(complete({ sizes: ['One Size'], sizeChart: undefined })), [])
  })
})

describe('rightsProblem', () => {
  const ok = { basis: 'own_design', reference: 'Design file DS-12', confirmed: true }

  it('a basis, a reference and the confirmation are accepted', () => {
    assert.equal(rightsProblem(ok), null)
  })

  it('there is no "replica" basis', () => {
    assert.ok(rightsProblem({ ...ok, basis: 'replica' }))
  })

  it('a missing or blank reference is refused', () => {
    assert.ok(rightsProblem({ ...ok, reference: '' }))
    assert.ok(rightsProblem({ ...ok, reference: '  a ' }))
  })

  it('an overlong reference is refused', () => {
    assert.ok(rightsProblem({ ...ok, reference: 'x'.repeat(501) }))
  })

  it('the confirmation must be an explicit true', () => {
    assert.ok(rightsProblem({ ...ok, confirmed: false }))
    assert.ok(rightsProblem({ ...ok, confirmed: 'true' }))
  })
})

describe('isPublished', () => {
  it('only a published listing is public', () => {
    assert.equal(isPublished({ listing: { status: 'published' } }), true)
    assert.equal(isPublished({ listing: { status: 'draft' } }), false)
    assert.equal(isPublished({ listing: { status: 'withdrawn' } }), false)
    assert.equal(isPublished({}), false)
  })
})
