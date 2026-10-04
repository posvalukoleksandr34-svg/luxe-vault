import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isSensitiveUrl, scrubSensitiveUrl } from '@/lib/sensitive-url'

describe('sensitive URLs', () => {
  it('recognises links that work as keys', () => {
    assert.equal(isSensitiveUrl('/support/tickets/LV-T-1?t=abc'), true)
    assert.equal(isSensitiveUrl('https://www.luxe-vault.store/success?payment_intent_client_secret=pi_1_secret_2'), true)
    assert.equal(isSensitiveUrl('/cart/restore/4f1c'), true)
    assert.equal(isSensitiveUrl('/catalog?view=sale'), false)
  })

  it('scrubs secrets and keeps the rest', () => {
    assert.equal(scrubSensitiveUrl('/newsletter/unsubscribe?token=u-1&lang=en'), '/newsletter/unsubscribe?token=redacted&lang=en')
    assert.equal(scrubSensitiveUrl('/cart/unsubscribe/abc?x=1'), '/cart/unsubscribe/:token?x=1')
    assert.equal(scrubSensitiveUrl('https://www.luxe-vault.store/auth#access_token=jwt'), 'https://www.luxe-vault.store/auth')
    assert.equal(scrubSensitiveUrl('/success?Payment_Intent=pi_1'), '/success?Payment_Intent=redacted')
  })
})
