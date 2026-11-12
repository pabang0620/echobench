import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertReadOnlySql, createEvershopTarget } from '../server/targets/evershop.js'

// A stand-in for the "pg" package that records every statement and answers from a table of rules.
function fakePg(answers) {
  const log = []
  class Client {
    constructor(opts) {
      this.url = opts.connectionString
    }
    async connect() {
      log.push({ url: this.url, sql: 'CONNECT' })
    }
    async query(sql, params) {
      log.push({ url: this.url, sql: sql.replace(/\s+/g, ' ').trim(), params })
      const rule = answers.find((a) => a.match.test(sql))
      return { rows: rule ? rule.rows : [] }
    }
    async end() {}
  }
  return { module: { Client }, log }
}

const env = { EVERSHOP_DB_ADMIN_URL: 'postgres://admin@db/postgres', EVERSHOP_DB_READONLY_URL: 'postgres://reader@db/evershop', EVERSHOP_DB_NAME: 'evershop' }
const lab = { cfg: { evershopDir: '/tmp/evershop-not-installed' } }

test('the read-only role may only run a single SELECT', () => {
  assert.equal(assertReadOnlySql('SELECT 1;'), 'SELECT 1')
  for (const bad of ['DELETE FROM "order"', 'UPDATE "order" SET a = 1', 'SELECT 1; DROP TABLE x', 'DROP DATABASE evershop', 'INSERT INTO a VALUES (1)', 'WITH x AS (DELETE FROM a RETURNING 1) SELECT * FROM x']) {
    assert.throws(() => assertReadOnlySql(bad), /Read-only/, bad)
  }
})

test('every state read runs inside a READ ONLY transaction on the read-only connection', async () => {
  const { module, log } = fakePg([
    { match: /FROM "order"/, rows: [{ id: 7, payment_status: 'paid', shipment_status: 'unfulfilled' }] },
    // EverShop 2.4.0 writes transaction_type 'online' for both; payment_action tells them apart (schema.json).
    { match: /FROM "payment_transaction"/, rows: [{ id: 'CAP1', type: 'capture', amount: '12.00' }, { id: 'REF1', type: 'refund', amount: '4.00' }] },
    { match: /FROM "shipment"/, rows: [{ n: '0' }] },
  ])
  const target = createEvershopTarget(lab, { pgModule: module, env })
  const state = await target.readState('ORDER1')
  assert.equal(state.exists, true)
  assert.deepEqual(state.captures, [{ id: 'CAP1', amount: '12.00' }])
  assert.deepEqual(state.refunds, [{ id: 'REF1', amount: '4.00' }])
  const sql = log.map((l) => l.sql)
  assert.equal(sql.filter((s) => s === 'BEGIN READ ONLY').length, 3)
  assert.ok(log.filter((l) => l.sql !== 'CONNECT').every((l) => l.url === env.EVERSHOP_DB_READONLY_URL))
  assert.ok(sql.every((s) => !/^(INSERT|UPDATE|DELETE|DROP|CREATE)/i.test(s)))
})

test('precheck is a database lookup of the recorded order and capture, not a re-delivery', async () => {
  const hit = fakePg([{ match: /integration_order_id/, rows: [{ id: 7 }] }, { match: /transaction_id/, rows: [{ found: 1 }] }])
  const ok = await createEvershopTarget(lab, { pgModule: hit.module, env }).precheck({ orderId: 'ORDER1', captureId: 'CAP1' })
  assert.equal(ok.ok, true)
  assert.deepEqual(hit.log.find((l) => /integration_order_id/.test(l.sql)).params, ['ORDER1'])
  assert.deepEqual(hit.log.find((l) => /transaction_id/.test(l.sql)).params, ['CAP1'])

  const noOrder = fakePg([])
  const miss = await createEvershopTarget(lab, { pgModule: noOrder.module, env }).precheck({ orderId: 'ORDER1', captureId: 'CAP1' })
  assert.equal(miss.ok, false)
  assert.match(miss.reason, /match failed: no EverShop order has integration_order_id = ORDER1/)

  const noCapture = fakePg([{ match: /integration_order_id/, rows: [{ id: 7 }] }])
  assert.match((await createEvershopTarget(lab, { pgModule: noCapture.module, env }).precheck({ orderId: 'ORDER1', captureId: 'CAP1' })).reason, /transaction_id = CAP1/)
})

test('a start point is a template database; a reset drops the app database and recreates it from the template', async () => {
  const { module, log } = fakePg([])
  const target = createEvershopTarget(lab, { pgModule: module, env })
  target.start = async () => {}
  target.stop = async () => {}
  target.readState = async () => ({ exists: true, status: 'paid', on_hold: false, fulfilled_count: 0, captures: [], refunds: [] })
  const dir = mkdtempSync(path.join(os.tmpdir(), 'evershop-snap-'))
  const marker = path.join(dir, 'SP1.sqlite')
  await target.snapshot(marker, 'ORDER1')
  const { template } = JSON.parse(readFileSync(marker, 'utf8'))
  assert.match(template, /^echobench_sp1_/)
  assert.ok(log.some((l) => l.sql === `CREATE DATABASE "${template}" TEMPLATE "evershop"`))
  log.length = 0
  await target.restore(marker)
  const sql = log.map((l) => l.sql).filter((s) => s !== 'CONNECT')
  assert.deepEqual(sql, ['DROP DATABASE IF EXISTS "evershop" WITH (FORCE)', `CREATE DATABASE "evershop" TEMPLATE "${template}"`])
  assert.ok(log.filter((l) => l.sql !== 'CONNECT').every((l) => l.url === env.EVERSHOP_DB_ADMIN_URL))
})

test('database names are checked before they go into SQL', async () => {
  const { module } = fakePg([])
  const target = createEvershopTarget(lab, { pgModule: module, env: { ...env, EVERSHOP_DB_NAME: 'evershop"; DROP DATABASE x; --' } })
  target.stop = async () => {}
  target.start = async () => {}
  const marker = path.join(mkdtempSync(path.join(os.tmpdir(), 'evershop-snap-')), 'SP1.sqlite')
  writeFileSync(marker, JSON.stringify({ template: 'echobench_ok' }))
  await assert.rejects(() => target.restore(marker), /Unsafe identifier/)
})

test('the schema check names the columns that are missing, so a wrong guess is found before a run', async () => {
  const have = { order: ['order_id', 'integration_order_id', 'payment_status'], payment_transaction: ['payment_transaction_order_id', 'transaction_id', 'payment_action', 'amount'], shipment: ['shipment_order_id'] }
  const { module } = fakePg([{ match: /information_schema/, rows: [] }])
  const target = createEvershopTarget(lab, { pgModule: { Client: class extends module.Client {
    async query(sql, params) {
      if (/information_schema/.test(sql)) return { rows: (have[params[0]] || []).map((column_name) => ({ column_name })) }
      return super.query(sql, params)
    }
  } }, env })
  const result = await target.checkSchema()
  assert.equal(result.ok, false)
  assert.deepEqual(result.missing, ['order.shipment_status'])
})

const pgInstalled = await import('pg').then(() => true, () => false)

test('without the pg package the target says what to install instead of crashing', { skip: pgInstalled && 'pg is installed here (R1 run), so the missing-package path cannot be exercised' }, async () => {
  const target = createEvershopTarget(lab, { env })
  await assert.rejects(() => target.readState('X'), /npm install pg|"pg" package/)
})

test('EverShop reports no return path, refund entry or dispute hold, so those scenarios say n/a instead of guessing', () => {
  const target = createEvershopTarget(lab, { pgModule: fakePg([]).module, env })
  assert.deepEqual(target.capabilities, { returnPath: false, disputes: false, refunds: false, reset: true, shipsByHand: true })
})

test('a shop that ships by hand passes I1 when the one capture is booked once, and fails when a webhook ships it', async () => {
  const { evaluate } = await import('../server/oracle.js')
  const ledger = { captures: [{ id: 'CAP1', amount: '12.00' }], refunds: [] }
  const base = { exists: true, status: 'paypal_captured', on_hold: false, shipments: [], refunds: [], processed_event_ids: [] }
  const booked = evaluate(['I1', 'I4'], { expect: {}, ledger, shipsByHand: true, after: { ...base, fulfilled_count: 0, captures: [{ id: 'CAP1', amount: '12.00' }] } })
  assert.deepEqual(booked.map((v) => v.status), ['pass', 'pass'])
  const missing = evaluate(['I1'], { expect: {}, ledger, shipsByHand: true, after: { ...base, fulfilled_count: 0, captures: [] } })
  assert.equal(missing[0].status, 'fail')
  const shipped = evaluate(['I1'], { expect: {}, ledger, shipsByHand: true, after: { ...base, fulfilled_count: 1, captures: [{ id: 'CAP1', amount: '12.00' }] } })
  assert.equal(shipped[0].status, 'fail')
})
