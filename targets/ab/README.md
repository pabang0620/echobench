# R2: the plugin off / plugin on measurement

Plan item 11. The same request is given to Claude Code twice, once without the APIMatic Context Plugin and once with it. Nobody edits the results. EchoBench runs both handlers.

## Round 2 (2026-11-12): the request names the SDK, the plugin is used

Why round 1 (below) measured nothing: the plugin was loaded in the plugin-on session (its 29 skills and the Skill tool were listed in the session's init event), but the skills are written for "Paypal TypeScript SDK work" (`typescript-integrate-paypal`: "Applies when asked to integrate Paypal in TypeScript/Node, create order, capture order..."). Round 1 asked for "a small Node.js PayPal checkout" and never named the SDK, so the model wrote plain `fetch` code and had no reason to open a skill. Print mode was not the cause: skills are offered in `claude -p` the same way.

- Request: `REQUEST_SDK.md`. It starts "Integrate PayPal in a new TypeScript/Node project using the Paypal TypeScript SDK (the package is `paypal`, ...install it with `npm install git+https://github.com/context-plugins/paypal-typescript-sdk#main`)" and keeps round 1's routes, JSON shapes and adapter contract. Both runs get exactly this text, so the plugin-off model also knows the SDK exists and where to get it.
- Command: `bash scripts/ab-generate.sh <off|on> targets/ab/REQUEST_SDK.md <empty folder>`. Same flags as round 1 (`claude -p --model claude-sonnet-5-5 --setting-sources "" --strict-mcp-config --no-session-persistence --permission-mode bypassPermissions`), local Claude Code login with `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` removed, empty folder outside any project. Only `on` adds `--plugin-dir ~/.claude/plugins/cache/context-plugins/paypal/0.4.1`. Both started 06:33:50Z.
- Plugin on (`sdk-plugin-on/`, 31 turns, 251 s): the model loaded `paypal:typescript-integrate-paypal`, `-getting-started`, `-error-handling`, `-client-initialization`, `-testing`, wrote `paypal-plan.md` with the plugin's tables, then the code (SDK `orders.createOrder`, `captureOrder`, `getOrder`, `payments.refundCapturedPayment`; webhook verification with `fetch` because the SDK has no webhooks resource).
- Plugin off (`sdk-plugin-off/`, 14 turns, 151 s): no skills; it installed the same SDK and read its `sdk-map.md` and `map/operations/` itself. Also SDK calls for orders and refunds.
- Logs: `GENERATION_LOG.md` (made from the raw stream by `scripts/ab-log.js`) and `generation.stream.jsonl` in each folder. Code not edited.
- Results (`node scripts/run-ab.js`, all 14 scenarios on each handler's own recording of the same purchase, local PayPal stand-in):

| Scenario | SDK request, plugin off | SDK request, plugin on |
|---|---|---|
| S0 to S4, S6, C-DUP, C-DUP-CAPTURE | green | green |
| S7 | amber | amber |
| S5, D1 | red | red |
| S5b (two refunds made outside the shop) | green | **red**: the webhook is noted, the refunds are not booked |
| C-UNK (refund reply cut) | **red**: answers 502, books nothing | green: re-reads the order, finds the refund by `custom_id`, books one |
| C-UNK-CAPTURE (capture reply cut) | **red**: reports failure, books nothing | green: `getOrder`, books the one capture |
| Green count | 9 | 10 |

- Reading: the two rows the plugin-on handler wins are exactly its plan's UNKNOWN OUTCOMES rows, the part the plugin's workflow makes the model write down before coding. The row it loses (S5b) is webhook bookkeeping, which the plugin does not cover. One generation per arm: this is one measured sample, not a rate.
- Two fixes this round found, both measured: the stand-in dropped a refund's `custom_id`, which made the plugin-on handler's correct re-read fail; the sandbox returns it (refund 21J38299VE4849725: in the refund reply, in GET order and in GET refund), and the stand-in now does too (`test/mock-paypal.test.js`). And the real plugin plan shortened the table column names ("Claim store", "Caught where", "Code"); `server/contract/parser.js` now also finds the tables by their section headings (`test/contract-parser.test.js`). In the Contract tab, choose the plugin-on target: the plan names `src/orders.ts` and `src/refunds.ts`, which the model never wrote (it wrote `src/shop.ts`).

## Round 1 (2026-11-12): what was run

- Request: `REQUEST.md` in this folder, the text below plus the exact routes and JSON shapes EchoBench drives (the checkout, return, refund and health routes) and the adapter contract, identical in both runs.
- `claude -p "$(cat REQUEST.md)" --model claude-sonnet-5-5 --setting-sources "" --strict-mcp-config --no-session-persistence --permission-mode bypassPermissions --output-format stream-json --verbose`, through the local Claude Code login with `ANTHROPIC_API_KEY` removed from the environment, each in an empty folder outside any project (no CLAUDE.md, no user settings or skills, no MCP servers). The plugin-on run adds `--plugin-dir ~/.claude/plugins/cache/context-plugins/paypal/0.4.1` (the installed plugin). That flag is the only difference.
- `plugin-off/` and `plugin-on/` hold the generated code as it was left (only `node_modules` was reinstalled with `npm ci`), `GENERATION_LOG.md` (readable transcript) and `generation.stream.jsonl` (raw stream), plus the `echobench.target.json` written afterwards.
- What happened: the plugin-on session listed the plugin's 29 skills, and the model did not invoke any of them. Both handlers call PayPal REST with `fetch`, not the APIMatic SDK. No plugin plan (`paypal-plan.md`) was produced, so the header comparison in step 5 could not be done.
- To run the two handlers again on a fresh clone: `npm ci` inside `targets/ab/plugin-off` (it uses better-sqlite3; plugin-on needs no packages), then `node scripts/run-ab.js` (add `--record` to record the purchase again).
- `node scripts/run-ab.js --record` records the built-in purchase against each handler on the local PayPal stand-in (`builtin/ab-plugin-*-demo`, made by driving that handler) and runs S0 to D1 on it. Results in `builtin/ab-runs.json`, shown in the A/B tab. Both: green S0, S1, S2, S3, S4, S6; amber S7; red S5, S5b, D1.
- Reading: the same model with and without the plugin produced handlers that fail the same scenarios. Because the plugin's skills were not opened, this does not measure the plugin (see round 2 for why and for the run that does). With the contract scenarios added later, both round 1 handlers are also red on C-UNK and C-UNK-CAPTURE.

## The one request (copy it exactly, same model, same text both times)

```
Build a small Node.js (TypeScript) PayPal checkout for a one-product shop.
- Orders v2: create an order, redirect the buyer to PayPal, capture on return.
- A webhook endpoint that ships the order when PayPal says the payment is complete.
- An admin endpoint and a support endpoint that can both refund part of a payment.
- Store all data in one SQLite file whose path is the DATA_PATH environment variable.
- Read PORT, PAYPAL_BASE_URL, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_WEBHOOK_ID from the environment.
- Add GET /__echobench/state?paypal_order_id=... and POST /__echobench/snapshot as described below.
```

Add the adapter text from `targets/mugshop/README.md` ("Adapter contract") to the request, word for word, in **both** runs. The `DATA_PATH` sentence is in both on purpose so the comparison stays fair. If a generated handler does not honour it, mark that side "reset not possible" and publish no result for it.

## Steps

1. Folder `targets/ab/plugin-off/`: run Claude Code with the request, plugin not installed. Keep the full transcript in `targets/ab/plugin-off/GENERATION_LOG.md`. Do not edit the generated code.
2. Folder `targets/ab/plugin-on/`: install the plugin yourself (`npx context-plugins install paypal`), run the same request, keep the transcript and the generated `paypal-plan.md` in the folder. Do not edit the code.
3. In each folder add `echobench.target.json`:

```json
{
  "label": "Agent-built handler (plugin off)",
  "group": "plugin-off",
  "command": "node",
  "args": ["--no-warnings", "server.js"],
  "paths": {
    "webhook": "/webhooks/paypal",
    "returnPath": "/checkout/return",
    "refund": { "admin": "/admin/refund", "support": "/support/refund" }
  }
}
```

   Change `args` and `paths` to what was generated. If something does not exist, say so with `"capabilities": { "returnPath": false }` (also `refunds`, `disputes`); scenarios that need it then show `N/A` instead of guessing.
4. Run both: `node scripts/run-ab.js mugshop-demo`. Results appear in the "A/B and EverShop" tab, side by side.
5. Read the generated `paypal-plan.md` and compare its column names with `server/contract/headers.js`. Fix that file if they differ, and remove the "to confirm" wording from the plan statement in the README.

## Reporting rules

- Publish the table whichever way it falls. If both are green, say so: the plugin's promises held.
- Same model, same request, generation logs kept. Do not describe the plugin as the cause of a bug.
