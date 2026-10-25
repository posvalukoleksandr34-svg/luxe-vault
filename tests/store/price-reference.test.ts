import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { referencePrice } from '@/lib/price-reference'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-25T12:00:00Z')
const ago = (days: number) => NOW - days * DAY

describe('referencePrice (the strike-through "was" price)', () => {
  it('no history: nothing to compare against', () => {
    assert.equal(referencePrice([], 100, NOW), undefined)
  })

  it('a price that never changed has no reference', () => {
    assert.equal(referencePrice([{ price: 100, validFrom: ago(90) }], 100, NOW), undefined)
  })

  it('a reduction after 40 days at the higher price: the higher price is the reference', () => {
    const h = [{ price: 150, validFrom: ago(50) }, { price: 100, validFrom: ago(10) }]
    assert.equal(referencePrice(h, 100, NOW), 150)
  })

  it('the LOWEST price of the 30 days before the reduction is the reference, not the highest', () => {
    const h = [
      { price: 200, validFrom: ago(80) },
      { price: 140, validFrom: ago(25) }, // a brief lower price inside the window
      { price: 180, validFrom: ago(20) },
      { price: 120, validFrom: ago(5) },
    ]
    assert.equal(referencePrice(h, 120, NOW), 140)
  })

  it('a history that does not cover the 30 days before the reduction proves nothing', () => {
    const h = [{ price: 150, validFrom: ago(20) }, { price: 100, validFrom: ago(5) }]
    assert.equal(referencePrice(h, 100, NOW), undefined)
  })

  it('a "reduction" from a price raised just before it does not count (lowest of the window)', () => {
    const h = [
      { price: 100, validFrom: ago(90) },
      { price: 200, validFrom: ago(12) }, // inflated right before
      { price: 120, validFrom: ago(2) },
    ]
    // The lowest price in the 30 days before ago(2) is 100, below 120: no discount to show.
    assert.equal(referencePrice(h, 120, NOW), undefined)
  })

  it('shown for at most half the time the higher price applied', () => {
    // Higher price known for 40 days before the cut at ago(30): allowed 20 days.
    const h = [{ price: 150, validFrom: ago(70) }, { price: 100, validFrom: ago(30) }]
    assert.equal(referencePrice(h, 100, NOW), undefined)
    assert.equal(referencePrice(h, 100, ago(15)), 150)
  })

  it('and never for more than 60 days', () => {
    const h = [{ price: 150, validFrom: ago(400) }, { price: 100, validFrom: ago(61) }]
    assert.equal(referencePrice(h, 100, NOW), undefined)
    const fresh = [{ price: 150, validFrom: ago(400) }, { price: 100, validFrom: ago(59) }]
    assert.equal(referencePrice(fresh, 100, NOW), 150)
  })

  it('a history out of step with the product price shows nothing', () => {
    const h = [{ price: 150, validFrom: ago(50) }, { price: 100, validFrom: ago(10) }]
    assert.equal(referencePrice(h, 90, NOW), undefined)
  })

  it('a price increase shows no reference', () => {
    const h = [{ price: 100, validFrom: ago(50) }, { price: 150, validFrom: ago(10) }]
    assert.equal(referencePrice(h, 150, NOW), undefined)
  })

  it('repeated rows at the current price do not restart the clock', () => {
    const h = [
      { price: 150, validFrom: ago(60) },
      { price: 100, validFrom: ago(20) },
      { price: 100, validFrom: ago(3) }, // e.g. re-saved with the same price
    ]
    assert.equal(referencePrice(h, 100, NOW), 150)
  })

  it('rows dated in the future are ignored', () => {
    const h = [{ price: 150, validFrom: ago(50) }, { price: 100, validFrom: ago(10) }, { price: 80, validFrom: NOW + DAY }]
    assert.equal(referencePrice(h, 100, NOW), 150)
  })
})
