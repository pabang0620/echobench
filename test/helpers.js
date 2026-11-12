import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../server/app.js'
import { createLab } from '../server/lab.js'

const SCRATCH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.scratch')

// A lab on the local PayPal stand-in with a private data folder inside the app (so MugShop can resolve node_modules).
export async function startLab(overrides = {}) {
  mkdirSync(SCRATCH, { recursive: true })
  const dataDir = mkdtempSync(path.join(SCRATCH, 'test-'))
  const lab = await createLab({ dataDir, mode: 'mock', anthropicKey: '', llmBackend: 'mock', recordedDir: '', settleWindowMs: 3500, ...overrides })
  const server = createApp(lab).listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  lab.publicUrl = `http://127.0.0.1:${server.address().port}`
  lab.mock?.registerWebhook(`${lab.publicUrl}/hooks/paypal`)
  return {
    lab,
    url: lab.publicUrl,
    recording: () => lab.store.getRecording('mugshop-demo'),
    async stop() {
      server.close()
      await lab.stop()
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

// `session` = a visitor id (32 hex). Without one every request is a new visitor.
export async function api(base, method, route, body, session) {
  const res = await fetch(`${base}/api${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...(session ? { 'x-echobench-session': session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}
