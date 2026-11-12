# MugShop

A one-product PayPal shop used as EchoBench's first target. It sells a mug for 12.00 USD with Orders v2, ships on webhooks and refunds from an admin button and a support tool.

MugShop is written to be correct everywhere except **one file**, `src/webhook.ts`, where three bugs are planted on purpose. The rest (checkout, return path, refund claims, signature check, the state adapter) is meant to behave. The lab shows "planted bugs" next to the target name (and "your patched copy" once a patch is applied) so nobody mistakes this for a find in someone else's code.

## The three planted bugs

| Bug | Where in `src/webhook.ts` | What it does | Caught by |
|---|---|---|---|
| A | `PAYMENT.CAPTURE.COMPLETED` case | Ships unconditionally: no event-id check, no "already shipped" check, no dispute-hold check | S1, S2 (twice, and in parallel), S7 (old replay), D1 (dispute) |
| B | `CHECKOUT.ORDER.APPROVED` case | Ships when the buyer approves, before PayPal has captured the money | S0, S3, S4 (shipment before the capture) |
| C | `PAYMENT.CAPTURE.REFUNDED` case and `startReconcile` | Keeps one refund per order and overwrites it; nothing ever compares the books with PayPal | S5b (4.00 then 8.00 ends as 8.00), S5 (a missed event stays missed) |

The reference fix is `fixes/webhook.fixed.ts`. It claims each event id and acts inside one transaction, ships only after a COMPLETED capture is booked and only once, books refunds by refund id, and reconciles with `getOrder` every second. The lab's AI step proposes this fix (mocked model output without a key) and checks it: `tsc` passes, the failing scenario goes green on a copy, and the other scenarios still pass.

## Contract behaviour (should be green)

| Plan row | How MugShop keeps the promise | Scenario |
|---|---|---|
| DUPLICATE CLAIMS, `refundCapturedPayment` | `refund_claims.request_key` is written before PayPal is called | C-DUP |
| UNKNOWN OUTCOMES, `refundCapturedPayment` | The same `PayPal-Request-Id` is sent again when the reply is lost | C-UNK |
| DUPLICATE CLAIMS, `captureOrder` | `ORDER_ALREADY_CAPTURED` is answered by reading the order back | C-DUP-CAPTURE (shop side only) |

`REFUND_CLAIM=off` is a contrast switch for the tests. It removes the claim and the retry so the verifier can be seen turning red. It is not one of the planted bugs and is never on in the demo.

## Adapter contract (what any target must offer)

EchoBench only needs these from a handler, and only when `PAYPAL_ENV` is `mock` or `sandbox`:

- `GET /__echobench/state?paypal_order_id=...` returns `{ exists, status, on_hold, fulfilled_count, shipments[{id, at_event, capture_recorded}], captures[{id, amount}], refunds[{id, amount}], processed_event_ids[] }`
- `POST /__echobench/snapshot` with `{ "to": "<path inside SNAPSHOT_DIR>" }` writes a consistent copy of the SQLite file at `DATA_PATH`
- The handler keeps all its data in the SQLite file named by `DATA_PATH`, reads `PORT`, and sends its PayPal calls to `PAYPAL_BASE_URL`

## Run it alone

```
PORT=4100 DATA_PATH=./mugshop.sqlite PAYPAL_BASE_URL=http://127.0.0.1:4200 ECHOBENCH_ADAPTER=1 \
  node --no-warnings src/server.ts
```

Normally the lab starts and restarts it for you. It uses Node's built-in type stripping (Node 22.18 or newer) and `node:sqlite`; the only package it imports is `zod`.

## paypal-plan.md

`paypal-plan.md` was written by Claude Code in the column layout of the APIMatic Context Plugin's plan (skill `typescript-integrate-paypal`, section 1b) so the Contract tab has something to read. It is not the plugin's own generated output. See VERIFY.md R2 for replacing it with a generated one.
