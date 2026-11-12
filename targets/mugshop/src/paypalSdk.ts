import { CheckoutPaymentIntent, PaypalClient, PaypalError as SdkError } from 'paypal'
import type { Error as SdkErrorBody, Order, ClientOptions } from 'paypal'
import { config } from './config.ts'
import { NetworkError, NotSentError, PaypalError, type LedgerOrder, type PaypalPort } from './paypalTypes.ts'

// The APIMatic-generated PayPal SDK adapter. Contract: ../../../paypal-plan.md (all facts there
// were read from node_modules/paypal/sdk-map.md and map/operations/*.md).

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const SANDBOX_HOSTS = new Set(['api-m.sandbox.paypal.com', 'api.sandbox.paypal.com'])

// The SDK has one environment and no selector, so the host is a base-URL override and nothing in the
// options says which deployment this is. Bind (env, host) here and refuse to start on any other pair.
export function assertHost(paypalEnv: string, baseUrl: string): string {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error('PAYPAL_BASE_URL is not a valid URL')
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname)
  const sandbox = SANDBOX_HOSTS.has(url.hostname) && url.protocol === 'https:'
  const allowed = paypalEnv === 'sandbox' ? loopback || sandbox : loopback
  if (!allowed || url.username || url.password) {
    throw new Error(`Refusing to start: PAYPAL_ENV=${paypalEnv} may not talk to host ${url.hostname}`)
  }
  return url.origin
}

export interface SdkClientInput {
  paypalEnv: string
  baseUrl: string
  clientId: string
  clientSecret: string
  fetch?: typeof fetch
}

// One client per process: the OAuth token cache and the resource getters live on it.
export function buildSdkClient(input: SdkClientInput): PaypalClient {
  if (!input.clientId || !input.clientSecret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not configured')
  const options: ClientOptions = {
    serverOptions: { baseUrl: assertHost(input.paypalEnv, input.baseUrl) },
    oauth2: { clientId: input.clientId, clientSecret: input.clientSecret },
    retry: { timeout: 10_000 },
    // Set explicitly so PAYPAL_CLIENT_LOG cannot switch logging on from outside. No body logging.
    logging: { level: 'off' },
    ...(input.fetch ? { fetch: input.fetch } : {}),
  }
  return new PaypalClient(options)
}

// Writes are sent once by the SDK (POST is not in httpMethodsToRetry). Said again per call so a
// changed client default cannot resend a money-moving write; the shop re-sends on purpose, with the stored id.
const SEND_ONCE = { retry: { maxRetries: 0 } } as const

const usd = (value: string) => ({ currencyCode: 'USD', value })

// Maps every member of the SDK's one error family onto the three outcomes the shop understands.
// Anything outside the family (a bug, an abort) is rethrown untouched.
function translate(err: unknown): never {
  if (!(err instanceof SdkError)) throw err
  if (err.kind === 'connection' || err.kind === 'timeout') throw new NetworkError(`${err.kind}: ${err.message}`)
  if (err.kind === 'auth' || err.kind === 'encode') throw new NotSentError(`${err.kind}: ${err.message}`)
  // The two kinds left, api and decode, are the ones PayPal answered on.
  const { status } = err
  if (err.kind === 'decode' && status >= 200 && status < 300) {
    throw new NetworkError(`PayPal answered ${status} but the body could not be read: the write may have happened`)
  }
  const body = err.kind === 'api' ? (err.payload as { body?: SdkErrorBody }).body : undefined
  const issue = body?.details?.[0]?.issue || body?.name || 'UNKNOWN'
  throw new PaypalError(status, issue, body?.message || issue, body?.debugId || err.headers.get('paypal-debug-id') || '')
}

async function run<T>(work: () => PromiseLike<T>): Promise<T> {
  try {
    return await work()
  } catch (err) {
    return translate(err)
  }
}

// A 2xx whose body decoded but lacks what we depend on has the same character as a lost reply.
function need<T>(value: T | undefined, what: string): T {
  if (value === undefined || value === '') throw new NetworkError(`PayPal answered without ${what}: the outcome is unknown`)
  return value
}

function ledgerOrder(order: Order): LedgerOrder {
  const unit = order.purchaseUnits?.[0]
  const payments = unit?.payments
  return {
    id: need(order.id, 'an order id'),
    status: need(order.status, 'an order status'),
    amount: unit?.amount?.value ?? '0.00',
    captureId: payments?.captures?.[0]?.id ?? null,
    refunds: (payments?.refunds ?? []).map((r) => ({ id: need(r.id, 'a refund id'), amount: r.amount?.value ?? '', status: r.status ?? '' })),
  }
}

export function createSdkPort(client: PaypalClient): PaypalPort {
  return {
    async createOrder(amount, requestId) {
      const order = await run(() =>
        client.orders.createOrder(
          { payPalRequestId: requestId, body: { intent: CheckoutPaymentIntent.Capture, purchaseUnits: [{ amount: usd(amount) }] } },
          SEND_ONCE,
        ),
      )
      const approve = order.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action')
      return { id: need(order.id, 'an order id'), approveUrl: approve?.href ?? '' }
    },
    async captureOrder(orderId) {
      // body {}: without a body the SDK sends no Content-Type and the sandbox answers 415 (VERIFY V4).
      // prefer: the capture id is read from the reply, and the default (return=minimal) does not promise it.
      const order = await run(() => client.orders.captureOrder({ id: orderId, prefer: 'return=representation', body: {} }, SEND_ONCE))
      return { captureId: need(order.purchaseUnits?.[0]?.payments?.captures?.[0]?.id, 'a capture id') }
    },
    async getOrder(orderId) {
      return ledgerOrder(await run(() => client.orders.getOrder({ id: orderId })))
    },
    async getCapture(captureId) {
      const capture = await run(() => client.payments.getCapturedPayment({ captureId }))
      return { id: need(capture.id, 'a capture id'), orderId: capture.supplementaryData?.relatedIds?.orderId ?? '' }
    },
    async refundCapture(captureId, amount, payPalRequestId) {
      const refund = await run(() => client.payments.refundCapturedPayment({ captureId, payPalRequestId, body: { amount: usd(amount) } }, SEND_ONCE))
      return { id: need(refund.id, 'a refund id'), amount, status: refund.status ?? '' }
    },
  }
}

export function createConfiguredSdkPort(): PaypalPort {
  return createSdkPort(
    buildSdkClient({ paypalEnv: config.paypalEnv, baseUrl: config.paypalBaseUrl, clientId: config.clientId, clientSecret: config.clientSecret }),
  )
}
