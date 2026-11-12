# R2: the plugin off / plugin on measurement

Plan item 11. The same request is given to Claude Code twice, once without the APIMatic Context Plugin and once with it. Nobody edits the results. EchoBench runs both handlers.

## What was run (2026-11-12)

- Request: `REQUEST.md` in this folder, the text below plus the exact routes and JSON shapes EchoBench drives (the checkout, return, refund and health routes) and the adapter contract, identical in both runs.
- `claude -p "$(cat REQUEST.md)" --model claude-sonnet-5-5 --setting-sources "" --strict-mcp-config --no-session-persistence --permission-mode bypassPermissions --output-format stream-json --verbose`, through the local Claude Code login with `ANTHROPIC_API_KEY` removed from the environment, each in an empty folder outside any project (no CLAUDE.md, no user settings or skills, no MCP servers). The plugin-on run adds `--plugin-dir ~/.claude/plugins/cache/context-plugins/paypal/0.4.1` (the installed plugin). That flag is the only difference.
- `plugin-off/` and `plugin-on/` hold the generated code as it was left (only `node_modules` was reinstalled with `npm ci`), `GENERATION_LOG.md` (readable transcript) and `generation.stream.jsonl` (raw stream), plus the `echobench.target.json` written afterwards.
- What happened: the plugin-on session listed the plugin's 29 skills, and the model did not invoke any of them. Both handlers call PayPal REST with `fetch`, not the APIMatic SDK. No plugin plan (`paypal-plan.md`) was produced, so the header comparison in step 5 could not be done.
- To run the two handlers again on a fresh clone: `npm ci` inside `targets/ab/plugin-off` (it uses better-sqlite3; plugin-on needs no packages), then `node scripts/run-ab.js` (add `--record` to record the purchase again).
- `node scripts/run-ab.js --record` records the built-in purchase against each handler on the local PayPal stand-in (`builtin/ab-plugin-*-demo`, made by driving that handler) and runs S0 to D1 on it. Results in `builtin/ab-runs.json`, shown in the A/B tab. Both: green S0, S1, S2, S3, S4, S6; amber S7; red S5, S5b, D1.
- Reading: the same model with and without the plugin produced handlers that fail the same three scenarios. Because the plugin's skills were not opened, this does not measure the plugin; a run in which the agent is told to use them would be a different request and is not published as A/B.

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
