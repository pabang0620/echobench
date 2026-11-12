// The two target-specific cells of the INBOUND EVENTS table for MugShop, read from its own code
// (targets/mugshop/src/db.ts for the tables, src/webhook.ts and fixes/webhook.fixed.ts for the handler).
const EVENT_TYPES = ['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.REFUNDED', 'CUSTOMER.DISPUTE.CREATED']

const PLANTED = {
  'CHECKOUT.ORDER.APPROVED': ['`processed_events.event_id` (PRIMARY KEY, `src/db.ts`)', 'Nothing. `INSERT OR REPLACE` in `src/webhook.ts` overwrites the row, and the approval branch ships the mug (planted bug B)'],
  'PAYMENT.CAPTURE.COMPLETED': ['`processed_events.event_id`, and `captures.paypal_capture_id` (PRIMARY KEY)', 'Nothing for shipping. The capture row is written with `INSERT OR IGNORE`, but `shipOrder` runs on every delivery (planted bug A)'],
  'PAYMENT.CAPTURE.REFUNDED': ['`refunds.paypal_refund_id` (UNIQUE, `src/db.ts`)', 'Nothing. The handler deletes the order\'s refunds and inserts one, so the UNIQUE column never rejects anything (planted bug C)'],
  'CUSTOMER.DISPUTE.CREATED': ['`orders.on_hold` (a flag on the order)', 'A repeat sets the flag again, which is harmless. The check that reads it before shipping is missing (planted bug A)'],
}

const FIXED = {
  'CHECKOUT.ORDER.APPROVED': ['`processed_events.event_id` (PRIMARY KEY)', '`INSERT OR IGNORE` changes no row, so the handler answers `duplicate: true` and does nothing. The approval only sets the order to APPROVED'],
  'PAYMENT.CAPTURE.COMPLETED': ['`processed_events.event_id`, `captures.paypal_capture_id` (PRIMARY KEY), `shipments`', 'The event id claim, then `ship()` skips an order that is on hold, already shipped, or has no COMPLETED capture'],
  'PAYMENT.CAPTURE.REFUNDED': ['`processed_events.event_id`, `refunds.paypal_refund_id` (UNIQUE)', 'The event id claim, then `INSERT OR IGNORE` on the refund id. Each refund is its own row, so two refunds add up'],
  'CUSTOMER.DISPUTE.CREATED': ['`processed_events.event_id`, `orders.on_hold`', 'The event id claim. `ship()` reads `on_hold` and holds the shipment'],
}

const PATCHED = ['`processed_events.event_id` (PRIMARY KEY, `src/db.ts`)', 'Changed by the patch you applied: see its diff in the card, or `src/webhook.ts` in the working copy']

// handler: 'planted' | 'fixed' | 'patched' | null (any other target)
export function mugshopCells(handler) {
  if (!handler) return null
  const table = handler === 'planted' ? PLANTED : handler === 'fixed' ? FIXED : null
  return Object.fromEntries(EVENT_TYPES.map((type) => [type, table ? table[type] : PATCHED]))
}
