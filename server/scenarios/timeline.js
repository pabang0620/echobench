// Two lines for the first screen: what PayPal's records say, and what the shop's books say.
// Cells that break a rule are flagged.
const cents = (v) => Math.round(Number(v) * 100)

export function buildTimeline({ ledger, after, verdicts, rules = [], proxyLog = [] }) {
  const failing = new Set(verdicts.filter((v) => v.status === 'fail').map((v) => v.rule))
  const paypal = []
  if (ledger.id) paypal.push({ text: 'approved' })
  for (const c of ledger.captures) paypal.push({ text: `captured ${c.amount}` })
  for (const r of ledger.refunds) paypal.push({ text: `refund ${r.amount}` })
  // The proxy forwarded a write to PayPal and then cut the reply: PayPal did it, the app never heard.
  if (proxyLog.some((p) => p.cut)) paypal.push({ text: 'reply cut (the app never heard back)' })

  const shop = []
  const ships = after.fulfilled_count
  if (ships > 0) shop.push({ text: `shipped x${ships}`, flag: ships !== 1 && (failing.has('I1') || failing.has('I4')) })
  const early = after.shipments.some((s) => !s.capture_recorded)
  if (early) shop.push({ text: 'shipped before capture', flag: true })
  if (rules.some((r) => ['I2', 'I5', 'I7'].includes(r))) for (const r of after.refunds) shop.push({ text: `refunded ${r.amount}`, flag: false })
  const paid = ledger.refunds.reduce((sum, r) => sum + cents(r.amount), 0)
  const booked = after.refunds.reduce((sum, r) => sum + cents(r.amount), 0)
  const judgesRefunds = rules.some((r) => ['I2', 'I5', 'I7'].includes(r))
  if (judgesRefunds && (booked !== paid || after.refunds.length !== ledger.refunds.length)) {
    shop.push({ text: `books ${(booked / 100).toFixed(2)} of ${(paid / 100).toFixed(2)}`, flag: failing.has('I2') || failing.has('I5') || failing.has('I7') })
  }
  if (after.on_hold) shop.push({ text: 'on hold (dispute)', flag: false })
  return { paypal, shop }
}

// First screen: one line pair that tells the whole story. PayPal's records from the refund run,
// the shop's shipments from the duplicate-event run and the shop's refund books from the refund run.
export function compositeTimeline(byScenario) {
  const refundRun = byScenario.S5b
  const shipRun = byScenario.S1
  if (!refundRun?.timeline || !shipRun?.timeline) return null
  const shipCells = shipRun.timeline.shop.filter((c) => c.text.startsWith('shipped'))
  const refundCells = refundRun.timeline.shop.filter((c) => !c.text.startsWith('shipped'))
  return { paypal: refundRun.timeline.paypal, shop: [...shipCells, ...refundCells], caption: 'Built from S1 (duplicate event) and S5b (two partial refunds).' }
}
