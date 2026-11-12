import { randomUUID } from 'node:crypto'
import { PRODUCT_PRICES } from './config.ts'
import { one, run, type Db } from './db.ts'
import { toCents, fromCents } from './money.ts'
import { NetworkError, PaypalError, type PaypalPort } from './paypalPort.ts'

// The caller sent something the shop will not pass on to PayPal. Never reaches the port.
export class ShopInputError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Creates the PayPal order. The amount comes from the server-side price list, never from the client.
export async function createCheckout(db: Db, port: PaypalPort, sku: string, quantity: number) {
  const unit = PRODUCT_PRICES[sku]
  if (!unit) throw new ShopInputError(400, `Unknown product ${sku}`)
  const amount = fromCents(toCents(unit) * quantity)
  const order = await port.createOrder(amount, randomUUID())
  run(db, 'INSERT INTO orders (paypal_order_id, sku, amount, status, created_at) VALUES (?, ?, ?, ?, ?)', order.id, sku, amount, 'CREATED', new Date().toISOString())
  return { orderId: order.id, approveUrl: order.approveUrl, amount }
}

// The buyer comes back from PayPal. Capture the money and book the capture.
// Shipping is not decided here: it waits for the PAYMENT.CAPTURE.COMPLETED webhook.
export async function returnPath(db: Db, port: PaypalPort, orderId: string) {
  if (!one(db, 'SELECT 1 AS found FROM orders WHERE paypal_order_id = ?', orderId)) throw new ShopInputError(404, 'Unknown order')
  let captureId: string | null = null
  try {
    captureId = (await port.captureOrder(orderId)).captureId
  } catch (err) {
    // The capture may already exist (the buyer reloaded, or this is a replay), or the reply may have been lost.
    // UNKNOWN OUTCOMES: read the order back. If that read fails too, the NetworkError says the outcome is still unknown.
    const lostReply = err instanceof NetworkError
    if (!lostReply && !(err instanceof PaypalError && err.issue === 'ORDER_ALREADY_CAPTURED')) throw err
    captureId = (await port.getOrder(orderId)).captureId
    if (!captureId && lostReply) throw err
  }
  if (!captureId) throw new Error('No capture found for the order')
  const order = one(db, 'SELECT amount FROM orders WHERE paypal_order_id = ?', orderId)
  run(db, 'INSERT OR IGNORE INTO captures (paypal_capture_id, paypal_order_id, amount, status) VALUES (?, ?, ?, ?)', captureId, orderId, String(order?.amount), 'COMPLETED')
  run(db, "UPDATE orders SET status = 'CAPTURED' WHERE paypal_order_id = ?", orderId)
  return { orderId, captureId }
}
