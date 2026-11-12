# EchoBench: a replay lab for PayPal webhooks

Target prize: Best Use of APIMatic.

## Inspiration

PayPal retries a webhook delivery that is not answered 2xx "up to 25 times over 3 days", and its simulator sends mock events that "do not belong to any App and can be generated on demand purely for development and testing purposes" ([PayPal webhooks docs](https://developer.paypal.com/api/rest/webhooks/rest/)). So repeats are normal traffic, but the test tool sends sample payloads, not your shop's orders. The resend API ([Webhooks v1](https://developer.paypal.com/docs/api/webhooks/v1/)) re-delivers one real event but does not say whether your shop ended up right. Developers learn about the gap in production:

- [woocommerce-paypal-payments #4173](https://github.com/woocommerce/woocommerce-paypal-payments/issues/4173) (March 2026): "3–4 WooCommerce orders are created per transaction ... PayPal is only charged once. Stock is reduced multiple times." Two incidents, 6 and 4 duplicate orders.
- [opencollective #5644](https://github.com/opencollective/opencollective/issues/5644) (June 2022): a duplicate transaction from two capture webhooks created "with a `0.07s` delay".

## Who it is for

The first user is a developer who maintains a PayPal checkout plugin or a shop's PayPal webhook handler (for example the WooCommerce PayPal Payments maintainers above) and wants to know, before release, whether repeated, reordered or missing PayPal events leave the shop's books different from PayPal's.

## Why this is good for PayPal

Every duplicate shipment or missed refund in a merchant's books becomes a support ticket, a dispute or a merchant who blames the payment provider, even when PayPal behaved as documented. A replay lab that judges a handler against PayPal's own records turns "make your webhook handler idempotent" from advice into a test merchants and plugin authors can run. PayPal could ship it as a "replay my sandbox deliveries" mode next to the existing simulator and resend API, and the plan rows from the APIMatic Context Plugin give its SDK users the contract to test against.

## What the demo proves today, and what needs PayPal or partners

- Today, with no keys: the replay engine, state resets, the judge, the contract reader, the reply-cutting proxy, `tsc` on the patch and all re-runs are real, against a local PayPal stand-in. Real Claude Sonnet diagnoses for every failing scenario are replayed and re-verified by the server.
- Measured on the PayPal sandbox on 2026-11-12: real webhook deliveries to the deployed host, recorded and shaken (V1, below), V4, V5, V8, V11, and the Contract tab's two promises run on real sandbox payments through the reply-cutting proxy (V5b, below).
- Plugin off / on (R2) was generated on 2026-11-12 in two rounds and every handler was run (below). In round 2 the plugin-on model used the plugin's skills and its handler passed both lost-reply contract checks the plugin-off handler failed.
- EverShop (R1), unmodified 2.4.0, ran on this machine on the local stand-in: a purchase and two refunds made inside EverShop, every scenario restored from a PostgreSQL template (below).
- Not run yet: resend timing and signing (V2), old original bytes re-verified (V3), a postback with a forged cert_url (V6), simulator events (V7), a real dispute (V9), and the hosted Anthropic API path of the AI step (the recorded runs used a local Claude Code account). Needs PayPal: a sandbox "replay this recording" API would remove the need for a public receiver.

## What it does

EchoBench records PayPal webhook deliveries (raw bytes and PAYPAL-* headers), restores the target shop to a saved start point, replays them duplicated, at the same time, reordered, dropped, replayed late and forged, and judges the shop's books against PayPal's own records (never HTTP codes alone). When a scenario fails, an AI step reads the failure, the delivery and the handler, proposes a small patch on a copy, and EchoBench itself runs `tsc` and re-runs the whole suite on that copy before the patch can be applied. The model never moves money; refunds in contract scenarios run only after a person presses Approve and run on a confirmation card.

The APIMatic angle: the plugin's `paypal-plan.md` rows (DUPLICATE CLAIMS, UNKNOWN OUTCOMES) become tests. The Contract tab shows MugShop next to a contrast copy with the plan's refund claim switched off: two PayPal refunds (red) against one (green). The proxy cuts a refund reply after PayPal did it, and the result card shows the same `PayPal-Request-Id` on both sends, the SDK's different `Idempotency-Key`, and one refund.

## How we built it

Claude Code with the APIMatic Context Plugin 0.4.1 (nine TypeScript skills), APIMatic SDK `paypal` 2.29.0 for the judge and the sample shop, Anthropic `claude-sonnet-5-5` in a ten-tool loop, Express, React 19, Vite, `node:sqlite`. Evidence: `README.md`, `VERIFY.md`, `builtin/sandbox-evidence.json`.

## Sandbox evidence (PayPal sandbox, 2026-11-12)

Source: `VERIFY.md` "Sandbox results" and `builtin/sandbox-evidence.json` (shown in the app's Contract tab as "Measured on the PayPal sandbox").

- Real webhook deliveries (V1): the deployed host runs in sandbox mode with webhook 7DN129377S414341L. One purchase (order 3RE32161SC8633459, capture 4PF24653JV1088034, 12.00) approved by a sandbox buyer, then refunds 4.00 and 8.00: four deliveries recorded with their PAYPAL-* headers (CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED, two PAYMENT.CAPTURE.REFUNDED), `scripts/record-v1.js`. Shake all on that recording, PayPal's records read from the sandbox: planted MugShop red S0 to S5b and S7, green S6; reference fix green S0 to S6, amber S7; D1 `na` (no dispute). The same verdicts as on the stand-in. One thing the stand-in hid: the recorded S1 AI patch, re-run on the real recording, fixes S1 but leaves S3 and S4 red (order status CREATED), so EchoBench marks it not verified there.
- The SDK read equals the REST read of the same real order (V4).
- A repeated `PayPal-Request-Id` returned the same refund id (201 then 200) and left one refund on the order (V5, first half).
- A real contract payment was recorded (V8). The SDK smoke reads work and a made-up id gives a typed 404 (V11).
- The fixed shop and the contrast copy on real sandbox payments, five runs, each on its own captured 12.00 payment (V5b, `scripts/sandbox-contract.js`):
  - C-UNK, refund reply cut by the proxy. MugShop with the plan's contract: GREEN, it re-sent the same `PayPal-Request-Id`, PayPal answered 200 with the stored refund 8DH51725TN890892T, one refund (order 6NY987535G7169516). Contrast copy: RED, PayPal refunded 98G44114MT935673U and the shop reported the refund as failed and booked nothing.
  - C-DUP, the same 4.00 refund from the admin page and then from the support desk. MugShop: GREEN, one refund 3R834948FC525115M. Contrast copy: RED, two real refunds 0YV80846AW8891156 and 2TE88129DT787735B for one request (order 8M9957751S5797610).
  - Found on the way: when the two refund requests overlap at PayPal, the sandbox itself answers the second one 409 `PREVIOUS_REQUEST_IN_PROGRESS` (capture 15977184649549306). The local stand-in used to create two refunds there; it now copies the 409, and C-DUP sends the requests one after the other, which is where only the shop's claim helps.
- Plugin off / on (R2): one request text, given twice to Claude Code (`claude-sonnet-5-5`, local account, empty folder, no user settings), once without and once with `--plugin-dir` for the APIMatic Context Plugin 0.4.1. Round 1 asked for "a PayPal checkout": the plugin was loaded but its skills are written for "Paypal TypeScript SDK work", so the model never opened one and both handlers used `fetch`; it compares two handlers, not the plugin. Round 2 names the Paypal TypeScript SDK in the request, for both runs. Plugin on: the model loaded 5 plugin skills, wrote the plugin's `paypal-plan.md` (DUPLICATE CLAIMS, UNKNOWN OUTCOMES, CROSS-OPERATION INVARIANTS) and then the code. Plugin off: same SDK, read from its own README and map. All 14 scenarios on each, local stand-in: plugin on 10 green, plugin off 9. Plugin on alone passes C-UNK (refund reply cut: re-reads the order, finds the refund by `custom_id`, books one) and C-UNK-CAPTURE (capture reply cut: `getOrder`, books the one capture); these are its plan's UNKNOWN OUTCOMES rows. Plugin off alone passes S5b (books refunds made outside the shop). Both red on S5 and D1. One generation per arm: one sample, not a rate. Logs: `targets/ab/*/GENERATION_LOG.md`.
- EverShop (R1): unmodified EverShop 2.4.0 with a local PostgreSQL, settings only through its environment, PayPal pointed at EchoBench's proxy over the local stand-in. A guest order, EverShop's own return page and two admin refunds were made inside EverShop; EchoBench recorded the four deliveries and four start points (template databases) and the precheck found the order and capture in EverShop's tables. Every run restored the database first. Green S0 to S3 (EverShop ships by hand; the one capture is booked once), S5b and S6; amber S7; red S5 (a lost refund event is not picked up within 6 s: EverShop waits for PayPal's redelivery). Results pending maintainer review.
- AI step (not sandbox, listed for completeness): real runs through a local Claude Code account on 2026-11-12 for every red scenario of the planted MugShop (S0, S1, S2, S3, S4, S5, S5b, S7, D1), each verified by the server on the stand-in recording; tool order and results in VERIFY.md V10 and the README table. They ship in `builtin/` and replay without a key as "Recorded run: Claude Sonnet (local account), 2026-11-12"; tsc and the re-runs are done again by the server each time. Two runs tried to read the reference fix and were refused by the tool; three passed a scenario id where an order id belonged, so `paypal_truth` now defaults to the recorded order. The hosted API path was not run.

Not claimed: a real dispute (D1 runs on the stand-in's synthetic dispute), PayPal resends (V2), EverShop on the sandbox. The default local run uses a local PayPal stand-in and says so on screen; the hosted demo runs in sandbox mode.

## Challenges

- `captureOrder` is optional-body in the SDK map; without a body the sandbox answers 415. We pass `body: {}`. Worth an APIMatic-side note.
- The SDK's `Idempotency-Key` is not `PayPal-Request-Id`; only the latter makes PayPal recognise a repeat.
- The SDK's `Error` model requires `debug_id`.
- The stand-in answered a repeated `PayPal-Request-Id` with 201 and two overlapping refunds with two refunds; the sandbox answers 200 and 409 `PREVIOUS_REQUEST_IN_PROGRESS`. It also dropped a refund's `custom_id`, which the sandbox returns in GET order (refund 21J38299VE4849725). All three are fixed in the stand-in and pinned by tests.
- The plan the plugin really generated shortened the table column names; the contract reader now also finds the tables by their section headings.

## What's next

EverShop on the PayPal sandbox (R1 with real deliveries), more plugin off / on generations so the comparison becomes a rate, a resend mode after measuring resend timing and signing (V2), a CI check.

## Testing instructions

**Try it:** https://echobench.35-216-2-121.sslip.io (hosted demo in PayPal sandbox mode, opens on the real sandbox recording; recorded Claude Sonnet runs; MugShop reset to the planted bugs on every start; no login).

See README.md, "Testing instructions" (about 3 minutes, no keys). `npm install`, `npm run build`, `npm start`, open http://127.0.0.1:3101 (or `npm run demo:video` for a clean start), then:

1. Open the app (target MugShop (planted bugs)).
2. Shake all: S1 and S5b red, S6 green.
3. Click the S1 row, Explain and fix (replays the recorded Claude Sonnet run; every red row has its own).
4. Apply to the MugShop working copy: EchoBench re-runs the scenarios on your own patched copy and the badge turns green (other visitors keep the planted bugs). Reset to planted bugs restores the start.
5. Contract tab: sandbox evidence, contrast table, Run C-UNK.
6. Recording tab. 7. Inbound events table and A/B tabs.
