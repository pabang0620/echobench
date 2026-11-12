import { DatabaseSync } from 'node:sqlite'
import { config } from './config.ts'

export type Db = DatabaseSync

export function openDb(path: string = config.dataPath): Db {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = DELETE')
  db.exec('PRAGMA busy_timeout = 3000')
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      paypal_order_id TEXT PRIMARY KEY,
      sku TEXT NOT NULL,
      amount TEXT NOT NULL,
      status TEXT NOT NULL,
      on_hold INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS captures (
      paypal_capture_id TEXT PRIMARY KEY,
      paypal_order_id TEXT NOT NULL,
      amount TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paypal_order_id TEXT NOT NULL,
      at_event TEXT NOT NULL,
      capture_recorded INTEGER NOT NULL,
      shipped_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS refunds (
      paypal_refund_id TEXT NOT NULL UNIQUE,
      paypal_order_id TEXT NOT NULL,
      amount TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS refund_claims (
      request_key TEXT PRIMARY KEY,
      paypal_order_id TEXT NOT NULL,
      amount TEXT NOT NULL,
      paypal_request_id TEXT NOT NULL,
      state TEXT NOT NULL,
      paypal_refund_id TEXT
    );
    CREATE TABLE IF NOT EXISTS refund_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paypal_order_id TEXT NOT NULL,
      path TEXT NOT NULL,
      outcome TEXT NOT NULL,
      detail TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS processed_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      received_at TEXT NOT NULL
    );
  `)
  return db
}

export type Row = Record<string, string | number | null>

export function all(db: Db, sql: string, ...params: Array<string | number | null>): Row[] {
  return db.prepare(sql).all(...params) as Row[]
}

export function one(db: Db, sql: string, ...params: Array<string | number | null>): Row | undefined {
  return db.prepare(sql).get(...params) as Row | undefined
}

export function run(db: Db, sql: string, ...params: Array<string | number | null>): number {
  return Number(db.prepare(sql).run(...params).changes)
}

export function inTransaction<T>(db: Db, work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// Writes one shipment row. Callers decide whether shipping is allowed.
export function shipOrder(db: Db, orderId: string, atEvent: string): void {
  const captured = one(db, 'SELECT 1 AS found FROM captures WHERE paypal_order_id = ?', orderId)
  run(
    db,
    'INSERT INTO shipments (paypal_order_id, at_event, capture_recorded, shipped_at) VALUES (?, ?, ?, ?)',
    orderId,
    atEvent,
    captured ? 1 : 0,
    new Date().toISOString(),
  )
}
