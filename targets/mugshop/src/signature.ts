import { crc32 } from 'node:zlib'
import { createVerify, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { IncomingHttpHeaders } from 'node:http'
import { config } from './config.ts'

export interface Verdict {
  ok: boolean
  reason: string
}

function header(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value || ''
}

async function loadCert(certUrl: URL): Promise<string> {
  if (config.pinnedCertPath) return readFileSync(config.pinnedCertPath, 'utf8')
  const res = await fetch(certUrl)
  return res.text()
}

// Self verification: rebuild the signed message and check it with the certificate public key.
// The certificate may only come from a PayPal host; a cert_url anywhere else is rejected
// before anything is downloaded.
export async function verifyIncoming(headers: IncomingHttpHeaders, body: Buffer): Promise<Verdict> {
  const transmissionId = header(headers, 'paypal-transmission-id')
  const transmissionTime = header(headers, 'paypal-transmission-time')
  const signature = header(headers, 'paypal-transmission-sig')
  const certUrlRaw = header(headers, 'paypal-cert-url')
  const algo = header(headers, 'paypal-auth-algo')
  if (!transmissionId || !transmissionTime || !signature || !certUrlRaw) return { ok: false, reason: 'missing signature headers' }
  if (algo && algo.toUpperCase() !== 'SHA256WITHRSA') return { ok: false, reason: `unsupported algorithm ${algo}` }

  let certUrl: URL
  try {
    certUrl = new URL(certUrlRaw)
  } catch {
    return { ok: false, reason: 'cert_url is not a URL' }
  }
  if (!config.trustedCertHosts.includes(certUrl.hostname)) return { ok: false, reason: `cert_url host ${certUrl.hostname} is not a PayPal host` }

  try {
    const certPem = await loadCert(certUrl)
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${transmissionId}|${transmissionTime}|${config.webhookId}|${crc32(body)}`)
    const valid = verifier.verify(new X509Certificate(certPem).publicKey, signature, 'base64')
    return valid ? { ok: true, reason: 'signature valid' } : { ok: false, reason: 'signature does not match body' }
  } catch (err) {
    return { ok: false, reason: `verification error: ${(err as Error).message}` }
  }
}
