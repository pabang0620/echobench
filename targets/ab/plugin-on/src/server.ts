import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";

const PORT = Number(process.env.PORT || 3000);
const PAYPAL_BASE_URL = (process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com").replace(/\/+$/, "");
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || "";
const DATA_PATH = process.env.DATA_PATH || "./data.sqlite";
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const ADAPTER =
  process.env.ECHOBENCH_ADAPTER === "1" || ["mock", "sandbox"].includes(process.env.PAYPAL_ENV || "");

const SKU = "MUG-001";
const UNIT_CENTS = 1200;
const CURRENCY = "USD";

// ---------- money ----------
function parseCents(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0") || 0);
}
const fmt = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;

// ---------- db ----------
const db = new DatabaseSync(DATA_PATH);
db.exec(`
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS orders(
  id TEXT PRIMARY KEY, sku TEXT NOT NULL, quantity INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL, status TEXT NOT NULL, on_hold INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS captures(
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS refunds(
  ref TEXT PRIMARY KEY, order_id TEXT NOT NULL, capture_id TEXT NOT NULL,
  paypal_id TEXT, amount_cents INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS shipments(
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL UNIQUE,
  at_event TEXT, capture_recorded INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events(
  id TEXT PRIMARY KEY, order_id TEXT);
`);
const q = (sql: string) => db.prepare(sql);
function tx<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

// ---------- keyed mutex (serialises capture/refund per order) ----------
const chains = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}

// ---------- PayPal ----------
class HttpError extends Error {
  constructor(public status: number, public body: unknown) { super(`HTTP ${status}`); }
}
let token: { value: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (token && token.exp > Date.now() + 30_000) return token.value;
  const r = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new HttpError(r.status, j);
  token = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 300) * 1000 };
  return token.value;
}
async function pp(method: string, p: string, body?: unknown, requestId?: string): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    "Content-Type": "application/json",
  };
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  const r = await fetch(`${PAYPAL_BASE_URL}${p}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let j: any = {};
  try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  if (!r.ok) throw new HttpError(r.status, j);
  return j;
}

// ---------- http helpers ----------
function send(res: http.ServerResponse, status: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(s) });
  res.end(s);
}
async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > 1_000_000) throw new HttpError(413, "too large");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function readJson(req: http.IncomingMessage): Promise<any> {
  const t = await readBody(req);
  try { return t ? JSON.parse(t) : {}; } catch { throw new HttpError(400, "invalid json"); }
}

// ---------- order helpers ----------
type Order = { id: string; sku: string; quantity: number; amount_cents: number; status: string; on_hold: number };
const getOrder = (id: string) => q("SELECT * FROM orders WHERE id=?").get(id) as Order | undefined;

function recomputeStatus(orderId: string) {
  const o = getOrder(orderId)!;
  const cap = q("SELECT * FROM captures WHERE order_id=? ORDER BY rowid LIMIT 1").get(orderId) as any;
  if (!cap) return;
  const refunded = (q("SELECT COALESCE(SUM(amount_cents),0) s FROM refunds WHERE order_id=?").get(orderId) as any).s;
  let status: string, hold = 0;
  if (cap.status === "PENDING") { status = "PENDING"; hold = 1; }
  else if (cap.status === "COMPLETED") {
    status = refunded <= 0 ? "COMPLETED" : refunded >= cap.amount_cents ? "REFUNDED" : "PARTIALLY_REFUNDED";
  } else status = cap.status; // DENIED, DECLINED, REVERSED, ...
  if (o.status !== status || o.on_hold !== hold)
    q("UPDATE orders SET status=?, on_hold=? WHERE id=?").run(status, hold, orderId);
}

function recordCapture(orderId: string, capId: string, cents: number, status: string) {
  q("INSERT OR IGNORE INTO captures(id,order_id,amount_cents,status) VALUES(?,?,?,?)").run(capId, orderId, cents, status);
}

// ---------- handlers ----------
async function checkout(req: http.IncomingMessage, res: http.ServerResponse) {
  const b = await readJson(req);
  const qty = b.quantity === undefined ? 1 : b.quantity;
  if (b.sku !== SKU) return send(res, 400, { error: "unknown sku" });
  if (!Number.isInteger(qty) || qty < 1 || qty > 100) return send(res, 400, { error: "invalid quantity" });
  const cents = UNIT_CENTS * qty;
  const order = await pp("POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: SKU,
      amount: { currency_code: CURRENCY, value: fmt(cents) },
    }],
    payment_source: {
      paypal: { experience_context: {
        return_url: `${APP_BASE_URL}/checkout/return`,
        cancel_url: `${APP_BASE_URL}/checkout/cancel`,
        user_action: "PAY_NOW",
      } },
    },
  }, randomUUID());
  const links: any[] = order.links || [];
  const approve = links.find((l) => l.rel === "payer-action") || links.find((l) => l.rel === "approve");
  q("INSERT OR IGNORE INTO orders(id,sku,quantity,amount_cents,status,on_hold) VALUES(?,?,?,?,?,0)")
    .run(order.id, SKU, qty, cents, "CREATED");
  send(res, 200, { orderId: order.id, amount: fmt(cents), approveUrl: approve?.href });
}

async function checkoutReturn(url: URL, res: http.ServerResponse) {
  const id = url.searchParams.get("token");
  if (!id) return send(res, 400, { error: "missing token" });
  if (!getOrder(id)) return send(res, 404, { error: "unknown order" });
  await withLock(id, async () => {
    const existing = q("SELECT * FROM captures WHERE order_id=? LIMIT 1").get(id) as any;
    if (!existing) {
      let result: any;
      try {
        result = await pp("POST", `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, `capture-${id}`);
      } catch (e) {
        if (e instanceof HttpError) {
          // maybe already captured elsewhere; look at the order itself
          try { result = await pp("GET", `/v2/checkout/orders/${encodeURIComponent(id)}`); } catch { result = null; }
          const c = result?.purchase_units?.[0]?.payments?.captures?.[0];
          if (!c) return send(res, 502, { error: "capture failed", detail: e.body });
        } else throw e;
      }
      const c = result?.purchase_units?.[0]?.payments?.captures?.[0];
      if (!c) return send(res, 502, { error: "no capture in response", status: result?.status });
      const cents = parseCents(c.amount?.value);
      if (cents === null) return send(res, 502, { error: "bad capture amount" });
      tx(() => {
        recordCapture(id, c.id, cents, c.status);
        recomputeStatus(id);
      });
    }
    const o = getOrder(id)!;
    const caps = q("SELECT id, amount_cents FROM captures WHERE order_id=?").all(id) as any[];
    send(res, 200, {
      orderId: id, status: o.status, on_hold: !!o.on_hold,
      captures: caps.map((c) => ({ id: c.id, amount: fmt(c.amount_cents) })),
    });
  });
}

async function verifyWebhook(req: http.IncomingMessage, event: any): Promise<boolean> {
  const h = (n: string) => String(req.headers[n] || "");
  try {
    const r = await pp("POST", "/v1/notifications/verify-webhook-signature", {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: WEBHOOK_ID,
      webhook_event: event,
    });
    return r.verification_status === "SUCCESS";
  } catch { return false; }
}

async function webhook(req: http.IncomingMessage, res: http.ServerResponse) {
  const event = await readJson(req);
  if (!event || typeof event.id !== "string" || typeof event.event_type !== "string")
    return send(res, 400, { error: "bad event" });
  if (!(await verifyWebhook(req, event))) return send(res, 401, { error: "signature verification failed" });

  const r = event.resource || {};
  const orderId: string | undefined = r.supplementary_data?.related_ids?.order_id;
  const result = tx(() => {
    if (q("SELECT 1 FROM events WHERE id=?").get(event.id)) return { code: 200, body: { duplicate: true } };
    const type: string = event.event_type;
    if (!type.startsWith("PAYMENT.CAPTURE.") || type === "PAYMENT.CAPTURE.REFUNDED") {
      q("INSERT INTO events(id,order_id) VALUES(?,?)").run(event.id, orderId ?? null);
      return { code: 200, body: { ignored: true } };
    }
    const o = orderId ? getOrder(orderId) : undefined;
    if (!o) return { code: 404, body: { error: "unknown order, retry later" } }; // not recorded -> PayPal retries
    const cents = parseCents(r.amount?.value);
    const status = type.slice("PAYMENT.CAPTURE.".length); // COMPLETED, PENDING, DENIED, REVERSED...
    if (typeof r.id === "string" && cents !== null) {
      recordCapture(o.id, r.id, cents, status);
      q("UPDATE captures SET status=? WHERE id=?").run(status, r.id);
    }
    recomputeStatus(o.id);
    let shipped = false;
    if (status === "COMPLETED" && cents !== null && cents >= o.amount_cents && r.amount?.currency_code === CURRENCY) {
      const rec = q("SELECT 1 FROM captures WHERE id=?").get(r.id) ? 1 : 0;
      const ins = q("INSERT OR IGNORE INTO shipments(order_id,at_event,capture_recorded) VALUES(?,?,?)")
        .run(o.id, event.id, rec);
      shipped = Number(ins.changes) > 0;
    }
    q("INSERT INTO events(id,order_id) VALUES(?,?)").run(event.id, o.id);
    return { code: 200, body: { processed: true, shipped } };
  });
  send(res, result.code, result.body);
}

async function refund(req: http.IncomingMessage, res: http.ServerResponse) {
  const b = await readJson(req);
  const orderId = b.orderId, ref = b.refundRef;
  const cents = parseCents(b.amount);
  if (typeof orderId !== "string" || typeof ref !== "string" || !ref || ref.length > 100)
    return send(res, 400, { error: "orderId and refundRef required" });
  if (cents === null || cents <= 0) return send(res, 400, { error: "invalid amount" });
  if (!getOrder(orderId)) return send(res, 404, { error: "unknown order" });

  await withLock(orderId, async () => {
    const prior = q("SELECT * FROM refunds WHERE ref=?").get(ref) as any;
    if (prior) {
      if (prior.order_id !== orderId || prior.amount_cents !== cents)
        return send(res, 409, { error: "refundRef already used for a different refund" });
      return send(res, 200, { orderId, refundRef: ref, refundId: prior.paypal_id ?? ref, amount: fmt(prior.amount_cents), duplicate: true });
    }
    const cap = q("SELECT * FROM captures WHERE order_id=? AND status='COMPLETED' ORDER BY rowid LIMIT 1").get(orderId) as any;
    if (!cap) return send(res, 409, { error: "no completed capture to refund" });
    const refunded = (q("SELECT COALESCE(SUM(amount_cents),0) s FROM refunds WHERE order_id=?").get(orderId) as any).s;
    const remaining = cap.amount_cents - refunded;
    if (cents > remaining)
      return send(res, 422, { error: "refund exceeds remaining refundable amount", remaining: fmt(remaining) });
    // reserve first so the amount counts even if we crash mid-call
    q("INSERT INTO refunds(ref,order_id,capture_id,paypal_id,amount_cents) VALUES(?,?,?,NULL,?)").run(ref, orderId, cap.id, cents);
    let pr: any;
    try {
      pr = await pp("POST", `/v2/payments/captures/${encodeURIComponent(cap.id)}/refund`,
        { amount: { currency_code: CURRENCY, value: fmt(cents) } }, `refund-${ref}`);
    } catch (e) {
      q("DELETE FROM refunds WHERE ref=?").run(ref);
      if (e instanceof HttpError) return send(res, 502, { error: "refund failed", detail: e.body });
      throw e;
    }
    tx(() => {
      q("UPDATE refunds SET paypal_id=? WHERE ref=?").run(pr.id, ref);
      recomputeStatus(orderId);
    });
    send(res, 200, { orderId, refundRef: ref, refundId: pr.id, status: pr.status, amount: fmt(cents) });
  });
}

function state(url: URL, res: http.ServerResponse) {
  const id = url.searchParams.get("paypal_order_id") || "";
  const o = getOrder(id);
  if (!o) return send(res, 200, {
    exists: false, status: null, on_hold: false, fulfilled_count: 0,
    shipments: [], captures: [], refunds: [], processed_event_ids: [],
  });
  const ships = q("SELECT * FROM shipments WHERE order_id=? ORDER BY id").all(id) as any[];
  send(res, 200, {
    exists: true, status: o.status, on_hold: !!o.on_hold, fulfilled_count: ships.length,
    shipments: ships.map((s) => ({ id: String(s.id), at_event: s.at_event, capture_recorded: !!s.capture_recorded })),
    captures: (q("SELECT * FROM captures WHERE order_id=? ORDER BY rowid").all(id) as any[])
      .map((c) => ({ id: c.id, amount: fmt(c.amount_cents) })),
    refunds: (q("SELECT * FROM refunds WHERE order_id=? ORDER BY rowid").all(id) as any[])
      .map((r) => ({ id: r.paypal_id ?? r.ref, amount: fmt(r.amount_cents) })),
    processed_event_ids: (q("SELECT id FROM events WHERE order_id=? ORDER BY rowid").all(id) as any[]).map((e) => e.id),
  });
}

async function snapshot(req: http.IncomingMessage, res: http.ServerResponse) {
  const b = await readJson(req);
  if (typeof b.to !== "string" || !b.to) return send(res, 400, { error: "to required" });
  const dir = process.env.SNAPSHOT_DIR ? path.resolve(process.env.SNAPSHOT_DIR) : null;
  const target = dir ? path.resolve(dir, b.to) : path.resolve(b.to);
  if (dir && target !== dir && !target.startsWith(dir + path.sep))
    return send(res, 400, { error: "path outside SNAPSHOT_DIR" });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { force: true });
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  send(res, 200, { ok: true, path: target });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://x");
    const k = `${req.method} ${url.pathname}`;
    if (k === "GET /health") return send(res, 200, { ok: true });
    if (k === "POST /checkout") return await checkout(req, res);
    if (k === "GET /checkout/return") return await checkoutReturn(url, res);
    if (k === "GET /checkout/cancel") return send(res, 200, { cancelled: true });
    if (k === "POST /webhooks/paypal") return await webhook(req, res);
    if (k === "POST /admin/refund" || k === "POST /support/refund") return await refund(req, res);
    if (ADAPTER && k === "GET /__echobench/state") return state(url, res);
    if (ADAPTER && k === "POST /__echobench/snapshot") return await snapshot(req, res);
    send(res, 404, { error: "not found" });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status >= 400 && e.status < 500 ? e.status : 502, { error: "upstream or request error", detail: e.body });
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: "internal error" });
  }
});
server.listen(PORT, () => console.log(`listening on ${PORT}`));
