import { PaypalClient, PaypalError as SdkError } from 'paypal'

// The PayPal ledger as the judge sees it. Read-only: this module has no write call on purpose.
// Default flavour is the APIMatic-generated SDK (client.orders.getOrder, client.payments.getCapturedPayment).
// The REST flavour (same endpoints, plain fetch) stays so the same run can be repeated through both
// (PAYPAL_CLIENT_IMPL=rest, test/adapters.test.js). Contract: paypal-plan.md.

const norm = (order) => {
  const unit = order.purchase_units?.[0] || {}
  return {
    id: order.id,
    status: order.status,
    amount: unit.amount?.value ?? null,
    captures: (unit.payments?.captures || []).map((c) => ({ id: c.id, amount: c.amount.value, status: c.status })),
    refunds: (unit.payments?.refunds || []).map((r) => ({ id: r.id, amount: r.amount.value, status: r.status })),
  }
}

export function createTruth({ baseUrl, clientId, clientSecret, impl = 'sdk', fetchImpl }) {
  if (!clientId || !clientSecret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not configured')
  return impl === 'rest' ? createRestTruth({ baseUrl, clientId, clientSecret }) : createSdkTruth({ baseUrl, clientId, clientSecret, fetchImpl })
}

function createRestTruth({ baseUrl, clientId, clientSecret }) {
  let token = null

  async function accessToken() {
    if (token && token.until > Date.now()) return token.value
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    })
    const body = await res.json()
    token = { value: body.access_token, until: Date.now() + (body.expires_in - 30) * 1000 }
    return token.value
  }

  async function get(path) {
    const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` } })
    if (!res.ok) throw new Error(`PayPal ledger read ${path} failed: ${res.status}`)
    return res.json()
  }

  return {
    impl: 'rest',
    async order(orderId) {
      return { ...norm(await get(`/v2/checkout/orders/${encodeURIComponent(orderId)}`)), source: 'GET /v2/checkout/orders/{id}' }
    },
    async capture(captureId) {
      const capture = await get(`/v2/payments/captures/${encodeURIComponent(captureId)}`)
      return { id: capture.id, status: capture.status, amount: capture.amount?.value ?? null, orderId: capture.supplementary_data?.related_ids?.order_id ?? null, source: 'GET /v2/payments/captures/{capture_id}' }
    },
  }
}

function createSdkTruth({ baseUrl, clientId, clientSecret, fetchImpl }) {
  // One client for the process: the OAuth token cache lives on it. Reads only; the SDK's default read
  // retry (GET, 3 retries) stands, each attempt bounded to 10 s. Logging is off and cannot be switched on from the environment.
  const client = new PaypalClient({
    serverOptions: { baseUrl },
    oauth2: { clientId, clientSecret },
    retry: { timeout: 10_000 },
    logging: { level: 'off' },
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })

  // Same message shape as the REST flavour; anything outside the SDK's error family is a bug and passes through.
  async function read(label, work) {
    try {
      return await work()
    } catch (err) {
      if (!(err instanceof SdkError)) throw err
      throw new Error(`PayPal ledger read ${label} failed: ${err.kind === 'api' || err.kind === 'decode' ? err.status : err.kind}`)
    }
  }

  return {
    impl: 'sdk',
    async order(orderId) {
      const order = await read('getOrder', () => client.orders.getOrder({ id: orderId }))
      if (!order.id || !order.status) throw new Error('PayPal ledger read getOrder failed: the reply has no id or status')
      const unit = order.purchaseUnits?.[0]
      return {
        id: order.id,
        status: order.status,
        amount: unit?.amount?.value ?? null,
        captures: (unit?.payments?.captures || []).map((c) => ({ id: c.id, amount: c.amount?.value, status: c.status })),
        refunds: (unit?.payments?.refunds || []).map((r) => ({ id: r.id, amount: r.amount?.value, status: r.status })),
        source: 'client.orders.getOrder',
      }
    },
    async capture(captureId) {
      const capture = await read('getCapturedPayment', () => client.payments.getCapturedPayment({ captureId }))
      if (!capture.id) throw new Error('PayPal ledger read getCapturedPayment failed: the reply has no id')
      return { id: capture.id, status: capture.status, amount: capture.amount?.value ?? null, orderId: capture.supplementaryData?.relatedIds?.orderId ?? null, source: 'client.payments.getCapturedPayment' }
    },
  }
}
