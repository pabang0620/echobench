# PayPal integration plan: MugShop (EchoBench's demo store)

Contract sheet for the APIMatic Context Plugin's TypeScript skills (`typescript-integrate-paypal`, `typescript-getting-started`, `typescript-error-handling`, plus configuration-resilience, calling-endpoints, models, testing, client-initialization, authentication). Every signature, field, channel and error arm below was read from `node_modules/paypal/` (`sdk-map.md`, `map/operations/orders.md`, `map/operations/payments.md`, and the model files they name), SDK version 2.29.0. Nothing is from memory.

How to read the code references: every path in a "Where in the code" cell is relative to `targets/mugshop/`. Paths in a test cell start with `../../test/` (the EchoBench test folder). EchoBench's Contract tab parses this file by its table headers (`server/contract/headers.js`).

## Scope and survey

- Operations in scope (what MugShop calls live): `client.orders.createOrder`, `client.orders.captureOrder`, `client.orders.getOrder`, `client.payments.getCapturedPayment`, `client.payments.refundCapturedPayment`. EchoBench's judge (`server/truth.js`) reads with `client.orders.getOrder` and `client.payments.getCapturedPayment`, and never writes.
- `client.payments.getRefund` exists but is not used: a lost refund reply does not tell the app the refund id, so it cannot be the re-read path (see UNKNOWN OUTCOMES).
- Not in the SDK, kept on REST: Webhooks v1 (register, list events, resend, simulate-event) in `server/webhooksRest.js`; webhook signature verification in `src/signature.ts` (self-verification with the PayPal certificate, the SDK has no webhook surface). The SDK has no Webhooks resource (resources: Orders 8, Payments 7, Vault 6, Transaction Search 2, Subscriptions 17).
- Module format: ESM (`"type": "module"`, `package.json`), Node `>=22.18` (SDK floor `>=20.3`). Runtime: Node process, TypeScript run by Node's type stripping, checked with `tsc --noEmit` (`targets/mugshop/tsconfig.json`: `strict`, `erasableSyntaxOnly`, `module: nodenext`; no `exactOptionalPropertyTypes`, no `verbatimModuleSyntax`).
- Convention exemplars: layering `src/checkout.ts` (service) over `src/paypalPort.ts` (port); errors `src/refunds.ts`; central HTTP error handling `src/server.ts`; tests `test/contract-runs.test.js` (`node:test`).
- Toolchain: npm. SDK installed with `npm install git+https://github.com/context-plugins/paypal-typescript-sdk#main` (not on npm; the install builds it, `dist/esm` and `dist/commonjs` exist). Commands: `npm test` (`node --test`), `npm run build` (vite), type check `npx tsc -p targets/mugshop/tsconfig.json --noEmit`.
- Baseline before changes: `npm test` green (REST adapter), `tsc` clean.
- Read-only smoke against a real credential: run 2026-11-12, VERIFY.md V11 PASS (getOrder, getCapturedPayment, typed 404).
- Observability: SDK logging is off (`logging: { level: "off" }` set explicitly, so `PAYPAL_CLIENT_LOG` cannot switch it on). `logRequestBody` stays off and no call passes a per-call log level. The correlation id of a PayPal error (`debugId` on the SDK `Error` model, wire `debug_id`, a required member; the response header `paypal-debug-id` is the fallback) is kept on our error as `debugId` and written to the `refund_attempts` detail.
- Pagination: none in the SDK and none needed. Streaming: none. No hooks or middleware are used; `ClientOptions.fetch` is left at the default in production code.

## Host decision

The SDK declares one environment and no `ServerEnvironment`; the host is `serverOptions.baseUrl`. MugShop sets it explicitly from `PAYPAL_BASE_URL`, and `src/paypalSdk.ts` refuses to start unless the (host, credential) pair is allowed:

| `PAYPAL_ENV` | Allowed `baseUrl` host | Credential |
| --- | --- | --- |
| `mock` | loopback only (`127.0.0.1`, `localhost`) | any non-empty placeholder |
| `sandbox` | `api-m.sandbox.paypal.com`, `api.sandbox.paypal.com`, or loopback (EchoBench's proxy, which swaps in the real credential) | non-empty |

The live hosts (`api-m.paypal.com`, `api.paypal.com`) are always refused. EchoBench's own judge does the same in `server/config.js` (`assertSandboxUrl`).

## Operation contracts

Client: one `PaypalClient`, built once per process (`src/paypalSdk.ts:buildSdkClient`), `oauth2: { clientId, clientSecret }`, `retry: { timeout: 10_000 }`, `logging: { level: "off" }`. Import aliases: SDK family `PaypalError as SdkError` (our own error class is also called `PaypalError`), model `Error as SdkErrorBody` is not needed (only `.name`, `.message`, `.details[].issue` are read).

| Operation | Signature (request type) | Wire | Returns | Members the code asserts |
| --- | --- | --- | --- | --- |
| `orders.createOrder` | `Orders.CreateOrderRequest` | `POST /v2/checkout/orders` | `Order` | `id`, `links[]` (`rel` approve or payer-action) |
| `orders.captureOrder` | `Orders.CaptureOrderRequest` | `POST /v2/checkout/orders/{id}/capture` | `Order` | `purchaseUnits[0].payments.captures[0].id` |
| `orders.getOrder` | `Orders.GetOrderRequest` | `GET /v2/checkout/orders/{id}` | `Order` | `id`, `status`, `purchaseUnits` |
| `payments.getCapturedPayment` | `Payments.GetCapturedPaymentRequest` | `GET /v2/payments/captures/{capture_id}` | `CapturedPayment` | `id`, `supplementaryData.relatedIds.orderId` |
| `payments.refundCapturedPayment` | `Payments.RefundCapturedPaymentRequest` | `POST /v2/payments/captures/{capture_id}/refund` | `Refund` | `id`, `status` |

Required members set by the code: `OrderRequest.intent` (`CheckoutPaymentIntent.Capture`), `OrderRequest.purchaseUnits[].amount.currencyCode` and `.value`. `Order`, `CapturedPayment` and `Refund` have no required members, so a truncated 2xx decodes cleanly; every member in the last column is guarded (`undefined` means unknown outcome, never success).

Error arms per operation (tags are schema-derived; narrowing is per operation, the code reads `err.status` and the arm body only):

| Operation | Arms (status: tag) |
| --- | --- |
| `createOrder` | 400 `error`, 401 `error2`, 422 `error3`, default `error4`, `undeclared` |
| `captureOrder` | 400 `error`, 401 `error2`, 403 `error3`, 404 `error4`, 422 `error5`, 500 `error6`, default `error7`, `undeclared` |
| `getOrder` | 401 `error`, 404 `error2`, default `error3`, `undeclared` |
| `getCapturedPayment` | 401 `error`, 403 `error2`, 404 `error3`, 500 `error500` (no body), default `error4`, `undeclared` |
| `refundCapturedPayment` | 400 `error`, 401 `error2`, 403 `error3`, 404 `error4`, 409 `error5`, 422 `error6`, 500 `error500` (no body), default `error7`, `undeclared` |

All bodies are the `Error` model (`name`, `message`, optional `details[]` with `issue`). A body-less arm (`error500`) rejects any body with `DecodeError` on that status, handled below.

Response mode: awaited (throwing). No operation in scope resolves to `undefined`, so `.asApiResult()` is not needed. Enum members: `CheckoutPaymentIntent.Capture` only.

## DUPLICATE CLAIMS

| Write | Where the claim is stored | What rejects the second one | Where that rejection is caught | Where in the code |
| --- | --- | --- | --- | --- |
| `refundCapturedPayment` | `refund_claims.request_key` (order id + refund reference, the same value for both entry points) | `request_key` PRIMARY KEY with `INSERT OR IGNORE`, written before the SDK call | `requestRefund` sees zero changed rows and answers 409 `rejected-duplicate`; the claim is deleted when PayPal refuses the call or the request never left | `src/refunds.ts:requestRefund` |
| `captureOrder` | PayPal (an order can be captured once) and `captures.paypal_capture_id` PRIMARY KEY | PayPal `ORDER_ALREADY_CAPTURED` (422), then `INSERT OR IGNORE` | `returnPath` reads the order back with `getOrder` and books the existing capture | `src/checkout.ts:returnPath` |
| `createOrder` | none (see Assumptions & Blockers: every checkout is a new cart) | none | none | `src/checkout.ts:createCheckout` |

The SDK mints one `Idempotency-Key` per call. It is not `PayPal-Request-Id`, which is the header PayPal uses to recognise a repeated request. The refund claim stores `paypal_request_id` and every send for that claim carries it through the `payPalRequestId` field.

## UNKNOWN OUTCOMES

| Write | The operation you re-read with | The reference you search by | Where in the code | The test that fails the connection |
| --- | --- | --- | --- | --- |
| `refundCapturedPayment` | send again with the same `payPalRequestId` (PayPal answers with the stored refund); at most three sends | `refund_claims.paypal_request_id` | `src/refunds.ts:requestRefund` | `../../test/sdk-adapter.test.js` |
| `captureOrder` | `getOrder` (`purchaseUnits[].payments.captures`) | PayPal order id | `src/checkout.ts:returnPath` | `../../test/sdk-adapter.test.js` |

Never-sent failures (`AuthError`, `EncodeError`) reach a different outcome: `NotSentError`, no re-read, claim released, answer 502 with a fixed message. `DecodeError` on a 2xx is an unknown outcome (the write may have happened) and is settled like a dropped connection. `getRefund` is not a legal entry: the refund id was inside the lost reply.

## CROSS-OPERATION INVARIANTS

| Invariant | Where the legal set comes from | Enforced where | The test that proves it |
| --- | --- | --- | --- |
| `sku` must be a product MugShop sells | the shop's own price list (`PRODUCT_PRICES`) | `src/checkout.ts:createCheckout` | `../../test/sdk-adapter.test.js` |
| A refund is only attempted for an order that has a capture in the shop's books | the shop's own `captures` table | `src/refunds.ts:requestRefund` | `../../test/sdk-adapter.test.js` |
| Refunds never exceed the captured amount | PayPal (`REFUND_AMOUNT_EXCEEDED`) | PayPal, surfaced as 422 by `requestRefund` | none in MugShop |
| A mug ships once per captured payment | the shop's own rule | `src/webhook.ts` | EchoBench S0 to S4 |

## OPTIONAL FIELDS

`createOrder` (`Orders.CreateOrderRequest`)

| Field | What requires it | Set it? |
| --- | --- | --- |
| `payPalRequestId` | DUPLICATE CLAIMS note: a per-call id so a resend of the same call is recognised by PayPal | set, one id per call |
| `prefer` (default `return=minimal`) | nothing. The code reads only `id` and `links`, which the minimal response carries | leave out |
| `payPalMockResponse`, `payPalPartnerAttributionId`, `payPalClientMetadataId`, `payPalAuthAssertion` | nothing | leave out |

`captureOrder` (`Orders.CaptureOrderRequest`)

| Field | What requires it | Set it? |
| --- | --- | --- |
| `id` | path, required | set |
| `prefer` (default `return=minimal`) | DUPLICATE CLAIMS row for `captureOrder`: the code books the capture id from `purchaseUnits[0].payments.captures[0].id`, which a minimal response (id, status, links) does not promise | set `return=representation` |
| `payPalRequestId`, `payPalMockResponse`, `payPalClientMetadataId`, `payPalAuthAssertion` | nothing: PayPal itself rejects a second capture | leave out |
| `body` | the SDK map lists it as optional, but without a body the SDK sends no Content-Type and the sandbox answers 415 UNSUPPORTED_MEDIA_TYPE (measured, VERIFY V4) | set `{}` |

`getOrder`: `id` set; `fields`, `payPalMockResponse`, `payPalAuthAssertion` leave out (nothing requires them; `fields` unset keeps the full order, which holds the captures and refunds the judge reads).

`getCapturedPayment`: `captureId` set; `payPalMockResponse` leave out.

`refundCapturedPayment` (`Payments.RefundCapturedPaymentRequest`)

| Field | What requires it | Set it? |
| --- | --- | --- |
| `captureId` | path, required | set |
| `payPalRequestId` | UNKNOWN OUTCOMES and DUPLICATE CLAIMS rows for `refundCapturedPayment` (the stored reference) | set from `refund_claims.paypal_request_id` |
| `body.amount` | the task: refund the amount the shop computed | set `{ currencyCode: "USD", value }` |
| `prefer` (default `return=minimal`) | nothing: `id` and `status` are in the minimal response | leave out |
| `body.invoiceId`, `body.customId`, `body.noteToPayer`, `body.paymentInstruction`, `payPalMockResponse`, `payPalAuthAssertion` | nothing | leave out |

Test that proves it: `../../test/sdk-adapter.test.js` asserts the headers and body the SDK actually sent carry no key outside this table (apart from what the SDK adds itself: authorization, content type, accept, `Idempotency-Key`, and the `Prefer` default where we do not set it).

## WHEN THE API SAYS NO

One table per operation that uses data a caller supplied. All three go through `describeFailure` (`src/failure.ts`), used by `requestRefund` and the central handler in `src/server.ts`.

`refundCapturedPayment` (order id, amount, refund reference typed by an operator)

| status | your app answers | the caller reads | test |
| --- | --- | --- | --- |
| a `4xx` other than 401 / 403 / 429 | the same `4xx` | the API's reason (`error` = issue code, `reason` = message) | `../../test/sdk-adapter.test.js` |
| 401 / 403 | 502 | fixed: "PayPal rejected the shop's credentials" | `../../test/sdk-adapter.test.js` |
| 429 | 503 | fixed: "PayPal is rate limiting the shop" | `../../test/sdk-adapter.test.js` |
| 5xx | 502 | fixed: "PayPal had a problem" | `../../test/sdk-adapter.test.js` |
| no response, on a write | 502 | "Refund outcome unknown, will be settled" (after the re-send) | `../../test/sdk-adapter.test.js` |

`captureOrder` (order id from the return URL)

| status | your app answers | the caller reads | test |
| --- | --- | --- | --- |
| a `4xx` other than 401 / 403 / 429 | the same `4xx` | the API's reason | `../../test/sdk-adapter.test.js` |
| 401 / 403 | 502 | fixed | `../../test/sdk-adapter.test.js` |
| 429 | 503 | fixed | `../../test/sdk-adapter.test.js` |
| 5xx | 502 | fixed | `../../test/sdk-adapter.test.js` |
| no response, on a write | per UNKNOWN OUTCOMES (re-read with `getOrder`; still unknown: 502 "outcome unknown") | unknown, never "failed" | `../../test/sdk-adapter.test.js` |

`createOrder` (sku and quantity; the amount is computed by the server)

| status | your app answers | the caller reads | test |
| --- | --- | --- | --- |
| a `4xx` other than 401 / 403 / 429 | the same `4xx` | the API's reason | `../../test/sdk-adapter.test.js` |
| 401 / 403 | 502 | fixed | `../../test/sdk-adapter.test.js` |
| 429 | 503 | fixed | `../../test/sdk-adapter.test.js` |
| 5xx | 502 | fixed | `../../test/sdk-adapter.test.js` |
| no response, on a write | 502 | unknown: an unpaid order may exist at PayPal, nothing was charged | `../../test/sdk-adapter.test.js` |

## Retry, timeout, logging

- Retry: the SDK default stands for reads (`GET`: up to 3 retries on 408, 429, 500, 502, 503, 504 and dropped connections). `POST` is not in `httpMethodsToRetry` and stays out; every write also passes `{ retry: { maxRetries: 0 } }` so a changed client default cannot resend it. Re-sends of a refund are the shop's own (`requestRefund`), with the stored `payPalRequestId`, three sends at most.
- Timeout: `retry.timeout = 10_000` ms per attempt (SDK default 60 s would hold a request for a minute).
- `Idempotency-Key`: sent by the SDK on every non-GET. It is minted per call, so it does not join two calls of ours. The `PayPal-Request-Id` (field `payPalRequestId`) does.
- Logging: off. No body logging.

## Assumptions & Blockers

- Blocker (accepted, not hidden): `createOrder` has no DUPLICATE CLAIMS claim. Each checkout click is a legitimate new cart, so there is no value every caller computes the same. A lost reply leaves an unpaid order at PayPal that expires; no money moves before `captureOrder`. Not settled by this build.
- Assumption: PayPal answers a repeated `PayPal-Request-Id` on the refund call with the stored result (documented behaviour, measured in VERIFY.md V5 against the sandbox). Result: holds (2026-11-12).
- Assumption: `Prefer: return=representation` on `captureOrder` returns `purchase_units[].payments.captures` (documented). Measured in VERIFY.md "SDK smoke" and V4. Result: holds (2026-11-12).
- Open check: the SDK's `Error` model requires `name`, `message` and `debug_id` (`src/models/error.ts`). An error reply without them rejects with `DecodeError` on the error status, and the SDK does not expose the raw body, so the reason is lost and the answer is `UNKNOWN`. PayPal documents `debug_id` on every error. Measured by the deliberate 404 read in VERIFY.md V11. Result: holds (2026-11-12).
- Measured finding: the SDK map says the `captureOrder` body is optional and that omitting it sends no Content-Type; the sandbox answers 415. Worth an APIMatic-side note.
- Webhooks, and verification of their signatures, are outside the SDK (REST and local code).

## REQUIRED READING

| Step | MUST load |
| --- | --- |
| Before this plan | `typescript-getting-started`, `typescript-error-handling` |
| Client construction (`src/paypalSdk.ts`, `server/truth.js`) | MUST load `typescript-client-initialization`, `typescript-authentication` |
| Calls and request building | MUST load `typescript-calling-endpoints`, `typescript-models` |
| Retry, timeout, host, logging | MUST load `typescript-configuration-resilience` |
| Any test that fakes `fetch` | MUST load `typescript-testing` |
