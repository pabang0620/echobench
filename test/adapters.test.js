import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { scenarioById } from '../server/scenarios/definitions.js'
import { runScenario } from '../server/scenarios/engine.js'
import { createMugshopTarget } from '../server/targets/mugshop.js'
import { startLab } from './helpers.js'

// The same scenario through both PayPal adapters of MugShop: plain REST and the APIMatic SDK.
// The verdicts must agree, because the contract is about the app's behaviour, not about how it calls PayPal.

let ctx
before(async () => {
  ctx = await startLab()
  for (const impl of ['rest', 'sdk']) {
    ctx.lab.addTarget(createMugshopTarget(ctx.lab, { id: `mugshop-${impl}`, variant: 'reference', env: { PAYPAL_CLIENT_IMPL: impl } }))
  }
})
after(() => ctx.stop())

const run = (id, impl) => runScenario({ lab: ctx.lab, scenario: scenarioById(id), recording: ctx.recording(), target: ctx.lab.target(`mugshop-${impl}`) })

test('the target reports which PayPal adapter it runs', async () => {
  for (const impl of ['rest', 'sdk']) {
    const target = ctx.lab.target(`mugshop-${impl}`)
    await target.start?.()
    const health = await (await fetch(`${target.baseUrl}/health`)).json()
    assert.equal(health.paypalClient, impl)
  }
})

test('C-DUP gives the same verdict and one refund through REST and through the SDK', async () => {
  const [rest, sdk] = [await run('C-DUP', 'rest'), await run('C-DUP', 'sdk')]
  assert.equal(rest.status, 'green', rest.headline)
  assert.equal(sdk.status, 'green', sdk.headline)
  assert.equal(rest.ledger.refunds.length, 1)
  assert.equal(sdk.ledger.refunds.length, 1)
  assert.deepEqual(sdk.deliveries.map((d) => d.status).sort(), rest.deliveries.map((d) => d.status).sort())
})

test('C-UNK through the SDK: the reply is cut after PayPal acted, the same PayPal-Request-Id is sent again, and the SDK key is a different one', async () => {
  const [rest, sdk] = [await run('C-UNK', 'rest'), await run('C-UNK', 'sdk')]
  assert.equal(rest.status, 'green', rest.headline)
  assert.equal(sdk.status, 'green', sdk.headline)
  assert.equal(sdk.ledger.refunds.length, 1)
  const sends = sdk.proxyLog.filter((p) => p.method === 'POST' && /refund$/.test(p.path))
  assert.equal(sends.length, 2)
  assert.equal(sends[0].requestId, sends[1].requestId)
  assert.ok(sends[0].sdkKey && sends[1].sdkKey, 'the SDK sent its own Idempotency-Key')
  assert.notEqual(sends[0].sdkKey, sends[1].sdkKey)
  assert.equal(rest.proxyLog.filter((p) => p.sdkKey).length, 0, 'the REST adapter sends no Idempotency-Key')
})

test('a webhook scenario (S1, duplicate delivery) gives the same verdict through both adapters', async () => {
  const [rest, sdk] = [await run('S1', 'rest'), await run('S1', 'sdk')]
  assert.equal(sdk.status, rest.status)
  assert.equal(sdk.headline, rest.headline)
})
