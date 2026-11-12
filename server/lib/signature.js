import { crc32 } from 'node:zlib'
import { createSign, createVerify, X509Certificate } from 'node:crypto'

// PayPal webhook signature, self-verification flavour (docs: "self cryptographic verification").
// message = transmissionId|transmissionTime|webhookId|crc32(rawBody)
export function signedMessage({ transmissionId, transmissionTime, webhookId, body }) {
  return `${transmissionId}|${transmissionTime}|${webhookId}|${crc32(body)}`
}

export function signDelivery({ privateKeyPem, transmissionId, transmissionTime, webhookId, body }) {
  const signer = createSign('RSA-SHA256')
  signer.update(signedMessage({ transmissionId, transmissionTime, webhookId, body }))
  return signer.sign(privateKeyPem, 'base64')
}

export function verifyDelivery({ certPem, signature, transmissionId, transmissionTime, webhookId, body }) {
  const publicKey = new X509Certificate(certPem).publicKey
  const verifier = createVerify('RSA-SHA256')
  verifier.update(signedMessage({ transmissionId, transmissionTime, webhookId, body }))
  return verifier.verify(publicKey, signature, 'base64')
}

export const PAYPAL_HEADERS = [
  'paypal-transmission-id',
  'paypal-transmission-time',
  'paypal-transmission-sig',
  'paypal-cert-url',
  'paypal-auth-algo',
  'paypal-auth-version',
  'content-type',
]

export function pickPaypalHeaders(headers) {
  const out = {}
  for (const name of PAYPAL_HEADERS) {
    if (headers[name] !== undefined) out[name] = String(headers[name])
  }
  return out
}
