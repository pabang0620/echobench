# EchoBench: a replay lab for PayPal webhooks

Target prize: Best Use of APIMatic.

## Inspiration

PayPal's webhook simulator cannot be resent and its events "do not correspond to any real event or transaction". The resend API re-delivers one real event but does not say whether your shop ended up right. Developers learn about the gap from a duplicate order in production, for example woocommerce-paypal-payments #4173.

## What it does

EchoBench records PayPal webhook deliveries (raw bytes and PAYPAL-* headers), restores the target shop to a saved start point, replays them duplicated, at the same time, reordered, dropped, replayed late and forged, and judges the shop's books against PayPal's own records (never HTTP codes alone). When a scenario fails, an AI step reads the failure, the delivery and the handler, proposes a small patch on a copy, and EchoBench itself runs `tsc` and re-runs the whole suite on that copy before the patch can be applied. The model never moves money; refunds in contract scenarios run only after a person presses Run on a confirmation card.

The APIMatic angle: the plugin's `paypal-plan.md` rows (DUPLICATE CLAIMS, UNKNOWN OUTCOMES) become tests. The Contract tab shows MugShop next to a contrast copy with the plan's refund claim switched off: two PayPal refunds (red) against one (green). The proxy cuts a refund reply after PayPal did it, and the result card shows the same `PayPal-Request-Id` on both sends, the SDK's different `Idempotency-Key`, and one refund.

## How we built it

Claude Code with the APIMatic Context Plugin 0.4.1 (nine TypeScript skills), APIMatic SDK `paypal` 2.29.0 for the judge and the sample shop, Anthropic `claude-sonnet-5-5` in a ten-tool loop, Express, React 19, Vite, `node:sqlite`. Evidence: `README.md`, `VERIFY.md`, `builtin/sandbox-evidence.json`.

## Sandbox evidence (PayPal sandbox, 2026-11-12)

- The SDK read equals the REST read of the same real order (V4).
- A repeated `PayPal-Request-Id` returned the same refund id (201 then 200) and left one refund on the order (V5, first half).
- A real contract payment was recorded (V8). The SDK smoke reads work and a made-up id gives a typed 404 (V11).
- AI step: one real run through a local Claude Code account (Sonnet, tool order and result in VERIFY.md V10), saved and replayable as a "Recorded live run". The hosted API path was not run.

Not claimed: recording real webhook deliveries (needs a public URL), C-UNK through the proxy on the sandbox, plugin off / on comparison, EverShop. The default demo uses a local PayPal stand-in and says so on screen.

## Challenges

- `captureOrder` is optional-body in the SDK map; without a body the sandbox answers 415. We pass `body: {}`. Worth an APIMatic-side note.
- The SDK's `Idempotency-Key` is not `PayPal-Request-Id`; only the latter makes PayPal recognise a repeat.
- The SDK's `Error` model requires `debug_id`.

## What's next

EverShop as an unmodified target (R1), plugin off / on handlers (R2), a resend mode after measuring resend timing and signing (V2), a CI check.

## Testing instructions

See README.md, "Testing instructions" (about 3 minutes, no keys): `npm install`, `npm run build`, `npm start`, open http://127.0.0.1:3101, Shake all, open the first red row, Explain and fix, Apply, Shake all again, then the Contract tab. "Reset to planted bugs" restores the start.
