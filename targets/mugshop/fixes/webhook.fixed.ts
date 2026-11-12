import type { IncomingHttpHeaders } from 'node:http'
import { approvedOrderId, capturedIds, disputedCaptureId, parseEvent, refundedIds, type PaypalEvent } from './events.ts'
import { all, inTransaction, one, run, shipOrder, type Db } from './db.ts'
import type { PaypalPort } from './paypalPort.ts'
import { verifyIncoming } from './signature.ts'
import { config } from './config.ts'

export interface WebhookReply {
  status: number
  body: Record<string, unknown>
}

// Reference fix for the three planted bugs (A, B, C). Each event is claimed by its id and
// processed inside one transaction, so a crash in the middle leaves the event unclaimed and
// PayPal's retry is processed normally.

function ship(db: Db, orderId: string, atEvent: string): boolean {
  const order = one(db, 'SELECT on_hold FROM orders WHERE paypal_order_id = ?', orderId)
  if (!order || Number(order.on_hold)) return false // dispute on file: hold the shipment
  if (one(db, 'SELECT 1 AS found FROM shipments WHERE paypal_order_id = ?', orderId)) return false // already shipped
  if (!one(db, "SELECT 1 AS found FROM captures WHERE paypal_order_id = ? AND status = 'COMPLETED'", orderId)) return false // only after the money is captured
  shipOrder(db, orderId, atEvent)
  return true
}

function apply(db: Db, event: PaypalEvent): Record<string, unknown> {
  switch (event.event_type) {
    case 'CHECKOUT.ORDER.APPROVED': {
      run(db, "UPDATE orders SET status = 'APPROVED' WHERE paypal_order_id = ? AND status = 'CREATED'", approvedOrderId(event))
      return { handled: event.event_type }
    }
    case 'PAYMENT.CAPTURE.COMPLETED': {
      const { captureId, orderId, amount } = capturedIds(event)
      run(db, 'INSERT OR IGNORE INTO captures (paypal_capture_id, paypal_order_id, amount, status) VALUES (?, ?, ?, ?)', captureId, orderId, amount, 'COMPLETED')
      run(db, "UPDATE orders SET status = 'CAPTURED' WHERE paypal_order_id = ?", orderId)
      return { handled: event.event_type, shipped: ship(db, orderId, event.event_type) }
    }
    case 'PAYMENT.CAPTURE.REFUNDED': {
      const { refundId, captureId, amount } = refundedIds(event)
      const capture = one(db, 'SELECT paypal_order_id FROM captures WHERE paypal_capture_id = ?', captureId)
      if (!capture) throw new Error('capture not known yet') // 500 makes PayPal deliver again
      run(db, 'INSERT OR IGNORE INTO refunds (paypal_refund_id, paypal_order_id, amount) VALUES (?, ?, ?)', refundId, String(capture.paypal_order_id), amount)
      return { handled: event.event_type }
    }
    case 'CUSTOMER.DISPUTE.CREATED': {
      const capture = one(db, 'SELECT paypal_order_id FROM captures WHERE paypal_capture_id = ?', disputedCaptureId(event))
      if (capture) run(db, 'UPDATE orders SET on_hold = 1 WHERE paypal_order_id = ?', String(capture.paypal_order_id))
      return { handled: event.event_type }
    }
    default:
      return { ignored: event.event_type }
  }
}

export async function handleWebhook(db: Db, _port: PaypalPort, headers: IncomingHttpHeaders, body: Buffer): Promise<WebhookReply> {
  const verdict = await verifyIncoming(headers, body)
  if (!verdict.ok) return { status: 401, body: { error: 'signature rejected', reason: verdict.reason } }

  const event = parseEvent(body)
  if (!event) return { status: 400, body: { error: 'not a PayPal event' } }

  try {
    return inTransaction(db, () => {
      const claimed = run(db, 'INSERT OR IGNORE INTO processed_events (event_id, event_type, received_at) VALUES (?, ?, ?)', event.id, event.event_type, new Date().toISOString())
      if (!claimed) return { status: 200, body: { duplicate: true, event_id: event.id } }
      return { status: 200, body: apply(db, event) }
    })
  } catch (err) {
    return { status: 500, body: { error: (err as Error).message } }
  }
}

// Settles the shop's books against PayPal's records, so a missed webhook does not stay missed.
async function reconcileOnce(db: Db, port: PaypalPort): Promise<void> {
  const orders = all(db, "SELECT paypal_order_id FROM orders WHERE status = 'CAPTURED'")
  for (const order of orders) {
    const orderId = String(order.paypal_order_id)
    const ledger = await port.getOrder(orderId)
    for (const refund of ledger.refunds) {
      run(db, 'INSERT OR IGNORE INTO refunds (paypal_refund_id, paypal_order_id, amount) VALUES (?, ?, ?)', refund.id, orderId, refund.amount)
    }
  }
}

export function startReconcile(db: Db, port: PaypalPort): void {
  if (config.reconcileIntervalMs <= 0) return
  const timer = setInterval(() => {
    reconcileOnce(db, port).catch(() => {
      // PayPal unreachable: try again on the next tick
    })
  }, config.reconcileIntervalMs)
  timer.unref()
}
