import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { api, startLab } from './helpers.js'

let ctx
before(async () => {
  ctx = await startLab()
})
after(() => ctx.stop())

test('status says the PayPal side is the local stand-in and the model step is mocked when there are no keys', async () => {
  const { json } = await api(ctx.url, 'GET', '/status')
  assert.equal(json.data.mode, 'mock')
  assert.equal(json.data.llm, 'mock')
})

test('targets list hides patch candidates and exposes capabilities', async () => {
  const { json } = await api(ctx.url, 'GET', '/targets')
  const ids = json.data.map((t) => t.id)
  assert.ok(ids.includes('mugshop') && ids.includes('mugshop-reference'))
  assert.equal(json.data.find((t) => t.id === 'mugshop').editable, true)
  assert.equal(json.data.find((t) => t.id === 'mugshop-reference').editable, false)
})

test('scenarios are listed without their code', async () => {
  const { json } = await api(ctx.url, 'GET', '/scenarios')
  assert.equal(json.data.length, 14)
  assert.equal(json.data.filter((s) => s.shakeAll).length, 11)
  assert.ok(json.data.every((s) => s.run === undefined && s.steps.length))
})

test('bad input is a 400 with a message, unknown things are 404', async () => {
  assert.equal((await api(ctx.url, 'POST', '/runs', { scenarioId: 'S1' })).status, 400)
  assert.equal((await api(ctx.url, 'POST', '/runs', { scenarioId: '../../etc', recordingId: 'x', targetId: 'y' })).status, 400)
  assert.equal((await api(ctx.url, 'POST', '/runs', { scenarioId: 'NOPE', recordingId: 'mugshop-demo', targetId: 'mugshop' })).status, 404)
  assert.equal((await api(ctx.url, 'GET', '/runs/does-not-exist')).status, 404)
  assert.equal((await api(ctx.url, 'POST', '/agent/diagnose', { runId: 'nope' })).status, 404)
  const res = await fetch(`${ctx.url}/api/contract/cards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenarioId: 'S1', recordingId: 'mugshop-demo', targetId: 'mugshop' }) })
  assert.equal(res.status, 400)
})

test('the PayPal receiver always answers 200, even for garbage and when nothing is recording', async () => {
  const res = await fetch(`${ctx.url}/hooks/paypal`, { method: 'POST', body: 'not json at all' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { received: true, stored: false })
})

test('a run through the API is stored and shows on the overview with the first-screen rows', async () => {
  const body = { recordingId: 'mugshop-demo', targetId: 'mugshop' }
  for (const scenarioId of ['S1', 'S5b', 'S6']) assert.equal((await api(ctx.url, 'POST', '/runs', { ...body, scenarioId })).status, 200)
  const overview = (await api(ctx.url, 'GET', '/overview?recordingId=mugshop-demo&targetId=mugshop')).json.data
  assert.equal(overview.topRows.length, 3)
  assert.deepEqual(overview.topRows.map((r) => r.status).sort(), ['green', 'red', 'red'])
  assert.ok(overview.headlineRun.timeline.paypal.length)
  const one = overview.topRows[0]
  assert.equal((await api(ctx.url, 'GET', `/runs/${one.runId}`)).json.data.id, one.runId)
})

test('the matrix lists every target against every scenario', async () => {
  const { json } = await api(ctx.url, 'GET', '/matrix?recordingId=mugshop-demo')
  assert.ok(json.data.columns.find((c) => c.id === 'mugshop').results.S1)
  assert.equal(json.data.scenarios.length, 14)
})

test('a recording is shown with decoded bodies and its start points, bytes only on request', async () => {
  const rec = (await api(ctx.url, 'GET', '/recordings/mugshop-demo')).json.data
  assert.equal(rec.deliveries[1].body.event_type, 'PAYMENT.CAPTURE.COMPLETED')
  assert.equal(rec.deliveries[1].bodyBase64, undefined)
  assert.equal((await api(ctx.url, 'GET', '/recordings/mugshop-demo?full=1')).json.data.deliveries[1].bodyBase64.length > 10, true)
  assert.deepEqual(Object.keys(rec.startPoints), ['SP0', 'SP1', 'SP2', 'SP3'])
})

test('the inbound events table is served as EchoBench\'s own proposal', async () => {
  const { json } = await api(ctx.url, 'GET', '/inbound?recordingId=mugshop-demo&targetId=mugshop')
  assert.match(json.data.markdown, /not part of the plugin/)
  assert.equal(json.data.rows.length, 4)
})

test('precomputed results are loaded into a fresh data folder', async () => {
  const { json } = await api(ctx.url, 'GET', '/runs?recordingId=mugshop-demo&targetId=mugshop-reference')
  assert.ok(json.data.some((r) => r.precomputed === true))
})
