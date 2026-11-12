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

- Today, with no keys: the replay engine, state resets, the judge, the contract reader, the reply-cutting proxy, `tsc` on the patch and all re-runs are real, against a local PayPal stand-in. Two real Claude Sonnet diagnoses (S1 and S5b) are replayed and re-verified by the server.
- Measured on the PayPal sandbox on 2026-11-12: V4, V5, V8, V11, and the Contract tab's two promises run on real sandbox payments through the reply-cutting proxy (V5b, below).
- Plugin off / on (R2) was generated on 2026-11-12 and both handlers were run (below).
- Needs a public URL or a person: recording real sandbox deliveries (V1), resend timing and signing (V2). Needs PayPal: a sandbox "replay this recording" API would remove the need for a tunnel.

## What it does

EchoBench records PayPal webhook deliveries (raw bytes and PAYPAL-* headers), restores the target shop to a saved start point, replays them duplicated, at the same time, reordered, dropped, replayed late and forged, and judges the shop's books against PayPal's own records (never HTTP codes alone). When a scenario fails, an AI step reads the failure, the delivery and the handler, proposes a small patch on a copy, and EchoBench itself runs `tsc` and re-runs the whole suite on that copy before the patch can be applied. The model never moves money; refunds in contract scenarios run only after a person presses Run on a confirmation card.

The APIMatic angle: the plugin's `paypal-plan.md` rows (DUPLICATE CLAIMS, UNKNOWN OUTCOMES) become tests. The Contract tab shows MugShop next to a contrast copy with the plan's refund claim switched off: two PayPal refunds (red) against one (green). The proxy cuts a refund reply after PayPal did it, and the result card shows the same `PayPal-Request-Id` on both sends, the SDK's different `Idempotency-Key`, and one refund.

## How we built it

Claude Code with the APIMatic Context Plugin 0.4.1 (nine TypeScript skills), APIMatic SDK `paypal` 2.29.0 for the judge and the sample shop, Anthropic `claude-sonnet-5-5` in a ten-tool loop, Express, React 19, Vite, `node:sqlite`. Evidence: `README.md`, `VERIFY.md`, `builtin/sandbox-evidence.json`.

## Sandbox evidence (PayPal sandbox, 2026-11-12)

Source: `VERIFY.md` "Sandbox results" and `builtin/sandbox-evidence.json` (shown in the app's Contract tab as "Measured on the PayPal sandbox").

- The SDK read equals the REST read of the same real order (V4).
- A repeated `PayPal-Request-Id` returned the same refund id (201 then 200) and left one refund on the order (V5, first half).
- A real contract payment was recorded (V8). The SDK smoke reads work and a made-up id gives a typed 404 (V11).
- The fixed shop and the contrast copy on real sandbox payments, five runs, each on its own captured 12.00 payment (V5b, `scripts/sandbox-contract.js`):
  - C-UNK, refund reply cut by the proxy. MugShop with the plan's contract: GREEN, it re-sent the same `PayPal-Request-Id`, PayPal answered 200 with the stored refund 8DH51725TN890892T, one refund (order 6NY987535G7169516). Contrast copy: RED, PayPal refunded 98G44114MT935673U and the shop reported the refund as failed and booked nothing.
  - C-DUP, the same 4.00 refund from the admin page and then from the support desk. MugShop: GREEN, one refund 3R834948FC525115M. Contrast copy: RED, two real refunds 0YV80846AW8891156 and 2TE88129DT787735B for one request (order 8M9957751S5797610).
  - Found on the way: when the two refund requests overlap at PayPal, the sandbox itself answers the second one 409 `PREVIOUS_REQUEST_IN_PROGRESS` (capture 15977184649549306). The local stand-in used to create two refunds there; it now copies the 409, and C-DUP sends the requests one after the other, which is where only the shop's claim helps.
- Plugin off / on (R2): one request text, given twice to Claude Code (`claude-sonnet-5-5`, local account, empty folder, no user settings), once without and once with `--plugin-dir` for the APIMatic Context Plugin 0.4.1. The plugin's 29 skills were listed in the second session, but the model did not open any of them; both handlers call PayPal REST with `fetch`. Same result on both: green S0 to S4 and S6, amber S7, red S5 (a dropped refund event is never reconciled), S5b (refund events are ignored, so refunds made outside the shop's own endpoints never reach the books) and D1 (the request did not mention disputes; the order ships with a dispute open). Logs: `targets/ab/*/GENERATION_LOG.md`. This compares two handlers; it does not show a plugin effect.
- AI step (not sandbox, listed for completeness): two real runs through a local Claude Code account on 2026-11-12, S1 (23 tool calls) and S5b (25 tool calls, 39 s of model time), tool order and results in VERIFY.md V10. They ship as `builtin/live-diagnosis.json` and `builtin/recorded-runs/S5b.json` and replay without a key as "Recorded run: Claude Sonnet (local account), 2026-11-12"; tsc and the re-runs are done again by the server each time. The hosted API path was not run.

Not claimed: recording real webhook deliveries (needs a public URL), so the webhook scenarios S0 to D1 run on the local stand-in; EverShop. The default demo uses a local PayPal stand-in and says so on screen.

## Challenges

- `captureOrder` is optional-body in the SDK map; without a body the sandbox answers 415. We pass `body: {}`. Worth an APIMatic-side note.
- The SDK's `Idempotency-Key` is not `PayPal-Request-Id`; only the latter makes PayPal recognise a repeat.
- The SDK's `Error` model requires `debug_id`.
- The stand-in answered a repeated `PayPal-Request-Id` with 201 and two overlapping refunds with two refunds; the sandbox answers 200 and 409 `PREVIOUS_REQUEST_IN_PROGRESS`. Both are fixed in the stand-in and pinned by tests.

## What's next

EverShop as an unmodified target (R1), a plugin-on run in which the model actually uses the skills, a resend mode after measuring resend timing and signing (V2), a CI check.

## Testing instructions

See README.md, "Testing instructions" (about 3 minutes, no keys). `npm install`, `npm run build`, `npm start`, open http://127.0.0.1:3101 (or `npm run demo:video` for a clean start), then:

1. Open the app (target MugShop (planted bugs)).
2. Shake all: S1 and S5b red, S6 green.
3. Click the S1 row, Explain and fix (replays the recorded Claude Sonnet run; the S5b row has its own).
4. Apply to the MugShop working copy, then Shake all again: green. Reset to planted bugs restores the start.
5. Contract tab: sandbox evidence, contrast table, Run C-UNK.
6. Recording tab. 7. Inbound events table and A/B tabs.
