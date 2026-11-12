import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { scenarioById } from '../server/scenarios/definitions.js'
import { runScenario } from '../server/scenarios/engine.js'
import { createMugshopTarget } from '../server/targets/mugshop.js'
import { api, startLab } from './helpers.js'

let ctx
let careless

before(async () => {
  ctx = await startLab()
  careless = ctx.lab.addTarget(createMugshopTarget(ctx.lab, { id: 'mugshop-careless', variant: 'reference', env: { REFUND_CLAIM: 'off' } }))
})
after(() => ctx.stop())

const run = (id, target) => runScenario({ lab: ctx.lab, scenario: scenarioById(id), recording: ctx.recording(), target })

test('C-DUP: with the claim, the same refund from admin then support becomes one PayPal refund (green)', async () => {
  const result = await run('C-DUP', ctx.lab.target('mugshop-reference'))
  assert.equal(result.status, 'green', result.headline)
  assert.equal(result.ledger.refunds.length, 1)
  assert.deepEqual(result.deliveries.map((d) => d.status).sort(), [201, 409])
})

test('C-DUP: without the claim PayPal gets two refunds and the verifier turns red', async () => {
  const result = await run('C-DUP', careless)
  assert.equal(result.status, 'red')
  assert.match(result.headline, /PayPal refunds: 2 for one request/)
  assert.equal(result.ledger.refunds.length, 2)
})

test('C-UNK: the proxy forwards the refund, cuts the reply, and the app settles it by re-sending the same PayPal-Request-Id (green)', async () => {
  const result = await run('C-UNK', ctx.lab.target('mugshop-reference'))
  assert.equal(result.status, 'green', result.headline)
  const cut = result.proxyLog.find((p) => p.cut)
  assert.ok(cut, 'the proxy cut a reply')
  assert.equal(cut.status, 201, 'PayPal had already done the refund')
  const resends = result.proxyLog.filter((p) => p.method === 'POST' && /refund$/.test(p.path) && p.requestId === cut.requestId && !p.cut)
  assert.equal(resends.length, 1)
  assert.equal(resends[0].status, 200, 'a repeat with the same PayPal-Request-Id answers 200, as measured on the sandbox')
  assert.equal(result.ledger.refunds.length, 1)
  assert.equal(result.stateAfter.refunds.length, 1)
})

test('C-UNK: a careless app reports failure although PayPal refunded, and the verifier turns red', async () => {
  const result = await run('C-UNK', careless)
  assert.equal(result.status, 'red')
  assert.match(result.headline, /reported the refund as failed/)
  assert.equal(result.ledger.refunds.length, 1)
  assert.equal(result.stateAfter.refunds.length, 0)
})

test('contract runs can be repeated on the same payment (the stand-in forgets earlier refunds between runs)', async () => {
  for (let i = 0; i < 3; i += 1) assert.equal((await run('C-DUP', ctx.lab.target('mugshop-reference'))).status, 'green')
})

test('a second return path booked once is a shop-side-only judgement (PayPal already captured)', async () => {
  const result = await run('C-DUP-CAPTURE', ctx.lab.target('mugshop-reference'))
  assert.equal(result.status, 'green')
  assert.equal(scenarioById('C-DUP-CAPTURE').movesMoney, false)
})

test('money-moving contract scenarios cannot be started without a confirmation card', async () => {
  const body = { scenarioId: 'C-DUP', recordingId: 'mugshop-demo', targetId: 'mugshop-reference' }
  assert.equal((await api(ctx.url, 'POST', '/runs', body)).status, 403)
  const wrong = await api(ctx.url, 'POST', '/contract/cards/00000000-0000-4000-8000-000000000000/run', {})
  assert.equal(wrong.status, 404)
})

test('the confirmation card shows amount, capture id and who runs it; a card works once', async () => {
  const body = { scenarioId: 'C-UNK', recordingId: 'mugshop-demo', targetId: 'mugshop-reference' }
  const card = (await api(ctx.url, 'POST', '/contract/cards', body)).json.data
  assert.equal(card.amount, '4.00')
  assert.equal(card.currency, 'USD')
  assert.equal(card.captureId, ctx.recording().contract.captureId)
  assert.equal(card.operator, 'you')
  assert.match(card.environment, /Local PayPal stand-in/)
  const ran = await api(ctx.url, 'POST', `/contract/cards/${card.token}/run`, {})
  assert.equal(ran.status, 200)
  assert.equal(ran.json.data.status, 'green')
  assert.equal(ran.json.data.confirmedBy, 'you')
  assert.equal((await api(ctx.url, 'POST', `/contract/cards/${card.token}/run`, {})).status, 404)
})

test('an expired card is refused and cancelling removes it', async (t) => {
  const body = { scenarioId: 'C-DUP', recordingId: 'mugshop-demo', targetId: 'mugshop-reference' }
  const stale = (await api(ctx.url, 'POST', '/contract/cards', body)).json.data
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 6 * 60 * 1000 })
  const late = await api(ctx.url, 'POST', `/contract/cards/${stale.token}/run`, {})
  t.mock.timers.reset()
  assert.equal(late.status, 410)
  const fresh = (await api(ctx.url, 'POST', '/contract/cards', body)).json.data
  await api(ctx.url, 'DELETE', `/contract/cards/${fresh.token}`)
  assert.equal((await api(ctx.url, 'POST', `/contract/cards/${fresh.token}/run`, {})).status, 404)
})

test('the Contract tab data pairs plan rows with results and keeps the invariants read only', async () => {
  const data = (await api(ctx.url, 'GET', '/contract?recordingId=mugshop-demo&targetId=mugshop-reference')).json.data
  assert.equal(data.available, true)
  const refundRow = data.rows.find((r) => r.kind === 'duplicate-claims' && r.write === 'refundCapturedPayment')
  assert.equal(refundRow.scenario, 'C-DUP')
  assert.equal(refundRow.status, 'green')
  assert.match(data.annotated, /Proven by EchoBench/)
  assert.ok(data.rows.filter((r) => r.kind === 'cross-operation-invariants').every((r) => r.status === 'readonly'))
  assert.equal(data.tbd.length, 0)
})
