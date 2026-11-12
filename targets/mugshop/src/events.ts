// Small readers for the PayPal webhook event bodies MugShop cares about.
export interface PaypalEvent {
  id: string
  event_type: string
  resource: Record<string, any>
}

export function parseEvent(body: Buffer): PaypalEvent | null {
  try {
    const event = JSON.parse(body.toString('utf8'))
    if (typeof event?.id !== 'string' || typeof event?.event_type !== 'string' || typeof event?.resource !== 'object') return null
    return event as PaypalEvent
  } catch {
    return null
  }
}

function lastSegment(href: unknown): string {
  return String(href || '').split('/').filter(Boolean).pop() || ''
}

// CHECKOUT.ORDER.APPROVED: resource is the order.
export function approvedOrderId(event: PaypalEvent): string {
  return String(event.resource.id || '')
}

// PAYMENT.CAPTURE.COMPLETED: resource is the capture; the order id sits in supplementary_data.
export function capturedIds(event: PaypalEvent): { captureId: string; orderId: string; amount: string } {
  const related = event.resource.supplementary_data?.related_ids?.order_id
  const up = (event.resource.links || []).find((l: any) => l.rel === 'up')
  return {
    captureId: String(event.resource.id || ''),
    orderId: String(related || lastSegment(up?.href)),
    amount: String(event.resource.amount?.value || '0.00'),
  }
}

// PAYMENT.CAPTURE.REFUNDED: resource is the refund; the capture is its "up" link.
export function refundedIds(event: PaypalEvent): { refundId: string; captureId: string; amount: string } {
  const up = (event.resource.links || []).find((l: any) => l.rel === 'up')
  return {
    refundId: String(event.resource.id || ''),
    captureId: lastSegment(up?.href),
    amount: String(event.resource.amount?.value || '0.00'),
  }
}

// CUSTOMER.DISPUTE.CREATED: the disputed capture is seller_transaction_id.
export function disputedCaptureId(event: PaypalEvent): string {
  return String(event.resource.disputed_transactions?.[0]?.seller_transaction_id || '')
}
