import { DatabaseSync } from "node:sqlite";

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY, sku TEXT NOT NULL, quantity INTEGER NOT NULL,
      amount TEXT NOT NULL, currency TEXT NOT NULL,
      status TEXT NOT NULL, on_hold INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS captures (
      capture_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, amount TEXT NOT NULL,
      currency TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS refunds (
      refund_ref TEXT PRIMARY KEY, order_id TEXT NOT NULL, capture_id TEXT NOT NULL,
      amount TEXT NOT NULL, currency TEXT NOT NULL,
      status TEXT NOT NULL, paypal_refund_id TEXT);
    CREATE TABLE IF NOT EXISTS shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL UNIQUE,
      at_event TEXT NOT NULL, capture_recorded INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS processed_events (
      event_id TEXT PRIMARY KEY, event_type TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  return db;
}

/** Run fn inside one write transaction (node:sqlite is synchronous, so this is atomic). */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function isUniqueViolation(e: unknown): boolean {
  const c = e as { code?: string; errcode?: number };
  return c?.code === "ERR_SQLITE_ERROR" && (c.errcode === 1555 || c.errcode === 2067 || c.errcode === 19);
}

export const toCents = (v: string): number => Math.round(Number(v) * 100);
export const fromCents = (c: number): string => (c / 100).toFixed(2);
