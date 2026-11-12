# EchoBench demo video script (2:45)

Start the app in the recording state with one command (after `npm install` and `npm run build`):

```
npm run demo:video      # http://127.0.0.1:3101
```

It uses the local PayPal stand-in, no model key (the two recorded Claude Sonnet runs replay), MugShop with its planted bugs, and an empty data folder (`data/video`), so nothing from an earlier session shows. Browser at 1366x900. Step numbers are the README "Testing instructions" steps.

Only scenes the app shows today are listed. Not shown, because VERIFY.md says they were not run: real sandbox webhook recordings (V1), PayPal resends (V2), C-UNK through the proxy on the sandbox (V5 second half), plugin off / on handlers (R2), EverShop (R1), the hosted Anthropic API path.

| Time | Step | On screen | Caption / narration (English) | Criterion |
|---|---|---|---|---|
| 0:00-0:12 | Intro | Browser: [woocommerce-paypal-payments #4173](https://github.com/woocommerce/woocommerce-paypal-payments/issues/4173), zoom on "Incident 2: March 12, 2026 - 4 duplicate orders created" and "PayPal is only charged once" | "One PayPal payment. Four shop orders." | Potential Impact |
| 0:12-0:22 | Intro | [PayPal webhooks docs](https://developer.paypal.com/api/rest/webhooks/rest/), zoom on "mock events ... purely for development and testing purposes" and "up to 25 times over 3 days" | "PayPal retries deliveries. The simulator only sends mock events, not your orders." | Potential Impact |
| 0:22-0:32 | Step 1 | EchoBench first screen: badges "PayPal: local stand-in", "PayPal client: APIMatic SDK", "AI: recorded run, Claude Sonnet 2026-11-12". Hero text says the recording came from the local stand-in | "A recorded purchase, two refunds and a dispute. Raw bytes and headers. Local PayPal stand-in." | Technological Implementation |
| 0:32-0:52 | Step 2 | Press **Shake all**: progress "n/11", then the two-line timeline with "shipped x2 (!)" and "books 8.00 of 12.00 (!)", rows S1 RED, S5b RED, S6 GREEN | "Same event twice: the mug shipped twice. Judged against PayPal's records, not status codes." | Technological Implementation, Innovation |
| 0:52-1:25 | Step 3 | Click the S1 row, press **Explain and fix**. Badge "Recorded run: Claude Sonnet (local account), 2026-11-12". Scroll the model's own explanation, open "Tool calls the model made, in order (23)", then badges "tsc passed", "copy re-run GREEN", "10/10 scenarios pass on the copy", and the hunk diff | "A real Claude Sonnet run, recorded on 2026-11-12. It picked 23 tool calls. EchoBench type-checks the patch and re-runs every scenario itself." | Technological Implementation (AI) |
| 1:25-1:40 | Step 4 | **Apply to the MugShop working copy**, then **Shake all**: green; target is now "MugShop (your patched copy)" | "Applied only after a person presses Apply. Green." | Technological Implementation |
| 1:40-1:55 | Step 5 | `paypal-plan.md` DUPLICATE CLAIMS table in an editor, then the Contract tab rows with the same names | "The APIMatic plugin's plan promises become tests." | Best Use of APIMatic |
| 1:55-2:10 | Step 5 | Contract tab "What the plan's promise changes": MugShop C-DUP GREEN "one PayPal refund" next to "MugShop (contract removed, contrast)" C-DUP RED "PayPal refunds: 2" | "Without the plan's refund claim: two refunds. With it: one." | Best Use of APIMatic |
| 2:10-2:25 | Step 5 | **Run C-UNK**: confirmation card (amount 4.00, capture id, environment "local stand-in", run by you, 5 minutes), press Run. Result card "What the proxy saw": same `PayPal-Request-Id` twice, two different `Idempotency-Key` values, "PayPal refunds on this order: 1" | "Reply cut. Same PayPal-Request-Id, one refund. The SDK's Idempotency-Key is not that header." | Best Use of APIMatic, Technological Implementation |
| 2:25-2:38 | Step 5 | Contract tab top panel "Measured on the PayPal sandbox (2026-11-12), measured, not re-run now": V4 PASS, V4 FOUND 415, V5 PASS, V8 PASS, V11 PASS | "Measured on the PayPal sandbox: SDK read equals REST read, same request id gives the same refund, and captureOrder without a body gets 415." | Technological Implementation, Best Use of APIMatic |
| 2:38-2:45 | Outro | Footer "Sandbox and local stand-in only. The model never moves money" and the repository URL | "The model never moves money. EchoBench, MIT licensed." | Presentation |

Before recording: run `npm run demo:video` fresh (it also resets MugShop). Record once, after all fixes.
