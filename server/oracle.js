// The judge. Rules I1..I8 compare the target's own books with PayPal's records.
// A verdict is { rule, status: pass|fail|warn|na, message, evidence }.
// Nothing here looks at HTTP status codes alone: the answer is always the state.

const cents = (value) => Math.round(Number(value) * 100)
const total = (list) => list.reduce((sum, item) => sum + cents(item.amount), 0)
const money = (c) => (c / 100).toFixed(2)
const verdict = (rule, status, message, evidence = {}) => ({ rule, status, message, evidence })

export const RULES = {
  I1: 'One shipment per captured payment, never before the money is captured',
  I2: "Shop refund total and count equal PayPal's refund records",
  I3: 'Forged or unsigned events change nothing',
  I4: 'The final state does not depend on delivery order',
  I5: "After a missed event the shop's books match PayPal within the time limit",
  I6: 'An old re-delivery changes nothing',
  I7: 'The contract promise holds (duplicate claim, unknown outcome)',
  I8: 'An order with an opened dispute is not shipped',
}

function i1({ after, expect }) {
  const wanted = expect.shipments ?? 1
  const early = after.shipments.filter((s) => !s.capture_recorded)
  if (after.fulfilled_count !== wanted) {
    return verdict('I1', 'fail', `The mug was shipped ${after.fulfilled_count} time${after.fulfilled_count === 1 ? '' : 's'}, expected ${wanted}`, { shipments: after.shipments })
  }
  if (early.length) {
    return verdict('I1', 'fail', `The mug was shipped at ${early[0].at_event} before the payment was captured`, { shipments: after.shipments })
  }
  return verdict('I1', 'pass', `Shipped ${after.fulfilled_count} time${after.fulfilled_count === 1 ? '' : 's'}, after the capture`, { shipments: after.shipments })
}

function i2({ after, ledger }) {
  const shop = total(after.refunds)
  const paypal = total(ledger.refunds)
  const same = shop === paypal && after.refunds.length === ledger.refunds.length
  const text = `PayPal refunds ${money(paypal)} (${ledger.refunds.length}), shop books ${money(shop)} (${after.refunds.length})`
  return verdict('I2', same ? 'pass' : 'fail', same ? text : `${text}`, { shop: after.refunds, paypal: ledger.refunds })
}

function i3({ before, after, sent }) {
  const changed = changedState(before, after)
  const accepted = sent.filter((s) => s.status >= 200 && s.status < 300).map((s) => s.label)
  if (changed) return verdict('I3', 'fail', 'A forged event changed the shop state', { accepted, before: summary(before), after: summary(after) })
  const skipped = sent.filter((s) => s.skipped).length
  const note = accepted.length ? ` (answered 2xx for: ${accepted.join('; ')}, but nothing changed)` : ''
  return verdict('I3', 'pass', `Rejected ${sent.length - skipped} forged event${sent.length - skipped === 1 ? '' : 's'} (state unchanged)${note}`, { statuses: sent.map((s) => ({ label: s.label, status: s.status })) })
}

function i4({ after, expect, ledger }) {
  const problems = []
  if (after.fulfilled_count !== (expect.shipments ?? 1)) problems.push(`shipped ${after.fulfilled_count} time(s)`)
  if (expect.status && after.status !== expect.status) problems.push(`order status ${after.status}, expected ${expect.status}`)
  if (after.shipments.some((s) => !s.capture_recorded)) problems.push('a shipment happened before the capture')
  if (expect.refundsFromLedger && total(after.refunds) !== total(ledger.refunds)) problems.push('refunds differ from PayPal')
  return problems.length
    ? verdict('I4', 'fail', `The delivery order changed the outcome: ${problems.join('; ')}`, { after: summary(after) })
    : verdict('I4', 'pass', 'Same final state as the in-order run', { after: summary(after) })
}

function i5({ after, ledger, windowMs }) {
  const shop = total(after.refunds)
  const paypal = total(ledger.refunds)
  if (shop === paypal && after.refunds.length === ledger.refunds.length) {
    return verdict('I5', 'pass', `The shop's books matched PayPal (${money(paypal)}) after the missed event`, { paypal: ledger.refunds, shop: after.refunds })
  }
  return verdict('I5', 'fail', `After ${Math.round(windowMs / 1000)}s PayPal records ${money(paypal)} refunded, the shop still books ${money(shop)}`, { paypal: ledger.refunds, shop: after.refunds })
}

function i6({ before, after, sent }) {
  const reply = sent[0]
  if (changedState(before, after)) return verdict('I6', 'fail', 'The handler processed the old event again and changed its state', { before: summary(before), after: summary(after), status: reply?.status })
  if (reply && reply.status >= 400) return verdict('I6', 'pass', `The old event was rejected (HTTP ${reply.status})`, { status: reply.status })
  return verdict('I6', 'warn', 'The old event was accepted (HTTP 2xx) but ignored as already processed. Nothing changed.', { status: reply?.status })
}

function i7({ scenario, expect, after, ledger, ledgerNew, ledgerBefore, sent, proxyLog }) {
  const evidence = { ledgerNew, shop: after.refunds, responses: sent.map((s) => ({ label: s.label, status: s.status })), proxy: proxyLog }
  if (scenario.id === 'C-DUP') {
    const ok = ledgerNew.length === 1 && after.refunds.length === 1
    return verdict('I7', ok ? 'pass' : 'fail', ok ? 'Two simultaneous refund requests became one PayPal refund' : `PayPal refunds: ${ledgerNew.length} for one request, the shop books ${after.refunds.length}`, evidence)
  }
  if (scenario.id === 'C-DUP-CAPTURE') {
    const bad = sent.filter((s) => s.status >= 500)
    const ok = after.captures.length === 1 && after.fulfilled_count <= 1 && bad.length === 0
    return verdict('I7', ok ? 'pass' : 'fail', ok ? 'Two simultaneous return paths booked one capture (shop side only)' : `The shop booked ${after.captures.length} captures, ${bad.length} call(s) reported an error`, evidence)
  }
  if (scenario.id === 'C-UNK-CAPTURE') {
    const cutCall = proxyLog.find((p) => p.cut)
    if (!cutCall) return verdict('I7', 'na', 'The proxy did not see the capture call, so nothing was cut', evidence)
    const reread = proxyLog.slice(proxyLog.indexOf(cutCall) + 1).some((p) => p.method === 'GET' && /\/v2\/checkout\/orders\//.test(p.path))
    const failed = sent[0] && sent[0].status >= 400
    const booked = after.captures.length === 1 && ledger.captures.length === 1 && after.captures[0].id === ledger.captures[0].id
    if (booked && reread && !failed) return verdict('I7', 'pass', 'The capture reply was cut; the app read the order back with getOrder and booked the one capture PayPal made', { ...evidence, paypalCaptures: ledger.captures })
    const why = []
    if (failed) why.push('it reported the capture as failed')
    if (!reread) why.push('it never read the order back')
    if (!booked) why.push(`PayPal captured ${ledger.captures.length}, the shop books ${after.captures.length}`)
    return verdict('I7', 'fail', `PayPal captured but the reply was cut: ${why.join('; ')}`, { ...evidence, paypalCaptures: ledger.captures })
  }
  // C-UNK
  const cut = proxyLog.find((p) => p.cut)
  const afterCut = cut ? proxyLog.slice(proxyLog.indexOf(cut) + 1) : []
  const resent = afterCut.some((p) => p.method === 'POST' && /\/refund$/.test(p.path) && p.requestId && p.requestId === cut.requestId)
  const reread = afterCut.some((p) => p.method === 'GET' && /\/v2\/checkout\/orders\//.test(p.path))
  const reply = sent[0]
  const reportedFailure = reply && reply.status >= 400
  const settled = after.refunds.length === ledgerNew.length && ledgerNew.length === 1
  if (!cut) return verdict('I7', 'na', 'The proxy did not see the refund call, so nothing was cut', evidence)
  if (settled && (resent || reread) && !reportedFailure) {
    return verdict('I7', 'pass', resent ? 'The reply was cut; the app re-sent the same PayPal-Request-Id and settled with one refund' : 'The reply was cut; the app re-read the order and settled with one refund', evidence)
  }
  const why = []
  if (reportedFailure) why.push('it reported the refund as failed')
  if (!resent && !reread) why.push('it never re-sent with the same PayPal-Request-Id or re-read the order')
  if (!settled) why.push(`PayPal refunds ${ledgerNew.length}, the shop books ${after.refunds.length}`)
  return verdict('I7', 'fail', `PayPal refunded but the reply was cut: ${why.join('; ')}`, evidence)
}

function i8({ after }) {
  if (after.fulfilled_count > 0) return verdict('I8', 'fail', 'The order was shipped although a dispute was already open', { shipments: after.shipments })
  return after.on_hold
    ? verdict('I8', 'pass', 'The order is on hold and was not shipped', {})
    : verdict('I8', 'fail', 'Nothing shipped, but the order was not put on hold either', {})
}

const RULE_FUNCTIONS = { I1: i1, I2: i2, I3: i3, I4: i4, I5: i5, I6: i6, I7: i7, I8: i8 }

export function evaluate(ruleIds, facts) {
  return ruleIds.map((id) => RULE_FUNCTIONS[id](facts))
}

export function overallStatus(verdicts) {
  const live = verdicts.filter((v) => v.status !== 'na')
  if (!live.length) return 'na'
  if (live.some((v) => v.status === 'fail')) return 'red'
  if (live.some((v) => v.status === 'warn')) return 'amber'
  return 'green'
}

function summary(state) {
  return { status: state.status, shipped: state.fulfilled_count, refunds: state.refunds.map((r) => `${r.id}:${r.amount}`), events: state.processed_event_ids.length }
}

function changedState(a, b) {
  return JSON.stringify(summary(a)) !== JSON.stringify(summary(b)) || a.on_hold !== b.on_hold || a.captures.length !== b.captures.length
}
