import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { CalculationError, calculateRefund, type CalcInput, type CalcOrder } from '@/lib/refunds/calculator'
import { allocate, formatMinor, scale, toMajor, toMinor } from '@/lib/refunds/money'
import { DEFAULT_POLICY } from '@/lib/refunds/policy'

describe('money: minor units', () => {
  it('converts francs exactly, including the floats that break naive maths', () => {
    assert.equal(toMinor(0.1), 10)
    assert.equal(toMinor(0.29), 29) // 0.29 * 100 = 28.999999999999996
    assert.equal(toMinor(249.9), 24990)
    assert.equal(toMinor('249.90'), 24990)
    assert.equal(toMinor(1.005 - 0.005), 100)
    assert.equal(toMinor(99999999.99), 9999999999)
    assert.equal(toMinor(0), 0)
  })

  it('refuses what is not money: negatives, a third decimal, NaN, text', () => {
    for (const bad of [-1, 1.234, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => toMinor(bad))
    for (const bad of ['', 'abc', '1.234', '-5', '1e3']) assert.throws(() => toMinor(bad))
  })

  it('round-trips and formats', () => {
    assert.equal(toMajor(24990), 249.9)
    assert.equal(formatMinor(123456), '1234.56 CHF')
    assert.equal(formatMinor(5, 'EUR'), '0.05 EUR')
    assert.throws(() => toMajor(1.5))
  })

  it('allocate() splits into integers that sum exactly, deterministically', () => {
    for (const [total, weights] of [
      [100, [1, 1, 1]],
      [2000, [30000, 30000, 9999]],
      [1, [5, 5]],
      [999_999, [3, 7, 11, 13]],
      [0, [4, 5]],
    ] as [number, number[]][]) {
      const parts = allocate(total, weights)
      assert.equal(parts.reduce((a, b) => a + b, 0), total)
      assert.deepEqual(allocate(total, weights), parts)
      for (const p of parts) assert.ok(Number.isSafeInteger(p) && p >= 0)
    }
    assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33])
    assert.deepEqual(allocate(10, [0, 0]), [0, 0])
  })

  it('scale() converts between currencies in integers, rounding half up', () => {
    // An order of CHF 100.00 charged EUR 106.37: a CHF 33.33 refund.
    assert.equal(scale(3333, 10637, 10000), 3545) // 35.4532 → 35.45
    assert.equal(scale(10000, 10637, 10000), 10637)
    assert.equal(scale(1, 1, 2), 1) // 0.5 rounds up
    assert.throws(() => scale(1, 1, 0))
  })
})

// Two coats at 300.00 and a scarf at 99.99; 20.00 discount; 15.00 shipping;
// no tax. Total 694.99.
const ORDER: CalcOrder = {
  subtotalMinor: 69999,
  discountMinor: 2000,
  shippingMinor: 1500,
  taxMinor: 0,
  totalMinor: 69499,
  lines: [
    { orderItemId: 'coat', qty: 2, unitPriceMinor: 30000 },
    { orderItemId: 'scarf', qty: 1, unitPriceMinor: 9999 },
  ],
}

const input = (over: Partial<CalcInput>): CalcInput => ({
  order: ORDER,
  claimType: 'changed_mind',
  selection: [{ orderItemId: 'coat', qty: 1 }],
  policy: DEFAULT_POLICY,
  claimedElsewhere: {},
  shippingAlreadyRefunded: false,
  committedMinor: 0,
  ...over,
})

describe('refund calculator', () => {
  it('a withdrawal of the whole order refunds everything, delivery included', () => {
    const r = calculateRefund(input({ selection: [{ orderItemId: 'coat', qty: 2 }, { orderItemId: 'scarf', qty: 1 }] }))
    assert.equal(r.includesShipping, true)
    assert.equal(r.totalMinor, ORDER.totalMinor)
    assert.equal(r.itemsMinor + r.shippingMinor, ORDER.totalMinor)
  })

  it('part of an order: its share of the discount comes off, delivery stays', () => {
    const r = calculateRefund(input({}))
    assert.equal(r.includesShipping, false)
    // The coat line carries 2 × 30000 / 69999 of the 2000 discount.
    const lineDiscount = allocate(2000, [60000, 9999])[0]
    assert.equal(r.lines[0].discountMinor, allocate(lineDiscount, [0, 1, 1])[1])
    assert.equal(r.totalMinor, 30000 - r.lines[0].discountMinor)
    assert.ok(r.warnings.includes('discount_shared_proportionally'))
  })

  it('claims on the same line, taken one after another, add up to the line exactly', () => {
    const first = calculateRefund(input({ selection: [{ orderItemId: 'coat', qty: 1 }] }))
    const second = calculateRefund(input({ selection: [{ orderItemId: 'coat', qty: 1 }], claimedElsewhere: { coat: 1 } }))
    const third = calculateRefund(input({
      selection: [{ orderItemId: 'scarf', qty: 1 }],
      claimedElsewhere: { coat: 2 },
    }))
    // The third covers the last unit, so the delivery charge comes back with it.
    assert.equal(third.includesShipping, true)
    assert.equal(first.totalMinor + second.totalMinor + third.totalMinor, ORDER.totalMinor)
  })

  it('tax is shared across goods and delivery, and comes back with them', () => {
    const taxed: CalcOrder = { ...ORDER, taxMinor: 5000, totalMinor: ORDER.totalMinor + 5000 }
    const all = calculateRefund(input({
      order: taxed,
      selection: [{ orderItemId: 'coat', qty: 2 }, { orderItemId: 'scarf', qty: 1 }],
    }))
    assert.equal(all.totalMinor, taxed.totalMinor)
    const part = calculateRefund(input({ order: taxed }))
    assert.ok(part.lines[0].taxMinor > 0 && part.lines[0].taxMinor < 5000)
  })

  it('never offers more than is still refundable on the order', () => {
    const r = calculateRefund(input({
      selection: [{ orderItemId: 'coat', qty: 2 }, { orderItemId: 'scarf', qty: 1 }],
      committedMinor: 60000,
    }))
    assert.equal(r.refundableBalanceMinor, 9499)
    assert.equal(r.totalMinor, 9499)
    assert.ok(r.warnings.includes('capped_to_refundable_balance'))
    const none = calculateRefund(input({ committedMinor: ORDER.totalMinor }))
    assert.equal(none.totalMinor, 0)
    assert.ok(none.warnings.includes('nothing_refundable'))
  })

  it('a seller-fault claim on part of an order: no delivery charge, return postage reimbursed', () => {
    const r = calculateRefund(input({ claimType: 'defective', returnPostageMinor: 1200 }))
    assert.equal(r.includesShipping, false)
    assert.equal(r.returnPostageMinor, 1200)
    assert.equal(r.totalMinor, r.itemsMinor + 1200)
  })

  it('return postage beyond what was paid is flagged, not refunded through the card', () => {
    const r = calculateRefund(input({
      claimType: 'defective',
      selection: [{ orderItemId: 'coat', qty: 2 }, { orderItemId: 'scarf', qty: 1 }],
      returnPostageMinor: 1200,
    }))
    assert.equal(r.totalMinor, ORDER.totalMinor)
    assert.ok(r.warnings.includes('postage_exceeds_balance'))
  })

  it('a loss-of-value deduction comes off, and never below zero', () => {
    const r = calculateRefund(input({ deductionMinor: 5000 }))
    assert.equal(r.totalMinor, r.itemsMinor - 5000)
    const over = calculateRefund(input({ deductionMinor: 10_000_000 }))
    assert.equal(over.totalMinor, 0)
    assert.ok(over.warnings.includes('deduction_exceeds_value'))
  })

  it('a cancellation before dispatch is a full refund; the delivery charge is never refunded twice', () => {
    const r = calculateRefund(input({
      claimType: 'cancel_before_dispatch',
      selection: [{ orderItemId: 'coat', qty: 2 }, { orderItemId: 'scarf', qty: 1 }],
    }))
    assert.equal(r.totalMinor, ORDER.totalMinor)
    const again = calculateRefund(input({
      selection: [{ orderItemId: 'scarf', qty: 1 }],
      claimedElsewhere: { coat: 2 },
      shippingAlreadyRefunded: true,
    }))
    assert.equal(again.includesShipping, false)
  })

  it('refuses a selection that is not in the order, empty, or beyond what is left', () => {
    assert.throws(() => calculateRefund(input({ selection: [] })), CalculationError)
    assert.throws(() => calculateRefund(input({ selection: [{ orderItemId: 'hat', qty: 1 }] })), /unknown_line/)
    assert.throws(() => calculateRefund(input({ selection: [{ orderItemId: 'coat', qty: 0 }] })), /invalid_quantity/)
    assert.throws(() => calculateRefund(input({ selection: [{ orderItemId: 'coat', qty: 1.5 }] })), /invalid_quantity/)
    assert.throws(() => calculateRefund(input({ selection: [{ orderItemId: 'coat', qty: 3 }] })), /exceeds_available/)
    assert.throws(
      () => calculateRefund(input({ selection: [{ orderItemId: 'coat', qty: 2 }], claimedElsewhere: { coat: 1 } })),
      /exceeds_available/,
    )
  })

  it('every amount is an integer of minor units', () => {
    const r = calculateRefund(input({ selection: [{ orderItemId: 'scarf', qty: 1 }] }))
    for (const v of [r.totalMinor, r.itemsMinor, r.shippingMinor, ...r.lines.map((l) => l.netMinor)]) {
      assert.ok(Number.isSafeInteger(v))
    }
  })
})
