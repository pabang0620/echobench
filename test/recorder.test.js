import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBuiltinRecording } from '../server/seed.js'
import { startLab } from './helpers.js'

const SCRATCH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.scratch')

test('recording a purchase saves every delivery as raw bytes plus PAYPAL-* headers and a start point per stage', async () => {
  mkdirSync(SCRATCH, { recursive: true })
  const dataDir = mkdtempSync(path.join(SCRATCH, 'rec-'))
  const outDir = path.join(dataDir, 'out')
  try {
    const result = await buildBuiltinRecording({ dataDir, outDir })
    assert.deepEqual(result.deliveries, ['approved', 'completed', 'refund1', 'refund2'])
    const { default: fs } = await import('node:fs')
    const rec = JSON.parse(fs.readFileSync(path.join(outDir, 'recording.json'), 'utf8'))
    for (const d of rec.deliveries) {
      assert.ok(Buffer.from(d.bodyBase64, 'base64').length > 100)
      assert.deepEqual(Object.keys(d.headers).sort(), ['content-type', 'paypal-auth-algo', 'paypal-auth-version', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'])
      assert.equal(d.targetResponse.status, 200)
    }
    const fp = (n) => rec.startPoints[n].fingerprint
    assert.deepEqual([fp('SP0').fulfilled_count, fp('SP1').fulfilled_count, fp('SP2').fulfilled_count, fp('SP3').fulfilled_count], [0, 1, 1, 1])
    assert.deepEqual([fp('SP0').refunds.length, fp('SP1').refunds.length, fp('SP2').refunds.length, fp('SP3').refunds.length], [0, 0, 1, 2])
    for (const name of ['SP0', 'SP1', 'SP2', 'SP3', 'SPC']) assert.ok(existsSync(path.join(outDir, 'snapshots', `${name}.sqlite`)), name)
    assert.equal(rec.extras.dispute.eventType, 'CUSTOMER.DISPUTE.CREATED')
    assert.equal(rec.contract.amount, '12.00')
    assert.ok(rec.ledger.refunds.length >= 2)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('the receiver answers PayPal 200 at once even when the target is slow or fails', async () => {
  const ctx = await startLab()
  try {
    const slow = {
      id: 'slow', capabilities: {}, meta: {},
      async postWebhook() {
        await new Promise((r) => setTimeout(r, 700))
        return { status: 500, body: 'boom', ms: 700 }
      },
      async snapshot() { return null },
      async stop() {},
    }
    ctx.lab.addTarget(slow)
    ctx.lab.recorder.start({ name: 'slow', targetId: 'slow', webhookId: 'WH' })
    const body = JSON.stringify({ id: 'WH-X', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORD' } })
    const started = Date.now()
    const res = await fetch(`${ctx.url}/hooks/paypal`, { method: 'POST', headers: { 'content-type': 'application/json', 'paypal-transmission-id': 'tx' }, body })
    assert.equal(res.status, 200)
    assert.ok(Date.now() - started < 400, 'answered before the slow target finished')
    const rec = await ctx.lab.recorder.finish()
    assert.equal(rec.deliveries[0].targetResponse.status, 500, 'the target answer is recorded separately')
    assert.equal(Buffer.from(rec.deliveries[0].bodyBase64, 'base64').toString(), body, 'the stored bytes equal the received bytes')
  } finally {
    await ctx.stop()
  }
})
