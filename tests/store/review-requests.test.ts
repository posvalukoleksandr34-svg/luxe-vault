import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_REVIEW_REQUEST_SETTINGS,
  backoffMs,
  classifySendFailure,
  decide,
  isSendableEmail,
  reviewRequestSettingsSchema,
  scheduledAtFor,
  settingsFrom,
  type RequestFacts,
  type ReviewRequestSettings,
} from '@/lib/review-requests'
import { ROLE_PERMISSIONS, can } from '@/lib/refunds/permissions'
import { reviewRequestEmail } from '@/lib/server/emails/review-request'
import { parseListFilter, testRecipients } from '@/lib/server/review-requests/admin'
import { isTokenShape, linkToken, tokenHash } from '@/lib/server/review-requests/tokens'
import { isSensitiveUrl, scrubSensitiveUrl } from '@/lib/sensitive-url'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const DELIVERED = Date.parse('2026-10-20T09:30:00Z')

const settings = (over: Partial<ReviewRequestSettings> = {}): ReviewRequestSettings => ({ ...DEFAULT_REVIEW_REQUEST_SETTINGS, ...over })

const facts = (over: Partial<RequestFacts> = {}): RequestFacts => ({
  orderStatus: 'delivered',
  paymentStatus: 'paid',
  fraudFlag: null,
  userId: 'u1',
  email: 'anna@example.com',
  deliveredAt: DELIVERED,
  suppressed: false,
  marketingConsent: true,
  unreviewedProducts: 2,
  lastSentToCustomerAt: null,
  ...over,
})

describe('review requests: when', () => {
  it('is 48 hours after the confirmed delivery by default, in UTC', () => {
    assert.equal(DEFAULT_REVIEW_REQUEST_SETTINGS.delayHours, 48)
    assert.equal(new Date(scheduledAtFor(DELIVERED, settings())).toISOString(), '2026-10-22T09:30:00.000Z')
  })

  it('follows a configured delay', () => {
    assert.equal(scheduledAtFor(DELIVERED, settings({ delayHours: 72 })) - DELIVERED, 72 * HOUR)
  })

  it('a corrected delivery date moves the schedule with it (computed only from delivered_at)', () => {
    const corrected = DELIVERED + 2 * DAY
    assert.equal(scheduledAtFor(corrected, settings()) - scheduledAtFor(DELIVERED, settings()), 2 * DAY)
  })

  it('backs off exponentially from 15 minutes, capped at 12 hours', () => {
    assert.deepEqual([1, 2, 3, 4].map(backoffMs), [15, 30, 60, 120].map((m) => m * 60_000))
    assert.equal(backoffMs(20), 12 * HOUR)
    assert.equal(backoffMs(0), 15 * 60_000, 'nonsense input still waits')
  })
})

describe('review requests: who and whether', () => {
  const now = DELIVERED + 49 * HOUR

  it('sends to an eligible, consenting account holder', () => {
    assert.deepEqual(decide(facts(), settings(), now), { action: 'send' })
  })

  it('does not ask about a cancelled, fully refunded or fraud-flagged order', () => {
    assert.deepEqual(decide(facts({ orderStatus: 'cancelled' }), settings(), now), { action: 'suppress', reason: 'order_cancelled' })
    assert.deepEqual(decide(facts({ orderStatus: 'refunded' }), settings(), now), { action: 'suppress', reason: 'order_refunded' })
    assert.deepEqual(decide(facts({ paymentStatus: 'refunded' }), settings(), now), { action: 'suppress', reason: 'order_refunded' })
    assert.deepEqual(decide(facts({ fraudFlag: 'early_fraud_warning' }), settings(), now), { action: 'suppress', reason: 'fraud_flag' })
  })

  it('does not send for an order that is no longer delivered (shipped / estimated dates never count)', () => {
    for (const s of ['shipped', 'confirmed', 'pending']) {
      assert.deepEqual(decide(facts({ orderStatus: s }), settings(), now), { action: 'suppress', reason: 'not_delivered' })
    }
  })

  it('is NOT selective: a partial refund still gets a request like everyone else', () => {
    assert.deepEqual(decide(facts({ paymentStatus: 'partially_refunded' }), settings(), now), { action: 'send' })
  })

  it('skips a guest order (reviews need an account) and an unusable address', () => {
    assert.deepEqual(decide(facts({ userId: null }), settings(), now), { action: 'suppress', reason: 'guest_order' })
    for (const email of [null, '', 'no-at-sign', 'a@b', 'x@example.com\r\nBcc: victim@example.com', 'a@example.com, b@example.com', '"x"<a@example.com>']) {
      assert.deepEqual(decide(facts({ email }), settings(), now), { action: 'suppress', reason: 'no_valid_email' }, String(email))
    }
  })

  it('honours an unsubscribe, and the consent mode', () => {
    assert.deepEqual(decide(facts({ suppressed: true }), settings(), now), { action: 'suppress', reason: 'unsubscribed' })
    assert.deepEqual(decide(facts({ marketingConsent: false }), settings(), now), { action: 'suppress', reason: 'no_marketing_consent' })
    assert.deepEqual(decide(facts({ marketingConsent: false }), settings({ consentMode: 'existing_customer' }), now), { action: 'send' })
    // An unsubscribe wins even in the broader mode.
    assert.deepEqual(decide(facts({ suppressed: true }), settings({ consentMode: 'existing_customer' }), now), { action: 'suppress', reason: 'unsubscribed' })
  })

  it('does not ask for a review the customer has already written for every item', () => {
    assert.deepEqual(decide(facts({ unreviewedProducts: 0 }), settings(), now), { action: 'suppress', reason: 'already_reviewed' })
  })

  it('never sends a stale request after downtime or a long pause', () => {
    assert.deepEqual(decide(facts(), settings({ staleAfterDays: 30 }), DELIVERED + 30 * DAY), { action: 'suppress', reason: 'stale' })
    assert.deepEqual(decide(facts(), settings({ staleAfterDays: 30 }), DELIVERED + 29 * DAY), { action: 'send' })
  })

  it('defers, not drops, within the per-customer cooldown — unless that would make it stale', () => {
    const lastSent = now - 2 * DAY
    assert.deepEqual(decide(facts({ lastSentToCustomerAt: lastSent }), settings({ cooldownDays: 7 }), now), { action: 'defer', until: lastSent + 7 * DAY })
    assert.deepEqual(decide(facts({ lastSentToCustomerAt: lastSent }), settings({ cooldownDays: 0 }), now), { action: 'send' })
    assert.deepEqual(
      decide(facts({ lastSentToCustomerAt: now - DAY }), settings({ cooldownDays: 30, staleAfterDays: 10 }), now),
      { action: 'suppress', reason: 'stale' },
    )
  })

  it('checks the order before the customer (a cancelled order is reported as cancelled, not as unsubscribed)', () => {
    assert.deepEqual(decide(facts({ orderStatus: 'cancelled', suppressed: true, userId: null }), settings(), now), { action: 'suppress', reason: 'order_cancelled' })
  })
})

describe('review requests: send failures', () => {
  it('retries what can recover and stops on what cannot', () => {
    assert.equal(classifySendFailure({ reason: 'network', message: 'reset' }), 'retry')
    assert.equal(classifySendFailure({ reason: 'not_configured', message: '' }), 'retry')
    for (const status of [429, 500, 502, 503, 401, 403]) assert.equal(classifySendFailure({ reason: 'rejected', status, message: '' }), 'retry', String(status))
    for (const status of [400, 404, 409, 422]) assert.equal(classifySendFailure({ reason: 'rejected', status, message: '' }), 'permanent', String(status))
  })
})

describe('review requests: settings', () => {
  it('starts switched off with the documented defaults', () => {
    assert.deepEqual(settingsFrom(null), DEFAULT_REVIEW_REQUEST_SETTINGS)
    assert.equal(DEFAULT_REVIEW_REQUEST_SETTINGS.enabled, false)
    assert.equal(DEFAULT_REVIEW_REQUEST_SETTINGS.consentMode, 'marketing_consent')
  })

  it('refuses out-of-range and inconsistent values on the server', () => {
    const bad: unknown[] = [
      { ...DEFAULT_REVIEW_REQUEST_SETTINGS, delayHours: 0 },
      { ...DEFAULT_REVIEW_REQUEST_SETTINGS, delayHours: 1.5 },
      { ...DEFAULT_REVIEW_REQUEST_SETTINGS, maxAttempts: 100 },
      { ...DEFAULT_REVIEW_REQUEST_SETTINGS, consentMode: 'everyone' },
      { ...DEFAULT_REVIEW_REQUEST_SETTINGS, enabled: 'yes' },
      { ...DEFAULT_REVIEW_REQUEST_SETTINGS, delayHours: 720, staleAfterDays: 30 }, // stale before it is due
      null,
    ]
    for (const b of bad) assert.equal(reviewRequestSettingsSchema.safeParse(b).success, false, JSON.stringify(b))
    assert.equal(reviewRequestSettingsSchema.safeParse({ ...DEFAULT_REVIEW_REQUEST_SETTINGS, enabled: true, delayHours: 72 }).success, true)
  })

  it('a corrupted stored value falls back to the safe defaults (off)', () => {
    assert.deepEqual(settingsFrom({ delayHours: -5, enabled: true }), DEFAULT_REVIEW_REQUEST_SETTINGS)
    assert.deepEqual(settingsFrom({ delayHours: 24 }), { ...DEFAULT_REVIEW_REQUEST_SETTINGS, delayHours: 24 })
  })
})

describe('review requests: the link token', () => {
  const env = process.env
  it('is 256 bits of HMAC, base64url, deterministic per (request, nonce), different per nonce', () => {
    process.env = { ...env, REVIEW_LINK_SECRET: 'test-secret' }
    try {
      const a = linkToken('req-1', 'n1')
      assert.ok(a && isTokenShape(a))
      assert.equal(linkToken('req-1', 'n1'), a, 'a crash-retry rebuilds the same link')
      assert.notEqual(linkToken('req-1', 'n2'), a, 'a manual retry (new nonce) gives a new link')
      assert.notEqual(linkToken('req-2', 'n1'), a, 'another request, another link')
      process.env = { ...env, REVIEW_LINK_SECRET: 'other-secret' }
      assert.notEqual(linkToken('req-1', 'n1'), a, 'the key matters')
    } finally {
      process.env = env
    }
  })

  it('only its hash is stored, and the hash is not the token', () => {
    const h = tokenHash('A'.repeat(43))
    assert.match(h, /^[0-9a-f]{64}$/)
    assert.notEqual(h, 'A'.repeat(43))
  })

  it('anything not shaped like a token is not even looked up', () => {
    for (const v of ['', 'short', 'A'.repeat(44), `${'A'.repeat(42)}=`, `${'A'.repeat(42)}/`, "' or 1=1 --", null, 42]) {
      assert.equal(isTokenShape(v), false, String(v))
    }
  })

  it('without any key there is no link (never a link signed with nothing)', () => {
    process.env = { ...env, REVIEW_LINK_SECRET: '', SUPABASE_SERVICE_ROLE_KEY: '' }
    try {
      assert.equal(linkToken('req-1', 'n1'), null)
    } finally {
      process.env = env
    }
  })

  it('review links are treated as secrets in analytics and logs, in every language', () => {
    for (const u of ['/review/abc', '/it/review/abc', '/de/review/abc/unsubscribe']) {
      assert.equal(isSensitiveUrl(u), true, u)
    }
    assert.equal(scrubSensitiveUrl('/fr/review/SECRETTOKEN/unsubscribe'), '/fr/review/:token/unsubscribe')
    assert.equal(isSensitiveUrl('/reviews'), false)
  })
})

describe('review requests: the email', () => {
  const base = {
    lang: 'en' as const,
    firstName: 'Anna Maria',
    productNames: ['Cashmere coat', 'Silk scarf'],
    reviewUrl: 'https://shop.example/review/TOKEN',
    unsubscribeUrl: 'https://shop.example/review/TOKEN/unsubscribe',
  }

  it('has the button, the fallback link, the unsubscribe link and why it was sent', () => {
    const m = reviewRequestEmail(base)
    assert.equal(m.subject, 'How was your recent purchase?')
    assert.match(m.html, /Leave a review/)
    assert.equal(m.html.split('https://shop.example/review/TOKEN"').length - 1, 2, 'button and fallback link')
    assert.match(m.html, /review\/TOKEN\/unsubscribe/)
    assert.match(m.html, /because your order was delivered/)
    assert.match(m.text, /Leave a review: https:\/\/shop\.example\/review\/TOKEN/)
    assert.match(m.text, /review requests: https:\/\/shop\.example\/review\/TOKEN\/unsubscribe/)
    assert.match(m.html, /Hi Anna,/, 'first name only')
  })

  it('is honest: no incentive, no pressure, asks for good or bad', () => {
    const m = reviewRequestEmail(base)
    assert.match(m.text, /good or bad/)
    for (const word of [/discount/i, /coupon/i, /reward/i, /5 stars/i, /five stars/i, /hurry/i, /last chance/i, /%/]) {
      assert.doesNotMatch(m.text, word)
    }
  })

  it('carries no amounts, address or order number', () => {
    const m = reviewRequestEmail(base)
    assert.doesNotMatch(m.text, /CHF|LV-|Strasse|street/i)
  })

  it('escapes names from the order (no markup injection)', () => {
    const m = reviewRequestEmail({
      ...base,
      firstName: '<img src=x onerror=alert(1)>',
      productNames: ['<script>alert(1)</script>', 'Coat & "Co"'],
    })
    assert.doesNotMatch(m.html, /<script>alert/)
    assert.doesNotMatch(m.html, /<img src=x/)
    assert.match(m.html, /&lt;script&gt;/)
    assert.match(m.html, /Coat &amp; &quot;Co&quot;/)
  })

  it('shows at most three products, then "and N more"', () => {
    const m = reviewRequestEmail({ ...base, productNames: ['A', 'B', 'C', 'D', 'E'] })
    assert.match(m.text, /and 2 more/)
    assert.doesNotMatch(m.text, /- D/)
  })

  it('exists in every email language, falling back to a plain greeting without a name', () => {
    for (const lang of ['en', 'ru', 'it', 'fr', 'de'] as const) {
      const m = reviewRequestEmail({ ...base, lang, firstName: null })
      assert.ok(m.subject.length > 5, lang)
      assert.match(m.html, new RegExp(`lang="${lang}"`), lang)
    }
    assert.match(reviewRequestEmail({ ...base, lang: 'de', firstName: '' }).text, /^Hallo,/)
  })
})

describe('review requests: admin', () => {
  it('staff roles: everyone sees, managers act, only the owner changes settings', () => {
    for (const r of ['viewer', 'agent', 'manager', 'owner'] as const) assert.equal(can(r, 'review_requests.view'), true, r)
    assert.equal(can('viewer', 'review_requests.manage'), false)
    assert.equal(can('agent', 'review_requests.manage'), false)
    assert.equal(can('manager', 'review_requests.manage'), true)
    assert.equal(can('manager', 'review_requests.settings'), false)
    assert.equal(can('owner', 'review_requests.settings'), true)
    assert.ok(ROLE_PERMISSIONS.owner.includes('review_requests.manage'))
  })

  it('the list filter keeps only known values', () => {
    const f = parseListFilter(new URLSearchParams('status=sent,bogus,failed&q=LV-abc123&from=2026-10-01&to=not-a-date&page=-4&pageSize=5000'))
    assert.deepEqual(f.statuses, ['sent', 'failed'])
    assert.equal(f.q, 'LV-ABC123')
    assert.equal(f.from, '2026-10-01')
    assert.equal(f.to, undefined)
    assert.equal(f.page, 1)
    assert.equal(f.pageSize, 100)
    // PostgREST filter syntax cannot be smuggled through a search box.
    const g = parseListFilter(new URLSearchParams({ q: 'x%,status.eq.sent)', product: 'coat*(' }))
    assert.doesNotMatch(`${g.q}${g.product}`, /[%,()*]/)
    const e = parseListFilter(new URLSearchParams({ q: 'Anna%@Example.com' }))
    assert.equal(e.q, 'anna@example.com')
  })

  it('test emails go only to the shop’s own addresses', () => {
    const env = process.env
    process.env = { ...env, EMAIL_TEST_RECIPIENT: 'qa@shop.example', REVIEW_TEST_RECIPIENTS: 'Owner@Shop.example, not-an-address, x@y.z,evil@example.com\r\nBcc: a@b.c' }
    try {
      const list = testRecipients()
      assert.ok(list.includes('qa@shop.example'))
      assert.ok(list.includes('owner@shop.example'))
      assert.ok(!list.includes('not-an-address'))
      assert.ok(list.every((a) => !/[\r\n]/.test(a)))
    } finally {
      process.env = env
    }
  })

  it('sendable addresses are single, plain addresses', () => {
    assert.equal(isSendableEmail('anna@example.com'), true)
    assert.equal(isSendableEmail(' anna@example.com '), true)
    assert.equal(isSendableEmail('anna@example.com\nBcc: x@y.com'), false)
  })
})
