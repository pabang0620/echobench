import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createMockPaypal, mockCertPem } from '../server/mockPaypal.js'
import { verifyDelivery } from '../server/lib/signature.js'

let mock
let base
const received = []
let receiver

before(async () => {
  mock = createMockPaypal({ webhookId: 'WH-T' })
  base = await mock.listen(0)
  receiver = createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    received.push({ headers: req.headers, body: Buffer.concat(chunks) })
    res.end('ok')
  })
  await new Promise((r) => receiver.listen(0, '127.0.0.1', r))
  mock.registerWebhook(`http://127.0.0.1:${receiver.address().port}/hook`)
})
after(async () => {
  receiver.close()
  await mock.close()
})

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: await res.json() }
}
const settle = () => new Promise((r) => setTimeout(r, 120))

test('order, approve, capture, partial refunds follow Orders v2 and Payments v2 shapes', async () => {
  const created = await call('POST', '/v2/checkout/orders', { purchase_units: [{ amount: { value: '12.00' } }] })
  assert.equal(created.status, 201)
  assert.equal(created.json.status, 'CREATED')
  assert.ok(created.json.links.some((l) => l.rel === 'approve'))
  const early = await call('POST', `/v2/checkout/orders/${created.json.id}/capture`, {})
  assert.equal(early.json.details[0].issue, 'ORDER_NOT_APPROVED')
  await call('POST', `/__mock/orders/${created.json.id}/approve`)
  const captured = await call('POST', `/v2/checkout/orders/${created.json.id}/capture`, {})
  const captureId = captured.json.purchase_units[0].payments.captures[0].id
  assert.equal((await call('POST', `/v2/checkout/orders/${created.json.id}/capture`, {})).json.details[0].issue, 'ORDER_ALREADY_CAPTURED')
  const first = await call('POST', `/v2/payments/captures/${captureId}/refund`, { amount: { currency_code: 'USD', value: '4.00' } }, { 'PayPal-Request-Id': 'r1' })
  assert.equal(first.json.status, 'COMPLETED')
  assert.equal((await call('GET', `/v2/payments/captures/${captureId}`)).json.status, 'PARTIALLY_REFUNDED')
  await call('POST', `/v2/payments/captures/${captureId}/refund`, { amount: { currency_code: 'USD', value: '8.00' } })
  assert.equal((await call('GET', `/v2/payments/captures/${captureId}`)).json.status, 'REFUNDED')
  const over = await call('POST', `/v2/payments/captures/${captureId}/refund`, { amount: { currency_code: 'USD', value: '0.01' } })
  assert.equal(over.json.details[0].issue, 'REFUND_AMOUNT_EXCEEDED')
  const order = await call('GET', `/v2/checkout/orders/${created.json.id}`)
  assert.equal(order.json.purchase_units[0].payments.refunds.length, 2)
})

test('the same PayPal-Request-Id returns the stored refund and creates no second one', async () => {
  const fixture = (await call('POST', '/__mock/fixture-capture', { amount: '12.00' })).json
  const a = await call('POST', `/v2/payments/captures/${fixture.captureId}/refund`, { amount: { value: '4.00' } }, { 'PayPal-Request-Id': 'same' })
  const b = await call('POST', `/v2/payments/captures/${fixture.captureId}/refund`, { amount: { value: '4.00' } }, { 'PayPal-Request-Id': 'same' })
  assert.equal(a.json.id, b.json.id)
  assert.equal(a.status, 201)
  assert.equal(b.status, 200, 'the sandbox answers 200 for a repeated PayPal-Request-Id (VERIFY V5)')
  const order = await call('GET', `/v2/checkout/orders/${fixture.orderId}`)
  assert.equal(order.json.purchase_units[0].payments.refunds.length, 1)
  const other = await call('POST', `/v2/payments/captures/${fixture.captureId}/refund`, { amount: { value: '4.00' } }, { 'PayPal-Request-Id': 'different' })
  assert.notEqual(other.json.id, a.json.id)
})

test('a refund keeps its custom_id in the reply and in GET order, as the sandbox does (refund 21J38299VE4849725)', async () => {
  const fixture = (await call('POST', '/__mock/fixture-capture', { amount: '12.00' })).json
  const made = await call('POST', `/v2/payments/captures/${fixture.captureId}/refund`, { amount: { value: '4.00' }, custom_id: 'RMA-9' }, { 'PayPal-Request-Id': 'cid' })
  assert.equal(made.json.custom_id, 'RMA-9')
  const order = await call('GET', `/v2/checkout/orders/${fixture.orderId}`)
  assert.equal(order.json.purchase_units[0].payments.refunds[0].custom_id, 'RMA-9')
  const plain = await call('POST', `/v2/payments/captures/${fixture.captureId}/refund`, { amount: { value: '1.00' } })
  assert.equal('custom_id' in plain.json, false)
})

test('two refunds that overlap on one capture: the second gets 409 PREVIOUS_REQUEST_IN_PROGRESS, as the sandbox answered', async () => {
  const fixture = (await call('POST', '/__mock/fixture-capture', { amount: '12.00' })).json
  const url = `/v2/payments/captures/${fixture.captureId}/refund`
  const [a, b] = await Promise.all([call('POST', url, { amount: { value: '4.00' } }, { 'PayPal-Request-Id': 'p1' }), call('POST', url, { amount: { value: '4.00' } }, { 'PayPal-Request-Id': 'p2' })])
  assert.deepEqual([a.status, b.status].sort(), [201, 409])
  assert.equal([a, b].find((r) => r.status === 409).json.details[0].issue, 'PREVIOUS_REQUEST_IN_PROGRESS')
  const later = await call('POST', url, { amount: { value: '4.00' } }, { 'PayPal-Request-Id': 'p3' })
  assert.equal(later.status, 201, 'one after the other is refunded again: only the shop can stop that')
})

test('webhook deliveries carry a signature that verifies, and a resend is signed again', async () => {
  await settle()
  received.length = 0
  const created = await call('POST', '/v2/checkout/orders', { purchase_units: [{ amount: { value: '5.00' } }] })
  await call('POST', `/__mock/orders/${created.json.id}/approve`)
  await settle()
  assert.equal(received.length, 1)
  const [first] = received
  const verify = (d) => verifyDelivery({ certPem: mockCertPem(), signature: d.headers['paypal-transmission-sig'], transmissionId: d.headers['paypal-transmission-id'], transmissionTime: d.headers['paypal-transmission-time'], webhookId: 'WH-T', body: d.body })
  assert.equal(verify(first), true)
  const eventId = JSON.parse(first.body).id
  const resend = await call('POST', `/v1/notifications/webhooks-events/${eventId}/resend`, { webhook_ids: ['WH-T'] })
  assert.equal(resend.status, 202)
  await settle()
  assert.equal(received.length, 2)
  assert.notEqual(received[1].headers['paypal-transmission-id'], first.headers['paypal-transmission-id'])
  assert.equal(verify(received[1]), true)
})

test('delivery can be switched off for silent setup', async () => {
  await settle()
  received.length = 0
  await call('POST', '/__mock/delivery', { enabled: false })
  const created = await call('POST', '/v2/checkout/orders', { purchase_units: [{ amount: { value: '5.00' } }] })
  await call('POST', `/__mock/orders/${created.json.id}/approve`)
  await settle()
  assert.equal(received.length, 0)
  await call('POST', '/__mock/delivery', { enabled: true })
})

test('the ledger export can be loaded into a fresh stand-in', async () => {
  const fresh = createMockPaypal()
  const url = await fresh.listen(0)
  fresh.importLedger(mock.exportLedger())
  const [orderId] = [...mock.state.orders.keys()]
  const res = await fetch(`${url}/v2/checkout/orders/${orderId}`)
  assert.equal(res.status, 200)
  await fresh.close()
})
