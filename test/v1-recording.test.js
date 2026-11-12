import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { api, startLab } from './helpers.js'
import { belongsToSession } from '../server/recorder.js'

// VERIFY V1 on a shared sandbox app: the recording session buys through the target, fixes its order id,
// and leaves out deliveries about other orders (other shops use the same sandbox app).

test('deliveries about another order or capture are not part of the session', () => {
  const session = { orderId: 'O-1', captureId: 'C-1' }
  const approved = (id) => ({ event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id } })
  const completed = (id, orderId) => ({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id, supplementary_data: { related_ids: { order_id: orderId } } } })
  const refunded = (captureId) => ({ event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'R', links: [{ rel: 'up', href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}` }] } })
  assert.equal(belongsToSession(session, approved('O-1')), true)
  assert.equal(belongsToSession(session, approved('O-2')), false)
  assert.equal(belongsToSession(session, completed('C-2', 'O-2')), false)
  assert.equal(belongsToSession(session, refunded('C-1')), true)
  assert.equal(belongsToSession(session, refunded('C-9')), false)
  assert.equal(belongsToSession({ orderId: 'O-1', captureId: null }, completed('C-1', 'O-1')), true)
  assert.equal(belongsToSession({ orderId: null, captureId: null }, approved('O-7')), true)
})

let ctx
before(async () => {
  ctx = await startLab()
})
after(() => ctx.stop())

test('a recording session buys, refunds 4.00 and 8.00 through the routes and gets four deliveries', async () => {
  const start = await api(ctx.url, 'POST', '/recordings/start', { name: 'V1 route check', targetId: 'mugshop-reference' })
  assert.equal(start.status, 200)
  const buy = await api(ctx.url, 'POST', '/recordings/checkout', {})
  assert.equal(buy.status, 200)
  const { orderId } = buy.json.data
  await fetch(`${ctx.lab.ledgerUrl}/__mock/orders/${orderId}/approve`, { method: 'POST', body: '{}' })
  await ctx.lab.recorder.waitForDeliveries(1)
  assert.equal((await fetch(`${ctx.url}/rec/return?token=${orderId}`)).status, 200)
  await ctx.lab.recorder.waitForDeliveries(2)
  assert.equal((await api(ctx.url, 'POST', '/recordings/refund', { amount: '4.00' })).json.data.status, 201)
  await ctx.lab.recorder.waitForDeliveries(3)
  assert.equal((await api(ctx.url, 'POST', '/recordings/refund', { amount: '8.00' })).json.data.status, 201)
  await ctx.lab.recorder.waitForDeliveries(4)
  const done = await api(ctx.url, 'POST', '/recordings/finish', {})
  assert.equal(done.json.data.deliveries, 4)
  assert.deepEqual(done.json.data.startPoints.sort(), ['SP0', 'SP1', 'SP2', 'SP3'])
})

test('a second checkout in the same session and an unknown refund amount are refused', async () => {
  await api(ctx.url, 'POST', '/recordings/start', { name: 'refusals', targetId: 'mugshop-reference' })
  assert.equal((await api(ctx.url, 'POST', '/recordings/refund', { amount: '4.00' })).status, 409)
  assert.equal((await api(ctx.url, 'POST', '/recordings/checkout', {})).status, 200)
  assert.equal((await api(ctx.url, 'POST', '/recordings/checkout', {})).status, 409)
  assert.equal((await api(ctx.url, 'POST', '/recordings/refund', { amount: '99.00' })).status, 400)
  await ctx.lab.recorder.finish()
})
