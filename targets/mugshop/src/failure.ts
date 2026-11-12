import { PaypalError } from './paypalTypes.ts'

export interface Answer {
  status: number
  body: Record<string, unknown>
}

// WHEN THE API SAYS NO (paypal-plan.md, WHEN THE API SAYS NO): what the shop tells its own caller.
// A 4xx the caller can act on keeps its status and PayPal's reason. Our credentials, quota and
// PayPal's own faults get fixed messages, because the caller can change none of them.
export function describeFailure(err: PaypalError): Answer {
  const { status } = err
  if (status === 401 || status === 403) return { status: 502, body: { error: 'PAYPAL_CREDENTIALS', reason: "PayPal rejected the shop's credentials" } }
  if (status === 429) return { status: 503, body: { error: 'PAYPAL_RATE_LIMIT', reason: 'PayPal is rate limiting the shop' } }
  if (status >= 500) return { status: 502, body: { error: 'PAYPAL_UNAVAILABLE', reason: 'PayPal had a problem' } }
  if (status >= 400) return { status, body: { error: err.issue, reason: err.message } }
  return { status: 502, body: { error: 'PAYPAL_UNEXPECTED', reason: 'PayPal answered in a way the shop does not understand' } }
}

export const NOT_SENT_ANSWER: Answer = { status: 502, body: { error: 'PAYPAL_NOT_REACHED', reason: 'The shop could not authenticate with PayPal, nothing was sent' } }
export const UNKNOWN_OUTCOME_ANSWER: Answer = { status: 502, body: { error: 'PAYPAL_OUTCOME_UNKNOWN', reason: 'PayPal may have acted, the outcome is unknown and will be settled' } }
