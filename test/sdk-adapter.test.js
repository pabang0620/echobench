import test from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../targets/mugshop/src/db.ts'
import { createCheckout, returnPath, ShopInputError } from '../targets/mugshop/src/checkout.ts'
import { assertHost, buildSdkClient, createSdkPort } from '../targets/mugshop/src/paypalSdk.ts'
import { NetworkError, NotSentError, PaypalError } from '../targets/mugshop/src/paypalTypes.ts'
import { requestRefund } from '../targets/mugshop/src/refunds.ts'
import { isToken, json, stubFetch, tokenReply, wireError, wireOrder } from './sdkStub.js'

// The APIMatic SDK adapter of MugShop on a faked fetch (typescript-testing). Contract: paypal-plan.md.

function setup(responder) {
  const stub = stubFetch((call) => (isToken(call) ? tokenReply() : responder(call)))
  const client = buildSdkClient({ paypalEnv: 'mock', baseUrl: 'http://127.0.0.1:4200', clientId: 'id', clientSecret: 'secret', fetch: stub.fetch })
  const db = openDb(':memory:')
  db.prepare("INSERT INTO orders (paypal_order_id, sku, amount, status, created_at) VALUES ('ORD1', 'MUG-001', '12.00', 'CAPTURED', 'now')").run()
  db.prepare("INSERT INTO captures (paypal_capture_id, paypal_order_id, amount, status) VALUES ('CAP1', 'ORD1', '12.00', 'COMPLETED')").run()
  return { stub, port: createSdkPort(client), db }
}

const refundOk = () => json(201, { id: 'REF1', status: 'COMPLETED' })
const refund = (db, port, ref = 'RMA-1') => requestRefund(db, port, { orderId: 'ORD1', amount: '4.00', refundRef: ref, path: 'admin' })
const claimRows = (db) => db.prepare('SELECT * FROM refund_claims').all()

test('OPTIONAL FIELDS: refund sends the stored PayPal-Request-Id and the amount, and no header or key nothing requires', async () => {
  const { stub, port } = setup(refundOk)
  await port.refundCapture('CAP1', '4.00', 'req-1')
  const [call] = stub.writes('/refund')
  assert.equal(call.path, '/v2/payments/captures/CAP1/refund')
  assert.equal(call.headers['paypal-request-id'], 'req-1')
  assert.deepEqual(JSON.parse(call.body), { amount: { currency_code: 'USD', value: '4.00' } })
  // What the SDK adds itself: credential, body type, its own Idempotency-Key, the Prefer default, user agent and x-apimatic-* telemetry.
  const ours = Object.keys(call.headers).filter((h) => !h.startsWith('x-apimatic-') && h !== 'user-agent')
  assert.deepEqual(ours.sort(), ['authorization', 'content-type', 'idempotency-key', 'paypal-request-id', 'prefer'])
  assert.equal(call.headers.prefer, 'return=minimal')
  assert.equal(call.headers.authorization, 'Bearer T')
})

test('OPTIONAL FIELDS: captureOrder asks for the representation (it reads the capture id) and sends an empty JSON body (the sandbox answers 415 without a Content-Type) and no request id', async () => {
  const { stub, port } = setup(() => json(201, wireOrder()))
  assert.deepEqual(await port.captureOrder('ORD1'), { captureId: 'CAP1' })
  const [call] = stub.writes('/capture')
  assert.equal(call.headers.prefer, 'return=representation')
  assert.equal(call.body, '{}')
  assert.match(call.headers['content-type'], /application\/json/)
  assert.equal(call.headers['paypal-request-id'], undefined)
})

test('OPTIONAL FIELDS: createOrder sends intent, one purchase unit with the server-side amount, and the per-call request id', async () => {
  const { stub, port } = setup(() => json(201, { id: 'ORD9', status: 'CREATED', links: [{ href: 'https://pay.example/approve', rel: 'payer-action', method: 'GET' }] }))
  assert.deepEqual(await port.createOrder('24.00', 'req-9'), { id: 'ORD9', approveUrl: 'https://pay.example/approve' })
  const [call] = stub.writes('/v2/checkout/orders')
  assert.deepEqual(JSON.parse(call.body), { intent: 'CAPTURE', purchase_units: [{ amount: { currency_code: 'USD', value: '24.00' } }] })
  assert.equal(call.headers['paypal-request-id'], 'req-9')
  assert.equal(call.headers.prefer, 'return=minimal')
})

test('reads: getOrder and getCapture map the wire shape (captures, refunds, related order id)', async () => {
  const { port } = setup((call) => {
    if (call.path.includes('/captures/')) return json(200, { id: 'CAP1', status: 'COMPLETED', supplementary_data: { related_ids: { order_id: 'ORD1' } } })
    return json(200, wireOrder({ purchase_units: [{ amount: { currency_code: 'USD', value: '12.00' }, payments: { captures: [{ id: 'CAP1' }], refunds: [{ id: 'R1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '4.00' } }] } }] }))
  })
  assert.deepEqual(await port.getOrder('ORD1'), { id: 'ORD1', status: 'COMPLETED', amount: '12.00', captureId: 'CAP1', refunds: [{ id: 'R1', amount: '4.00', status: 'COMPLETED' }] })
  assert.deepEqual(await port.getCapture('CAP1'), { id: 'CAP1', orderId: 'ORD1' })
})

test('DUPLICATE CLAIMS (refund): the claim row is in the store when the request leaves, and two simultaneous requests send one', async () => {
  const seen = []
  const { stub, port, db } = setup(async (call) => {
    seen.push(claimRows(db).map((c) => c.state))
    await new Promise((r) => setTimeout(r, 20))
    return refundOk(call)
  })
  const [a, b] = await Promise.all([refund(db, port), refund(db, port)])
  assert.deepEqual([a.status, b.status].sort(), [201, 409])
  assert.equal(stub.writes('/refund').length, 1)
  assert.deepEqual(seen, [['PENDING']])
  assert.equal(claimRows(db)[0].state, 'DONE')
})

test('UNKNOWN OUTCOMES (refund): a dropped connection is settled by sending the same PayPal-Request-Id again; the SDK key differs per call', async () => {
  let n = 0
  const { stub, port, db } = setup(() => {
    n += 1
    if (n === 1) throw new TypeError('socket hang up')
    return refundOk()
  })
  const outcome = await refund(db, port)
  assert.equal(outcome.status, 201)
  const sends = stub.writes('/refund')
  assert.equal(sends.length, 2)
  assert.equal(sends[0].headers['paypal-request-id'], sends[1].headers['paypal-request-id'])
  assert.notEqual(sends[0].headers['idempotency-key'], sends[1].headers['idempotency-key'], 'a call of our own is a new SDK call with a new Idempotency-Key')
  assert.equal(claimRows(db)[0].paypal_request_id, sends[0].headers['paypal-request-id'])
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM refunds').get().n, 1)
})

test('UNKNOWN OUTCOMES (refund): a success reply that cannot be read is an unknown outcome, never a failure', async () => {
  const { port } = setup(() => json(201, { id: 42 }))
  await assert.rejects(() => port.refundCapture('CAP1', '4.00', 'req-1'), NetworkError)
  const empty = setup(() => json(201, {}))
  await assert.rejects(() => empty.port.refundCapture('CAP1', '4.00', 'req-1'), NetworkError)
})

test('UNKNOWN OUTCOMES (refund): never sent (token refused) means no refund request, claim released, fixed 502', async () => {
  const stub = stubFetch((call) => (isToken(call) ? json(401, { error: 'invalid_client' }) : refundOk()))
  const client = buildSdkClient({ paypalEnv: 'mock', baseUrl: 'http://127.0.0.1:4200', clientId: 'id', clientSecret: 'bad', fetch: stub.fetch })
  const db = openDb(':memory:')
  db.prepare("INSERT INTO captures (paypal_capture_id, paypal_order_id, amount, status) VALUES ('CAP1', 'ORD1', '12.00', 'COMPLETED')").run()
  const outcome = await refund(db, createSdkPort(client))
  assert.equal(outcome.status, 502)
  assert.equal(outcome.body.error, 'PAYPAL_NOT_REACHED')
  assert.equal(stub.writes('/refund').length, 0)
  assert.equal(claimRows(db).length, 0, 'the claim is released so a later attempt is not blocked')
  await assert.rejects(() => createSdkPort(client).refundCapture('CAP1', '4.00', 'x'), NotSentError)
})

test('UNKNOWN OUTCOMES (capture): a lost capture reply is settled by reading the order back; a never-sent capture is not re-read', async () => {
  const { stub, port, db } = setup((call) => {
    if (call.method === 'POST') throw new TypeError('socket hang up')
    return json(200, wireOrder())
  })
  assert.deepEqual(await returnPath(db, port, 'ORD1'), { orderId: 'ORD1', captureId: 'CAP1' })
  assert.equal(stub.calls.filter((c) => c.method === 'GET' && c.path === '/v2/checkout/orders/ORD1').length, 1)

  const refused = stubFetch((call) => (isToken(call) ? json(401, { error: 'invalid_client' }) : json(200, wireOrder())))
  const client = buildSdkClient({ paypalEnv: 'mock', baseUrl: 'http://127.0.0.1:4200', clientId: 'id', clientSecret: 'bad', fetch: refused.fetch })
  const fresh = openDb(':memory:')
  fresh.prepare("INSERT INTO orders (paypal_order_id, sku, amount, status, created_at) VALUES ('ORD1', 'MUG-001', '12.00', 'CREATED', 'now')").run()
  await assert.rejects(() => returnPath(fresh, createSdkPort(client), 'ORD1'), NotSentError)
  assert.equal(refused.calls.filter((c) => c.path.startsWith('/v2/')).length, 0)
})

test('UNKNOWN OUTCOMES (capture): lost reply and the order shows no capture stays unknown, not failed', async () => {
  const { port, db } = setup((call) => {
    if (call.method === 'POST') throw new TypeError('socket hang up')
    return json(200, wireOrder({ purchase_units: [{ amount: { currency_code: 'USD', value: '12.00' }, payments: {} }], status: 'APPROVED' }))
  })
  await assert.rejects(() => returnPath(db, port, 'ORD1'), NetworkError)
})

test('DUPLICATE CLAIMS (capture): ORDER_ALREADY_CAPTURED is answered by reading the order back and booking the one capture', async () => {
  const { stub, port, db } = setup((call) => (call.method === 'POST' ? json(422, wireError('UNPROCESSABLE_ENTITY', 'ORDER_ALREADY_CAPTURED')) : json(200, wireOrder())))
  await returnPath(db, port, 'ORD1')
  await returnPath(db, port, 'ORD1')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM captures').get().n, 1)
  assert.equal(stub.writes('/capture').length, 2)
})

test('WHEN THE API SAYS NO (refund): a 4xx keeps its status and PayPal reason; 401, 429 and 5xx get fixed messages', async () => {
  const cases = [
    [422, wireError('UNPROCESSABLE_ENTITY', 'REFUND_AMOUNT_EXCEEDED', 'Refund exceeds the capture'), 422, 'REFUND_AMOUNT_EXCEEDED'],
    [404, wireError('RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'Capture not found'), 404, 'INVALID_RESOURCE_ID'],
    [401, wireError('AUTHENTICATION_FAILURE', 'AUTH', 'Authentication failed'), 502, 'PAYPAL_CREDENTIALS'],
    [403, wireError('NOT_AUTHORIZED', 'PERMISSION_DENIED', 'no'), 502, 'PAYPAL_CREDENTIALS'],
  ]
  for (const [status, body, expectStatus, expectError] of cases) {
    const { port, db } = setup(() => json(status, body))
    const outcome = await refund(db, port)
    assert.equal(outcome.status, expectStatus)
    assert.equal(outcome.body.error, expectError)
    if (expectStatus === status) assert.match(String(outcome.body.reason), /Refund exceeds|not found/)
    assert.equal(claimRows(db).length, 0, 'a refused call releases the claim')
  }
  const limited = setup(() => json(429, wireError('RATE_LIMIT_REACHED', 'RATE', 'slow down')))
  const rate = await refund(limited.db, limited.port)
  assert.deepEqual([rate.status, rate.body.error], [503, 'PAYPAL_RATE_LIMIT'])
})

test('WHEN THE API SAYS NO (refund): a 5xx with no body is an unknown outcome: same request id sent again, then 502, claim kept', async () => {
  const { stub, port, db } = setup(() => new Response(null, { status: 500 }))
  const outcome = await refund(db, port)
  assert.equal(outcome.status, 502)
  assert.equal(stub.writes('/refund').length, 3)
  assert.equal(new Set(stub.writes('/refund').map((c) => c.headers['paypal-request-id'])).size, 1)
  assert.equal(claimRows(db).length, 1)
})

test('WHEN THE API SAYS NO (createOrder, captureOrder): same 4xx, fixed 502 for credentials', async () => {
  const { port } = setup(() => json(422, wireError('UNPROCESSABLE_ENTITY', 'AMOUNT_MISMATCH', 'Amount is wrong')))
  await assert.rejects(() => port.createOrder('12.00', 'r'), (err) => err instanceof PaypalError && err.status === 422 && err.issue === 'AMOUNT_MISMATCH' && err.message === 'Amount is wrong' && err.debugId === 'dbg-1')
  const other = setup(() => json(401, wireError('AUTHENTICATION_FAILURE', 'AUTH')))
  await assert.rejects(() => other.port.captureOrder('ORD1'), (err) => err instanceof PaypalError && err.status === 401)
})

test('WHEN THE API SAYS NO: an error body the SDK Error model cannot decode (no debug_id) keeps the status and loses the reason', async () => {
  const { port } = setup(() => json(422, { name: 'UNPROCESSABLE_ENTITY', message: 'x', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }))
  await assert.rejects(() => port.captureOrder('ORD1'), (err) => err instanceof PaypalError && err.status === 422 && err.issue === 'UNKNOWN')
})

test('CROSS-OPERATION INVARIANTS: an unknown sku is rejected before PayPal is called; a refund for an order with no capture is rejected before the claim', async () => {
  let calls = 0
  const port = { createOrder: async () => { calls += 1; return { id: 'x', approveUrl: '' } }, refundCapture: async () => { calls += 1; return { id: 'r', amount: '1.00', status: 'COMPLETED' } } }
  const db = openDb(':memory:')
  await assert.rejects(() => createCheckout(db, port, 'MUG-999', 1), (err) => err instanceof ShopInputError && err.status === 400)
  const outcome = await requestRefund(db, port, { orderId: 'NOPE', amount: '1.00', refundRef: 'R', path: 'admin' })
  assert.equal(outcome.status, 409)
  assert.equal(calls, 0)
  assert.equal(claimRows(db).length, 0)
})

test('host decision: the live host is refused, mock only talks to loopback, sandbox to its host or EchoBench\'s proxy; credentials must be set', () => {
  assert.throws(() => assertHost('sandbox', 'https://api-m.paypal.com'), /Refusing to start/)
  assert.throws(() => assertHost('mock', 'https://api-m.sandbox.paypal.com'), /Refusing to start/)
  assert.throws(() => assertHost('sandbox', 'http://api-m.sandbox.paypal.com'), /Refusing to start/)
  assert.equal(assertHost('sandbox', 'https://api-m.sandbox.paypal.com'), 'https://api-m.sandbox.paypal.com')
  assert.equal(assertHost('sandbox', 'http://127.0.0.1:3999'), 'http://127.0.0.1:3999')
  assert.equal(assertHost('mock', 'http://127.0.0.1:4200'), 'http://127.0.0.1:4200')
  assert.throws(() => buildSdkClient({ paypalEnv: 'mock', baseUrl: 'http://127.0.0.1:1', clientId: '', clientSecret: 'x' }), /not configured/)
})
