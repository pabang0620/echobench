import * as forge from './forge.js'

// Each scenario names its start point (SP0..SP3, SPC), the oracle rules that judge it, and what
// it does. Webhook scenarios may also be run by the AI agent; contract scenarios never are.
//   SP0 order created and approved at PayPal, nothing processed   SP1 capture processed
//   SP2 first partial refund processed                             SP3 final (fully refunded)
//   SPC a captured, unrefunded payment kept for contract runs

export const CONTRACT_REFUND_AMOUNT = '4.00'

export const SCENARIOS = [
  {
    id: 'S0',
    kind: 'webhook',
    title: 'Control: the recorded purchase, in order',
    summary: 'Approved, return path, capture completed. One mug must ship, after the capture.',
    startPoint: 'SP0',
    rules: ['I1'],
    expect: { shipments: 1, status: 'CAPTURED' },
    steps: ['deliver approved', 'buyer returns (capture)', 'deliver completed'],
    async run(c) {
      await c.send('approved')
      await c.returnPath()
      await c.send('completed')
    },
  },
  {
    id: 'S1',
    kind: 'webhook',
    title: 'Same event twice',
    summary: 'PayPal re-delivers PAYMENT.CAPTURE.COMPLETED (it retries up to 25 times when it does not get a 2xx).',
    startPoint: 'SP0',
    rules: ['I1'],
    expect: { shipments: 1 },
    steps: ['buyer returns (capture)', 'deliver completed', 'deliver completed again'],
    async run(c) {
      await c.returnPath()
      await c.send('completed')
      await c.send('completed', { tag: 'completed (repeat)' })
    },
  },
  {
    id: 'S2',
    kind: 'webhook',
    title: 'Same event twice, at the same time',
    summary: 'Two copies of PAYMENT.CAPTURE.COMPLETED arrive in parallel, so "check then insert" races.',
    startPoint: 'SP0',
    rules: ['I1'],
    expect: { shipments: 1 },
    steps: ['buyer returns (capture)', 'deliver completed x2 in parallel'],
    async run(c) {
      await c.returnPath()
      await Promise.all([c.send('completed', { tag: 'completed (copy 1)' }), c.send('completed', { tag: 'completed (copy 2)' })])
    },
  },
  {
    id: 'S3',
    kind: 'webhook',
    title: 'Capture event before the approval event',
    summary: 'PAYMENT.CAPTURE.COMPLETED is delivered first, CHECKOUT.ORDER.APPROVED after it.',
    startPoint: 'SP0',
    rules: ['I1', 'I4'],
    expect: { shipments: 1, status: 'CAPTURED' },
    steps: ['buyer returns (capture)', 'deliver completed', 'deliver approved'],
    async run(c) {
      await c.returnPath()
      await c.send('completed')
      await c.send('approved')
    },
  },
  {
    id: 'S4',
    kind: 'webhook',
    title: 'Approval event races the return path',
    summary: 'The webhook for the approval and the buyer coming back from PayPal hit the shop at the same moment (WooCommerce #4173, #4058).',
    startPoint: 'SP0',
    rules: ['I1', 'I4'],
    expect: { shipments: 1, status: 'CAPTURED' },
    requires: { returnPath: true },
    steps: ['deliver approved + buyer returns, in parallel', 'deliver completed'],
    async run(c) {
      await Promise.all([c.send('approved'), c.returnPath()])
      await c.send('completed')
    },
  },
  {
    id: 'S5',
    kind: 'webhook',
    title: 'Second partial refund event never arrives',
    summary: 'The 8.00 refund happened at PayPal but its webhook is dropped. Event-id storage cannot fix this; the shop has to ask PayPal.',
    startPoint: 'SP2',
    rules: ['I5'],
    expect: {},
    steps: ['(refund 2 webhook dropped)', 'wait for the shop to settle with PayPal'],
    async run(c) {
      c.dropped('refund2')
      await c.waitForBooksToMatch()
    },
  },
  {
    id: 'S5b',
    kind: 'webhook',
    title: 'Two partial refunds, 4.00 then 8.00',
    summary: 'Both refund events arrive in order. Both must end up in the shop books.',
    startPoint: 'SP1',
    rules: ['I2'],
    expect: {},
    steps: ['deliver refund 1', 'deliver refund 2'],
    async run(c) {
      await c.send('refund1')
      await c.send('refund2')
    },
  },
  {
    id: 'S6',
    kind: 'webhook',
    title: 'Forged events',
    summary: 'Body changed after signing, a simulator-style event, and an event signed with a certificate that is not PayPal\'s.',
    startPoint: 'SP3',
    rules: ['I3'],
    expect: {},
    steps: ['body changed after signing', 'simulator event (webhook id "WEBHOOK_ID")', 'foreign certificate cert_url'],
    async run(c) {
      const refund = c.delivery('refund1')
      await c.sendForged(forge.tamperedBody(refund))
      await c.sendForged(forge.simulatorEvent(refund, { mockKeyPem: c.mockKeyPem }), 'simulator event needs the local PayPal stand-in key; on the sandbox use simulate-event (VERIFY.md)')
      await c.sendForged(forge.foreignCertificate(refund, { webhookId: c.webhookId, certUrl: `${c.publicUrl}/forge/cert.pem` }))
    },
  },
  {
    id: 'S7',
    kind: 'webhook',
    title: 'Old delivery replayed',
    summary: 'The original bytes of PAYMENT.CAPTURE.COMPLETED are delivered again long after the order finished.',
    startPoint: 'SP3',
    rules: ['I6'],
    expect: {},
    steps: ['deliver the recorded completed event again'],
    async run(c) {
      await c.send('completed', { tag: 'completed (old replay)' })
    },
  },
  {
    id: 'D1',
    kind: 'webhook',
    title: 'Dispute opened before shipping',
    summary: 'CUSTOMER.DISPUTE.CREATED arrives before the capture event. The order must be held, not shipped.',
    startPoint: 'SP0',
    rules: ['I8'],
    expect: {},
    requires: { dispute: true },
    steps: ['buyer returns (capture)', 'deliver dispute', 'deliver completed'],
    async run(c) {
      await c.returnPath()
      await c.send('dispute')
      await c.send('completed')
    },
  },
  {
    id: 'C-DUP',
    kind: 'contract',
    title: 'DUPLICATE CLAIMS: refundCapturedPayment',
    summary: `The same ${CONTRACT_REFUND_AMOUNT} refund is requested from the admin page and, right after it went through, from the support desk. The claim must let exactly one reach PayPal. (Two requests that overlap at PayPal are already stopped by PayPal itself: the sandbox answered 409 PREVIOUS_REQUEST_IN_PROGRESS to the second.)`,
    startPoint: 'SPC',
    rules: ['I7'],
    movesMoney: true,
    expect: {},
    requires: { refunds: true },
    steps: [`admin refund ${CONTRACT_REFUND_AMOUNT}`, `support refund ${CONTRACT_REFUND_AMOUNT} with the same reference, right after`],
    async run(c) {
      const body = { orderId: c.contract.orderId, amount: CONTRACT_REFUND_AMOUNT, refundRef: 'RMA-1001' }
      await c.refund('admin', body)
      await c.refund('support', body)
    },
  },
  {
    id: 'C-UNK',
    kind: 'contract',
    title: 'UNKNOWN OUTCOMES: refundCapturedPayment',
    summary: `PayPal gets the ${CONTRACT_REFUND_AMOUNT} refund but the reply is cut. The app must settle it without a second refund and without reporting failure.`,
    startPoint: 'SPC',
    rules: ['I7'],
    movesMoney: true,
    expect: {},
    requires: { refunds: true },
    steps: [`admin refund ${CONTRACT_REFUND_AMOUNT} (proxy forwards it, then cuts the reply)`],
    async run(c) {
      c.armCut()
      await c.refund('admin', { orderId: c.contract.orderId, amount: CONTRACT_REFUND_AMOUNT, refundRef: 'RMA-2002' })
    },
  },
  {
    id: 'C-DUP-CAPTURE',
    kind: 'contract',
    title: 'DUPLICATE CLAIMS: captureOrder (shop side only)',
    summary: 'Two return paths run at once for the same order. PayPal already captured it, so only the shop side is judged: one capture booked, no error reported.',
    startPoint: 'SP0',
    rules: ['I7'],
    movesMoney: false,
    expect: {},
    requires: { returnPath: true },
    steps: ['buyer returns (capture) x2 in parallel'],
    async run(c) {
      await Promise.all([c.returnPath('return path (copy 1)'), c.returnPath('return path (copy 2)')])
    },
  },
  {
    id: 'C-UNK-CAPTURE',
    kind: 'contract',
    title: 'UNKNOWN OUTCOMES: captureOrder (local stand-in only)',
    summary: 'PayPal captures the order but the reply is cut. The app must read the order back with getOrder and book the one capture, and must not report a failure.',
    startPoint: 'SP0',
    rules: ['I7'],
    movesMoney: false,
    expect: {},
    requires: { returnPath: true, freshCapture: true },
    steps: ['stand-in only: the order is taken back to approved for this run', 'buyer returns (capture); the proxy forwards it, then cuts the reply', 'the app reads the order back'],
    async run(c) {
      c.armCut(/\/capture$/)
      await c.returnPath('return path (reply cut)')
    },
  },
]

export const scenarioById = (id) => SCENARIOS.find((s) => s.id === id)
// What "Shake all" runs: every webhook scenario, plus the one contract scenario that moves no money.
export const SHAKE_ALL_IDS = [...SCENARIOS.filter((s) => s.kind === 'webhook').map((s) => s.id), 'C-DUP-CAPTURE']
export const WEBHOOK_SCENARIO_IDS = SCENARIOS.filter((s) => s.kind === 'webhook').map((s) => s.id)
