import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { signDelivery } from '../lib/signature.js'

// Forged deliveries (scenario S6). These are attack simulations made with EchoBench's own
// test keys. They need the webhook id the target verifies against, which the developer who
// runs EchoBench knows. They do not imitate PayPal's real signing key.

const KEY_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'keys')
export const attackerCertPem = () => readFileSync(path.join(KEY_DIR, 'attacker.cert.pem'), 'utf8')
const attackerKeyPem = () => readFileSync(path.join(KEY_DIR, 'attacker.key.pem'), 'utf8')

const bodyOf = (delivery) => JSON.parse(Buffer.from(delivery.bodyBase64, 'base64').toString('utf8'))

function forgedRefundEvent(base, amount) {
  const event = bodyOf(base)
  return {
    ...event,
    id: `WH-FORGED-${randomUUID().slice(0, 8).toUpperCase()}`,
    resource: { ...event.resource, id: `FORGED${randomUUID().slice(0, 8).toUpperCase()}`, amount: { currency_code: 'USD', value: amount } },
  }
}

// (a) The body is changed after PayPal signed it; the original headers are kept.
export function tamperedBody(refundDelivery) {
  const body = Buffer.from(JSON.stringify(forgedRefundEvent(refundDelivery, '99.00')))
  return { label: 'body changed after signing', headers: { ...refundDelivery.headers }, body }
}

// (b) A simulator-style event: signed with the literal webhook id "WEBHOOK_ID" instead of the real one.
// Needs a signing key, which only the local PayPal stand-in exposes. On the sandbox, use simulate-event (VERIFY.md).
export function simulatorEvent(refundDelivery, { mockKeyPem }) {
  if (!mockKeyPem) return null
  const body = Buffer.from(JSON.stringify(forgedRefundEvent(refundDelivery, '5.00')))
  const transmissionId = randomUUID()
  const transmissionTime = new Date().toISOString()
  return {
    label: 'simulator event (webhook id "WEBHOOK_ID")',
    body,
    headers: {
      'content-type': 'application/json',
      'paypal-transmission-id': transmissionId,
      'paypal-transmission-time': transmissionTime,
      'paypal-cert-url': refundDelivery.headers['paypal-cert-url'],
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-auth-version': 'v2',
      'paypal-transmission-sig': signDelivery({ privateKeyPem: mockKeyPem, transmissionId, transmissionTime, webhookId: 'WEBHOOK_ID', body }),
    },
  }
}

// (c) Signed with the attacker's own key and a cert_url that points at the attacker's certificate.
// A handler that downloads whatever cert_url says would accept this.
export function foreignCertificate(refundDelivery, { webhookId, certUrl }) {
  const body = Buffer.from(JSON.stringify(forgedRefundEvent(refundDelivery, '75.00')))
  const transmissionId = randomUUID()
  const transmissionTime = new Date().toISOString()
  return {
    label: 'signed with a certificate that is not PayPal\'s',
    body,
    headers: {
      'content-type': 'application/json',
      'paypal-transmission-id': transmissionId,
      'paypal-transmission-time': transmissionTime,
      'paypal-cert-url': certUrl,
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-auth-version': 'v2',
      'paypal-transmission-sig': signDelivery({ privateKeyPem: attackerKeyPem(), transmissionId, transmissionTime, webhookId, body }),
    },
  }
}
