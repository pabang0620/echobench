# R2: the plugin off / plugin on measurement

Plan item 11. The same request is given to Claude Code twice, once without the APIMatic Context Plugin and once with it. Nobody edits the results. EchoBench runs both handlers. **Nothing here has been generated yet**, and this build did not install the plugin or run Claude Code.

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
