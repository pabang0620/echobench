# Generation log: SDK-named request, plugin off

Started 2026-11-12T06:33:50Z (UTC). Claude Code 2.1.322, model `claude-sonnet-5-5`, through the local Claude Code account (apiKeySource: none).
Command: `claude -p "$(cat REQUEST_SDK.md)" --model claude-sonnet-5-5 --setting-sources "" --strict-mcp-config --no-session-persistence --permission-mode bypassPermissions --output-format stream-json --verbose`
Run in an empty folder outside any project (no CLAUDE.md, no user settings, no MCP servers). The only difference between the two runs of this round is the `--plugin-dir` flag.

Plugins loaded: cc-plugin-agents-md, cc-plugin-telemetry, cc-plugin-privacy, cc-plugin-plugin-authoring
Skills the session could use (19): deep-research, design, design-sync, dataviz, update-config, verify, debug, code-review, simplify, batch, fewer-permission-prompts, doctor, loop, schedule, claude-api, workflow-authoring, run, run-skill-generator, plugin-authoring

Result: success, 14 turns, 151 s.

The raw stream is `generation.stream.jsonl` in this folder. Nothing in this folder was edited by hand after generation.

## Transcript

**Tool call `Bash`**
```
ls -la && npm init -y >/dev/null && npm install git+https://github.com/context-plugins/paypal-typescript-sdk#main 2>&1 | tail -5; ls node_modules; node -v
```

Tool result:
```
total 0
drwxr-xr-x 2 lee lee  40 Nov 12 15:33 .
drwxr-xr-x 4 lee lee 240 Nov 12 15:33 ..

1 package is looking for funding
  run `npm fund` for details

found 0 vulnerabilities
paypal
zod
v22.23.1
```

**Tool call `Bash`**
```
cd /tmp/claude-1000/-home-lee-project/24a2843c-f5c4-4147-8649-980e86b209f4/scratchpad/ab-gen-sdk/sdk-plugin-off/node_modules/paypal && ls; cat package.json | head -40; cat README* | head -150
```

Tool result:
```
LICENSE
README.md
api-reference.md
dist
map
package.json
sdk-map.md
src
tsconfig.json
tsconfig.tshy.json
{
  "name": "paypal",
  "version": "2.29.0",
  "description": "### Important Notes\n - **Available Features:** This SDK currently contains only 5 of PayPal's API endpoints. Additional endpoints and functionality will be added in the future.\n \n ## Information\n The PayPal Server SDK provides integration access to the PayPal REST APIs. The API endpoints are divided into distinct controllers:\n - Orders Controller: [Orders API v2](https://developer.paypal.com/docs/api/orders/v2/)\n - Payments Controller: [Payments API v2](https://developer.paypal.com/docs/api/payments/v2)\n - Vault Controller: [Payment Method Tokens API v3](https://developer.paypal.com/docs/api/payment-tokens/v3/) *Available in the US only.*\n - Transaction Search Controller: [Transaction Search API v1](https://developer.paypal.com/docs/api/transaction-search/v1/)\n - Subscriptions Controller: [Subscriptions API v1](https://developer.paypal.com/docs/api/subscriptions/v1/)",
  "type": "module",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/esm/index.d.ts",
        "default": "./dist/esm/index.js"
      },
      "require": {
        "types": "./dist/commonjs/index.d.ts",
        "default": "./dist/commonjs/index.js"
      }
    },
    "./package.json": "./package.json"
  },
  "tshy": {
    "exports": {
      ".": "./src/index.ts",
      "./package.json": "./package.json"
    },
    "dialects": [
      "esm",
      "commonjs"
    ],
    "project": "./tsconfig.tshy.json",
    "selfLink": false
  },
  "main": "./dist/commonjs/index.js",
  "module": "./dist/esm/index.js",
  "types": "./dist/commonjs/index.d.ts",
  "files": [
    "dist",
    "src",
    "tsconfig.json",
    "tsconfig.tshy.json",
    "README.md",
    "api-reference.md",
# Paypal

[![Built with APIMatic][apimatic-badge]][apimatic-url] [![License: MIT][license-badge]][license-url]

The Paypal SDK for TypeScript provides typed access to the Paypal REST APIs from Node.js and the browser.

> [!TIP]
> **Looking for a specific signature, request field, model, enum or error type?** This SDK ships a generated, machine-readable **[SDK map](sdk-map.md)** — a lookup index of the whole TypeScript surface. Consult it **before** grepping or scanning the source tree; it answers most contract questions directly and, where a source file is genuinely needed, names the exact one to open. Details under [SDK map](#sdk-map).

### Important Notes
 - **Available Features:** This SDK currently contains only 5 of PayPal's API endpoints. Additional endpoints and functionality will be added in the future.
 
 ## Information
 The PayPal Server SDK provides integration access to the PayPal REST APIs. The API endpoints are divided into distinct controllers:
 - Orders Controller: [Orders API v2](https://developer.paypal.com/docs/api/orders/v2/)
 - Payments Controller: [Payments API v2](https://developer.paypal.com/docs/api/payments/v2)
 - Vault Controller: [Payment Method Tokens API v3](https://developer.paypal.com/docs/api/payment-tokens/v3/) *Available in the US only.*
 - Transaction Search Controller: [Transaction Search API v1](https://developer.paypal.com/docs/api/transaction-search/v1/)
 - Subscriptions Controller: [Subscriptions API v1](https://developer.paypal.com/docs/api/subscriptions/v1/)

---

## Installation

The SDK compiles to `dist/` before it can be referenced — run its `build` script once in the SDK folder, then add it to your project by path:

'''bash
npm install <path-to-sdk>
'''

---

## Quick Start

Create one client and reuse it. Configure its behaviour through [ClientOptions](src/client-options.ts).

'''ts
import { PaypalClient } from "paypal";

const client = new PaypalClient({
  oauth2: { clientId: "YOUR_CLIENT_ID", clientSecret: "YOUR_CLIENT_SECRET" },
});
'''

Nothing in `ClientOptions` is required — `new PaypalClient()` compiles — and each option left out falls back to its default. 
```

**Tool call `Bash`**
```
cat sdk-map.md; cat map/operations/orders.md; ls map/operations; ls dist
```

Tool result:
```
<persisted-output>
Output too large (51.6KB). Full output saved to: /home/lee/.claude/projects/-tmp-claude-1000--home-lee-project-24a2843c-f5c4-4147-8649-980e86b209f4-scratchpad-ab-gen-sdk-sdk-plugin-off/836bc7df-d865-4994-b93c-69bb3a3c9d89/tool-results/bi80td10g.txt

Preview (first 2KB):
<!-- Generated file — do not edit; regenerated with the SDK. -->

# SDK map — Paypal (TypeScript)

> A generated table of contents for this SDK. Consult this map and its sub-pages to learn signatures, request-field placement, error types and server wiring **by lookup**. Model shapes and enum values are *not* duplicated here — the map names the file declaring each type and the schema value exported beside it; read the shape there. The compiler is the backstop: a wrong name fails to build.

|  |  |
| --- | --- |
| SDK display name | Paypal |
| Package | `paypal` |
| Package version | `2.29.0` |
| API spec version | `2.29` |
| Import specifier | `paypal` — the package root is the **only** entry. Deep imports (`paypal/models/...`) do not resolve; the `exports` map exposes `.` and `./package.json` and nothing else |
| Module format | dual ESM + CommonJS, as folder dialects (`dist/esm`, `dist/commonjs`), each with its own `package.json` marker. No `.mjs`, `.cjs`, `.d.mts` or `.d.cts` files exist |
| Node floor | `>=20.3` (`engines.node`) |
| TypeScript floor | a resolver that reads `exports` (4.7+), plus whatever the pinned `zod` requires — `zod@4` needs 5.5 or later. The public `.d.ts` chain reaches `zod/v4-mini`, so this is a real constraint rather than a build-tool version |
| Runtime dependency | `zod` (`^4.1.0`), imported as `zod/v4-mini`. The only runtime dependency |
| Generator | APIMatic |

Staleness check: the API spec version above changes when the SDK is regenerated from a new spec. If a lookup here fails to compile, trust the compiler and re-read the source file named in the row.

...
</persisted-output>
```

**Tool call `Bash`**
```
sed -n 20,200p sdk-map.md | cut -c1-600
```

Tool result:
```
Staleness check: the API spec version above changes when the SDK is regenerated from a new spec. If a lookup here fails to compile, trust the compiler and re-read the source file named in the row.

All `Source` paths on this map and its sub-pages are relative to the **SDK root** — the directory holding this file and `package.json` — never to the page that carries them: a page two directories deep writes exactly what a page at the root would. The package ships its `src/` tree, so the same paths resolve inside `node_modules/paypal/` too. An import specifier ending `.js` inside that source is the NodeNext spelling of the sibling `.ts` file.

---

## Getting a client

'''ts
import { PaypalClient } from "paypal";

const client = new PaypalClient({
  oauth2: { clientId: "YOUR_CLIENT_ID", clientSecret: "YOUR_CLIENT_SECRET" },
});
'''

The only constructor is `new PaypalClient(options: ClientOptions = {})`, so `new PaypalClient()` is the minimum. Resources are memoized lazy getters on the client — `client.orders`, `client.payments`, `client.vault`, `client.transactionSearch`, `client.subscriptions` — and their classes are exported only for their merged namespaces and for `instanceof`; their constructors take engine internals that are not exported, so reach a resource only through its getter.

All `ClientOptions` fields (source: `src/client-options.ts`; every field is `readonly`):

| Field | Type | Default |
| --- | --- | --- |
| `serverOptions` | the server's base-URL and template-variable overrides | `{}` — the resolver merges the declared defaults in |
| `retry` | `RetryOptions` | the `RetryOptions` defaults below |
| `logging` | `LoggingOptions` | off — the `LoggingOptions` defaults below |
| `fetch` | `FetchLike \| undefined` | the global `fetch`, resolved by the transport |
| `oauth2` | `OAuth2ClientCredentials \| undefined` | unset |
| `oauth2Strategy` | `OAuth2TokenStrategy<OAuth2ClientCredentials> \| undefined` | the built-in grant |

The 2 auth fields are all optional, and an unset one is not an error — the operation that wanted it simply sends no credential. What each one puts on the wire, and which operations require it, are under Servers & auth.

When no `fetch` is reachable the **constructor** throws `ConfigurationError`, not the first call.

`RetryOptions` fields (source: `src/core/retry.ts`; exported from `paypal` as a type). Every field is optional, so pass only the fields you change — each one left out takes its default:

| Field | Type | Default |
| --- | --- | --- |
| `timeout` | `number` (ms) | `60_000` |
| `statusCodesToRetry` | `readonly number[]` | `[408, 429, 500, 502, 503, 504]` |
| `httpMethodsToRetry` | `readonly HttpMethod[]` | `["GET", "HEAD", "PUT", "OPTIONS"]` |
| `maxRetries` | `number` | `3` |
| `delay` | `number` (ms) | `1000` |
| `backoffFactor` | `number` | `2` |
| `useExponentialBackoff` | `boolean` | `true` |
| `maxJitter` | `number` (a fraction, `0` to `1`) | `0.25` |
| `onRetry` | `((attempt: RetryAttempt) => void) \| undefined` | unset |

`retry: { maxRetries: 0 }` turns retries off.

A call may override three of these through `RequestOptions.retry`, typed `RequestRetryOptions`: `maxRetries`, `timeout` and `statusCodesToRetry`.

Retry types named by the fields above — public members with their **declared types**, verbatim from source; every member is `readonly`, and both are exported as types:

| Type | Public members | Source |
| --- | --- | --- |
| `RetryAttempt` — the `onRetry` callback argument | `attemptNumber: number` · `delay: number` · `reason: RetryReason` | `src/core/retry.ts` |
| `RetryReason` — narrow on `kind` | `{ kind: "status"; status: number; headers: Headers }` or `{ kind: "fault"; error: ConnectionError \| TimeoutError }`, the two retryable leaves of `PaypalError` | `src/core/retry.ts` |

`LoggingOptions` fields (source: `src/core/logging.ts`; exported from `paypal` as a type). Every field is optional, so pass only the fields you change — each one left out takes its default:

```

**Tool call `Bash`**
```
ls map/operations; cat map/operations/orders.md | cut -c1-500 | head -150
```

Tool result:
```
orders.md
payments.md
subscriptions.md
transaction-search.md
vault.md
<!-- Generated file — do not edit; regenerated with the SDK. -->

# Orders — operations

Accessor: `client.orders` · Source: `src/resources/orders.ts` · 8 operations · Request and error types: namespace `Orders`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `paypal`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### authorizeOrder

- **Signature**: `authorizeOrder(request: Orders.AuthorizeOrderRequest, options?: RequestOptions): ApiPromise<OrderAuthorizeResponse, Orders.AuthorizeOrderError>`
- **Wire**: `POST /v2/checkout/orders/{id}/authorize`
- **Auth**: `oauth2`
- **Request body**: `application/json` — the `body` field. **Optional**: omit it and the request carries no body and no `Content-Type` header at all
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `OrderAuthorizeResponse`
- **Error**: `PaypalError` with `kind: "api"`, an instance of `Orders.AuthorizeOrderError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [400] `Error` · `"error2"` [401] `Error` · `"error3"` [403] `Error` · `"error4"` [404] `Error` · `"error5"` [422] `Error` · `"error6"` [500] `Error` · `"error7"` [default — any status no arm above covers] `Error` · `"undeclared"` [a `default`-matched body that did not fit `Error`] `rawBody: ArrayBuffer`

**Fields** — `Orders.AuthorizeOrderRequest` (7):

| Field | Channel | Wire | Type | Req | Default |
| --- | --- | --- | --- | --- | --- |
| `id` | `path` | — | `string` | yes | — |
| `payPalMockResponse` | `header` | `PayPal-Mock-Response` | `string` | no | — |
| `payPalRequestId` | `header` | `PayPal-Request-Id` | `string` | no | — |
| `prefer` | `header` | `Prefer` | `string` | no | `"return=minimal"` |
| `payPalClientMetadataId` | `header` | `PayPal-Client-Metadata-Id` | `string` | no | — |
| `payPalAuthAssertion` | `header` | `PayPal-Auth-Assertion` | `string` | no | — |
| `body` | `body` | — | `OrderAuthorizeRequest` | no | — |

| Type | Schema value | Source |
| --- | --- | --- |
| `OrderAuthorizeRequest` | `orderAuthorizeRequestSchema` | `src/models/order-authorize-request.ts` |
| `OrderAuthorizeResponse` | `orderAuthorizeResponseSchema` | `src/models/order-authorize-response.ts` |
| `Error` | `errorSchema` | `src/models/error.ts` |

### captureOrder

- **Signature**: `captureOrder(request: Orders.CaptureOrderRequest, options?: RequestOptions): ApiPromise<Order, Orders.CaptureOrderError>`
- **Wire**: `POST /v2/checkout/orders/{id}/capture`
- **Auth**: `oauth2`
- **Request body**: `application/json` — the `body` field. **Optional**: omit it and the request carries no body and no `Content-Type` header at all
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `Order`
- **Error**: `PaypalError` with `kind: "api"`, an instance of `Orders.CaptureOrderError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [400] `Error` · `"error2"` [401] `Error` · `"error3"` [403] `Error` · `"error4"` [404] `Error` · `"error5"` [422] `Error` · `"error6"` [500] `Error` · `"error7"` [default — any status no arm above covers] `Error` · `"undeclared"` [a `default`-matched body that did not fit `Error`] `rawBody: ArrayBuffer`

**Fields** — `Orders.CaptureOrderRequest` (7):

| Field | Channel | Wire | Type | Req | Default |
| --- | --- | --- | --- | --- | --- |
| `id` | `path` | — | `string` | yes | — |
| `payPalMockResponse` | `header` | `PayPal-Mock-Response` | `string` | no | — |
| `payPalRequestId` | `header` | `PayPal-Request-Id` | `string` | no | — |
| `prefer` | `header` | `Prefer` | `string` | no | `"return=minimal"` |
| `payPalClientMetadataId` | `header` | `PayPal-Client-Metadata-Id` | `string` | no | — |
| `payPalAuthAssertion` | `heade
```

**Tool call `Bash`**
```
grep -n -i -A25 "^## Servers" sdk-map.md | cut -c1-900; grep -n -A22 "### refundCapturedPayment" map/operations/payments.md | cut -c1-400; cat src/client-options.ts | head -60; cat src/models/order-request.ts | grep -v "^\s*\*\|/\*\*" | head -50
```

Tool result:
```
286:## Servers & auth
287-
288-**Authentication is per operation.** Every operation declares the requirement it enforces and the SDK sends exactly that: **40 of the 40 operations** require a credential and **0** are public. Each block on a page above carries an **Auth** bullet naming its requirement, `none` included. There is no client-global switch and no per-call override.
289-
290-| Scheme (as an **Auth** bullet names it) | Configured with | What the SDK sends |
291-| --- | --- | --- |
292-| `oauth2` | `oauth2: { clientId, clientSecret, scope? }` | `Authorization: Bearer <access token>` |
293-
294-A scheme **contributes** headers, query parameters and cookies rather than mutating the request, so a credential is encoded by exactly the code that encodes an operation's own parameters. The auth layer goes on **last**, which means a scheme's `Authorization` wins over one the operation declared.
295-
296-**Composition is emitted, not configured.** Where the spec puts two schemes in one requirement the SDK sends **both**; where it lists alternatives the SDK sends the **first configured** one, in the order the **Auth** bullet prints them. The combinators that express this (`allAuth`, `anyAuth`, `noneAuth`) live in the generated resource modules and are **not exported**.
297-
298-**A credential may be a function.** Every field typed `TokenProvider` is re-read on **every** request with no caching, so a key can rotate without rebuilding the client. An empty string counts as absent, and a function is treated as present without being invoked. The function is handed the call's `signal`, or one that never aborts when the call was given none, and the SDK waits for it to settle — so a function that fetches its credential should pass that signal on, or a cancelled call waits for the fetch to finish.
299-
300-**An unconfigured scheme does not throw.** The request goes out without that credential and the server decides. So a 401 on a call you believed was authenticated is usually an unset credential field rather than an SDK failure — check the operation's **Auth** bullet against what the client was given.
301-
302-**OAuth2 fetches and caches its own token.** The token request goes through the same client as every other call — same `fetch`, same `retry` policy. It sends a form-urlencoded body, and **decodes** the response against a schema rather than casting it. An access token is cached until shortly before it expires; a response carrying no `expires_in` is treated as never expiring (RFC 6749 §5.1); concurrent callers share one in-flight fetch, and one of them aborting ends only its own wait — unless it is the caller that started the fetch, whose signal the fetch runs under. A refused token endpoint rejects with `AuthError` wrapping the underlying `ApiError` as `cause` — untyped, so its payload is the `"undeclared"` arm — so it never looks like the business call failing.
303-
304-| Flow | Token endpoint | Client credentials travel |
305-| --- | --- | --- |
306-| `oauth2` | `default` + `/v1/oauth2/token` | as `Authorization: Basic` |
307-
308-**Replacing a grant.** Each OAuth2 scheme's token request is a strategy you can substitute — `oauth2Strategy` on `ClientOptions`. A strategy is one method, `getToken(credentials, signal)`, plus `tryRefreshToken(...)` for the refreshable one. `signal` is the one the call was given, or one that never aborts when it was given none; nothing times a strategy of your own. Supply it and the built-in token request is not used, while the caching, the expiry buffer and the single-flight behaviour above still apply.
309-
310-**The auth types you can name.** Every row below is exported from the package root. `Source` is where to read the declaration, never what to import — the credential shapes themselves are already spelled in the scheme table above.
311-
132:### refundCapturedPayment
133-
134-- **Signature**: `refundCapturedPayment(request: Payments.RefundCapturedPaymentRequest, options?: RequestOptions): ApiPromise
```

**Model**

Reading the SDK models (order, refund request), then I'll write the server.

**Tool call `Bash`**
```
cd /tmp/claude-1000/-home-lee-project/24a2843c-f5c4-4147-8649-980e86b209f4/scratchpad/ab-gen-sdk/sdk-plugin-off/node_modules/paypal/src/models && for f in checkout-payment-intent purchase-unit-request amount-with-breakdown refund-request money order link-description order-application-context order-capture-request; do echo "== $f"; grep -v "^\s*\*\|/\*\*\|^import" $f.ts | head -40; done; grep -n "baseUrl\|sandbox\|api-m" ../core/*.ts ../*.ts | head
```

Tool result:
```
== checkout-payment-intent

export const CheckoutPaymentIntent = {
  Capture: "CAPTURE",
  Authorize: "AUTHORIZE",
} as const;
export type CheckoutPaymentIntent =
  | (typeof CheckoutPaymentIntent)[keyof typeof CheckoutPaymentIntent]
  | (string & {});

export const checkoutPaymentIntentSchema: EnumSchema<CheckoutPaymentIntent> =
  s.enumOf<CheckoutPaymentIntent>(CheckoutPaymentIntent);
== purchase-unit-request

export type PurchaseUnitRequest = {
  referenceId?: string;
  amount: AmountWithBreakdown;
  payee?: PayeeBase;
  paymentInstruction?: PaymentInstruction;
  description?: string;
  customId?: string;
  invoiceId?: string;
  softDescriptor?: string;
  items?: ItemRequest[];
  shipping?: ShippingDetails;
  supplementaryData?: SupplementaryData;
};

export const purchaseUnitRequestSchema: Schema<PurchaseUnitRequest> = s.object<PurchaseUnitRequest>({
  referenceId: s.optional(s.string()),
  amount: amountWithBreakdownSchema,
  payee: s.optional(s.lazy(() => payeeBaseSchema)),
  paymentInstruction: s.optional(s.lazy(() => paymentInstructionSchema)),
  description: s.optional(s.string()),
  customId: s.optional(s.string()),
  invoiceId: s.optional(s.string()),
  softDescriptor: s.optional(s.string()),
  items: s.optional(s.array(s.lazy(() => itemRequestSchema))),
  shipping: s.optional(s.lazy(() => shippingDetailsSchema)),
  supplementaryData: s.optional(s.lazy(() => supplementaryDataSchema)),
  _keysMap: {
    referenceId: "reference_id",
    paymentInstruction: "payment_instruction",
    customId: "custom_id",
    invoiceId: "invoice_id",
    softDescriptor: "soft_descriptor",
    supplementaryData: "supplementary_data",
  },
});
== amount-with-breakdown

export type AmountWithBreakdown = {
  currencyCode: string;
  value: string;
  breakdown?: AmountBreakdown;
};

export const amountWithBreakdownSchema: Schema<AmountWithBreakdown> = s.object<AmountWithBreakdown>({
  currencyCode: s.string(),
  value: s.string(),
  breakdown: s.optional(s.lazy(() => amountBreakdownSchema)),
  _keysMap: {
    currencyCode: "currency_code",
  },
});
== refund-request
  refundPaymentInstructionSchema,
  type RefundPaymentInstruction,
} from "./refund-payment-instruction.js";

export type RefundRequest = {
  amount?: Money;
  customId?: string;
  invoiceId?: string;
  noteToPayer?: string;
  paymentInstruction?: RefundPaymentInstruction;
};

export const refundRequestSchema: Schema<RefundRequest> = s.object<RefundRequest>({
  amount: s.optional(s.lazy(() => moneySchema)),
  customId: s.optional(s.string()),
  invoiceId: s.optional(s.string()),
  noteToPayer: s.optional(s.string()),
  paymentInstruction: s.optional(s.lazy(() => refundPaymentInstructionSchema)),
  _keysMap: {
    customId: "custom_id",
    invoiceId: "invoice_id",
    noteToPayer: "note_to_payer",
    paymentInstruction: "payment_instruction",
  },
});
== money

export type Money = {
  currencyCode: string;
  value: string;
};

export const moneySchema: Schema<Money> = s.object<Money>({
  currencyCode: s.string(),
  value: s.string(),
  _keysMap: {
    currencyCode: "currency_code",
  },
});
== order

export type Order = {
  createTime?: string;
  updateTime?: string;
  id?: string;
  paymentSource?: PaymentSourceResponse;
  intent?: CheckoutPaymentIntent;
  processingInstruction?: ProcessingInstruction;
  payer?: Payer;
  purchaseUnits?: PurchaseUnit[];
  status?: OrderStatus;
  links?: LinkDescription[];
};

export const orderSchema: Schema<Order> = s.object<Order>({
  createTime: s.optional(s.string()),
  updateTime: s.optional(s.string()),
  id: s.optional(s.string()),
  paymentSource: s.optional(s.lazy(() => paymentSourceResponseSchema)),
  intent: s.optional(s.lazy(() => checkoutPaymentIntentSchema)),
  processingInstruction: s.optional(s.lazy(() => processingInstructionSchema)),
  payer: s.optional(s.lazy(() => payerSchema)),
  purchaseUnits: s.optional(s.array(s.lazy(() => purchaseUnitSchema))),
  status: s.optional(s.lazy(() => orderStatusSchema)),
  links: s.optional(s
```

**Tool call `Bash`**
```
cd /tmp/claude-1000/-home-lee-project/24a2843c-f5c4-4147-8649-980e86b209f4/scratchpad/ab-gen-sdk/sdk-plugin-off && npm i -D typescript @types/node@22 2>&1 | tail -2; node -e "const {DatabaseSync}=require('node:sqlite');console.log(typeof DatabaseSync)"; grep -n "capture\|class Payments" node_modules/paypal/src/models/payment-collection.ts | head; grep -v "^\s*\*\|/\*\*\|^import" node_modules/paypal/src/models/capture-status.ts | head -20; grep -n "^  [a-zA-Z]*?*:" node_modules/paypal/src/models/refund.ts node_modules/paypal/src/models/captured-payment.ts | head -40
```

Tool result:
```
found 0 vulnerabilities
function
(node:1593435) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
7:import { ordersCaptureSchema, type OrdersCapture } from "./orders-capture.js";
12: * authorized payments, captured payments, and refunds.
21:   * An array of captured payments for a purchase unit. A purchase unit can have zero or more
22:   * captured payments.
24:  captures?: OrdersCapture[];
31:  captures: s.optional(s.array(s.lazy(() => ordersCaptureSchema))),

export const CaptureStatus = {
  Completed: "COMPLETED",
  Declined: "DECLINED",
  PartiallyRefunded: "PARTIALLY_REFUNDED",
  Pending: "PENDING",
  Refunded: "REFUNDED",
  Failed: "FAILED",
} as const;
export type CaptureStatus = (typeof CaptureStatus)[keyof typeof CaptureStatus] | (string & {});

export const captureStatusSchema: EnumSchema<CaptureStatus> = s.enumOf<CaptureStatus>(CaptureStatus);
node_modules/paypal/src/models/refund.ts:13:  status?: RefundStatus;
node_modules/paypal/src/models/refund.ts:15:  statusDetails?: RefundStatusDetails;
node_modules/paypal/src/models/refund.ts:17:  id?: string;
node_modules/paypal/src/models/refund.ts:19:  amount?: Money;
node_modules/paypal/src/models/refund.ts:24:  invoiceId?: string;
node_modules/paypal/src/models/refund.ts:29:  customId?: string;
node_modules/paypal/src/models/refund.ts:34:  acquirerReferenceNumber?: string;
node_modules/paypal/src/models/refund.ts:39:  noteToPayer?: string;
node_modules/paypal/src/models/refund.ts:41:  sellerPayableBreakdown?: SellerPayableBreakdown;
node_modules/paypal/src/models/refund.ts:46:  payer?: PayeeBase;
node_modules/paypal/src/models/refund.ts:48:  links?: LinkDescription[];
node_modules/paypal/src/models/refund.ts:55:  createTime?: string;
node_modules/paypal/src/models/refund.ts:62:  updateTime?: string;
node_modules/paypal/src/models/refund.ts:66:  status: s.optional(s.lazy(() => refundStatusSchema)),
node_modules/paypal/src/models/refund.ts:67:  statusDetails: s.optional(s.lazy(() => refundStatusDetailsSchema)),
node_modules/paypal/src/models/refund.ts:68:  id: s.optional(s.string()),
node_modules/paypal/src/models/refund.ts:69:  amount: s.optional(s.lazy(() => moneySchema)),
node_modules/paypal/src/models/refund.ts:70:  invoiceId: s.optional(s.string()),
node_modules/paypal/src/models/refund.ts:71:  customId: s.optional(s.string()),
node_modules/paypal/src/models/refund.ts:72:  acquirerReferenceNumber: s.optional(s.string()),
node_modules/paypal/src/models/refund.ts:73:  noteToPayer: s.optional(s.string()),
node_modules/paypal/src/models/refund.ts:74:  sellerPayableBreakdown: s.optional(s.lazy(() => sellerPayableBreakdownSchema)),
node_modules/paypal/src/models/refund.ts:75:  payer: s.optional(s.lazy(() => payeeBaseSchema)),
node_modules/paypal/src/models/refund.ts:76:  links: s.optional(s.array(s.lazy(() => linkDescriptionSchema))),
node_modules/paypal/src/models/refund.ts:77:  createTime: s.optional(s.string()),
node_modules/paypal/src/models/refund.ts:78:  updateTime: s.optional(s.string()),
node_modules/paypal/src/models/captured-payment.ts:24:  status?: CaptureStatus;
node_modules/paypal/src/models/captured-payment.ts:26:  statusDetails?: CaptureStatusDetails;
node_modules/paypal/src/models/captured-payment.ts:28:  id?: string;
node_modules/paypal/src/models/captured-payment.ts:30:  amount?: Money;
node_modules/paypal/src/models/captured-payment.ts:35:  invoiceId?: string;
node_modules/paypal/src/models/captured-payment.ts:40:  customId?: string;
node_modules/paypal/src/models/captured-payment.ts:42:  networkTransactionReference?: NetworkTransaction;
node_modules/paypal/src/models/captured-payment.ts:47:  sellerProtection?: SellerProtection;
node_modules/paypal/src/models/captured-payment.ts:55:  finalCapture?: boolean;
node_modules/paypal/src/models/captured-payment.ts:60:  sellerReceivableBreakdown?: SellerReceivableBreakdown;
node_modules/paypal/src/models/cap
```

**Tool call `Bash`**
```
mkdir -p src && cat > tsconfig.json <<'E'
{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","outDir":"dist","rootDir":"src","strict":true,"skipLibCheck":true,"esModuleInterop":true},"include":["src"]}
E
node -e "
const p=require('./package.json');p.name='mug-shop';p.type='module';p.main='dist/server.js';p.scripts={build:'tsc',start:'node dist/server.js'};delete p.description;require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"
echo "node dist/server.js" > START.txt
cat > src/db.ts <<'E'
import { DatabaseSync } from "node:sqlite";

export const db = new DatabaseSync(process.env.DATA_PATH ?? "./data.sqlite");
db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS orders(
  paypal_order_id TEXT PRIMARY KEY, sku TEXT NOT NULL, quantity INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL,
  on_hold INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS captures(
  id TEXT PRIMARY KEY, paypal_order_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS refunds(
  ref TEXT PRIMARY KEY, id TEXT, paypal_order_id TEXT NOT NULL, capture_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, status TEXT NOT NULL, source TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS refunds_id ON refunds(id) WHERE id IS NOT NULL;
CREATE TABLE IF NOT EXISTS shipments(
  id INTEGER PRIMARY KEY AUTOINCREMENT, paypal_order_id TEXT NOT NULL UNIQUE,
  at_event TEXT, capture_recorded INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events(event_id TEXT PRIMARY KEY);
`);

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

export const toCents = (v: string): number | null =>
  /^\d{1,9}\.\d{2}$/.test(v) ? Number(v.replace(".", "")) : null;
export const fromCents = (c: number): string => (c / 100).toFixed(2);
E
cat > src/paypal.ts <<'E'
import { PaypalClient } from "paypal";

export const BASE_URL = (process.env.PAYPAL_BASE_URL ?? "").replace(/\/+$/, "");
const clientId = process.env.PAYPAL_CLIENT_ID ?? "";
const clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? "";

export const client = new PaypalClient({
  serverOptions: { baseUrl: BASE_URL },
  oauth2: { clientId, clientSecret },
  retry: { maxRetries: 2, timeout: 20_000 },
});

// Only used for webhook signature verification (not covered by the SDK).
export async function verifyWebhook(headers: Record<string, string | string[] | undefined>, event: unknown): Promise<boolean> {
  const h = (n: string) => String(headers[n] ?? "");
  const tok = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!tok.ok) throw new Error(`token ${tok.status}`);
  const { access_token } = (await tok.json()) as { access_token: string };
  const res = await fetch(`${BASE_URL}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: process.env.PAYPAL_WEBHOOK_ID ?? "",
      webhook_event: event,
    }),
  });
  if (!res.ok) throw new Error(`verify ${res.status}`);
  return ((await res.json()) as { verification_status?: string }).verification_status === "SUCCESS";
}
E
cat > src/server.ts <<'E'
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { PaypalError, ApiError } from "paypal";
import 
```

Tool result:
```
src/db.ts(1,30): error TS2591: Cannot find name 'node:sqlite'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/db.ts(3,36): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/paypal.ts(3,26): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/paypal.ts(4,18): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/paypal.ts(5,22): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/paypal.ts(19,33): error TS2591: Cannot find name 'Buffer'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/paypal.ts(35,19): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/server.ts(1,18): error TS2591: Cannot find name 'node:http'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/server.ts(2,18): error TS2591: Cannot find name 'node:path'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/server.ts(3,16): error TS2591: Cannot find name 'node:fs'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/server.ts(10,21): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/server.ts(11,20): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/server.ts(13,17): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/server.ts(13,87): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/server.ts(21,17): error TS2591: Cannot find name 'Buffer'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/server.ts(25,30): error TS2591: Cannot find name 'Buffer'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/server.ts(29,16): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/server.ts(119,15): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
src/server.ts(131,41): error TS7006: Parameter 'req' implicitly has an 'any' type.
src/server.ts(131,46): error TS7006: Parameter 'res' implicitly has an 'any' type.
```

**Tool call `Bash`**
```
ls node_modules node_modules/@types; cat package.json
```

Tool result:
```
node_modules:
@types
@typescript
paypal
typescript
undici-types
zod

node_modules/@types:
node
{
  "name": "mug-shop",
  "version": "1.0.0",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "paypal": "github:context-plugins/paypal-typescript-sdk#main"
  },
  "devDependencies": {
    "@types/node": "^22.20.5",
    "typescript": "^7.0.2"
  },
  "type": "module"
}
```

**Tool call `Bash`**
```
sed -i 's/"strict":true/"strict":true,"types":["node"]/' tsconfig.json && npx tsc 2>&1 | head -30
```

Tool result:
```
(Bash completed with no output)
```

**Tool call `Bash`**
```
sed -i '/no-op \*\//d' src/orders.ts && npx tsc && mkdir -p /tmp/t && cat > /tmp/t/mock.mjs <<'E'
import http from "node:http";
let n=0;
http.createServer((q,s)=>{let b="";q.on("data",d=>b+=d);q.on("end",()=>{
 console.log("MOCK",q.method,q.url);
 const j=(o,c=200)=>{s.writeHead(c,{"content-type":"application/json"});s.end(JSON.stringify(o))};
 if(q.url=="/v1/oauth2/token")return j({access_token:"t",token_type:"Bearer",expires_in:3000});
 if(q.url=="/v2/checkout/orders")return j({id:"ORD1",status:"CREATED",links:[{href:"http://pp/approve",rel:"payer-action",method:"GET"}]},201);
 if(q.url.endsWith("/capture"))return j({id:"ORD1",status:"COMPLETED",purchase_units:[{payments:{captures:[{id:"CAP1",status:"COMPLETED",amount:{currency_code:"USD",value:"12.00"}}]}}]},201);
 if(q.url.endsWith("/refund"))return j({id:"REF"+(++n),status:"COMPLETED",amount:JSON.parse(b).amount},201);
 if(q.url.includes("verify-webhook"))return j({verification_status:"SUCCESS"});
 j({},404)})}).listen(9911);
E
node /tmp/t/mock.mjs > /tmp/t/mock.log 2>&1 &
PORT=3111 DATA_PATH=/tmp/t/d.db SNAPSHOT_DIR=/tmp/t/snap PAYPAL_ENV=mock PAYPAL_BASE_URL=http://localhost:9911 PAYPAL_CLIENT_ID=a PAYPAL_CLIENT_SECRET=b PAYPAL_WEBHOOK_ID=w node dist/server.js > /tmp/t/srv.log 2>&1 &
sleep 1.5
c(){ curl -s -X "$1" localhost:3111$2 -H 'content-type: application/json' ${3:+-d "$3"}; echo; }
c GET /health
c POST /checkout '{"sku":"MUG-001","quantity":1}'
c GET '/checkout/return?token=ORD1'
EV='{"id":"EV1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"CAP1","amount":{"value":"12.00"},"supplementary_data":{"related_ids":{"order_id":"ORD1"}}}}'
c POST /webhooks/paypal "$EV"; c POST /webhooks/paypal "$EV"
c POST /admin/refund '{"orderId":"ORD1","amount":"4.00","refundRef":"r1"}'
c POST /support/refund '{"orderId":"ORD1","amount":"4.00","refundRef":"r1"}'
c POST /support/refund '{"orderId":"ORD1","amount":"4.00","refundRef":"r2"}'
c POST /support/refund '{"orderId":"ORD1","amount":"4.01","refundRef":"r3"}'
c GET '/__echobench/state?paypal_order_id=ORD1'
c POST /__echobench/snapshot '{"to":"a.db"}'; c POST /__echobench/snapshot '{"to":"../x.db"}'
ls /tmp/t/snap; cat /tmp/t/srv.log
```

Tool result:
```
{"ok":true}
{"orderId":"ORD1","amount":"12.00","approveUrl":"http://pp/approve"}
{"orderId":"ORD1","status":"COMPLETED","onHold":false,"captures":[{"id":"CAP1","amount":"12.00","status":"COMPLETED"}]}
{"result":"processed"}
{"result":"duplicate"}
{"orderId":"ORD1","refundId":"REF1","amount":"4.00","refundRef":"r1","status":"COMPLETED"}
{"orderId":"ORD1","refundId":"REF1","amount":"4.00","refundRef":"r1","status":"COMPLETED","replayed":true}
{"orderId":"ORD1","refundId":"REF2","amount":"4.00","refundRef":"r2","status":"COMPLETED"}
{"error":"refund exceeds captured amount (refundable 4.00)"}
{"exists":true,"status":"COMPLETED","on_hold":false,"fulfilled_count":1,"shipments":[{"id":1,"at_event":"EV1","capture_recorded":true}],"captures":[{"id":"CAP1","amount":"12.00"}],"refunds":[{"id":"REF1","amount":"4.00"},{"id":"REF2","amount":"4.00"}],"processed_event_ids":["EV1"]}
{"ok":true,"path":"/tmp/t/snap/a.db"}
{"error":"path outside SNAPSHOT_DIR"}
a.db
s.sqlite
(node:1595036) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
listening on 3111
```

**Tool call `Bash`**
```
pkill -f /tmp/t/mock.mjs; pkill -f "dist/server.js"; grep -c "localhost:3111\|MOCK" /tmp/t/mock.log; head -3 /tmp/t/mock.log; cat /tmp/claude-1000/-home-lee-project/24a2843c-f5c4-4147-8649-980e86b209f4/scratchpad/ab-gen-sdk/sdk-plugin-off/START.txt
```

Tool result:
```
Exit code 144
```

**Model**

The local check passed; I was just shutting down the test processes.

The shop is built and works against a mock PayPal server in the local check. The build compiles with no errors. The start command is in `START.txt`: `node dist/server.js`. Run `npm run build` first if `dist/` is missing.

I ran these checks locally:
- **Checkout:** `/health`, `/checkout`, `/checkout/return`, the webhook, both refund routes and both `/__echobench` routes all answered correctly.
- **Webhook replay:** sending the same webhook twice shipped the order once.
- **Refunds:** repeating a `refundRef` returned the stored result instead of refunding again. A refund that would push the total past the captured amount was rejected.
- **Snapshot:** a snapshot to a path inside `SNAPSHOT_DIR` worked, and `../x.db` was refused.
- **PayPal base URL:** I didn't read the mock's request log, so I haven't confirmed that every PayPal call, including the OAuth token call, went to `PAYPAL_BASE_URL`. The SDK and my own `fetch` calls are both pointed at it in the code.

I haven't tested against a real sandbox, so the PayPal response shapes are checked against the SDK's types only.

How it behaves:
- **Orders:** orders, captures, refunds, shipments and processed event ids all live in the SQLite file at `DATA_PATH`. Checkout, capture and refunds go through the SDK. The server fixes the price at 12.00 USD per mug and only accepts `MUG-001`.
- **Return page:** capture uses a per-order request id, so reloading `/checkout/return` doesn't capture twice. It also handles an order that is already captured.
- **Webhook:**
  - It checks the signature with PayPal's verify endpoint, which the SDK doesn't cover. If verification can't be reached it returns 503.
  - Each event id is processed once. A capture event for an order we haven't stored yet returns 503, so PayPal retries it.
  - A pending, denied or reversed capture puts the order on hold and nothing ships. A completed capture ships once per order.
- **Refunds:** `/admin/refund` and `/support/refund` share one code path. They reserve the amount before calling PayPal, so two simultaneous refunds can't together exceed the captured total. Reusing a `refundRef` with different values returns 409.

The admin and support refund routes are open unless you set `ADMIN_TOKEN` or `SUPPORT_TOKEN`. When set, the route requires `Authorization: Bearer <token>`. I left them open by default because the harness sends no credentials. Set both before real use.

The code is in `src/` (`server.ts`, `orders.ts`, `refund.ts`, `paypal.ts`, `db.ts`). It uses Node's built-in `node:sqlite`, which prints an experimental warning at startup.

## Final answer

The local check passed; I was just shutting down the test processes.

The shop is built and works against a mock PayPal server in the local check. The build compiles with no errors. The start command is in `START.txt`: `node dist/server.js`. Run `npm run build` first if `dist/` is missing.

I ran these checks locally:
- **Checkout:** `/health`, `/checkout`, `/checkout/return`, the webhook, both refund routes and both `/__echobench` routes all answered correctly.
- **Webhook replay:** sending the same webhook twice shipped the order once.
- **Refunds:** repeating a `refundRef` returned the stored result instead of refunding again. A refund that would push the total past the captured amount was rejected.
- **Snapshot:** a snapshot to a path inside `SNAPSHOT_DIR` worked, and `../x.db` was refused.
- **PayPal base URL:** I didn't read the mock's request log, so I haven't confirmed that every PayPal call, including the OAuth token call, went to `PAYPAL_BASE_URL`. The SDK and my own `fetch` calls are both pointed at it in the code.

I haven't tested against a real sandbox, so the PayPal response shapes are checked against the SDK's types only.

How it behaves:
- **Orders:** orders, captures, refunds, shipments and processed event ids all live in the SQLite file at `DATA_PATH`. Checkout, capture and refunds go through the SDK. The server fixes the price at 12.00 USD per mug and only accepts `MUG-001`.
- **Return page:** capture uses a per-order request id, so reloading `/checkout/return` doesn't capture twice. It also handles an order that is already captured.
- **Webhook:**
  - It checks the signature with PayPal's verify endpoint, which the SDK doesn't cover. If verification can't be reached it returns 503.
  - Each event id is processed once. A capture event for an order we haven't stored yet returns 503, so PayPal retries it.
  - A pending, denied or reversed capture puts the order on hold and nothing ships. A completed capture ships once per order.
- **Refunds:** `/admin/refund` and `/support/refund` share one code path. They reserve the amount before calling PayPal, so two simultaneous refunds can't together exceed the captured total. Reusing a `refundRef` with different values returns 409.

The admin and support refund routes are open unless you set `ADMIN_TOKEN` or `SUPPORT_TOKEN`. When set, the route requires `Authorization: Bearer <token>`. I left them open by default because the harness sends no credentials. Set both before real use.

The code is in `src/` (`server.ts`, `orders.ts`, `refund.ts`, `paypal.ts`, `db.ts`). It uses Node's built-in `node:sqlite`, which prints an experimental warning at startup.
