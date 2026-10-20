import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { CASE_COPY, CUSTOMER_EVENTS } from '@/lib/refunds/customer-copy'
import { PERMISSIONS, can } from '@/lib/refunds/permissions'
import { COMMANDS, type CommandDef } from '@/lib/refunds/state-machine'
import { STAFF_ROLES, TERMINAL_STATES } from '@/lib/refunds/types'
import { csvCell, parseFilter } from '@/lib/server/refunds/admin-queries'
import type { LedgerRow } from '@/lib/server/refunds/ledger'
import type { RefundOrderFacts } from '@/lib/server/refunds/order-facts'
import { fromProviderMinor, mapStripeStatus, toProviderMinor, unexplainedStripeRefunds } from '@/lib/server/refunds/payments'
import { hashPassphrase, passphraseProblem, verifyPassphrase } from '@/lib/server/staff-password'

const order = (over: Partial<RefundOrderFacts> = {}): RefundOrderFacts => ({
  id: 'o',
  number: 'LV-T',
  customerName: 'T',
  status: 'delivered',
  paymentStatus: 'paid',
  paymentProvider: 'stripe',
  paymentId: 'pi_t',
  createdAt: 0,
  subtotalMinor: 69999,
  discountMinor: 2000,
  shippingMinor: 1500,
  taxMinor: 0,
  totalMinor: 69499,
  refundedMinor: 0,
  committedMinor: 0,
  promisedMinor: 0,
  inFlight: false,
  shippingAlreadyRefunded: false,
  lines: [],
  ...over,
})

const row = (over: Partial<LedgerRow>): LedgerRow => ({
  id: 'x',
  orderId: 'o',
  provider: 'stripe',
  idempotencyKey: 'k',
  amountMinor: 0,
  currency: 'CHF',
  status: 'succeeded',
  source: 'case',
  attempts: 1,
  createdAt: 0,
  ...over,
})

describe('staff passphrases', () => {
  it('are stored as scrypt and verify only with the right passphrase', async () => {
    const hash = await hashPassphrase('correct horse battery staple')
    assert.match(hash, /^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/)
    assert.equal(hash.includes('horse'), false)
    assert.equal(await verifyPassphrase('correct horse battery staple', hash), true)
    assert.equal(await verifyPassphrase('correct horse battery stapl', hash), false)
    assert.notEqual(await hashPassphrase('correct horse battery staple'), hash, 'salted')
  })
  it('a malformed stored hash is a no, never an error', async () => {
    for (const bad of ['', 'plain', 'scrypt$1$2$3', 'scrypt$x$8$1$AAAA$BBBB', 'bcrypt$...']) {
      assert.equal(await verifyPassphrase('anything at all', bad), false)
    }
  })
  it('length is the rule', () => {
    assert.equal(passphraseProblem('short'), 'too_short')
    assert.equal(passphraseProblem('twelve chars'), null)
    assert.equal(passphraseProblem('x'.repeat(201)), 'too_long')
  })
})

describe('refunds in the currency the card was charged in', () => {
  const eur = order({ paymentCurrency: 'EUR', paymentAmount: 740 })
  it('CHF is passed through unchanged', () => {
    assert.equal(toProviderMinor(order(), 29143), 29143)
    assert.equal(fromProviderMinor(order(), 29143), 29143)
  })
  it('a EUR charge converts at the rate it was MADE at, in integers', () => {
    assert.equal(toProviderMinor(eur, 69499), 74000)
    assert.equal(toProviderMinor(eur, 29143), Math.round((29143 * 74000) / 69499))
    assert.equal(fromProviderMinor(eur, 74000), 69499)
  })
  it('Stripe statuses map to the ledger, unknown ones to "unknown"', () => {
    assert.equal(mapStripeStatus('succeeded'), 'succeeded')
    assert.equal(mapStripeStatus('requires_action'), 'requires_action')
    assert.equal(mapStripeStatus('canceled'), 'canceled')
    assert.equal(mapStripeStatus('something_new'), 'unknown')
    assert.equal(mapStripeStatus(null), 'unknown')
  })
  it('a refund made in the dashboard shows up as unexplained; recorded ones do not', () => {
    const ledger = [row({ amountMinor: 10000, providerAmountMinor: 10000 }), row({ amountMinor: 500, status: 'failed' })]
    assert.deepEqual(unexplainedStripeRefunds(order(), ledger, 10000), { unexplained: 0, tolerance: 0 })
    assert.equal(unexplainedStripeRefunds(order(), ledger, 15000).unexplained, 5000)
    // Manual payouts never went through Stripe.
    assert.equal(unexplainedStripeRefunds(order(), [row({ provider: 'manual', amountMinor: 3000 })], 0).unexplained, 0)
    // A converted charge tolerates rounding.
    assert.ok(unexplainedStripeRefunds(eur, [row({ amountMinor: 29143 })], toProviderMinor(eur, 29143) + 1).unexplained <= 2)
  })
})

describe('CSV export', () => {
  it('neutralises spreadsheet formulas and quotes everything', () => {
    assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`)
    assert.equal(csvCell('+41 79'), `"'+41 79"`)
    assert.equal(csvCell('-5'), `"'-5"`)
    assert.equal(csvCell('@SUM(A1)'), `"'@SUM(A1)"`)
    assert.equal(csvCell('Anna'), '"Anna"')
    assert.equal(csvCell(undefined), '""')
  })
})

describe('console filters', () => {
  it('only known values reach a query; paging is clamped', () => {
    const f = parseFilter(new URLSearchParams('state=refunded,hacked&claim=x,defective&risk=high&page=-3&pageSize=5000&q=%20RC-ABC%20&sort=drop'), null)
    assert.deepEqual(f.states, ['refunded'])
    assert.deepEqual(f.claimTypes, ['defective'])
    assert.deepEqual(f.risk, ['high'])
    assert.equal(f.page, 1)
    assert.equal(f.pageSize, 100)
    assert.equal(f.q, 'RC-ABC')
    assert.equal(f.sort, 'newest')
    assert.equal(parseFilter(new URLSearchParams('assigned=me'), null).assigned, 'none')
    assert.equal(parseFilter(new URLSearchParams("assigned=1' or 1=1"), 'x').assigned, undefined)
  })
})

describe('customer copy', () => {
  it('every event is written in every language, with the case number in the title', () => {
    for (const [locale, copy] of Object.entries(CASE_COPY)) {
      for (const event of CUSTOMER_EVENTS) {
        const line = copy.events[event]
        assert.ok(line, `${locale}.${event}`)
        assert.ok(line.title('RC-TEST1234').includes('RC-TEST1234'), `${locale}.${event} title`)
        assert.ok(line.body.length > 10, `${locale}.${event} body`)
      }
    }
  })
})

describe('state machine and roles', () => {
  const entries = Object.entries(COMMANDS) as [string, CommandDef][]
  it('a customer can never move money, decide, or touch stock', () => {
    for (const [name, def] of entries) {
      if (!def.actors.includes('customer')) continue
      assert.equal(def.payment, false, name)
      assert.equal(def.inventory, false, name)
      assert.ok(!['approved', 'refunded', 'partially_refunded', 'refund_processing', 'resolved'].includes(String(def.to)), name)
    }
  })
  it('every staff command needs a permission', () => {
    for (const [name, def] of entries) {
      if (def.actors.includes('staff') && name !== 'settle') assert.ok(def.permission, name)
    }
  })
  it('money moves only with refund.execute', () => {
    for (const [name, def] of entries) {
      if (def.payment && def.actors.includes('staff') && def.permission) assert.equal(def.permission, 'refund.execute', name)
    }
  })
  it('a closed case accepts only notes, findings, evidence, stock and reopening', () => {
    const allowed = new Set(['add_note', 'record_finding', 'record_evidence', 'reopen', 'appeal', 'restock', 'record_inspection', 'settle'])
    for (const state of TERMINAL_STATES) {
      for (const [name, def] of entries) if (def.from.includes(state)) assert.ok(allowed.has(name), `${name} from ${state}`)
    }
  })
  it('roles nest: viewer ⊂ agent ⊂ manager ⊂ owner, and only managers and owners decide or pay', () => {
    const order = [...STAFF_ROLES].reverse() // viewer, agent, manager, owner
    for (let i = 1; i < order.length; i++) {
      for (const p of PERMISSIONS) if (can(order[i - 1], p)) assert.ok(can(order[i], p), `${order[i]} lacks ${p}`)
    }
    for (const p of ['case.decide', 'refund.execute', 'refund.second_approve'] as const) {
      assert.equal(can('agent', p), false)
      assert.equal(can('viewer', p), false)
      assert.equal(can('manager', p), true)
    }
    assert.equal(can('manager', 'policy.manage'), false)
    assert.equal(can('manager', 'staff.manage'), false)
  })
})
