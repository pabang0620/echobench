import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { signDelivery, verifyDelivery } from './lib/signature.js'

// Local stand-in for the PayPal sandbox. Response shapes follow the public Orders v2, Payments v2
// and Webhooks v1 documentation. It is the "PayPal ledger" whenever no sandbox credentials are set.
// Nothing here talks to the network except the webhook deliveries it sends to a URL you register.

const KEY_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'keys')
export const MOCK_CERT_URL = 'https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-MOCK-0001'
export const mockCertPem = () => readFileSync(path.join(KEY_DIR, 'paypal-mock.cert.pem'), 'utf8')
export const mockKeyPem = () => readFileSync(path.join(KEY_DIR, 'paypal-mock.key.pem'), 'utf8')

const cents = (value) => Math.round(Number(value) * 100)
const money = (c) => (c / 100).toFixed(2)
const paypalId = () => randomBytes(9).toString('hex').toUpperCase().slice(0, 17)
// How long the stand-in holds a refund "in progress" (see refundsInFlight).
const REFUND_PROCESSING_MS = 40

export function createMockPaypal({ webhookId = 'WH-MOCK-0001', resendResigns = true } = {}) {
  const state = {
    orders: new Map(),
    captures: new Map(),
    refunds: new Map(),
    requestIds: new Map(),
    // Captures with a refund being processed. Measured on the sandbox: a second refund that overlaps one in
    // progress on the same capture is answered 409 PREVIOUS_REQUEST_IN_PROGRESS.
    refundsInFlight: new Set(),
    events: [],
    webhooks: [],
    delivery: true,
    sent: [],
  }
  let baseUrl = ''

  const refundsOf = (captureId) => [...state.refunds.values()].filter((r) => r.captureId === captureId)
  const refundedCents = (captureId) => refundsOf(captureId).reduce((sum, r) => sum + cents(r.amount), 0)

  function captureStatus(capture) {
    const refunded = refundedCents(capture.id)
    if (refunded === 0) return 'COMPLETED'
    return refunded >= cents(capture.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED'
  }

  function captureView(capture) {
    return {
      id: capture.id,
      status: captureStatus(capture),
      amount: { currency_code: 'USD', value: capture.amount },
      final_capture: true,
      seller_protection: { status: 'ELIGIBLE', dispute_categories: ['ITEM_NOT_RECEIVED', 'UNAUTHORIZED_TRANSACTION'] },
      create_time: capture.createdAt,
      update_time: capture.createdAt,
      links: [
        { href: `${baseUrl}/v2/payments/captures/${capture.id}`, rel: 'self', method: 'GET' },
        { href: `${baseUrl}/v2/payments/captures/${capture.id}/refund`, rel: 'refund', method: 'POST' },
        { href: `${baseUrl}/v2/checkout/orders/${capture.orderId}`, rel: 'up', method: 'GET' },
      ],
    }
  }

  function refundView(refund) {
    return {
      id: refund.id,
      status: 'COMPLETED',
      amount: { currency_code: 'USD', value: refund.amount },
      ...(refund.customId ? { custom_id: refund.customId } : {}),
      create_time: refund.createdAt,
      update_time: refund.createdAt,
      links: [
        { href: `${baseUrl}/v2/payments/refunds/${refund.id}`, rel: 'self', method: 'GET' },
        { href: `${baseUrl}/v2/payments/captures/${refund.captureId}`, rel: 'up', method: 'GET' },
      ],
    }
  }

  function orderView(order) {
    const captures = [...state.captures.values()].filter((c) => c.orderId === order.id)
    const refunds = captures.flatMap((c) => refundsOf(c.id))
    const payments = {}
    if (captures.length) payments.captures = captures.map(captureView)
    if (refunds.length) payments.refunds = refunds.map(refundView)
    return {
      id: order.id,
      status: order.status,
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: 'default', amount: { currency_code: 'USD', value: order.amount }, payee: { email_address: 'merchant@example.test', merchant_id: 'MOCKMERCHANT' }, payments }],
      create_time: order.createdAt,
      links: [
        { href: `${baseUrl}/v2/checkout/orders/${order.id}`, rel: 'self', method: 'GET' },
        { href: `${baseUrl}/checkoutnow?token=${order.id}`, rel: 'approve', method: 'GET' },
      ],
    }
  }

  // ---- webhook deliveries ----
  function sign(bodyText, transmissionId = randomUUID(), transmissionTime = new Date().toISOString()) {
    const body = Buffer.from(bodyText)
    return {
      body,
      headers: {
        'content-type': 'application/json',
        'paypal-transmission-id': transmissionId,
        'paypal-transmission-time': transmissionTime,
        'paypal-cert-url': MOCK_CERT_URL,
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-auth-version': 'v2',
        'paypal-transmission-sig': signDelivery({ privateKeyPem: mockKeyPem(), transmissionId, transmissionTime, webhookId, body }),
      },
    }
  }

  async function deliver(event, { resend = false } = {}) {
    const packet = sign(event.bodyText)
    if (resend && !resendResigns) Object.assign(packet.headers, event.headers)
    for (const hook of state.webhooks) {
      try {
        const res = await fetch(hook.url, { method: 'POST', headers: packet.headers, body: packet.body })
        state.sent.push({ eventId: event.id, url: hook.url, status: res.status, resend })
      } catch (err) {
        state.sent.push({ eventId: event.id, url: hook.url, status: 0, error: String(err.message), resend })
      }
    }
  }

  async function emit(eventType, resourceType, resource, summary) {
    const id = `WH-${paypalId()}`
    const body = {
      id,
      event_version: '1.0',
      create_time: new Date().toISOString(),
      resource_type: resourceType,
      resource_version: '2.0',
      event_type: eventType,
      summary,
      resource,
      links: [
        { href: `${baseUrl}/v1/notifications/webhooks-events/${id}`, rel: 'self', method: 'GET' },
        { href: `${baseUrl}/v1/notifications/webhooks-events/${id}/resend`, rel: 'resend', method: 'POST' },
      ],
    }
    const event = { id, eventType, bodyText: JSON.stringify(body), body, headers: {} }
    state.events.push(event)
    if (state.delivery && state.webhooks.length) await deliver(event)
    return event
  }

  // ---- HTTP ----
  async function readJson(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf8')
    return text ? JSON.parse(text) : {}
  }

  const reply = (res, status, body) => {
    const text = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
    res.end(text)
  }
  // PayPal's error body always carries debug_id; the SDK's Error model requires it.
  const fail = (res, status, name, issue, message) => reply(res, status, { name, message, debug_id: paypalId().toLowerCase(), details: [{ issue, description: message }] })

  function capture(order) {
    const id = paypalId()
    const record = { id, orderId: order.id, amount: order.amount, createdAt: new Date().toISOString() }
    state.captures.set(id, record)
    order.status = 'COMPLETED'
    return record
  }

  // Removes an order's captures, their refunds and the request ids that remember them. Returns what was removed.
  function detach(order) {
    const captures = [...state.captures.values()].filter((c) => c.orderId === order.id)
    const refunds = [...state.refunds.values()].filter((r) => captures.some((c) => c.id === r.captureId))
    for (const c of captures) state.captures.delete(c.id)
    for (const r of refunds) state.refunds.delete(r.id)
    for (const k of [...state.requestIds.keys()]) if (captures.some((c) => k.startsWith(`refund:${c.id}:`))) state.requestIds.delete(k)
    return { order: { ...order }, captures, refunds }
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost')
    const parts = url.pathname.split('/').filter(Boolean)
    const key = `${req.method} ${url.pathname}`

    if (key === 'POST /v1/oauth2/token') return reply(res, 200, { access_token: 'mock-token', token_type: 'Bearer', expires_in: 32400 })

    if (key === 'POST /v2/checkout/orders') {
      const body = await readJson(req)
      const requestId = req.headers['paypal-request-id']
      if (requestId && state.requestIds.has(`order:${requestId}`)) return reply(res, 200, orderView(state.orders.get(state.requestIds.get(`order:${requestId}`))))
      const order = { id: paypalId(), status: 'CREATED', amount: String(body.purchase_units?.[0]?.amount?.value || '0.00'), createdAt: new Date().toISOString() }
      state.orders.set(order.id, order)
      if (requestId) state.requestIds.set(`order:${requestId}`, order.id)
      return reply(res, 201, orderView(order))
    }

    if (parts[0] === 'v2' && parts[1] === 'checkout' && parts[2] === 'orders' && parts[3]) {
      const order = state.orders.get(parts[3])
      if (!order) return fail(res, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
      if (req.method === 'GET' && !parts[4]) return reply(res, 200, orderView(order))
      if (req.method === 'POST' && parts[4] === 'capture') {
        if (order.status === 'COMPLETED') return fail(res, 422, 'UNPROCESSABLE_ENTITY', 'ORDER_ALREADY_CAPTURED', 'Order already captured.')
        if (order.status !== 'APPROVED') return fail(res, 422, 'UNPROCESSABLE_ENTITY', 'ORDER_NOT_APPROVED', 'Payer has not approved the order.')
        const record = capture(order)
        reply(res, 201, orderView(order))
        const resource = { ...captureView(record), supplementary_data: { related_ids: { order_id: order.id } } }
        return void emit('PAYMENT.CAPTURE.COMPLETED', 'capture', resource, `Payment completed for $ ${record.amount} USD`)
      }
    }

    if (parts[0] === 'v2' && parts[1] === 'payments' && parts[2] === 'captures' && parts[3]) {
      const record = state.captures.get(parts[3])
      if (!record) return fail(res, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
      if (req.method === 'GET' && !parts[4]) return reply(res, 200, { ...captureView(record), supplementary_data: { related_ids: { order_id: record.orderId } } })
      if (req.method === 'POST' && parts[4] === 'refund') {
        const body = await readJson(req)
        const requestId = req.headers['paypal-request-id']
        const memoKey = requestId ? `refund:${parts[3]}:${requestId}` : ''
        // Measured on the sandbox (VERIFY V5): a repeat with the same PayPal-Request-Id answers 200 with the stored refund.
        if (memoKey && state.requestIds.has(memoKey)) return reply(res, 200, refundView(state.refunds.get(state.requestIds.get(memoKey))))
        if (state.refundsInFlight.has(record.id)) return fail(res, 409, 'RESOURCE_CONFLICT', 'PREVIOUS_REQUEST_IN_PROGRESS', 'The server has detected a conflict while processing this request.')
        state.refundsInFlight.add(record.id)
        await new Promise((resolve) => setTimeout(resolve, REFUND_PROCESSING_MS))
        state.refundsInFlight.delete(record.id)
        const amount = body.amount?.value ? String(body.amount.value) : record.amount
        if (refundedCents(record.id) + cents(amount) > cents(record.amount)) return fail(res, 422, 'UNPROCESSABLE_ENTITY', 'REFUND_AMOUNT_EXCEEDED', 'The refund amount must be less than or equal to the capture amount that has not yet been refunded.')
        // Measured on the sandbox (2026-11-12, refund 21J38299VE4849725): custom_id comes back on the refund reply and in GET order refunds[].
        const refund = { id: paypalId(), captureId: record.id, amount, createdAt: new Date().toISOString(), ...(body.custom_id ? { customId: String(body.custom_id) } : {}) }
        state.refunds.set(refund.id, refund)
        if (memoKey) state.requestIds.set(memoKey, refund.id)
        reply(res, 201, refundView(refund))
        return void emit('PAYMENT.CAPTURE.REFUNDED', 'refund', refundView(refund), `A $ ${amount} USD capture payment was refunded`)
      }
    }

    if (key === 'POST /v1/notifications/webhooks') {
      const body = await readJson(req)
      const hook = { id: webhookId, url: String(body.url), event_types: body.event_types || [] }
      state.webhooks.push(hook)
      return reply(res, 201, hook)
    }
    if (key === 'GET /v1/notifications/webhooks-events') {
      return reply(res, 200, { events: state.events.map((e) => e.body), count: state.events.length })
    }
    if (parts.slice(0, 3).join('/') === 'v1/notifications/webhooks-events' && parts[3]) {
      const event = state.events.find((e) => e.id === parts[3])
      if (!event) return fail(res, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
      if (req.method === 'GET' && !parts[4]) return reply(res, 200, event.body)
      if (req.method === 'POST' && parts[4] === 'resend') {
        reply(res, 202, event.body)
        return void deliver(event, { resend: true })
      }
    }
    if (parts.slice(0, 3).join('/') === 'v1/notifications/certs') {
      res.writeHead(200, { 'content-type': 'application/x-pem-file' })
      return res.end(mockCertPem())
    }
    if (key === 'POST /v1/notifications/verify-webhook-signature') {
      const body = await readJson(req)
      const trusted = ['api.paypal.com', 'api-m.paypal.com', 'api.sandbox.paypal.com', 'api-m.sandbox.paypal.com'].includes(new URL(body.cert_url).hostname)
      let ok = false
      try {
        ok = trusted && verifyDelivery({ certPem: mockCertPem(), signature: body.transmission_sig, transmissionId: body.transmission_id, transmissionTime: body.transmission_time, webhookId: body.webhook_id, body: Buffer.from(JSON.stringify(body.webhook_event)) })
      } catch {
        ok = false
      }
      return reply(res, 200, { verification_status: ok ? 'SUCCESS' : 'FAILURE' })
    }

    // ---- mock controls (never exist on the real sandbox) ----
    if (parts[0] === '__mock') {
      if (key === 'POST /__mock/delivery') {
        state.delivery = Boolean((await readJson(req)).enabled)
        return reply(res, 200, { delivery: state.delivery })
      }
      if (req.method === 'POST' && parts[1] === 'orders' && parts[3] === 'approve') {
        const order = state.orders.get(parts[2])
        if (!order) return fail(res, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
        order.status = 'APPROVED'
        reply(res, 200, orderView(order))
        const resource = { ...orderView(order), status: 'APPROVED' }
        return void emit('CHECKOUT.ORDER.APPROVED', 'checkout-order', resource, 'An order has been approved by buyer')
      }
      if (key === 'POST /__mock/fixture-capture') {
        // A captured, unrefunded order for contract runs. No webhook is sent for it.
        const body = await readJson(req)
        const order = { id: paypalId(), status: 'APPROVED', amount: String(body.amount || '12.00'), createdAt: new Date().toISOString() }
        state.orders.set(order.id, order)
        const record = capture(order)
        return reply(res, 201, { orderId: order.id, captureId: record.id, amount: record.amount })
      }
      if (key === 'POST /__mock/rewind-refunds') {
        // Forget refunds made after a contract run so the same capture can be used again.
        const body = await readJson(req)
        for (const [id, refund] of state.refunds) if (refund.captureId === body.captureId) state.refunds.delete(id)
        for (const [k, v] of state.requestIds) if (k.startsWith(`refund:${body.captureId}:`)) state.requestIds.delete(k)
        return reply(res, 200, { ok: true })
      }
      if (key === 'POST /__mock/rewind-order') {
        // Takes an order back to APPROVED (captures and their refunds removed) and returns what was removed,
        // so a contract run can capture it afresh. restore-order puts the removed records back.
        const { orderId } = await readJson(req)
        const order = state.orders.get(orderId)
        if (!order) return fail(res, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
        const snapshot = detach(order)
        order.status = 'APPROVED'
        return reply(res, 200, snapshot)
      }
      if (key === 'POST /__mock/restore-order') {
        const { snapshot } = await readJson(req)
        const order = state.orders.get(snapshot.order.id)
        if (!order) return fail(res, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
        detach(order)
        Object.assign(order, snapshot.order)
        for (const c of snapshot.captures) state.captures.set(c.id, c)
        for (const r of snapshot.refunds) state.refunds.set(r.id, r)
        return reply(res, 200, { ok: true })
      }
      if (key === 'POST /__mock/emit-dispute') {
        // CUSTOMER.DISPUTE.CREATED for a capture. The real sandbox needs a buyer-side dispute (review/dispute_probe).
        const body = await readJson(req)
        const record = state.captures.get(body.captureId)
        if (!record) return fail(res, 404, 'RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Specified resource ID does not exist.')
        const disputeId = `PP-D-${paypalId().slice(0, 9)}`
        const resource = {
          dispute_id: disputeId,
          create_time: new Date().toISOString(),
          update_time: new Date().toISOString(),
          disputed_transactions: [{ seller_transaction_id: record.id, create_time: record.createdAt, transaction_status: 'COMPLETED', gross_amount: { currency_code: 'USD', value: record.amount }, buyer: { name: 'Sandbox Buyer' } }],
          reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
          status: 'OPEN',
          dispute_amount: { currency_code: 'USD', value: record.amount },
          dispute_life_cycle_stage: 'INQUIRY',
          links: [{ href: `${baseUrl}/v1/customer/disputes/${disputeId}`, rel: 'self', method: 'GET' }],
        }
        reply(res, 201, { dispute_id: disputeId })
        return void emit('CUSTOMER.DISPUTE.CREATED', 'dispute', resource, 'A new dispute opened with Sandbox Buyer')
      }
      if (key === 'GET /__mock/sent') return reply(res, 200, state.sent)
    }
    reply(res, 404, { name: 'RESOURCE_NOT_FOUND', message: `No route for ${key}`, debug_id: paypalId().toLowerCase() })
  }

  const server = createServer((req, res) => {
    route(req, res).catch((err) => reply(res, 500, { name: 'INTERNAL_SERVER_ERROR', message: String(err.message), debug_id: paypalId().toLowerCase() }))
  })

  return {
    state,
    server,
    // The built-in recording ships the PayPal-side records of its orders, so a fresh stand-in knows them.
    exportLedger: () => ({
      orders: [...state.orders.values()],
      captures: [...state.captures.values()],
      refunds: [...state.refunds.values()],
      events: state.events.map((e) => ({ id: e.id, eventType: e.eventType, bodyText: e.bodyText })),
    }),
    importLedger(ledger) {
      for (const o of ledger.orders) state.orders.set(o.id, o)
      for (const c of ledger.captures) state.captures.set(c.id, c)
      for (const r of ledger.refunds) state.refunds.set(r.id, r)
      for (const e of ledger.events) if (!state.events.some((x) => x.id === e.id)) state.events.push({ ...e, body: JSON.parse(e.bodyText), headers: {} })
    },
    registerWebhook: (url) => state.webhooks.push({ id: webhookId, url, event_types: [] }),
    async listen(port = 0) {
      await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
      baseUrl = `http://127.0.0.1:${server.address().port}`
      return baseUrl
    },
    close: () => new Promise((resolve) => server.close(resolve)),
    get baseUrl() {
      return baseUrl
    },
  }
}
