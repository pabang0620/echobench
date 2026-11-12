// Operation names of the APIMatic PayPal TypeScript SDK (package `paypal` 2.29.0), read from the installed
// package's own map (node_modules/paypal/map/operations/orders.md and payments.md). Used by the lookup_sdk tool.
// Request fields are written in the SDK's camelCase, with the wire name where it differs.
export const SDK_MAP = {
  'orders.createOrder': { resource: 'orders', http: 'POST /v2/checkout/orders', request: 'Orders.CreateOrderRequest { payPalRequestId (header PayPal-Request-Id), prefer (default "return=minimal"), body: OrderRequest }', note: 'Send a payPalRequestId so a resent create is recognised. The reply is minimal (id, status, links) unless prefer says otherwise.' },
  'orders.getOrder': { resource: 'orders', http: 'GET /v2/checkout/orders/{id}', request: 'Orders.GetOrderRequest { id, fields? }', note: 'purchaseUnits[].payments.captures and .refunds hold PayPal\'s own records. Use it to settle an unknown outcome.' },
  'orders.captureOrder': { resource: 'orders', http: 'POST /v2/checkout/orders/{id}/capture', request: 'Orders.CaptureOrderRequest { id, prefer (default "return=minimal"), payPalRequestId?, body? }', note: 'A second capture is rejected with ORDER_ALREADY_CAPTURED (422); read the order back. Set prefer to "return=representation" if you read the capture id from the reply.' },
  'payments.getCapturedPayment': { resource: 'payments', http: 'GET /v2/payments/captures/{capture_id}', request: 'Payments.GetCapturedPaymentRequest { captureId }', note: 'supplementaryData.relatedIds.orderId links a capture to its order.' },
  'payments.refundCapturedPayment': { resource: 'payments', http: 'POST /v2/payments/captures/{capture_id}/refund', request: 'Payments.RefundCapturedPaymentRequest { captureId, payPalRequestId (header PayPal-Request-Id), prefer, body?: RefundRequest { amount?: Money } }', note: 'payPalRequestId is the header PayPal uses to recognise a repeated refund. The SDK also adds its own Idempotency-Key to every non-GET call, minted per call, which PayPal does not use for this. POST is not retried by the SDK by default.' },
  'payments.getRefund': { resource: 'payments', http: 'GET /v2/payments/refunds/{refund_id}', request: 'Payments.GetRefundRequest { refundId }', note: 'Needs the refund id; a lost reply is exactly the case where you do not have it.' },
}

export function lookupSdk(name) {
  const key = Object.keys(SDK_MAP).find((k) => k.toLowerCase().endsWith(String(name).toLowerCase()) || k.toLowerCase() === String(name).toLowerCase())
  return key ? { name: key, ...SDK_MAP[key] } : { error: `No SDK entry named ${name}`, known: Object.keys(SDK_MAP) }
}
