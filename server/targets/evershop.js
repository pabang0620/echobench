import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { APP_ROOT } from '../config.js'

// R1 harness: an unmodified EverShop (PostgreSQL) as the target. EchoBench never edits EverShop.
//  - state is read through a READ-ONLY database role (every statement must be a SELECT)
//  - start points are PostgreSQL template databases; a reset drops the app database,
//    recreates it from the template and restarts EverShop (connection pool and caches)
//  - EverShop is installed by scripts/install-evershop.sh, which the user runs; this file never installs it.
// Run instructions: targets/evershop/README.md. Status: harness written, NOT run (VERIFY.md R1).

const SCHEMA = JSON.parse(readFileSync(path.join(APP_ROOT, 'targets', 'evershop', 'schema.json'), 'utf8'))
const ident = (name) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Unsafe identifier ${name}`)
  return `"${name}"`
}

export function assertReadOnlySql(sql) {
  const text = sql.trim().replace(/;$/, '')
  if (!/^select\s/i.test(text) || /;/.test(text)) throw new Error('Read-only role: only a single SELECT is allowed')
  return text
}

async function defaultPg() {
  try {
    return await import('pg')
  } catch {
    throw new Error('The "pg" package is not installed. Run `npm install pg` in this folder before using the EverShop target.')
  }
}

export function createEvershopTarget(lab, { pgModule = null, env = process.env } = {}) {
  const dir = lab.cfg.evershopDir
  const dbName = env.EVERSHOP_DB_NAME || 'evershop'
  const adminUrl = env.EVERSHOP_DB_ADMIN_URL || ''
  const readonlyUrl = env.EVERSHOP_DB_READONLY_URL || ''
  const port = Number(env.EVERSHOP_PORT || 3000)
  const webhookPath = env.EVERSHOP_WEBHOOK_PATH || '/api/paypal/webhook'
  const startCmd = env.EVERSHOP_START_CMD || 'npm run start'
  let child = null
  let log = ''

  const connect = async (url) => {
    const { default: pg } = await (pgModule ? Promise.resolve({ default: pgModule }) : defaultPg())
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    return client
  }

  async function readOnly(sql, params = []) {
    const client = await connect(readonlyUrl)
    try {
      await client.query('BEGIN READ ONLY')
      const result = await client.query(assertReadOnlySql(sql), params)
      await client.query('ROLLBACK')
      return result.rows
    } finally {
      await client.end()
    }
  }

  async function admin(sql) {
    const client = await connect(adminUrl)
    try {
      await client.query(sql)
    } finally {
      await client.end()
    }
  }

  const target = {
    id: 'evershop',
    label: 'EverShop (unmodified)',
    kind: 'postgres',
    capabilities: { returnPath: false, disputes: false, refunds: false, reset: true },
    meta: { variant: 'unmodified', group: 'evershop' },
    get baseUrl() {
      return `http://127.0.0.1:${port}`
    },
    get webhookUrl() {
      return `${target.baseUrl}${webhookPath}`
    },

    async start() {
      if (child) return
      if (!dir || !existsSync(dir)) throw new Error('EVERSHOP_DIR does not exist. Run scripts/install-evershop.sh first.')
      const [cmd, ...args] = startCmd.split(' ')
      child = spawn(cmd, args, { cwd: dir, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
      const keep = (chunk) => {
        log = (log + chunk.toString()).slice(-4000)
      }
      child.stdout.on('data', keep)
      child.stderr.on('data', keep)
      const current = child
      current.on('exit', () => {
        if (child === current) child = null
      })
      const deadline = Date.now() + 90000
      while (Date.now() < deadline) {
        try {
          const res = await fetch(target.baseUrl)
          if (res.status < 500) return
        } catch {
          // still starting
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      throw new Error(`EverShop did not come up:\n${log}`)
    },
    async stop() {
      if (!child) return
      const current = child
      child = null
      await new Promise((resolve) => {
        current.once('exit', resolve)
        current.kill('SIGTERM')
        setTimeout(() => current.kill('SIGKILL'), 5000).unref()
      })
    },

    // destFile is only a marker file holding the template database name.
    async snapshot(destFile, orderId) {
      const template = `echobench_${path.basename(destFile, '.sqlite')}_${Date.now().toString(36)}`.toLowerCase()
      await target.stop() // a template can only be copied while nobody is connected
      await admin(`CREATE DATABASE ${ident(template)} TEMPLATE ${ident(dbName)}`)
      mkdirSync(path.dirname(destFile), { recursive: true })
      writeFileSync(destFile, JSON.stringify({ template }))
      await target.start()
      return orderId ? fingerprintOf(await target.readState(orderId)) : null
    },
    async restore(markerFile) {
      const { template } = JSON.parse(readFileSync(markerFile, 'utf8'))
      await target.stop()
      await admin(`DROP DATABASE IF EXISTS ${ident(dbName)} WITH (FORCE)`)
      await admin(`CREATE DATABASE ${ident(dbName)} TEMPLATE ${ident(template)}`)
      await target.start()
    },

    async readState(paypalOrderId) {
      const o = SCHEMA.order
      const p = SCHEMA.payment
      const orders = await readOnly(`SELECT ${ident(o.id)} AS id, ${ident(o.status)} AS payment_status, ${ident(o.shipment)} AS shipment_status FROM ${ident(o.table)} WHERE ${ident(o.key)} = $1`, [paypalOrderId])
      if (!orders.length) return { paypal_order_id: paypalOrderId, exists: false, status: 'UNKNOWN', on_hold: false, fulfilled_count: 0, shipments: [], captures: [], refunds: [], refund_attempts: [], processed_event_ids: [] }
      const order = orders[0]
      const tx = await readOnly(`SELECT ${ident(p.transactionId)} AS id, ${ident(p.type)} AS type, ${ident(p.amount)} AS amount FROM ${ident(p.table)} WHERE ${ident(p.orderRef)} = $1 ORDER BY 1`, [order.id])
      const ships = await readOnly(`SELECT COUNT(*) AS n FROM ${ident(SCHEMA.shipment.table)} WHERE ${ident(SCHEMA.shipment.orderRef)} = $1`, [order.id])
      const money = (v) => Number(v).toFixed(2)
      return {
        paypal_order_id: paypalOrderId,
        exists: true,
        status: String(order.payment_status),
        on_hold: false,
        fulfilled_count: Number(ships[0].n),
        shipments: Array.from({ length: Number(ships[0].n) }, (_, i) => ({ id: i + 1, at_event: 'unknown (EverShop does not log it)', capture_recorded: true })),
        captures: tx.filter((t) => p.captureTypes.includes(t.type)).map((t) => ({ id: String(t.id), amount: money(t.amount) })),
        refunds: tx.filter((t) => p.refundTypes.includes(t.type)).map((t) => ({ id: String(t.id), amount: money(t.amount) })),
        refund_attempts: [],
        processed_event_ids: [],
      }
    },

    // Plan R1 step 4: the recorded PayPal order and capture must exist in EverShop's own tables.
    async precheck({ orderId, captureId }) {
      const o = SCHEMA.order
      const p = SCHEMA.payment
      const orders = await readOnly(`SELECT ${ident(o.id)} AS id FROM ${ident(o.table)} WHERE ${ident(o.key)} = $1`, [orderId])
      if (!orders.length) return { ok: false, reason: `match failed: no EverShop order has ${o.key} = ${orderId}` }
      const tx = await readOnly(`SELECT 1 AS found FROM ${ident(p.table)} WHERE ${ident(p.transactionId)} = $1`, [captureId])
      if (!tx.length) return { ok: false, reason: `match failed: no ${p.table} row has ${p.transactionId} = ${captureId}` }
      return { ok: true, reason: 'EverShop order and capture found' }
    },

    // Compares SCHEMA with information_schema so a wrong column guess is found before any run.
    async checkSchema() {
      const wanted = [
        [SCHEMA.order.table, [SCHEMA.order.key, SCHEMA.order.status, SCHEMA.order.shipment, SCHEMA.order.id]],
        [SCHEMA.payment.table, [SCHEMA.payment.orderRef, SCHEMA.payment.transactionId, SCHEMA.payment.type, SCHEMA.payment.amount]],
        [SCHEMA.shipment.table, [SCHEMA.shipment.orderRef]],
      ]
      const missing = []
      for (const [table, columns] of wanted) {
        const rows = await readOnly('SELECT column_name FROM information_schema.columns WHERE table_name = $1', [table])
        const have = new Set(rows.map((r) => r.column_name))
        for (const column of columns) if (!have.has(column)) missing.push(`${table}.${column}`)
      }
      return { ok: missing.length === 0, missing }
    },

    async postWebhook(headers, body) {
      const started = Date.now()
      try {
        const res = await fetch(target.webhookUrl, { method: 'POST', headers, body })
        const text = await res.text()
        return { status: res.status, body: text.slice(0, 500), ms: Date.now() - started }
      } catch (err) {
        return { status: 0, body: String(err.message), ms: Date.now() - started }
      }
    },
  }
  return target
}

function fingerprintOf(state) {
  return {
    exists: state.exists,
    status: state.status,
    on_hold: state.on_hold,
    fulfilled_count: state.fulfilled_count,
    captures: state.captures.map((c) => c.id).sort(),
    refunds: state.refunds.map((r) => r.id).sort(),
    processed_event_ids: [],
  }
}
