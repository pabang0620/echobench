import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluate, overallStatus } from '../server/oracle.js'

const state = (over = {}) => ({
  status: 'CAPTURED', on_hold: false, fulfilled_count: 1, shipments: [{ id: 1, at_event: 'PAYMENT.CAPTURE.COMPLETED', capture_recorded: true }],
  captures: [{ id: 'C1', amount: '12.00' }], refunds: [], processed_event_ids: [], ...over,
})
const ledger = (refunds = []) => ({ refunds: refunds.map(([id, amount]) => ({ id, amount })) })
const run = (rules, facts) => evaluate(rules, { expect: {}, before: state(), after: state(), ledger: ledger(), sent: [], proxyLog: [], windowMs: 3000, scenario: { id: 'S' }, ...facts })

test('I1 fails on a second shipment and on a shipment before the capture, passes on one clean shipment', () => {
  assert.equal(run(['I1'], { after: state({ fulfilled_count: 2, shipments: [{ capture_recorded: true }, { capture_recorded: true }] }) })[0].status, 'fail')
  assert.match(run(['I1'], { after: state({ shipments: [{ at_event: 'CHECKOUT.ORDER.APPROVED', capture_recorded: false }] }) })[0].message, /before the payment was captured/)
  assert.equal(run(['I1'], {})[0].status, 'pass')
})

test('I2 compares the shop books with PayPal records by total and by count', () => {
  const paypal = ledger([['R1', '4.00'], ['R2', '8.00']])
  const overwritten = run(['I2'], { ledger: paypal, after: state({ refunds: [{ id: 'R2', amount: '8.00' }] }) })[0]
  assert.equal(overwritten.status, 'fail')
  assert.match(overwritten.message, /PayPal refunds 12.00 \(2\), shop books 8.00 \(1\)/)
  assert.equal(run(['I2'], { ledger: paypal, after: state({ refunds: [{ id: 'R1', amount: '4.00' }, { id: 'R2', amount: '8.00' }] }) })[0].status, 'pass')
  // same total, different count is still a mismatch
  assert.equal(run(['I2'], { ledger: ledger([['R1', '12.00']]), after: state({ refunds: [{ id: 'A', amount: '6.00' }, { id: 'B', amount: '6.00' }] }) })[0].status, 'fail')
})

test('I3 passes only when a forged event changed nothing, and says which ones were answered 2xx', () => {
  const sent = [{ label: 'forged', status: 200 }]
  assert.equal(run(['I3'], { sent })[0].status, 'pass')
  assert.match(run(['I3'], { sent })[0].message, /answered 2xx for: forged, but nothing changed/)
  assert.equal(run(['I3'], { sent, after: state({ processed_event_ids: ['WH-FORGED'] }) })[0].status, 'fail')
})

test('I4 checks shipments, status, ordering of shipment and capture', () => {
  assert.equal(run(['I4'], { expect: { shipments: 1, status: 'CAPTURED' } })[0].status, 'pass')
  assert.equal(run(['I4'], { expect: { shipments: 1, status: 'APPROVED' } })[0].status, 'fail')
})

test('I5 passes when the books caught up and fails with both numbers when they did not', () => {
  const paypal = ledger([['R1', '4.00'], ['R2', '8.00']])
  assert.equal(run(['I5'], { ledger: paypal, after: state({ refunds: [{ id: 'R1', amount: '4.00' }, { id: 'R2', amount: '8.00' }] }) })[0].status, 'pass')
  const late = run(['I5'], { ledger: paypal, after: state({ refunds: [{ id: 'R1', amount: '4.00' }] }) })[0]
  assert.equal(late.status, 'fail')
  assert.match(late.message, /PayPal records 12.00 refunded, the shop still books 4.00/)
})

test('I6: processed = fail, ignored as already processed = warn, rejected = pass', () => {
  assert.equal(run(['I6'], { sent: [{ status: 200 }], after: state({ fulfilled_count: 2 }) })[0].status, 'fail')
  assert.equal(run(['I6'], { sent: [{ status: 200 }] })[0].status, 'warn')
  assert.equal(run(['I6'], { sent: [{ status: 400 }] })[0].status, 'pass')
})

test('I7 C-DUP needs exactly one PayPal refund; C-UNK needs a resend or re-read, no failure report, one refund', () => {
  const dupBad = run(['I7'], { scenario: { id: 'C-DUP' }, ledgerNew: [{ id: 'A' }, { id: 'B' }], after: state({ refunds: [{ id: 'A' }, { id: 'B' }] }) })[0]
  assert.equal(dupBad.status, 'fail')
  assert.match(dupBad.message, /PayPal refunds: 2/)
  assert.equal(run(['I7'], { scenario: { id: 'C-DUP' }, ledgerNew: [{ id: 'A' }], after: state({ refunds: [{ id: 'A' }] }) })[0].status, 'pass')

  const cut = { method: 'POST', path: '/v2/payments/captures/C1/refund', requestId: 'rid', cut: true }
  const resend = { method: 'POST', path: '/v2/payments/captures/C1/refund', requestId: 'rid', cut: false }
  const good = run(['I7'], { scenario: { id: 'C-UNK' }, proxyLog: [cut, resend], sent: [{ status: 201 }], ledgerNew: [{ id: 'A' }], after: state({ refunds: [{ id: 'A' }] }) })[0]
  assert.equal(good.status, 'pass')
  assert.match(good.message, /re-sent the same PayPal-Request-Id/)
  const careless = run(['I7'], { scenario: { id: 'C-UNK' }, proxyLog: [cut], sent: [{ status: 502 }], ledgerNew: [{ id: 'A' }], after: state() })[0]
  assert.equal(careless.status, 'fail')
  assert.match(careless.message, /reported the refund as failed/)
  assert.equal(run(['I7'], { scenario: { id: 'C-UNK' }, proxyLog: [], sent: [{ status: 201 }], ledgerNew: [] })[0].status, 'na')
})

test('I8 needs the order on hold and unshipped', () => {
  assert.equal(run(['I8'], { after: state({ fulfilled_count: 0, shipments: [], on_hold: true }) })[0].status, 'pass')
  assert.equal(run(['I8'], { after: state() })[0].status, 'fail')
})

test('overall status: fail beats warn beats pass, n/a alone is n/a', () => {
  assert.equal(overallStatus([{ status: 'pass' }, { status: 'fail' }, { status: 'warn' }]), 'red')
  assert.equal(overallStatus([{ status: 'pass' }, { status: 'warn' }]), 'amber')
  assert.equal(overallStatus([{ status: 'pass' }]), 'green')
  assert.equal(overallStatus([{ status: 'na' }]), 'na')
})
