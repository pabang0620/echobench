Integrate PayPal in a new TypeScript/Node project using the Paypal TypeScript SDK (the package is `paypal`, not on npm; install it with `npm install git+https://github.com/context-plugins/paypal-typescript-sdk#main`). The project is a small checkout for a one-product shop:
- Create order, redirect the buyer to PayPal, capture order on return (Orders v2, through the SDK).
- A webhook endpoint that ships the order when PayPal says the payment is complete.
- An admin endpoint and a support endpoint that can both refund part of a captured payment (through the SDK).
- Store all data in one SQLite file whose path is the DATA_PATH environment variable.
- Read PORT, PAYPAL_BASE_URL, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_WEBHOOK_ID from the environment. Every PayPal call, including the OAuth token call, must go to PAYPAL_BASE_URL.
- Add GET /__echobench/state?paypal_order_id=... and POST /__echobench/snapshot as described below.

The product: one mug, SKU MUG-001, price 12.00 USD.

Routes the test harness calls (use exactly these paths and JSON shapes):
- GET /health answers 200 when the server is ready.
- POST /checkout with { "sku": "MUG-001", "quantity": 1 } creates the PayPal order and answers { "orderId": "<PayPal order id>", "amount": "12.00", "approveUrl": "<PayPal approve link>" }.
- GET /checkout/return?token=<PayPal order id> is where PayPal sends the buyer back; it captures the order and answers JSON.
- POST /webhooks/paypal receives PayPal webhooks.
- POST /admin/refund and POST /support/refund take { "orderId": "<PayPal order id>", "amount": "4.00", "refundRef": "<your own reference>" } and answer JSON.

Adapter contract (what any target must offer):

EchoBench only needs these from a handler, and only when `PAYPAL_ENV` is `mock` or `sandbox`:

- `GET /__echobench/state?paypal_order_id=...` returns `{ exists, status, on_hold, fulfilled_count, shipments[{id, at_event, capture_recorded}], captures[{id, amount}], refunds[{id, amount}], processed_event_ids[] }`
- `POST /__echobench/snapshot` with `{ "to": "<path inside SNAPSHOT_DIR>" }` writes a consistent copy of the SQLite file at `DATA_PATH`
- The handler keeps all its data in the SQLite file named by `DATA_PATH`, reads `PORT`, and sends its PayPal calls to `PAYPAL_BASE_URL`

(EchoBench starts the server with `ECHOBENCH_ADAPTER=1` set; offer the two `/__echobench` routes when that variable is `1` or `PAYPAL_ENV` is `mock` or `sandbox`.)

Start command: put the start command in a file `START.txt` (one line, for example `node dist/server.js`). Install any packages you need in this folder. Do not ask questions; make reasonable choices and finish the whole thing, including a quick local check that the server starts.
