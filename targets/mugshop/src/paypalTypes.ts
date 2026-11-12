// Shared shapes for both PayPal adapters (plain REST and the APIMatic SDK). The shop code only
// sees these, so the two adapters are interchangeable.

// PayPal answered with an error status (or a body we could not read on an error status).
export class PaypalError extends Error {
  status: number
  issue: string
  debugId: string
  constructor(status: number, issue: string, message: string, debugId = '') {
    super(message)
    this.status = status
    this.issue = issue
    this.debugId = debugId
  }
}

// The exchange broke after the request may already have reached PayPal: a dropped connection, a
// timeout, or a success reply that could not be read. This is an unknown outcome, never a failure.
export class NetworkError extends Error {}

// The request never left: no credential could be obtained, or a value would not encode. Nothing to re-read.
export class NotSentError extends Error {}

export interface LedgerRefund {
  id: string
  amount: string
  status: string
}

export interface LedgerOrder {
  id: string
  status: string
  amount: string
  captureId: string | null
  refunds: LedgerRefund[]
}

export interface PaypalPort {
  createOrder(amount: string, requestId: string): Promise<{ id: string; approveUrl: string }>
  captureOrder(orderId: string): Promise<{ captureId: string }>
  getOrder(orderId: string): Promise<LedgerOrder>
  getCapture(captureId: string): Promise<{ id: string; orderId: string }>
  refundCapture(captureId: string, amount: string, payPalRequestId: string): Promise<LedgerRefund>
}
