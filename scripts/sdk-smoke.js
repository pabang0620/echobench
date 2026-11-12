import { writeFileSync } from 'node:fs'
import { assertSandboxUrl, loadConfig } from '../server/config.js'
import { createTruth } from '../server/truth.js'

// SDK smoke (VERIFY.md item V11): read-only calls through the APIMatic SDK against the real sandbox credential.
// It sends only GET requests (plus the OAuth token request the SDK makes itself). It never runs from npm test.
//   ECHOBENCH_ALLOW_SANDBOX=1 PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... node scripts/sdk-smoke.js <order-id> [capture-id]
const [orderId, captureId] = process.argv.slice(2)
const config = loadConfig()
if (process.env.ECHOBENCH_ALLOW_SANDBOX !== '1' || config.mode !== 'sandbox') {
  process.stderr.write('Refusing to run: set ECHOBENCH_ALLOW_SANDBOX=1 and real PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (sandbox) first.\n')
  process.exit(2)
}
if (!orderId) {
  process.stderr.write('Usage: node scripts/sdk-smoke.js <order-id> [capture-id]\n')
  process.exit(1)
}
assertSandboxUrl(config.paypalBaseUrl)

const sdk = createTruth({ baseUrl: config.paypalBaseUrl, clientId: config.clientId, clientSecret: config.clientSecret, impl: 'sdk' })
const results = []
async function attempt(operation, work) {
  try {
    const value = await work()
    results.push({ operation, ok: true, value })
  } catch (err) {
    // A 403 here means the credential or plan may not call this operation; a 404 means the id is not on this account.
    results.push({ operation, ok: false, error: String(err.message) })
  }
}
await attempt('client.orders.getOrder', () => sdk.order(orderId))
if (captureId) await attempt('client.payments.getCapturedPayment', () => sdk.capture(captureId))
// A read of an id that does not exist must come back as PayPal's typed 404, not as a body the SDK cannot decode.
await attempt('client.orders.getOrder (unknown id, expects 404)', async () => {
  try {
    await sdk.order('0AA00000AA000000A')
  } catch (err) {
    return /failed: 404/.test(String(err.message)) ? '404 decoded as PayPal error' : Promise.reject(err)
  }
  throw new Error('An unknown order id was found')
})

const line = { step: 'SDK-smoke', at: new Date().toISOString(), results }
writeFileSync('VERIFY_RESULTS.json', `${JSON.stringify(line)}\n`, { flag: 'a' })
process.stdout.write(`${JSON.stringify(line, null, 2)}\n`)
process.exitCode = results.every((r) => r.ok) ? 0 : 1
