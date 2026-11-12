import { randomUUID } from 'node:crypto'
import { config } from './config.ts'
import { NetworkError, PaypalError, type LedgerOrder, type PaypalPort } from './paypalTypes.ts'

export { NetworkError, NotSentError, PaypalError } from './paypalTypes.ts'
export type { LedgerOrder, LedgerRefund, PaypalPort } from './paypalTypes.ts'

type Json = Record<string, any>

let tokenCache: { value: string; until: number } | null = null

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.until > Date.now()) return tokenCache.value
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
  const res = await fetch(`${config.paypalBaseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  const body = (await res.json()) as Json
  tokenCache = { value: String(body.access_token), until: Date.now() + (Number(body.expires_in) - 30) * 1000 }
  return tokenCache.value
}

async function call(method: string, path: string, body?: Json, headers: Record<string, string> = {}): Promise<Json> {
  let res: Response
  let text: string
  try {
    const token = await accessToken()
    res = await fetch(`${config.paypalBaseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    })
    text = await res.text()
  } catch (err) {
    throw new NetworkError(String((err as Error).message || err))
  }
  const parsed = text ? (JSON.parse(text) as Json) : {}
  if (!res.ok) {
    const issue = String(parsed.details?.[0]?.issue || parsed.name || 'UNKNOWN')
    throw new PaypalError(res.status, issue, String(parsed.message || issue))
  }
  return parsed
}

function ledgerOrder(order: Json): LedgerOrder {
  const unit = order.purchase_units?.[0] || {}
  const captures: Json[] = unit.payments?.captures || []
  const refunds: Json[] = unit.payments?.refunds || []
  return {
    id: String(order.id),
    status: String(order.status),
    amount: String(unit.amount?.value || '0.00'),
    captureId: captures[0] ? String(captures[0].id) : null,
    refunds: refunds.map((r) => ({ id: String(r.id), amount: String(r.amount?.value), status: String(r.status) })),
  }
}

export const restPort: PaypalPort = {
  async createOrder(amount, requestId) {
    const order = await call(
      'POST',
      '/v2/checkout/orders',
      { intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'USD', value: amount } }] },
      { 'PayPal-Request-Id': requestId },
    )
    const approve = (order.links as Json[] | undefined)?.find((l) => l.rel === 'approve' || l.rel === 'payer-action')
    return { id: String(order.id), approveUrl: String(approve?.href || '') }
  },
  async captureOrder(orderId) {
    // Prefer: return=representation, same as the SDK adapter (paypal-plan.md, OPTIONAL FIELDS).
    const order = await call('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, undefined, { Prefer: 'return=representation' })
    return { captureId: String(order.purchase_units[0].payments.captures[0].id) }
  },
  async getOrder(orderId) {
    return ledgerOrder(await call('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`))
  },
  async getCapture(captureId) {
    const capture = await call('GET', `/v2/payments/captures/${encodeURIComponent(captureId)}`)
    return { id: String(capture.id), orderId: String(capture.supplementary_data?.related_ids?.order_id || '') }
  },
  async refundCapture(captureId, amount, payPalRequestId) {
    const refund = await call(
      'POST',
      `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
      { amount: { currency_code: 'USD', value: amount } },
      { 'PayPal-Request-Id': payPalRequestId },
    )
    return { id: String(refund.id), amount, status: String(refund.status) }
  },
}

let cached: PaypalPort | null = null

export async function getPort(): Promise<PaypalPort> {
  if (!cached) cached = config.clientImpl === 'sdk' ? (await import('./paypalSdk.ts')).createConfiguredSdkPort() : restPort
  return cached
}

export function newRequestId(): string {
  return randomUUID()
}
