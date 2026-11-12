import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkCodeNames, parsePlan } from '../server/contract/parser.js'
import { annotatedPlan, contractRows, scenarioForRow } from '../server/contract/annotate.js'
import { HEADER_SETS, PROOF_COLUMN } from '../server/contract/headers.js'
import { inboundTable } from '../server/contract/inbound.js'

const PLAN = readFileSync(new URL('../paypal-plan.md', import.meta.url), 'utf8')
// Code references in the sheet are relative to targets/mugshop.
const ROOT = new URL('../targets/mugshop', import.meta.url).pathname

const known = (parsed) => parsed.tables.filter((t) => t.kind !== 'unknown')

test('the three plugin tables are found by their original column names (the other tables of the sheet are ignored)', () => {
  const parsed = parsePlan(PLAN)
  const tables = known(parsed)
  assert.deepEqual(tables.map((t) => t.kind), ['duplicate-claims', 'unknown-outcomes', 'cross-operation-invariants'])
  assert.deepEqual(tables[0].headers, HEADER_SETS['duplicate-claims'].columns)
  assert.deepEqual(tables[1].headers, HEADER_SETS['unknown-outcomes'].columns)
  assert.deepEqual(tables[2].headers, HEADER_SETS['cross-operation-invariants'].columns)
})

test('DUPLICATE CLAIMS has no test column and UNKNOWN OUTCOMES names the test that fails the connection', () => {
  const parsed = parsePlan(PLAN)
  const tables = known(parsed)
  assert.equal(tables[0].headers.includes('The test that proves it'), false)
  assert.ok(tables[1].headers.includes('The test that fails the connection'))
})

test('tables are found by header name, not by column position', () => {
  const shuffled = [
    '## Whatever',
    '| Where in the code | Write | What rejects the second one | Where the claim is stored | Where that rejection is caught |',
    '| --- | --- | --- | --- | --- |',
    '| `a.ts:f` | `captureOrder` | unique | table | handler |',
  ].join('\n')
  const parsed = parsePlan(shuffled)
  assert.equal(parsed.tables[0].kind, 'duplicate-claims')
  assert.equal(parsed.tables[0].rows[0].cells.Write, '`captureOrder`')
})

test('TBD cells are listed with their row and column; the finished sheet has none', () => {
  assert.equal(parsePlan(PLAN).tbd.length, 0)
  const open = PLAN.replace('| `createOrder` | none (see Assumptions & Blockers: every checkout is a new cart) | none |', '| `createOrder` | orders.paypal_order_id | TBD |')
  const tbd = parsePlan(open).tbd
  assert.equal(tbd.length, 1)
  assert.ok(tbd.some((t) => t.write === 'createOrder' && t.column === 'What rejects the second one'))
})

test('a write with no way to find it again is a Blocker, and so is getRefund by refund id', () => {
  const none = ['| Write | The operation you re-read with | The reference you search by | Where in the code | The test that fails the connection |', '| --- | --- | --- | --- | --- |', '| `refundCapturedPayment` | none | - | x.ts | t.ts |'].join('\n')
  assert.match(parsePlan(none).blockers[0].reason, /No operation listed/)
  const refund = ['| Write | The operation you re-read with | The reference you search by | Where in the code | The test that fails the connection |', '| --- | --- | --- | --- | --- |', '| `refundCapturedPayment` | `getRefund` | the refund id | x.ts | t.ts |'].join('\n')
  assert.match(parsePlan(refund).blockers[0].reason, /refund id/)
  assert.equal(parsePlan(PLAN).blockers.length, 0)
})

test('names that do not exist in the code are reported', () => {
  assert.deepEqual(checkCodeNames(parsePlan(PLAN), ROOT), [])
  const broken = PLAN.replace('src/refunds.ts:requestRefund', 'src/refunds.ts:doesNotExist').replace('src/checkout.ts:createCheckout', 'src/nothing.ts:createCheckout')
  const missing = checkCodeNames(parsePlan(broken), ROOT)
  assert.ok(missing.some((m) => m.reason.includes('not found in the file')))
  assert.ok(missing.some((m) => m.reason === 'file not found'))
})

test('the annotated copy adds only the EchoBench column and leaves the original text alone', () => {
  const parsed = parsePlan(PLAN)
  const before = PLAN
  const annotated = annotatedPlan(PLAN, parsed, { 'C-DUP': { status: 'red', headline: 'PayPal refunds: 2' } })
  assert.equal(PLAN, before)
  assert.match(annotated, new RegExp(`Where in the code \\| ${PROOF_COLUMN} \\|`))
  assert.match(annotated, /C-DUP RED: PayPal refunds: 2/)
  assert.match(annotated, /C-UNK: not run yet/)
  // The invariants table is read only and gets no extra column.
  assert.doesNotMatch(annotated.split('## CROSS-OPERATION INVARIANTS')[1], new RegExp(PROOF_COLUMN))
})

test('rows map to the right scenario and the invariants are read only', () => {
  assert.equal(scenarioForRow('duplicate-claims', 'refundCapturedPayment'), 'C-DUP')
  assert.equal(scenarioForRow('duplicate-claims', 'captureOrder'), 'C-DUP-CAPTURE')
  assert.equal(scenarioForRow('unknown-outcomes', 'refund'), 'C-UNK', 'the plugin-generated plan writes plain "refund"')
  assert.equal(scenarioForRow('unknown-outcomes', 'refundCapturedPayment'), 'C-UNK')
  const rows = contractRows(parsePlan(PLAN), {})
  assert.ok(rows.filter((r) => r.kind === 'cross-operation-invariants').every((r) => r.status === 'readonly'))
})

test('the inbound events table is titled as EchoBench\'s own and carries results', () => {
  const table = inboundTable({ S1: { status: 'red' }, S2: { status: 'red' }, S7: { status: 'amber' } })
  assert.match(table.markdown, /proposed by EchoBench, not part of the plugin/)
  assert.match(table.rows.find((r) => r.event === 'PAYMENT.CAPTURE.COMPLETED').proof, /S1 RED, S2 RED, S7 WARN/)
  assert.deepEqual(table.header.at(-1), 'Proven by EchoBench')
})

test('a plan the plugin really generated, with shortened column names, is read by its section headings (R2 round 2)', () => {
  const generated = readFileSync(new URL('../targets/ab/sdk-plugin-on/paypal-plan.md', import.meta.url), 'utf8')
  const parsed = parsePlan(generated)
  const tables = known(parsed)
  assert.deepEqual(tables.map((t) => t.kind), ['duplicate-claims', 'unknown-outcomes', 'cross-operation-invariants'])
  assert.deepEqual(tables[0].writtenHeaders, ['Write', 'Claim store', 'What rejects 2nd', 'Caught where', 'Code'])
  assert.equal(tables[1].headers[1], 'The operation you re-read with')
  assert.equal(clean(tables[1].rows[1].cells['The operation you re-read with']), 'getOrder(orderId), find refunds[].customId == refundRef')
  assert.equal(parsed.blockers.length, 0)
  const missing = checkCodeNames(parsed, new URL('../targets/ab/sdk-plugin-on', import.meta.url).pathname)
  assert.deepEqual(missing.map((m) => m.ref), ['src/orders.ts', 'src/refunds.ts'], 'the plan names files the model never wrote')
})

const clean = (cell) => cell.replace(/`/g, '').trim()
