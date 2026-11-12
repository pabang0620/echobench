# PayPal plan — one-mug checkout (paypal 2.29.0, ESM, Node 22, strict TS)

## Host
Single environment SDK -> `serverOptions: { baseUrl: PAYPAL_BASE_URL }` (start fails if env unset/not http(s)). Token endpoint follows the same base URL. Webhook verification is not in the SDK; done with raw `fetch` against PAYPAL_BASE_URL (`/v1/oauth2/token`, `/v1/notifications/verify-webhook-signature`).
Client: built once at startup, `retry: { maxRetries: 0 }` for writes is default (POST not retried); reads use default retry, timeout 15s. Logging: off, `level: "off"` explicit, no request body logging.

## Contract sheet (from map + models)
| Op | Signature | Fields set | Returns | Arms |
|---|---|---|---|---|
| createOrder | `orders.createOrder(Orders.CreateOrderRequest)` | `body: OrderRequest{intent:"CAPTURE", purchaseUnits:[{amount:{currencyCode,value}}], paymentSource.paypal.experienceContext{returnUrl,cancelUrl,userAction}}` | `Order` (id?, links?) | 400,401,422,default typed `Error` |
| captureOrder | `orders.captureOrder({id, payPalRequestId})` | no body | `Order` | 400/401/403/404/422/500/default |
| getOrder | `orders.getOrder({id})` | - | `Order` (purchaseUnits[].payments.captures[]{id,status,amount}, refunds[]{id,customId,amount}) | 401,404,default |
| refundCapturedPayment | `payments.refundCapturedPayment({captureId, payPalRequestId, body:RefundRequest{amount:{currencyCode,value}, customId}})` | | `Refund` (id?, status?) | 400/401/403/404/409/422/error500/default |
All response members optional -> guard `id`/`status` after each call (missing => unknown outcome).
`Prefer: return=minimal` is an SDK default and is left alone, so amounts are read via getOrder, never from the capture response.

## DUPLICATE CLAIMS
| Write | Claim store | What rejects 2nd | Caught where | Code |
|---|---|---|---|---|
| createOrder | none: every checkout is a new order | n/a (buyer may legitimately start several) | n/a | checkout handler |
| captureOrder | `orders.status` CREATED->CAPTURING conditional UPDATE keyed by order id | `changes==0` | `claimCapture` | src/orders.ts |
| refund | `refunds` row (status pending) with UNIQUE(refund_ref), inserted before the call | UNIQUE constraint (`ERR_SQLITE_ERROR` constraint) | `claimRefund` | src/refunds.ts |
Keys: `PayPal-Request-Id` = order id (capture) / refundRef (refund), set beside the claim. Claim released (reset/deleted) when PayPal definitively refuses.

## UNKNOWN OUTCOMES
| Write | Re-read | Reference | Code |
|---|---|---|---|
| captureOrder | getOrder(id) | order id | `reconcileCapture` |
| refund | getOrder(orderId), find `refunds[].customId == refundRef` | `customId` = refundRef (set because of this row) | `reconcileRefund` |
| createOrder | none possible (no search by reference) | - | answers 502 "outcome unknown"; orphan order is harmless: nothing is charged until the buyer approves, and we never learn its id. Minor assumption. |
connection/timeout/decode/missing-id on a write -> re-read; found -> settle; not found or re-read fails -> HTTP 202 `{status:"unknown"}`, claim kept. AuthError/EncodeError (never sent) -> no re-read, claim released, 502.

## CROSS-OPERATION INVARIANTS
| Invariant | Legal set | Enforced | Test |
|---|---|---|---|
| sku must be MUG-001, quantity positive int | the one product | /checkout before createOrder | bad sku -> 400, no PayPal call |
| return `token` / refund `orderId` must be an order this shop created | local `orders` table | before claim and before any call | unknown id -> 404, no call |
| refund amount > 0, 2-decimals, total refunds <= captured amount, refundRef unique | local captures/refunds | transaction before claim | over-refund -> 422 |

## OPTIONAL FIELDS
createOrder: only `body` (required). Header fields (`payPalRequestId`, mock, partner, metadata, prefer, assertion): leave out. `intent`, amount, return/cancel urls: required by task. `userAction` PAY_NOW: not required -> leave out. `description`, `customId`, `invoiceId`, `items`: leave out.
captureOrder: `payPalRequestId` set (DUPLICATE row); body, others left out.
refund: `payPalRequestId` (DUPLICATE row), `customId` (UNKNOWN row), `amount` (task); `invoiceId`, `noteToPayer`, `paymentInstruction`, `prefer`: left out.

## WHEN THE API SAYS NO (applied to createOrder/capture/refund)
4xx not 401/403/429 -> same status + reason from `payload.body.message/details`; 401/403 -> 502 fixed; 429 -> 503; 5xx -> 502; no response on write -> unknown (above); on read -> 502.

## Other decisions
- SQLite via built-in `node:sqlite` (no native build); snapshot via `VACUUM INTO`.
- Webhook: verify signature first (fail closed; infra failure -> 503 so PayPal redelivers), dedupe by event id in the same transaction that applies it, record capture then ship (one shipment per order, UNIQUE(order_id)); only COMPLETED captures ship, PENDING/DENIED/REVERSED set on_hold.
- Admin/support refund endpoints share one handler; no auth was specified (assumption: sits behind internal network).

## REQUIRED READING
MUST load typescript-error-handling, typescript-client-initialization, typescript-testing (done).

## Assumptions & Blockers
Minor only (above). No blockers.
