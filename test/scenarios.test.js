import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { SCENARIOS, WEBHOOK_SCENARIO_IDS, scenarioById } from '../server/scenarios/definitions.js'
import { runScenario } from '../server/scenarios/engine.js'
import { createMugshopTarget } from '../server/targets/mugshop.js'
import { startLab } from './helpers.js'

let ctx
const results = { mugshop: {}, 'mugshop-reference': {} }

before(async () => {
  ctx = await startLab()
  const recording = ctx.recording()
  for (const targetId of Object.keys(results)) {
    for (const id of [...WEBHOOK_SCENARIO_IDS, 'C-DUP-CAPTURE']) {
      results[targetId][id] = await runScenario({ lab: ctx.lab, scenario: scenarioById(id), recording, target: ctx.lab.target(targetId) })
    }
  }
})
after(() => ctx.stop())

const planted = (id) => results.mugshop[id]
const reference = (id) => results['mugshop-reference'][id]

test('the built-in recording has the four deliveries, a dispute, start points SP0..SP3 and a contract payment', () => {
  const rec = ctx.recording()
  assert.deepEqual(rec.deliveries.map((d) => d.label), ['approved', 'completed', 'refund1', 'refund2'])
  assert.ok(rec.extras.dispute)
  assert.deepEqual(Object.keys(rec.startPoints).sort(), ['SP0', 'SP1', 'SP2', 'SP3'])
  assert.ok(rec.contract.captureId)
})

test('planted bug A (capture handler ships unconditionally): S1 and S2 go red with only capture-event shipments', () => {
  for (const id of ['S1', 'S2']) {
    const run = planted(id)
    assert.equal(run.status, 'red', id)
    assert.equal(run.verdicts[0].rule, 'I1')
    assert.ok(run.stateAfter.shipments.every((s) => s.at_event === 'PAYMENT.CAPTURE.COMPLETED'), `${id} shipped only from the capture event`)
    assert.equal(run.stateAfter.fulfilled_count, 2)
  }
})

test('planted bug B (ships on the approval event): S0, S3 and S4 go red with a shipment before the capture', () => {
  for (const id of ['S0', 'S3', 'S4']) {
    const run = planted(id)
    assert.equal(run.status, 'red', id)
    assert.ok(run.stateAfter.shipments.some((s) => s.at_event === 'CHECKOUT.ORDER.APPROVED'), `${id} has an approval-event shipment`)
  }
  assert.equal(planted('S0').timeline.shop.find((c) => c.text.startsWith('shipped')).flag, true)
})

test('planted bug C (one refund per order, overwritten, nothing reconciles): S5b and S5 go red with both numbers', () => {
  assert.equal(planted('S5b').status, 'red')
  assert.match(planted('S5b').headline, /PayPal refunds 12.00 \(2\), shop books 8.00 \(1\)/)
  assert.equal(planted('S5').status, 'red')
  assert.match(planted('S5').headline, /PayPal records 12.00 refunded, the shop still books 4.00/)
  assert.deepEqual(planted('S5').deliveries.map((d) => d.dropped), [true])
})

test('the old delivery (S7) and the dispute (D1) are caught on the planted handler', () => {
  assert.equal(planted('S7').status, 'red')
  assert.equal(planted('S7').verdicts[0].rule, 'I6')
  assert.equal(planted('D1').status, 'red')
  assert.equal(planted('D1').verdicts[0].rule, 'I8')
})

test('signature checking is correct in MugShop: all three forgeries are rejected and nothing changes (S6 green)', () => {
  for (const results of [planted('S6'), reference('S6')]) {
    assert.equal(results.status, 'green')
    assert.equal(results.deliveries.length, 3)
    assert.ok(results.deliveries.every((d) => d.status === 401))
  }
})

test('the reference fix is green everywhere; only S7 is an amber warning (accepted but ignored)', () => {
  for (const id of [...WEBHOOK_SCENARIO_IDS, 'C-DUP-CAPTURE']) {
    const run = reference(id)
    assert.equal(run.status, id === 'S7' ? 'amber' : 'green', `${id}: ${run.headline}`)
  }
  assert.match(reference('S7').headline, /ignored as already processed/)
})

test('every run starts from a verified start point and says PayPal cannot be rewound', () => {
  for (const run of [...Object.values(results.mugshop), ...Object.values(results['mugshop-reference'])]) {
    assert.equal(run.resetOk, true, run.scenarioId)
    assert.match(run.ledgerFinalNote, /cannot be rewound/)
  }
})

test('scenarios start where the plan says (S5 at SP2, S6 and S7 at SP3, the rest at SP0, S5b at SP1)', () => {
  assert.deepEqual(Object.fromEntries(SCENARIOS.filter((s) => s.kind === 'webhook').map((s) => [s.id, s.startPoint])), {
    S0: 'SP0', S1: 'SP0', S2: 'SP0', S3: 'SP0', S4: 'SP0', S5: 'SP2', S5b: 'SP1', S6: 'SP3', S7: 'SP3', D1: 'SP0',
  })
})

test('a target that is not at the start point is not run: "Reset failed", no event delivered', async () => {
  const rec = structuredClone(ctx.recording())
  rec.dir = ctx.recording().dir
  rec.startPoints.SP0.fingerprint.fulfilled_count = 5
  const run = await runScenario({ lab: ctx.lab, scenario: scenarioById('S1'), recording: rec, target: ctx.lab.target('mugshop') })
  assert.equal(run.status, 'error')
  assert.match(run.headline, /Reset failed/)
  assert.equal(run.resetOk, false)
  assert.deepEqual(run.deliveries, [])
})

test('one scenario does not leak into the next: after S1 (two shipments) S0 still starts at zero', async () => {
  const first = await runScenario({ lab: ctx.lab, scenario: scenarioById('S1'), recording: ctx.recording(), target: ctx.lab.target('mugshop') })
  assert.equal(first.stateAfter.fulfilled_count, 2)
  const second = await runScenario({ lab: ctx.lab, scenario: scenarioById('S0'), recording: ctx.recording(), target: ctx.lab.target('mugshop') })
  assert.equal(second.stateStart.fulfilled_count, 0)
  assert.equal(second.stateStart.processed_event_ids.length, 0)
})

test('start points carry the processed events of the recorded run, so SP3 replays are real duplicates', async () => {
  const rec = ctx.recording()
  assert.equal(rec.startPoints.SP3.fingerprint.processed_event_ids.length, 4)
  assert.equal(rec.startPoints.SP0.fingerprint.processed_event_ids.length, 0)
})

test('a handler that trusts any cert_url accepts the foreign-certificate forgery (S6 red): the check can fail', async () => {
  const naive = ctx.lab.addTarget(createMugshopTarget(ctx.lab, { id: 'mugshop-naive', variant: 'planted', env: { PAYPAL_CERT_PEM_PATH: '', TRUSTED_CERT_HOSTS: '127.0.0.1' } }))
  const run = await runScenario({ lab: ctx.lab, scenario: scenarioById('S6'), recording: ctx.recording(), target: naive })
  assert.equal(run.status, 'red')
  assert.equal(run.verdicts[0].rule, 'I3')
  const accepted = run.deliveries.filter((d) => d.status === 200)
  assert.equal(accepted.length, 1)
  assert.match(accepted[0].label, /certificate that is not PayPal/)
})

test('the recorded precheck finds the order in the target (read-only)', async () => {
  const target = ctx.lab.target('mugshop-reference')
  await target.restore(`${ctx.recording().dir}/${ctx.recording().startPoints.SP1.file}`)
  const check = await target.precheck({ orderId: ctx.recording().orderId, captureId: ctx.recording().captureId })
  assert.equal(check.ok, true)
  assert.equal((await target.precheck({ orderId: 'NOPE', captureId: 'x' })).ok, false)
})
