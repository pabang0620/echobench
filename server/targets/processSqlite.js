import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { ConfigError } from '../config.js'

// A target that runs as a child process and keeps its data in one SQLite file (DATA_PATH).
// State reset = stop the process, copy the snapshot file over DATA_PATH, start it again.
// The handler under test is never modified: it only has to offer the adapter contract
// (GET state, POST snapshot) described in the README.

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
    probe.on('error', reject)
  })
}

// Code the model wrote runs with only these variables from EchoBench's own environment: no API keys,
// no PayPal credentials. What the target needs is passed explicitly in `env`.
const SAFE_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'TMPDIR', 'TEMP', 'SystemRoot']
const pickEnv = (source, keys) => Object.fromEntries(keys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]))

export const DEFAULT_PATHS = {
  health: '/health',
  webhook: '/webhooks/paypal',
  returnPath: '/checkout/return',
  state: '/__echobench/state',
  snapshot: '/__echobench/snapshot',
  refund: { admin: '/admin/refund', support: '/support/refund' },
  checkout: '/checkout',
}

export class ProcessSqliteTarget {
  constructor({ id, label, command, args, cwd, runtimeDir, env = {}, paths = {}, capabilities = {}, meta = {}, cleanEnv = false }) {
    this.id = id
    this.meta = meta
    this.label = label
    this.kind = 'process-sqlite'
    this.command = command
    this.args = args
    this.cwd = cwd
    this.runtimeDir = runtimeDir
    this.env = env
    this.cleanEnv = cleanEnv
    this.paths = { ...DEFAULT_PATHS, ...paths, refund: { ...DEFAULT_PATHS.refund, ...(paths.refund || {}) } }
    this.capabilities = { returnPath: true, disputes: true, refunds: true, reset: true, ...capabilities }
    this.child = null
    this.port = 0
    this.log = ''
    this.dataPath = path.join(runtimeDir, 'db.sqlite')
    this.snapshotDir = path.join(runtimeDir, 'tmp-snapshots')
  }

  get baseUrl() {
    return `http://127.0.0.1:${this.port}`
  }

  get webhookUrl() {
    return `${this.baseUrl}${this.paths.webhook}`
  }

  async start({ fresh = false } = {}) {
    if (this.child) return
    mkdirSync(this.snapshotDir, { recursive: true })
    if (fresh) this.#removeDb()
    this.port = await freePort()
    this.log = ''
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: {
        ...(this.cleanEnv ? pickEnv(process.env, SAFE_ENV_KEYS) : process.env),
        ...this.env,
        PORT: String(this.port),
        DATA_PATH: this.dataPath,
        SNAPSHOT_DIR: this.snapshotDir,
        ECHOBENCH_ADAPTER: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const keep = (chunk) => {
      this.log = (this.log + chunk.toString()).slice(-4000)
    }
    this.child.stdout.on('data', keep)
    this.child.stderr.on('data', keep)
    const child = this.child
    child.on('exit', () => {
      if (this.child === child) this.child = null
    })
    await this.#waitHealthy()
  }

  async #waitHealthy() {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      if (!this.child) throw new ConfigError(`${this.id} could not start. ${this.log.trim().slice(-600) || 'It exited without output.'}`)
      try {
        const res = await fetch(`${this.baseUrl}${this.paths.health}`)
        if (res.ok) return
      } catch {
        // not listening yet
      }
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    throw new ConfigError(`${this.id} did not become healthy in 15 s. ${this.log.trim().slice(-600)}`)
  }

  async stop() {
    const child = this.child
    if (!child) return
    this.child = null
    await new Promise((resolve) => {
      child.once('exit', resolve)
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 3000).unref()
    })
  }

  #removeDb() {
    for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(`${this.dataPath}${suffix}`, { force: true })
  }

  // Writes a consistent copy of the live database to destFile and returns the state fingerprint.
  async snapshot(destFile, orderId) {
    mkdirSync(path.dirname(destFile), { recursive: true })
    const tmp = path.join(this.snapshotDir, `snap-${Date.now()}.sqlite`)
    const res = await fetch(`${this.baseUrl}${this.paths.snapshot}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: tmp }),
    })
    if (!res.ok) throw new Error(`snapshot failed: ${res.status} ${await res.text()}`)
    copyFileSync(tmp, destFile)
    rmSync(tmp, { force: true })
    return orderId ? fingerprint(await this.readState(orderId)) : null
  }

  async restore(snapshotFile) {
    if (!existsSync(snapshotFile)) throw new Error(`snapshot file missing: ${snapshotFile}`)
    await this.stop()
    this.#removeDb()
    mkdirSync(path.dirname(this.dataPath), { recursive: true })
    copyFileSync(snapshotFile, this.dataPath)
    await this.start()
  }

  async readState(orderId) {
    const res = await fetch(`${this.baseUrl}${this.paths.state}?paypal_order_id=${encodeURIComponent(orderId)}`)
    if (!res.ok) throw new Error(`state read failed: ${res.status}`)
    return res.json()
  }

  async returnPath(orderId) {
    const res = await fetch(`${this.baseUrl}${this.paths.returnPath}?token=${encodeURIComponent(orderId)}`)
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }

  async refund(pathName, body) {
    const res = await fetch(`${this.baseUrl}${this.paths.refund[pathName]}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }

  async checkout(body) {
    const res = await fetch(`${this.baseUrl}${this.paths.checkout}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }

  async postWebhook(headers, body) {
    const started = Date.now()
    try {
      const res = await fetch(this.webhookUrl, { method: 'POST', headers, body })
      const text = await res.text()
      let parsed = text
      try {
        parsed = JSON.parse(text)
      } catch {
        // keep text
      }
      return { status: res.status, body: parsed, ms: Date.now() - started }
    } catch (err) {
      return { status: 0, body: String(err.message), ms: Date.now() - started }
    }
  }

  // Read-only precheck: does the target know the recorded order and capture?
  async precheck({ orderId, captureId }) {
    const state = await this.readState(orderId)
    const knowsCapture = state.captures.some((c) => c.id === captureId)
    if (!state.exists) return { ok: false, reason: `target has no order ${orderId}` }
    return { ok: true, reason: knowsCapture ? 'order and capture found' : 'order found (capture is booked by the return path)' }
  }
}

// What a start point must look like again after a reset.
export function fingerprint(state) {
  return {
    exists: state.exists,
    status: state.status,
    on_hold: state.on_hold,
    fulfilled_count: state.fulfilled_count,
    captures: state.captures.map((c) => c.id).sort(),
    refunds: state.refunds.map((r) => r.id).sort(),
    processed_event_ids: [...state.processed_event_ids].sort(),
  }
}

export function sameFingerprint(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}
