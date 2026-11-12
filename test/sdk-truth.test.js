import test from 'node:test'
import assert from 'node:assert/strict'
import { createTruth } from '../server/truth.js'
import { isToken, json, stubFetch, tokenReply, wireError, wireOrder } from './sdkStub.js'

// The judge reads PayPal's records through the APIMatic SDK. Fake fetch, no network (typescript-testing).

const BASE = 'http://127.0.0.1:4200'
const sdkTruth = (responder) => {
  const stub = stubFetch((call) => (isToken(call) ? tokenReply() : responder(call)))
  return { stub, truth: createTruth({ baseUrl: BASE, clientId: 'id', clientSecret: 'secret', impl: 'sdk', fetchImpl: stub.fetch }) }
}
const withRefund = wireOrder({ purchase_units: [{ amount: { currency_code: 'USD', value: '12.00' }, payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '12.00' } }], refunds: [{ id: 'R1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '4.00' } }] } }] })

test('SDK truth: order() calls GET /v2/checkout/orders/{id} with a Bearer token and returns captures and refunds', async () => {
  const { stub, truth } = sdkTruth(() => json(200, withRefund))
  const order = await truth.order('ORD1')
  const read = stub.calls.find((c) => c.path === '/v2/checkout/orders/ORD1')
  assert.equal(read.method, 'GET')
  assert.equal(read.headers.authorization, 'Bearer T')
  assert.equal(read.body, undefined)
  assert.deepEqual(order, { id: 'ORD1', status: 'COMPLETED', amount: '12.00', captures: [{ id: 'CAP1', amount: '12.00', status: 'COMPLETED' }], refunds: [{ id: 'R1', amount: '4.00', status: 'COMPLETED' }], source: 'client.orders.getOrder' })
})

test('SDK truth equals REST truth on the same PayPal reply (the offline half of VERIFY.md V4)', async (t) => {
  const { truth } = sdkTruth(() => json(200, withRefund))
  t.mock.method(globalThis, 'fetch', async (url) => (String(url).endsWith('/v1/oauth2/token') ? tokenReply() : json(200, withRefund)))
  const rest = createTruth({ baseUrl: BASE, clientId: 'id', clientSecret: 'secret', impl: 'rest' })
  const [a, b] = [await truth.order('ORD1'), await rest.order('ORD1')]
  assert.deepEqual({ ...a, source: 0 }, { ...b, source: 0 })
})

test('SDK truth: capture() reads the related order id', async () => {
  const { stub, truth } = sdkTruth(() => json(200, { id: 'CAP1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '12.00' }, supplementary_data: { related_ids: { order_id: 'ORD1' } } }))
  assert.deepEqual(await truth.capture('CAP1'), { id: 'CAP1', status: 'COMPLETED', amount: '12.00', orderId: 'ORD1', source: 'client.payments.getCapturedPayment' })
  assert.ok(stub.calls.some((c) => c.path === '/v2/payments/captures/CAP1'))
})

test('SDK truth: a 404 is a read failure with the status; a truncated 2xx is a read failure, not an empty ledger', async () => {
  const missing = sdkTruth(() => json(404, wireError('RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID')))
  await assert.rejects(() => missing.truth.order('NOPE'), /getOrder failed: 404/)
  const empty = sdkTruth(() => json(200, {}))
  await assert.rejects(() => empty.truth.order('ORD1'), /no id or status/)
})

test('SDK truth: a refused token is a read failure that names the kind, and no ledger read was sent', async () => {
  const stub = stubFetch((call) => (isToken(call) ? json(401, { error: 'invalid_client' }) : json(200, withRefund)))
  const truth = createTruth({ baseUrl: BASE, clientId: 'id', clientSecret: 'bad', impl: 'sdk', fetchImpl: stub.fetch })
  await assert.rejects(() => truth.order('ORD1'), /getOrder failed: auth/)
  assert.equal(stub.calls.filter((c) => c.path.startsWith('/v2/')).length, 0)
})

test('the judge is read only and refuses to start without credentials', () => {
  const { truth } = sdkTruth(() => json(200, withRefund))
  assert.deepEqual(Object.keys(truth).sort(), ['capture', 'impl', 'order'])
  assert.throws(() => createTruth({ baseUrl: BASE, clientId: '', clientSecret: '', impl: 'sdk' }), /not configured/)
})
