import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createLab } from '../server/lab.js'
import { scenarioById } from '../server/scenarios/definitions.js'
import { runScenario } from '../server/scenarios/engine.js'
import { buildProxyStory } from '../server/scenarios/proxyStory.js'
import { buildTimeline } from '../server/scenarios/timeline.js'
import { evaluate } from '../server/oracle.js'
import { inboundTable } from '../server/contract/inbound.js'
import { mugshopCells } from '../server/contract/inboundMugshop.js'
import { isPatched } from '../server/targets/view.js'
import { workspaceDir } from '../server/targets/mugshop.js'
import { api, startLab } from './helpers.js'

let ctx
before(async () => {
  ctx = await startLab()
})
after(() => ctx.stop())

const runOn = (id, targetId) => runScenario({ lab: ctx.lab, scenario: scenarioById(id), recording: ctx.recording(), target: ctx.lab.target(targetId) })
const VISITOR = 'a'.repeat(32)
const post = (route, body) => api(ctx.url, 'POST', route, body, VISITOR)
const get = (route) => api(ctx.url, 'GET', route, undefined, VISITOR)

// ---- item 1: the label follows the working copy, and Reset brings the red screen back

test('after Apply the target says "your patched copy", and Reset to planted bugs brings the red start back', async () => {
  const before = (await get('/targets')).json.data.find((t) => t.id === 'mugshop')
  assert.equal(before.label, 'MugShop (planted bugs)')
  assert.equal(before.patched, false)
  assert.match(before.note, /three planted bugs/)

  const run = (await post('/runs', { scenarioId: 'S1', recordingId: 'mugshop-demo', targetId: 'mugshop' })).json.data
  const diagnosis = (await post('/agent/diagnose', { runId: run.id })).json.data
  assert.equal((await post(`/agent/${diagnosis.id}/apply`, { confirm: true })).status, 200)

  const patched = (await get('/targets')).json.data.find((t) => t.id === 'mugshop')
  assert.equal(patched.label, 'MugShop (your patched copy)')
  assert.equal(patched.patched, true)
  assert.match(patched.note, /Reset to planted bugs/)
  const matrix = (await get('/matrix?recordingId=mugshop-demo')).json.data
  assert.equal(matrix.columns.find((c) => c.id === 'mugshop').label, 'MugShop (your patched copy)')

  // the same visitor's next run is on the patched copy
  assert.equal((await post('/runs', { scenarioId: 'S1', recordingId: 'mugshop-demo', targetId: 'mugshop' })).json.data.status, 'green')

  assert.equal((await post('/targets/mugshop/reset-workspace')).status, 200)
  const reset = (await get('/targets')).json.data.find((t) => t.id === 'mugshop')
  assert.equal(reset.label, 'MugShop (planted bugs)')
  assert.equal(reset.patched, false)
  const overview = (await get('/overview?recordingId=mugshop-demo&targetId=mugshop')).json.data
  assert.equal(overview.topRows.filter((r) => r.status === 'red').length, 2, 'two red rows and one green row, as at the first visit')
  assert.equal(overview.topRows[2].status, 'green')
  assert.equal((await post('/runs', { scenarioId: 'S1', recordingId: 'mugshop-demo', targetId: 'mugshop' })).json.data.status, 'red')
})

test('the reference and contrast copies are never reported as patched, and the reset route refuses a target that is not editable', async () => {
  assert.equal(isPatched(ctx.lab.target('mugshop-reference')), false)
  assert.equal((await post('/targets/mugshop-reference/reset-workspace')).status, 400)
})

test('RESET_WORKSPACE_ON_START puts the planted source back and forgets the old runs of that target', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'echobench-reset-'))
  const first = await createLab({ dataDir, mode: 'mock', anthropicKey: '', llmBackend: 'mock', recordedDir: '' })
  try {
    writeFileSync(path.join(workspaceDir(dataDir, 'mugshop'), 'src', 'money.ts'), '// patched by a visitor\n')
    assert.equal(isPatched(first.target('mugshop')), true)
  } finally {
    await first.stop()
  }
  const second = await createLab({ dataDir, mode: 'mock', anthropicKey: '', llmBackend: 'mock', recordedDir: '', resetWorkspaceOnStart: true })
  try {
    assert.equal(isPatched(second.target('mugshop')), false)
    assert.doesNotMatch(readFileSync(path.join(workspaceDir(dataDir, 'mugshop'), 'src', 'money.ts'), 'utf8'), /patched by a visitor/)
  } finally {
    await second.stop()
    rmSync(dataDir, { recursive: true, force: true })
  }
})

// ---- item 3: sandbox evidence shipped with the app

test('sandbox evidence is served with its date and the ids of V4, V5 and V11, and holds no secret', async () => {
  const data = (await api(ctx.url, 'GET', '/sandbox-evidence')).json.data
  assert.equal(data.measuredAt, '2026-11-12')
  assert.match(data.label, /Measured on the PayPal sandbox/)
  assert.match(data.label, /Not re-run now/)
  for (const id of ['V4', 'V5', 'V11']) assert.ok(data.items.some((i) => i.id === id && ['PASS', 'FOUND'].includes(i.result)), id)
  assert.ok(data.items.some((i) => /415/.test(i.evidence)))
  const text = JSON.stringify(data)
  assert.doesNotMatch(text, /secret|password|bearer|client_id|access_token/i)
  assert.ok(data.notRunOnTheSandbox.length >= 3)
})

// ---- item 4: the contrast copy

test('contrast copy: C-DUP is red with two PayPal refunds, MugShop is green with one', async () => {
  const targets = (await api(ctx.url, 'GET', '/targets')).json.data
  const contrast = targets.find((t) => t.id === 'mugshop-contrast')
  assert.equal(contrast.label, 'MugShop (contract removed, contrast)')
  assert.match(contrast.note, /Not a planted bug/)
  const off = await runOn('C-DUP', 'mugshop-contrast')
  assert.equal(off.status, 'red')
  assert.match(off.headline, /PayPal refunds: 2 for one request/)
  const on = await runOn('C-DUP', 'mugshop-reference')
  assert.equal(on.status, 'green')
  assert.equal(on.ledger.refunds.length, 1)
})

test('the compare route lists both copies for C-DUP, C-UNK and C-UNK-CAPTURE', async () => {
  for (const [scenarioId, targetId] of [['C-DUP', 'mugshop-contrast'], ['C-UNK', 'mugshop-contrast'], ['C-DUP', 'mugshop']]) {
    ctx.lab.store.saveRun(await runOn(scenarioId, targetId))
  }
  const data = (await api(ctx.url, 'GET', '/contract/compare?recordingId=mugshop-demo')).json.data
  assert.deepEqual(data.scenarios.map((s) => s.id), ['C-DUP', 'C-UNK', 'C-UNK-CAPTURE'])
  assert.deepEqual(data.columns.map((c) => c.id), ['mugshop', 'mugshop-contrast'])
  assert.equal(data.columns[1].results['C-DUP'].status, 'red')
  assert.equal(data.columns[1].results['C-UNK'].status, 'red')
  assert.equal(data.columns[0].results['C-DUP'].status, 'green')
  assert.match(data.note, /not a planted bug/i)
})

// ---- item 5: the proxy record is part of the result

test('C-UNK carries the proxy lines: same PayPal-Request-Id, different Idempotency-Key, one refund, and a "reply cut" cell', async () => {
  const run = await runOn('C-UNK', 'mugshop-reference')
  assert.equal(run.status, 'green', run.headline)
  const story = run.proxyStory
  assert.equal(story.operation, 'refund')
  assert.equal(story.sameRequestId, true)
  assert.equal(story.sdkKeysDiffer, true)
  assert.equal(story.total, 1)
  assert.match(story.lines[0], /^1 POST \/refund PayPal-Request-Id=\S+ Idempotency-Key=\S+ -> forwarded to PayPal \(\d+\), reply cut$/)
  assert.match(story.lines[1], /^2 POST \/refund PayPal-Request-Id=\S+ Idempotency-Key=\S+ -> \d+ same PayPal-Request-Id as the cut call/)
  assert.equal(story.lines.at(-1), 'PayPal refunds on this order: 1')
  assert.match(story.note, /Idempotency-Key is different on each call/)
  assert.ok(run.timeline.paypal.some((c) => /reply cut/.test(c.text)))
})

test('buildProxyStory and buildTimeline on a made-up log: no cut means no "reply cut" cell and no story for reads', () => {
  const read = [{ method: 'GET', path: '/v2/checkout/orders/1', requestId: null, sdkKey: null, status: 200, cut: false }]
  assert.equal(buildProxyStory({ proxyLog: read, ledgerNew: [], ledger: { captures: [] } }), null)
  const ledger = { id: 'O1', captures: [{ amount: '12.00' }], refunds: [] }
  const after = { fulfilled_count: 0, shipments: [], refunds: [], on_hold: false }
  assert.ok(!buildTimeline({ ledger, after, verdicts: [], proxyLog: read }).paypal.some((c) => /cut/.test(c.text)))
  assert.ok(buildTimeline({ ledger, after, verdicts: [], proxyLog: [{ ...read[0], cut: true }] }).paypal.some((c) => /reply cut/.test(c.text)))
})

// ---- item 9: C-UNK-CAPTURE

test('C-UNK-CAPTURE: the capture reply is cut, the app reads the order back and books one capture (green), and PayPal records are put back', async () => {
  const orderId = ctx.recording().orderId
  const before = await ctx.lab.truth.order(orderId)
  const run = await runOn('C-UNK-CAPTURE', 'mugshop-reference')
  assert.equal(run.status, 'green', run.headline)
  assert.match(run.headline, /read the order back with getOrder/)
  assert.ok(run.proxyLog.some((p) => p.cut && /capture$/.test(p.path)))
  assert.equal(run.proxyStory.operation, 'capture')
  assert.equal(run.ledger.captures.length, 1)
  assert.equal(run.stateAfter.captures.length, 1)
  const afterRun = await ctx.lab.truth.order(orderId)
  assert.deepEqual(afterRun.captures, before.captures, 'the stand-in goes back to the recorded capture')
  assert.equal((await runOn('S1', 'mugshop-reference')).status, 'green', 'other scenarios still work on the same order')
})

test('C-UNK-CAPTURE is na on the real sandbox (an order cannot be un-captured there) and the plan row now points at it', async () => {
  const run = await runScenario({ lab: { mock: null }, scenario: scenarioById('C-UNK-CAPTURE'), recording: { id: 'r' }, target: { id: 't', capabilities: { returnPath: true } } })
  assert.equal(run.status, 'na')
  assert.match(run.headline, /cannot un-capture/)
  const data = (await api(ctx.url, 'GET', '/contract?recordingId=mugshop-demo&targetId=mugshop-reference')).json.data
  const row = data.rows.find((r) => r.kind === 'unknown-outcomes' && r.write === 'captureOrder')
  assert.equal(row.scenario, 'C-UNK-CAPTURE')
  assert.notEqual(row.status, 'untested')
})

test('I7 for C-UNK-CAPTURE fails when the app never read the order back or reported a failure', () => {
  const base = {
    scenario: scenarioById('C-UNK-CAPTURE'),
    expect: {},
    after: { captures: [], refunds: [], fulfilled_count: 0, shipments: [] },
    ledger: { captures: [{ id: 'CAP1', amount: '12.00' }], refunds: [] },
    ledgerNew: [],
    ledgerBefore: {},
    sent: [{ label: 'return path (reply cut)', status: 502 }],
    proxyLog: [{ method: 'POST', path: '/v2/checkout/orders/1/capture', cut: true, status: 201 }],
  }
  const [bad] = evaluate(['I7'], base)
  assert.equal(bad.status, 'fail')
  assert.match(bad.message, /reported the capture as failed; it never read the order back; PayPal captured 1, the shop books 0/)
  const [good] = evaluate(['I7'], { ...base, after: { ...base.after, captures: [{ id: 'CAP1' }] }, sent: [{ status: 200 }], proxyLog: [...base.proxyLog, { method: 'GET', path: '/v2/checkout/orders/1', cut: false, status: 200 }] })
  assert.equal(good.status, 'pass')
})

// ---- item 11: Inbound table filled from MugShop's code

test('the Inbound table has no TBD cell for MugShop, names the planted bug, and says the same cells are different on the reference copy', async () => {
  const planted = (await api(ctx.url, 'GET', '/inbound?recordingId=mugshop-demo&targetId=mugshop')).json.data
  assert.doesNotMatch(planted.markdown, /\| TBD \|/)
  assert.equal(planted.rows.length, 4)
  assert.match(planted.rows[1].whatRejects, /planted bug A/)
  assert.match(planted.rows[2].whereStored, /refunds\.paypal_refund_id/)
  const fixed = (await api(ctx.url, 'GET', '/inbound?recordingId=mugshop-demo&targetId=mugshop-reference')).json.data
  assert.match(fixed.rows[0].whatRejects, /duplicate: true/)
  assert.notEqual(fixed.rows[1].whatRejects, planted.rows[1].whatRejects)
  assert.equal(mugshopCells(null), null)
  assert.match(inboundTable({}).markdown, /\| TBD \| TBD \|/, 'a target EchoBench cannot read keeps TBD')
})

// ---- item 12 and 13: progress and waiting

test('Shake all is eleven scenarios the client can run one by one, and the lab reports how many runs it has in hand', async () => {
  const list = (await api(ctx.url, 'GET', '/scenarios')).json.data
  assert.deepEqual(list.filter((s) => s.shakeAll).map((s) => s.id), ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S5b', 'S6', 'S7', 'D1', 'C-DUP-CAPTURE'])
  assert.equal((await api(ctx.url, 'GET', '/status')).json.data.queued, 0)
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const first = ctx.lab.exclusive(() => gate)
  const second = ctx.lab.exclusive(async () => 'second')
  assert.equal((await api(ctx.url, 'GET', '/status')).json.data.queued, 2)
  release()
  await Promise.all([first, second])
  assert.equal(ctx.lab.pending, 0)
})
