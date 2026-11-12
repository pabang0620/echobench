import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { crc32 } from 'node:zlib'
import { signDelivery, signedMessage, verifyDelivery } from '../server/lib/signature.js'
import { mockCertPem, mockKeyPem } from '../server/mockPaypal.js'
import { attackerCertPem } from '../server/scenarios/forge.js'

const body = Buffer.from(JSON.stringify({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' }))
const base = { transmissionId: 'tx-1', transmissionTime: '2026-11-12T00:00:00Z', webhookId: 'WH-MOCK-0001', body }

test('signed message is id|time|webhookId|crc32 of the raw bytes', () => {
  assert.equal(signedMessage(base), `tx-1|2026-11-12T00:00:00Z|WH-MOCK-0001|${crc32(body)}`)
})

test('a signature made with the PayPal stand-in key verifies with its certificate', () => {
  const signature = signDelivery({ ...base, privateKeyPem: mockKeyPem() })
  assert.equal(verifyDelivery({ ...base, certPem: mockCertPem(), signature }), true)
})

test('a changed body, a different webhook id or a foreign certificate does not verify', () => {
  const signature = signDelivery({ ...base, privateKeyPem: mockKeyPem() })
  assert.equal(verifyDelivery({ ...base, body: Buffer.from('{"id":"x"}'), certPem: mockCertPem(), signature }), false)
  assert.equal(verifyDelivery({ ...base, webhookId: 'WEBHOOK_ID', certPem: mockCertPem(), signature }), false)
  assert.equal(verifyDelivery({ ...base, certPem: attackerCertPem(), signature }), false)
})

test('the committed test keys are test material only', () => {
  assert.match(readFileSync(new URL('../fixtures/keys/paypal-mock.cert.pem', import.meta.url), 'utf8'), /BEGIN CERTIFICATE/)
})
