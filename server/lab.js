import { mkdirSync } from 'node:fs'
import { assertSandboxUrl, loadConfig } from './config.js'
import { createMockPaypal, mockKeyPem } from './mockPaypal.js'
import { createProxy } from './proxy.js'
import { createRecorder } from './recorder.js'
import { createStore } from './store.js'
import { createTruth } from './truth.js'
import { createMugshopTarget, prepareWorkspace } from './targets/mugshop.js'
import { loadExtraTargets } from './targets/extra.js'
import { importPrecomputed } from './precomputed.js'

// Everything the lab needs, wired once: the PayPal ledger (stand-in or sandbox), the pass-through
// proxy that can cut a reply, the read-only truth reader, the recorder, the store and the targets.
export async function createLab(overrides = {}) {
  const cfg = { ...loadConfig(), ...overrides }
  if (cfg.mode === 'sandbox') assertSandboxUrl(cfg.paypalBaseUrl)
  mkdirSync(cfg.dataDir, { recursive: true })

  const mock = cfg.mode === 'mock' ? createMockPaypal({ webhookId: cfg.webhookId }) : null
  const ledgerUrl = mock ? await mock.listen(0) : cfg.paypalBaseUrl
  const proxy = createProxy({ upstream: ledgerUrl, credentials: cfg.mode === 'sandbox' ? { clientId: cfg.clientId, clientSecret: cfg.clientSecret } : null })
  await proxy.listen(0)
  const truth = createTruth({ baseUrl: ledgerUrl, clientId: cfg.clientId, clientSecret: cfg.clientSecret, impl: cfg.clientImpl })
  const store = createStore({ dataDir: cfg.dataDir, builtinDir: cfg.builtinDir })
  const targets = new Map()

  let queue = Promise.resolve()
  let pending = 0
  const lab = {
    cfg,
    mock,
    ledgerUrl,
    proxy,
    truth,
    store,
    targets,
    publicUrl: cfg.publicUrl,
    // Where this process listens, for the targets on this machine (the public URL may be a tunnel). Set by index.js.
    localUrl: null,
    mockKeyPem: mock ? mockKeyPem() : null,
    settleWindowMs: cfg.settleWindowMs,
    // One scenario at a time: runs restart the target process.
    get pending() {
      return pending
    },
    exclusive(work) {
      pending += 1
      const next = queue.then(work, work)
      queue = next.catch(() => {})
      return next.finally(() => {
        pending -= 1
      })
    },
    target(id) {
      const target = targets.get(id)
      if (!target) throw Object.assign(new Error(`Unknown target ${id}`), { status: 404 })
      return target
    },
    addTarget(target) {
      targets.set(target.id, target)
      return target
    },
    // Forget the refunds a contract run made, so the same capture serves the next run (stand-in only).
    async afterContractRun(contract) {
      if (!mock) return
      await fetch(`${ledgerUrl}/__mock/rewind-refunds`, { method: 'POST', body: JSON.stringify({ captureId: contract.captureId }) })
    },
    // Stand-in only: take an order back to "approved, not captured" for one run, then put its records back.
    async rewindOrder(orderId) {
      const res = await fetch(`${ledgerUrl}/__mock/rewind-order`, { method: 'POST', body: JSON.stringify({ orderId }) })
      return res.json()
    },
    async restoreOrder(snapshot) {
      await fetch(`${ledgerUrl}/__mock/restore-order`, { method: 'POST', body: JSON.stringify({ snapshot }) })
    },
    async setDelivery(enabled) {
      if (mock) await fetch(`${ledgerUrl}/__mock/delivery`, { method: 'POST', body: JSON.stringify({ enabled }) })
    },
    async stop() {
      await Promise.allSettled([...targets.values()].map((t) => t.stop()))
      await proxy.close()
      if (mock) await mock.close()
    },
  }
  lab.recorder = createRecorder({ store, getTarget: (id) => lab.target(id) })

  if (cfg.resetWorkspaceOnStart) {
    prepareWorkspace(cfg.dataDir, 'mugshop', 'planted', { force: true })
    store.deleteRuns({ targetId: 'mugshop' })
  }
  lab.addTarget(createMugshopTarget(lab, { id: 'mugshop', variant: 'planted' }))
  lab.addTarget(createMugshopTarget(lab, { id: 'mugshop-reference', variant: 'reference' }))
  // Contrast copy: the reference fix with the plan's refund claim and retry switched off. Not a planted bug.
  lab.addTarget(createMugshopTarget(lab, { id: 'mugshop-contrast', variant: 'contrast', env: { REFUND_CLAIM: 'off' } }))
  for (const target of loadExtraTargets(lab)) lab.addTarget(target)
  if (mock) {
    for (const meta of store.listRecordings()) {
      const rec = store.getRecording(meta.id)
      if (rec?.ledger) mock.importLedger(rec.ledger)
    }
  }
  importPrecomputed(lab)
  return lab
}
