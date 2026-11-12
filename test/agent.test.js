import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { APP_ROOT } from '../server/config.js'
import { createAgentSession, MAX_PATCH_ATTEMPTS } from '../server/agent/tools.js'
import { applyEdits, createCandidate, discardCandidate } from '../server/agent/patch.js'
import { unifiedDiff } from '../server/agent/diff.js'
import { explainRun } from '../server/agent/explain.js'
import { api, startLab } from './helpers.js'

let ctx
let diagnosis
// One visitor for the whole file: a diagnosis and its Apply belong to the visitor who asked.
const SID = 'e5'.repeat(16)
const call = (method, route, body) => api(ctx.url, method, route, body, SID)
before(async () => {
  ctx = await startLab()
  const run = (await call('POST', '/runs', { scenarioId: 'S1', recordingId: 'mugshop-demo', targetId: 'mugshop' })).json.data
  diagnosis = (await call('POST', '/agent/diagnose', { runId: run.id })).json.data
})
after(() => ctx.stop())

const sessionFor = async (scenarioId = 'S1') => {
  const run = (await call('POST', '/runs', { scenarioId, recordingId: 'mugshop-demo', targetId: 'mugshop' })).json.data
  return createAgentSession(ctx.lab, { run, recording: ctx.recording(), target: ctx.lab.target('mugshop') })
}

test('without an Anthropic key the diagnosis is mocked, but the tools, tsc and re-runs are real', () => {
  assert.equal(diagnosis.mode, 'mock')
  const toolNames = diagnosis.steps.map((s) => s.tool)
  for (const name of ['get_failures', 'get_timeline', 'read_handler_file', 'propose_patch', 'run_scenario']) assert.ok(toolNames.includes(name), name)
  assert.equal(diagnosis.candidate.tscOk, true)
  assert.equal(diagnosis.candidate.rerun.status, 'green')
  assert.ok(diagnosis.candidate.suite.length >= 10)
})

test('the explanation names the cause in plain words and quotes the verdicts', () => {
  assert.match(diagnosis.explanation.cause.join(' '), /ships unconditionally/)
  assert.ok(diagnosis.explanation.evidence.some((e) => e.startsWith('I1 fail')))
  assert.ok(diagnosis.explanation.fix.length >= 1)
})

test('the patch is shown as a diff against the original and only counts as verified when tsc and the re-runs pass', () => {
  assert.match(diagnosis.candidate.diff, /^--- a\/src\/webhook.ts/m)
  assert.match(diagnosis.candidate.diff, /^-.*PLANTED BUG A/m)
  assert.equal(diagnosis.candidate.verified, true)
})

test('the repository source is untouched by a diagnosis', () => {
  assert.match(readFileSync(path.join(APP_ROOT, 'targets', 'mugshop', 'src', 'webhook.ts'), 'utf8'), /PLANTED BUG A/)
})

test('Apply needs confirm: true and a verified patch, and then the planted workspace turns green', async () => {
  const refused = await call('POST', `/agent/${diagnosis.id}/apply`, { confirm: false })
  assert.equal(refused.status, 400)
  const applied = await call('POST', `/agent/${diagnosis.id}/apply`, { confirm: true })
  assert.equal(applied.status, 200)
  assert.equal(applied.json.data.rerun.status, 'green')
  assert.deepEqual(applied.json.data.apply.files, ['src/webhook.ts'])
  assert.equal(applied.json.data.apply.appliedBy, 'you')
  assert.equal((await call('POST', `/agent/${diagnosis.id}/apply`, { confirm: true })).status, 409)
  assert.equal((await call('GET', '/applies')).json.data.length, 1)
  // the original source file in the repository is still the planted version
  assert.match(readFileSync(path.join(APP_ROOT, 'targets', 'mugshop', 'src', 'webhook.ts'), 'utf8'), /PLANTED BUG A/)
  // and the lab can put the planted copy back
  await call('POST', '/targets/mugshop/reset-workspace', {})
  const again = (await call('POST', '/runs', { scenarioId: 'S1', recordingId: 'mugshop-demo', targetId: 'mugshop' })).json.data
  assert.equal(again.status, 'red')
})

test('a patch that does not type-check is reported with the tsc output and is not verified', async () => {
  const { tools } = await sessionFor()
  const current = readFileSync(path.join(APP_ROOT, 'targets', 'mugshop', 'src', 'webhook.ts'), 'utf8')
  const result = await tools.propose_patch({ edits: [{ file: 'src/webhook.ts', content: `${current}\nconst broken: number = 'text'\n` }] })
  assert.equal(result.ok, false)
  assert.match(result.tsc.output, /TS2322|not assignable/)
  await tools.discard()
})

test('patch edits are all-or-none, must match exactly once, and stay inside src/', async () => {
  const { dir, id } = createCandidate(ctx.lab.cfg.dataDir, ctx.lab.target('mugshop').meta.workspace)
  assert.throws(() => applyEdits(dir, [{ file: '../../etc/passwd', content: 'x' }]), /not a source file/)
  assert.throws(() => applyEdits(dir, [{ file: 'src/webhook.ts', old_str: 'import', new_str: 'x' }]), /exactly once/)
  assert.throws(() => applyEdits(dir, [{ file: 'src/nothing.ts', old_str: 'a', new_str: 'b' }]), /Handler files only/)
  assert.throws(() => applyEdits(dir, [{ file: 'package.json', content: '{}' }]), /not a source file/)
  const before = readFileSync(path.join(dir, 'src', 'money.ts'), 'utf8')
  assert.throws(() => applyEdits(dir, [{ file: 'src/money.ts', content: 'export {}' }, { file: 'src/nothing.ts', old_str: 'a', new_str: 'b' }]))
  assert.equal(readFileSync(path.join(dir, 'src', 'money.ts'), 'utf8'), before)
  discardCandidate(dir)
  assert.equal(existsSync(dir), false)
  void id
})

test('at most three patch attempts per diagnosis', async () => {
  const { tools } = await sessionFor()
  const bad = { edits: [{ file: 'src/webhook.ts', old_str: 'no such text', new_str: 'x' }] }
  for (let i = 0; i < MAX_PATCH_ATTEMPTS; i += 1) assert.equal((await tools.propose_patch(bad)).ok, false)
  assert.match((await tools.propose_patch(bad)).error, /At most 3/)
})

test('the model has no way to run contract scenarios, write to PayPal, or read outside the copy', async () => {
  const { tools } = await sessionFor()
  assert.match((await tools.run_scenario({ scenario_id: 'C-DUP' })).error, /move money/)
  assert.match((await tools.run_scenario({ scenario_id: 'C-UNK' })).error, /person/)
  assert.match((await tools.read_handler_file({ path: '../../.env' })).error, /Only files under src/)
  assert.match((await tools.read_handler_file({ path: 'src/../../server/config.js' })).error, /Only files under src/)
  for (const name of Object.keys(tools)) assert.doesNotMatch(name, /refund|capture_order|create_order|apply/)
  assert.deepEqual(Object.keys(tools).sort(), ['check_invariants', 'discard', 'get_delivery', 'get_failures', 'get_timeline', 'lookup_sdk', 'paypal_truth', 'propose_patch', 'read_contract', 'read_handler_file', 'run_scenario'])
})

test('read-only tools return PayPal records, SDK notes and recorded deliveries', async () => {
  const { tools } = await sessionFor()
  const truth = await tools.paypal_truth({ order_id: ctx.recording().orderId })
  assert.equal(truth.refunds.length, 2)
  // The account runs passed the scenario id; both that and no id read the recorded order.
  assert.equal((await tools.paypal_truth({ order_id: 'S1' })).refunds.length, 2)
  assert.equal((await tools.paypal_truth({})).refunds.length, 2)
  assert.equal((await tools.get_timeline()).orderId, ctx.recording().orderId)
  assert.match((await tools.lookup_sdk({ name: 'refundCapturedPayment' })).note, /payPalRequestId/)
  assert.match((await tools.lookup_sdk({ name: 'refundCapturedPayment' })).note, /Idempotency-Key/)
  const delivery = await tools.get_delivery({ label: 'completed' })
  assert.equal(delivery.body.event_type, 'PAYMENT.CAPTURE.COMPLETED')
  assert.match(delivery.headers['paypal-transmission-sig'], /\.\.\.$/)
  const contract = await tools.read_contract()
  assert.ok(contract.rows.length >= 5)
})

test('only failing webhook runs are diagnosed', async () => {
  const green = (await call('POST', '/runs', { scenarioId: 'S6', recordingId: 'mugshop-demo', targetId: 'mugshop' })).json.data
  assert.equal((await call('POST', '/agent/diagnose', { runId: green.id })).status, 400)
})

test('explanations are written from the run evidence for each kind of failure', () => {
  const refund = explainRun({ scenarioId: 'S5b', verdicts: [{ rule: 'I2', status: 'fail', message: 'books differ', evidence: {} }] })
  assert.match(refund.cause[0], /overwrites the first/)
  const missed = explainRun({ scenarioId: 'S5', verdicts: [{ rule: 'I5', status: 'fail', message: 'late', evidence: {} }] })
  assert.match(missed.cause[0], /Storing event ids cannot help/)
})

test('unified diff shows only changed lines with context', () => {
  const diff = unifiedDiff('a\nb\nc\nd\ne\nf\ng\nh', 'a\nb\nc\nX\ne\nf\ng\nh', 'x.ts')
  assert.match(diff, /^-d$/m)
  assert.match(diff, /^\+X$/m)
  assert.equal(unifiedDiff('same', 'same', 'x.ts'), '')
})
