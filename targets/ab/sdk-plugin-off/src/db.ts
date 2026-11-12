import { DatabaseSync } from "node:sqlite";

export const db = new DatabaseSync(process.env.DATA_PATH ?? "./data.sqlite");
db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS orders(
  paypal_order_id TEXT PRIMARY KEY, sku TEXT NOT NULL, quantity INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL,
  on_hold INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS captures(
  id TEXT PRIMARY KEY, paypal_order_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS refunds(
  ref TEXT PRIMARY KEY, id TEXT, paypal_order_id TEXT NOT NULL, capture_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, status TEXT NOT NULL, source TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS refunds_id ON refunds(id) WHERE id IS NOT NULL;
CREATE TABLE IF NOT EXISTS shipments(
  id INTEGER PRIMARY KEY AUTOINCREMENT, paypal_order_id TEXT NOT NULL UNIQUE,
  at_event TEXT, capture_recorded INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events(event_id TEXT PRIMARY KEY);
`);

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

export const toCents = (v: string): number | null =>
  /^\d{1,9}\.\d{2}$/.test(v) ? Number(v.replace(".", "")) : null;
export const fromCents = (c: number): string => (c / 100).toFixed(2);
