import { randomUUID } from 'node:crypto'
import { config } from './config.ts'
import { all, one, run, type Db } from './db.ts'
import { describeFailure, NOT_SENT_ANSWER, UNKNOWN_OUTCOME_ANSWER } from './failure.ts'
import { NetworkError, NotSentError, PaypalError, type PaypalPort } from './paypalPort.ts'

export type RefundPath = 'admin' | 'support'

export interface RefundOutcome {
  status: number
  body: Record<string, unknown>
}

function note(db: Db, orderId: string, path: RefundPath, outcome: string, detail: string): void {
  run(db, 'INSERT INTO refund_attempts (paypal_order_id, path, outcome, detail) VALUES (?, ?, ?, ?)', orderId, path, outcome, detail)
}

function book(db: Db, orderId: string, refundId: string, amount: string): void {
  run(db, 'INSERT OR IGNORE INTO refunds (paypal_refund_id, paypal_order_id, amount) VALUES (?, ?, ?)', refundId, orderId, amount)
}

// Two entry points (admin button, support tool) call this with the same refundRef for the same
// customer request. DUPLICATE CLAIMS: the claim row (request_key UNIQUE) is written before PayPal is called.
// UNKNOWN OUTCOMES: if the reply is lost, the same PayPal-Request-Id is sent again.
export async function requestRefund(db: Db, port: PaypalPort, input: { orderId: string; amount: string; refundRef: string; path: RefundPath }): Promise<RefundOutcome> {
  const { orderId, amount, refundRef, path } = input
  const capture = one(db, 'SELECT paypal_capture_id FROM captures WHERE paypal_order_id = ?', orderId)
  if (!capture) return { status: 409, body: { error: 'Order has no capture' } }
  const captureId = String(capture.paypal_capture_id)

  const claimed = config.refundClaim === 'on'
  const payPalRequestId = randomUUID()
  if (claimed) {
    const requestKey = `${orderId}:${refundRef}`
    const inserted = run(db, "INSERT OR IGNORE INTO refund_claims (request_key, paypal_order_id, amount, paypal_request_id, state) VALUES (?, ?, ?, ?, 'PENDING')", requestKey, orderId, amount, payPalRequestId)
    if (!inserted) {
      note(db, orderId, path, 'rejected-duplicate', requestKey)
      return { status: 409, body: { error: 'Refund already requested', refundRef } }
    }
  }

  for (let attempt = 1; attempt <= (claimed ? 3 : 1); attempt += 1) {
    try {
      const refund = await port.refundCapture(captureId, amount, payPalRequestId)
      book(db, orderId, refund.id, amount)
      if (claimed) run(db, "UPDATE refund_claims SET state = 'DONE', paypal_refund_id = ? WHERE request_key = ?", refund.id, `${orderId}:${refundRef}`)
      note(db, orderId, path, 'ok', refund.id)
      return { status: 201, body: { refundId: refund.id, amount } }
    } catch (err) {
      const outcome = classify(db, err, { orderId, path, claimed, requestKey: `${orderId}:${refundRef}`, attempt })
      if (outcome) return outcome
    }
  }
  // Unknown outcome that could not be settled. Reported as unsettled, never as a clean failure.
  return claimed ? { ...UNKNOWN_OUTCOME_ANSWER, body: { ...UNKNOWN_OUTCOME_ANSWER.body, error: 'Refund outcome unknown, will be settled' } } : { status: 502, body: { error: 'Refund failed' } }
}

// What to do with one failed send. Returns an answer to stop, or null to send again with the same PayPal-Request-Id.
function classify(db: Db, err: unknown, ctx: { orderId: string; path: RefundPath; claimed: boolean; requestKey: string; attempt: number }): RefundOutcome | null {
  const { orderId, path, claimed, requestKey, attempt } = ctx
  if (err instanceof NotSentError) {
    // The request never left, so there is nothing to re-read. Release the claim so a later attempt is not blocked.
    note(db, orderId, path, 'not-sent', err.message)
    if (claimed) run(db, 'DELETE FROM refund_claims WHERE request_key = ?', requestKey)
    return NOT_SENT_ANSWER
  }
  if (err instanceof PaypalError && err.status < 500) {
    note(db, orderId, path, 'declined', `${err.issue}${err.debugId ? ` (debug ${err.debugId})` : ''}`)
    if (claimed) run(db, 'DELETE FROM refund_claims WHERE request_key = ?', requestKey)
    return describeFailure(err)
  }
  // A 5xx or a lost reply: PayPal may have acted. Same handling, the stored PayPal-Request-Id is sent again.
  if (!(err instanceof NetworkError) && !(err instanceof PaypalError)) throw err
  note(db, orderId, path, claimed ? 'retry' : 'failed', `attempt ${attempt}: ${err.message}`)
  return null
}

export function refundAttempts(db: Db, orderId: string) {
  return all(db, 'SELECT path, outcome, detail FROM refund_attempts WHERE paypal_order_id = ? ORDER BY id', orderId)
}
