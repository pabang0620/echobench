import { cpSync, rmSync } from 'node:fs'
import path from 'node:path'
import { createApp } from './app.js'
import { createLab } from './lab.js'
import { APP_ROOT } from './config.js'

// Builds the built-in recording by driving a real purchase through the local PayPal stand-in:
// order, approval, capture (through the recorder's return URL), partial refunds 4.00 and 8.00,
// plus one dispute and one captured-but-unrefunded payment for contract runs.
// It is recorded against the reference MugShop so every start point is a clean state.
export const BUILTIN_ID = 'mugshop-demo'

async function json(res) {
  if (!res.ok) throw new Error(`${res.url} -> ${res.status} ${await res.text()}`)
  return res.json()
}

export async function buildBuiltinRecording({ dataDir, outDir = path.join(APP_ROOT, 'builtin', BUILTIN_ID) }) {
  const lab = await createLab({ dataDir, mode: 'mock', settleWindowMs: 3000 })
  const app = createApp(lab)
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  lab.publicUrl = `http://127.0.0.1:${server.address().port}`
  lab.mock.registerWebhook(`${lab.publicUrl}/hooks/paypal`)
  const mock = (p, body = {}) => fetch(`${lab.ledgerUrl}${p}`, { method: 'POST', body: JSON.stringify(body) }).then(json)

  try {
    const target = lab.target('mugshop-reference')
    await target.start({ fresh: true })
    const rec = lab.recorder.start({ id: BUILTIN_ID, name: 'MugShop demo purchase (built-in, recorded against the local PayPal stand-in)', targetId: target.id, source: 'builtin-mock', webhookId: lab.cfg.webhookId })

    // A captured, unrefunded payment for the contract tests. PayPal sends no webhooks for it.
    await lab.setDelivery(false)
    const fixture = (await target.checkout({ sku: 'MUG-001', quantity: 1 })).body
    await mock(`/__mock/orders/${fixture.orderId}/approve`)
    await target.returnPath(fixture.orderId)
    const fixtureState = await target.readState(fixture.orderId)
    await lab.recorder.recordContractFixture({ orderId: fixture.orderId, captureId: fixtureState.captures[0].id, amount: fixture.amount })
    await lab.setDelivery(true)

    // The recorded purchase.
    const order = (await target.checkout({ sku: 'MUG-001', quantity: 1 })).body
    rec.orderId = order.orderId
    await lab.recorder.snapshotNow('SP0')
    await mock(`/__mock/orders/${order.orderId}/approve`)
    await lab.recorder.waitForDeliveries(1)
    await json(await fetch(`${lab.publicUrl}/rec/return?token=${order.orderId}`))
    await lab.recorder.waitForDeliveries(2)
    await target.refund('admin', { orderId: order.orderId, amount: '4.00', refundRef: 'RMA-A1' })
    await lab.recorder.waitForDeliveries(3)
    await target.refund('admin', { orderId: order.orderId, amount: '8.00', refundRef: 'RMA-A2' })
    await lab.recorder.waitForDeliveries(4)
    await mock('/__mock/emit-dispute', { captureId: lab.recorder.session.captureId })
    for (let i = 0; i < 80 && !lab.recorder.session.extras.dispute; i += 1) await new Promise((r) => setTimeout(r, 50))

    lab.recorder.session.ledger = lab.mock.exportLedger()
    const saved = await lab.recorder.finish()
    rmSync(outDir, { recursive: true, force: true })
    cpSync(saved.dir, outDir, { recursive: true })
    return { id: saved.id, dir: outDir, deliveries: saved.deliveries.map((d) => d.label), startPoints: Object.keys(saved.startPoints) }
  } finally {
    server.close()
    await lab.stop()
  }
}
