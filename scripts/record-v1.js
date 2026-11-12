import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// VERIFY V1 against a deployed EchoBench in sandbox mode: real PayPal sandbox deliveries to its public
// /hooks/paypal. One purchase of 12.00 (approved by a sandbox buyer in headless Chromium through the
// shared buyer lock), then partial refunds 4.00 and 8.00 from MugShop's admin route. Fake money only.
//   ECHOBENCH_ALLOW_SANDBOX=1 BUYER_RUN=<buyer-run.sh> node scripts/record-v1.js https://<host> [targetId]
// Appends one JSON line to VERIFY_RESULTS.json (git-ignored). Prints ids, never credentials.
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [host, targetId = 'mugshop-reference'] = process.argv.slice(2)
if (process.env.ECHOBENCH_ALLOW_SANDBOX !== '1' || !process.env.BUYER_RUN || !/^https:\/\//.test(host || '')) {
  throw new Error('Usage: ECHOBENCH_ALLOW_SANDBOX=1 BUYER_RUN=<buyer-run.sh> node scripts/record-v1.js https://<host> [targetId]')
}
const headers = { 'content-type': 'application/json', ...(process.env.ECHOBENCH_ACCESS_TOKEN ? { 'x-echobench-token': process.env.ECHOBENCH_ACCESS_TOKEN } : {}) }
const call = async (method, route, body) => {
  const res = await fetch(`${host}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${json.message || ''}`)
  return json.data ?? json
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const say = (line) => process.stdout.write(`${line}\n`)

// PayPal delivers within seconds to minutes; wait for the labels, not for a clock.
async function waitFor(label, limitMs = 300000) {
  const started = Date.now()
  while (Date.now() - started < limitMs) {
    const live = await call('GET', '/api/recordings-live')
    if (live?.deliveries.includes(label)) return live
    await sleep(3000)
  }
  throw new Error(`no ${label} delivery within ${limitMs / 1000} s`)
}

const status = await call('GET', '/api/status')
if (status.mode !== 'sandbox') throw new Error(`the host runs in ${status.mode} mode, not sandbox`)
const started = Date.now()
const rec = await call('POST', '/api/recordings/start', { name: 'Real PayPal sandbox deliveries: one purchase, refunds 4.00 and 8.00 (VERIFY V1)', targetId })
say(`recording ${rec.id}, webhook ${rec.webhookUrl}`)
try {
  const order = await call('POST', '/api/recordings/checkout', {})
  say(`order ${order.orderId}`)
  const buyer = spawnSync(process.env.BUYER_RUN, ['python3', path.join(APP, 'scripts', 'approve-buyer.py'), order.approveUrl], { cwd: APP, encoding: 'utf8', timeout: 240000 })
  say(`buyer: ${buyer.stdout.trim().split('\n').pop()}`)
  await waitFor('approved')
  const back = await fetch(`${host}/rec/return?token=${encodeURIComponent(order.orderId)}`, { headers })
  say(`return path ${back.status}`)
  await waitFor('completed')
  for (const [amount, label] of [['4.00', 'refund1'], ['8.00', 'refund2']]) {
    const r = await call('POST', '/api/recordings/refund', { amount })
    say(`refund ${amount}: shop answered ${r.status}`)
    await waitFor(label)
  }
} finally {
  const live = await call('GET', '/api/recordings-live').catch(() => null)
  const done = await call('POST', '/api/recordings/finish', {})
  const detail = await call('GET', `/api/recordings/${done.id}`)
  const line = {
    step: 'V1', at: new Date().toISOString(), host, recordingId: done.id, orderId: detail.orderId, captureId: detail.captureId,
    seconds: Math.round((Date.now() - started) / 1000), startPoints: done.startPoints, ignoredOtherOrders: live?.ignoredOtherOrders ?? null,
    deliveries: detail.deliveries.map((d) => ({ label: d.label, eventType: d.eventType, eventId: d.eventId, receivedAt: d.receivedAt, transmissionId: d.headers['paypal-transmission-id'] || null, certUrlHost: d.headers['paypal-cert-url'] ? new URL(d.headers['paypal-cert-url']).hostname : null, targetStatus: d.targetResponse?.status ?? null })),
  }
  appendFileSync(path.join(APP, 'VERIFY_RESULTS.json'), `${JSON.stringify(line)}\n`)
  say(JSON.stringify(line, null, 2))
}
