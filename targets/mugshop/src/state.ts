import { all, one, type Db } from './db.ts'
import { refundAttempts } from './refunds.ts'

// Read-only view for EchoBench (adapter contract: GET /__echobench/state?paypal_order_id=...).
export function readState(db: Db, orderId: string) {
  const order = one(db, 'SELECT paypal_order_id, amount, status, on_hold FROM orders WHERE paypal_order_id = ?', orderId)
  const shipments = all(db, 'SELECT id, at_event, capture_recorded FROM shipments WHERE paypal_order_id = ? ORDER BY id', orderId)
  const refunds = all(db, 'SELECT paypal_refund_id AS id, amount FROM refunds WHERE paypal_order_id = ? ORDER BY rowid', orderId)
  const captures = all(db, 'SELECT paypal_capture_id AS id, amount FROM captures WHERE paypal_order_id = ?', orderId)
  const events = all(db, 'SELECT event_id FROM processed_events ORDER BY event_id')
  return {
    paypal_order_id: orderId,
    exists: Boolean(order),
    status: order ? String(order.status) : 'UNKNOWN',
    on_hold: Boolean(order && Number(order.on_hold)),
    fulfilled_count: shipments.length,
    shipments: shipments.map((s) => ({ id: Number(s.id), at_event: String(s.at_event), capture_recorded: Boolean(Number(s.capture_recorded)) })),
    captures: captures.map((c) => ({ id: String(c.id), amount: String(c.amount) })),
    refunds: refunds.map((r) => ({ id: String(r.id), amount: String(r.amount) })),
    refund_attempts: refundAttempts(db, orderId),
    processed_event_ids: events.map((e) => String(e.event_id)),
  }
}
