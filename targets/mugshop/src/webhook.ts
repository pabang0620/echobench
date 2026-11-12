import type { IncomingHttpHeaders } from 'node:http'
import { approvedOrderId, capturedIds, disputedCaptureId, parseEvent, refundedIds } from './events.ts'
import { one, run, shipOrder, type Db } from './db.ts'
import type { PaypalPort } from './paypalPort.ts'
import { verifyIncoming } from './signature.ts'

export interface WebhookReply {
  status: number
  body: Record<string, unknown>
}

// =====================================================================================
// PLANTED BUGS. This file is the only place MugShop is wrong on purpose (see ../../README.md).
//   A  PAYMENT.CAPTURE.COMPLETED ships unconditionally: no event-id check, no "already shipped"
//      check, no dispute-hold check. A repeated delivery ships the mug again.
//   B  CHECKOUT.ORDER.APPROVED ships the mug. The money is not captured yet at that moment.
//   C  PAYMENT.CAPTURE.REFUNDED keeps one refund per order and overwrites it, and nothing
//      reconciles the shop's books with PayPal's records.
// The fixed version of this file is ../fixes/webhook.fixed.ts.
// =====================================================================================

export async function handleWebhook(db: Db, _port: PaypalPort, headers: IncomingHttpHeaders, body: Buffer): Promise<WebhookReply> {
  const verdict = await verifyIncoming(headers, body)
  if (!verdict.ok) return { status: 401, body: { error: 'signature rejected', reason: verdict.reason } }

  const event = parseEvent(body)
  if (!event) return { status: 400, body: { error: 'not a PayPal event' } }

  run(db, 'INSERT OR REPLACE INTO processed_events (event_id, event_type, received_at) VALUES (?, ?, ?)', event.id, event.event_type, new Date().toISOString())

  switch (event.event_type) {
    case 'CHECKOUT.ORDER.APPROVED': {
      shipOrder(db, approvedOrderId(event), event.event_type) // PLANTED BUG B
      return { status: 200, body: { handled: event.event_type } }
    }
    case 'PAYMENT.CAPTURE.COMPLETED': {
      const { captureId, orderId, amount } = capturedIds(event)
      run(db, 'INSERT OR IGNORE INTO captures (paypal_capture_id, paypal_order_id, amount, status) VALUES (?, ?, ?, ?)', captureId, orderId, amount, 'COMPLETED')
      shipOrder(db, orderId, event.event_type) // PLANTED BUG A
      return { status: 200, body: { handled: event.event_type } }
    }
    case 'PAYMENT.CAPTURE.REFUNDED': {
      const { refundId, captureId, amount } = refundedIds(event)
      const capture = one(db, 'SELECT paypal_order_id FROM captures WHERE paypal_capture_id = ?', captureId)
      if (!capture) return { status: 200, body: { ignored: 'unknown capture' } }
      const orderId = String(capture.paypal_order_id)
      run(db, 'DELETE FROM refunds WHERE paypal_order_id = ?', orderId) // PLANTED BUG C
      run(db, 'INSERT INTO refunds (paypal_refund_id, paypal_order_id, amount) VALUES (?, ?, ?)', refundId, orderId, amount)
      return { status: 200, body: { handled: event.event_type } }
    }
    case 'CUSTOMER.DISPUTE.CREATED': {
      const capture = one(db, 'SELECT paypal_order_id FROM captures WHERE paypal_capture_id = ?', disputedCaptureId(event))
      if (capture) run(db, 'UPDATE orders SET on_hold = 1 WHERE paypal_order_id = ?', String(capture.paypal_order_id))
      return { status: 200, body: { handled: event.event_type } }
    }
    default:
      return { status: 200, body: { ignored: event.event_type } }
  }
}

// PLANTED BUG C (second half): nothing compares the shop's books with PayPal's records.
export function startReconcile(_db: Db, _port: PaypalPort): void {}
