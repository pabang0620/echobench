import { writeFileSync } from 'node:fs'
import { assertSandboxUrl, loadConfig } from '../server/config.js'
import { createWebhooksRest } from '../server/webhooksRest.js'

// Sandbox measurements V1..V6 from the plan. It does nothing by default and it never runs from npm test.
//   ECHOBENCH_ALLOW_SANDBOX=1 PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... node scripts/verify-sandbox.js V2 <recording-id>
// Steps V1, V2, V3, V6 only read or re-deliver; V5 creates one sandbox refund (4.00) from the contract payment.
// Each step appends its measured result to VERIFY_RESULTS.json (git-ignored) and prints it. Read VERIFY.md first.
const step = process.argv[2]
const config = loadConfig()
if (process.env.ECHOBENCH_ALLOW_SANDBOX !== '1' || config.mode !== 'sandbox') {
  process.stderr.write('Refusing to run: set ECHOBENCH_ALLOW_SANDBOX=1 and real PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (sandbox) first.\n')
  process.exit(2)
}
assertSandboxUrl(config.paypalBaseUrl)

const rest = createWebhooksRest({ baseUrl: config.paypalBaseUrl, clientId: config.clientId, clientSecret: config.clientSecret })
const { createLab } = await import('../server/lab.js')
const lab = await createLab()
const recording = lab.store.getRecording(process.argv[3] || '')
const record = (result) => {
  const line = { step, at: new Date().toISOString(), ...result }
  writeFileSync('VERIFY_RESULTS.json', `${JSON.stringify(line)}\n`, { flag: 'a' })
  process.stdout.write(`${JSON.stringify(line, null, 2)}\n`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const bodyText = (d) => Buffer.from(d.bodyBase64, 'base64').toString('utf8')

try {
  if (step === 'V1') {
    // Register EchoBench's public receiver URL as a webhook, then make one sandbox purchase by hand.
    const hook = await rest.register(`${config.publicUrl}/hooks/paypal`, ['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.REFUNDED', 'CUSTOMER.DISPUTE.CREATED'])
    record({ question: 'Does a real sandbox transaction reach the receiver?', webhookStatus: hook.status, webhookId: hook.body?.id, next: 'Put this id in PAYPAL_WEBHOOK_ID, start a recording in the app, buy and refund in the sandbox, then check the recording lists the deliveries.' })
  } else if (step === 'V2' && recording) {
    // Resend a recorded event and compare the new delivery headers with the original.
    const original = recording.deliveries[1]
    const sent = await rest.resend(original.eventId, [config.webhookId])
    await sleep(15000)
    record({ question: 'How fast is a resend, and is it signed again?', resendStatus: sent.status, originalTransmission: { id: original.headers['paypal-transmission-id'], time: original.headers['paypal-transmission-time'] }, next: 'Open the recording or the receiver log: compare PAYPAL-TRANSMISSION-ID / -TIME / -SIG of the new delivery with the original.' })
  } else if (step === 'V3' && recording) {
    // Postback-verify the ORIGINAL bytes of an old delivery.
    const old = recording.deliveries[1]
    const result = await rest.verifyPostback({ headers: old.headers, webhookId: config.webhookId, rawBody: bodyText(old) })
    record({ question: 'Does PayPal still verify old original bytes?', deliveryAgeMs: Date.now() - Date.parse(old.receivedAt), verificationStatus: result.body?.verification_status })
  } else if (step === 'V4') {
    // The APIMatic SDK read equals the raw REST read of the same order.
    const { createTruth } = await import('../server/truth.js')
    const truth = createTruth({ baseUrl: config.paypalBaseUrl, clientId: config.clientId, clientSecret: config.clientSecret, impl: 'sdk' })
    const rest2 = createTruth({ baseUrl: config.paypalBaseUrl, clientId: config.clientId, clientSecret: config.clientSecret, impl: 'rest' })
    const orderId = process.argv[3]
    const [viaSdk, viaRest] = await Promise.all([truth.order(orderId), rest2.order(orderId)])
    record({ question: 'Does the SDK read equal the raw REST read?', same: JSON.stringify({ ...viaSdk, source: 0 }) === JSON.stringify({ ...viaRest, source: 0 }), viaSdk, viaRest })
  } else if (step === 'V5' && recording?.contract) {
    // Same PayPal-Request-Id twice against the real sandbox, once with the reply cut by the proxy.
    const id = `echobench-v5-${Date.now()}`
    const url = `${config.paypalBaseUrl}/v2/payments/captures/${recording.contract.captureId}/refund`
    const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
    const tokenRes = await fetch(`${config.paypalBaseUrl}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
    const { access_token: token } = await tokenRes.json()
    const post = () => fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', 'PayPal-Request-Id': id }, body: JSON.stringify({ amount: { currency_code: 'USD', value: '4.00' } }) }).then(async (r) => ({ status: r.status, body: await r.json() }))
    const first = await post()
    const second = await post()
    const orderAfter = await lab.truth.order(recording.contract.orderId)
    record({ question: 'Does a repeated PayPal-Request-Id return the stored refund and create no second one?', first: { status: first.status, id: first.body.id }, second: { status: second.status, id: second.body.id }, refundsOnOrder: orderAfter.refunds.length, sameId: first.body.id === second.body.id })
  } else if (step === 'V6' && recording) {
    // Postback with a cert_url that is not PayPal's.
    const d = recording.deliveries[1]
    const forged = { ...d.headers, 'paypal-cert-url': 'https://attacker.example.test/cert.pem' }
    const result = await rest.verifyPostback({ headers: forged, webhookId: config.webhookId, rawBody: bodyText(d) })
    record({ question: 'What does PayPal answer to a postback whose cert_url is not PayPal?', status: result.status, body: result.body })
  } else {
    process.stderr.write('Usage: node scripts/verify-sandbox.js V1 | V2 <recording> | V3 <recording> | V4 <order-id> | V5 <recording> | V6 <recording>\n')
    process.exitCode = 1
  }
} finally {
  await lab.stop()
}
