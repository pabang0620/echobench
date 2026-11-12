import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { api, startLab } from './helpers.js'
import { scenarioById } from '../server/scenarios/definitions.js'
import { runScenario } from '../server/scenarios/engine.js'

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
let ctx
before(async () => {
  ctx = await startLab()
})
after(() => ctx.stop())

test('a recording made on the PayPal sandbox answers na on the stand-in instead of failing', async () => {
  const sandboxLike = { ...ctx.recording(), source: 'live-sandbox' }
  const run = await runScenario({ lab: ctx.lab, scenario: scenarioById('S1'), recording: sandboxLike, target: ctx.lab.target('mugshop-reference') })
  assert.equal(run.status, 'na')
  assert.match(run.headline, /made on the PayPal sandbox/)
})

test('a contract-only recording answers na for webhook scenarios', async () => {
  const contractOnly = { ...ctx.recording(), deliveries: [], startPoints: {}, extras: {} }
  const run = await runScenario({ lab: ctx.lab, scenario: scenarioById('S1'), recording: contractOnly, target: ctx.lab.target('mugshop-reference') })
  assert.equal(run.status, 'na')
  assert.match(run.headline, /only a contract payment/)
})

test('the expected final status is the one the target itself reported at SP1, not MugShop\'s word', async () => {
  const rec = ctx.recording()
  const renamed = { ...rec, startPoints: { ...rec.startPoints, SP1: { ...rec.startPoints.SP1, fingerprint: { ...rec.startPoints.SP1.fingerprint, status: 'SOMETHING_ELSE' } } } }
  const run = await runScenario({ lab: ctx.lab, scenario: scenarioById('S3'), recording: renamed, target: ctx.lab.target('mugshop-reference') })
  assert.equal(run.status, 'red')
  assert.match(run.headline, /expected SOMETHING_ELSE/)
})

test('C-DUP sends the admin refund and then the support refund, one after the other', async () => {
  const run = await runScenario({ lab: ctx.lab, scenario: scenarioById('C-DUP'), recording: ctx.recording(), target: ctx.lab.target('mugshop-reference') })
  assert.equal(run.status, 'green', run.headline)
  assert.deepEqual(run.deliveries.map((d) => d.status), [201, 409])
})

test('recordings made against the agent-built handlers stay out of the picker; the A/B tab reads them', async () => {
  const list = (await api(ctx.url, 'GET', '/recordings')).json.data
  assert.equal(list[0].id, 'mugshop-demo')
  assert.ok(list.every((r) => !String(r.targetId).startsWith('ab-')))
  if (existsSync(path.join(APP, 'builtin', 'ab-runs.json'))) {
    const matrix = (await api(ctx.url, 'GET', '/matrix?recordingId=mugshop-demo')).json.data
    const off = matrix.columns.find((c) => c.id === 'ab-plugin-off')
    assert.equal(off.recordingId, 'ab-plugin-off-demo')
    assert.ok(Object.keys(off.results).length >= 10)
  }
})

test('R2 logs and request are kept with the generated code', () => {
  const request = readFileSync(path.join(APP, 'targets', 'ab', 'REQUEST.md'), 'utf8')
  for (const side of ['plugin-off', 'plugin-on']) {
    const log = readFileSync(path.join(APP, 'targets', 'ab', side, 'GENERATION_LOG.md'), 'utf8')
    assert.match(log, /claude-sonnet-5-5/)
    assert.ok(existsSync(path.join(APP, 'targets', 'ab', side, 'echobench.target.json')))
  }
  assert.match(request, /Adapter contract/)
})
