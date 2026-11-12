import express from "express";
import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

const PORT = Number(process.env.PORT || 3000);
const PP = (process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com").replace(/\/+$/, "");
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || "";
const DATA_PATH = process.env.DATA_PATH || "./data.sqlite";
const ADAPTER =
  process.env.ECHOBENCH_ADAPTER === "1" || ["mock", "sandbox"].includes(process.env.PAYPAL_ENV || "");

const SKU = "MUG-001";
const PRICE_CENTS = 1200;
const CUR = "USD";

const db = new Database(DATA_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.exec(`
CREATE TABLE IF NOT EXISTS orders(
  id TEXT PRIMARY KEY, sku TEXT, quantity INTEGER, amount_cents INTEGER,
  status TEXT NOT NULL, on_hold INTEGER NOT NULL DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS captures(
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS refunds(
  ref TEXT PRIMARY KEY, order_id TEXT NOT NULL, capture_id TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  paypal_id TEXT, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS shipments(
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL UNIQUE, at_event TEXT, capture_recorded INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events(
  id TEXT PRIMARY KEY, order_id TEXT, type TEXT);
`);

const cents = (s: string) => Math.round(parseFloat(s) * 100);
const money = (c: number) => (c / 100).toFixed(2);
const validMoney = (s: unknown): s is string => typeof s === "string" && /^\d{1,9}(\.\d{1,2})?$/.test(s);

// ---- PayPal client ----
let token: { v: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (token && token.exp > Date.now() + 30000) return token.v;
  const r = await fetch(`${PP}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`paypal auth ${r.status}`);
  const j: any = await r.json();
  token = { v: j.access_token, exp: Date.now() + (j.expires_in || 300) * 1000 };
  return token.v;
}
async function pp(method: string, p: string, body?: unknown, requestId?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    "Content-Type": "application/json",
  };
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  const r = await fetch(PP + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: r.ok, status: r.status, json };
}

// ---- per-key mutex (serialise async work per order) ----
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  locks.set(key, run);
  try { return await run; } finally { if (locks.get(key) === run) locks.delete(key); }
}

// ---- DB helpers ----
const getOrder = (id: string): any => db.prepare("SELECT * FROM orders WHERE id=?").get(id);
const capturedCents = (orderId: string) =>
  (db.prepare("SELECT COALESCE(SUM(amount_cents),0) s FROM captures WHERE order_id=? AND status='COMPLETED'").get(orderId) as any).s as number;

function recordCapture(orderId: string, c: any) {
  const status = String(c.status || "COMPLETED").toUpperCase();
  db.prepare(
    "INSERT INTO captures(id,order_id,amount_cents,status) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, amount_cents=excluded.amount_cents"
  ).run(c.id, orderId, cents(c.amount?.value ?? "0"), status);
  applyCaptureStatus(orderId, status);
}
function applyCaptureStatus(orderId: string, status: string) {
  if (status === "COMPLETED") db.prepare("UPDATE orders SET status='COMPLETED', on_hold=0 WHERE id=?").run(orderId);
  else if (status === "PENDING") db.prepare("UPDATE orders SET status='PENDING', on_hold=1 WHERE id=?").run(orderId);
  else if (["DECLINED", "DENIED", "FAILED"].includes(status)) db.prepare("UPDATE orders SET status='DENIED', on_hold=0 WHERE id=?").run(orderId);
  else if (status === "REVERSED") db.prepare("UPDATE orders SET status='REVERSED', on_hold=0 WHERE id=?").run(orderId);
}

const app = express();
app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf.toString("utf8"); } }));

app.get("/health", (_req, res) => { res.json({ ok: true }); });

// ---- checkout ----
app.post("/checkout", async (req, res) => {
  try {
    const { sku, quantity } = req.body || {};
    const qty = quantity === undefined ? 1 : quantity;
    if (sku !== SKU) return res.status(400).json({ error: "unknown sku" });
    if (!Number.isInteger(qty) || qty < 1 || qty > 100) return res.status(400).json({ error: "invalid quantity" });
    const total = PRICE_CENTS * qty;
    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const r = await pp("POST", "/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: SKU,
        custom_id: SKU,
        amount: { currency_code: CUR, value: money(total),
          breakdown: { item_total: { currency_code: CUR, value: money(total) } } },
        items: [{ name: "Mug", sku: SKU, quantity: String(qty), unit_amount: { currency_code: CUR, value: money(PRICE_CENTS) } }],
      }],
      payment_source: { paypal: { experience_context: {
        return_url: `${base}/checkout/return`, cancel_url: `${base}/checkout/cancel`, user_action: "PAY_NOW" } } },
    }, crypto.randomUUID());
    if (!r.ok || !r.json?.id) return res.status(502).json({ error: "paypal create failed", status: r.status });
    const links: any[] = r.json.links || [];
    const approve = links.find((l) => l.rel === "payer-action") || links.find((l) => l.rel === "approve");
    db.prepare("INSERT OR IGNORE INTO orders(id,sku,quantity,amount_cents,status,created_at) VALUES(?,?,?,?,?,?)")
      .run(r.json.id, SKU, qty, total, "CREATED", new Date().toISOString());
    res.json({ orderId: r.json.id, amount: money(total), approveUrl: approve?.href });
  } catch (e: any) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.get("/checkout/cancel", (_req, res) => { res.json({ status: "cancelled" }); });

app.get("/checkout/return", async (req, res) => {
  const orderId = String(req.query.token || "");
  if (!orderId) return res.status(400).json({ error: "missing token" });
  const o = getOrder(orderId);
  if (!o) return res.status(404).json({ error: "unknown order" });
  try {
    const out = await withLock(orderId, async () => {
      const cur = getOrder(orderId);
      if (db.prepare("SELECT 1 FROM captures WHERE order_id=?").get(orderId)) return cur;
      let r = await pp("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, `capture-${orderId}`);
      if (!r.ok) r = await pp("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
      if (!r.ok) throw new Error(`paypal capture failed ${r.status}`);
      const caps: any[] = r.json?.purchase_units?.[0]?.payments?.captures || [];
      db.transaction(() => { for (const c of caps) recordCapture(orderId, c); })();
      return getOrder(orderId);
    });
    const caps = db.prepare("SELECT id,amount_cents,status FROM captures WHERE order_id=?").all(orderId) as any[];
    if (!caps.length) return res.status(402).json({ orderId, status: out.status, error: "payment not captured" });
    res.json({ orderId, status: out.status, on_hold: !!out.on_hold,
      captures: caps.map((c) => ({ id: c.id, amount: money(c.amount_cents), status: c.status })) });
  } catch (e: any) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// ---- webhook ----
async function verifyWebhook(req: any): Promise<boolean> {
  const h = (n: string) => String(req.get(n) || "");
  if (!WEBHOOK_ID || !req.rawBody) return false;
  const body = `{"auth_algo":${JSON.stringify(h("paypal-auth-algo"))},"cert_url":${JSON.stringify(h("paypal-cert-url"))},` +
    `"transmission_id":${JSON.stringify(h("paypal-transmission-id"))},"transmission_sig":${JSON.stringify(h("paypal-transmission-sig"))},` +
    `"transmission_time":${JSON.stringify(h("paypal-transmission-time"))},"webhook_id":${JSON.stringify(WEBHOOK_ID)},"webhook_event":${req.rawBody}}`;
  const r = await fetch(`${PP}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body,
  });
  if (!r.ok) return false;
  const j: any = await r.json();
  return j.verification_status === "SUCCESS";
}

function handleEvent(ev: any) {
  const type: string = ev.type;
  const res = ev.resource || {};
  let orderId: string | null =
    res.supplementary_data?.related_ids?.order_id || null;
  if (!orderId && type.startsWith("PAYMENT.CAPTURE.")) {
    const row: any = db.prepare("SELECT order_id FROM captures WHERE id=?").get(res.id);
    if (row) orderId = row.order_id;
  }
  if (!orderId && type.startsWith("CHECKOUT.ORDER.")) orderId = res.id || null;
  if (!orderId || !getOrder(orderId)) return { handled: false };

  db.transaction(() => {
    const ins = db.prepare("INSERT OR IGNORE INTO events(id,order_id,type) VALUES(?,?,?)").run(ev.id, orderId, type);
    if (ins.changes === 0) return; // duplicate delivery
    if (type === "PAYMENT.CAPTURE.COMPLETED" || type === "PAYMENT.CAPTURE.PENDING") {
      const existing: any = db.prepare("SELECT status FROM captures WHERE id=?").get(res.id);
      // never downgrade a completed capture because of an out-of-order PENDING
      if (!(existing?.status === "COMPLETED" && type === "PAYMENT.CAPTURE.PENDING")) {
        recordCapture(orderId!, { id: res.id, amount: res.amount, status: type.endsWith("COMPLETED") ? "COMPLETED" : "PENDING" });
      }
      const o = getOrder(orderId!);
      if (!o.on_hold && capturedCents(orderId!) > 0) {
        db.prepare("INSERT OR IGNORE INTO shipments(order_id,at_event,capture_recorded) VALUES(?,?,1)").run(orderId, ev.id);
      }
    } else if (type === "PAYMENT.CAPTURE.DENIED" || type === "PAYMENT.CAPTURE.DECLINED" || type === "PAYMENT.CAPTURE.REVERSED") {
      const st = type.endsWith("REVERSED") ? "REVERSED" : "DENIED";
      db.prepare("UPDATE captures SET status=? WHERE id=?").run(st, res.id);
      applyCaptureStatus(orderId!, st);
    } else if (type === "PAYMENT.CAPTURE.REFUNDED") {
      const rid = res.id;
      if (rid && !db.prepare("SELECT 1 FROM refunds WHERE paypal_id=?").get(rid)) {
        const capId = db.prepare("SELECT id FROM captures WHERE order_id=? LIMIT 1").get(orderId) as any;
        db.prepare("INSERT OR IGNORE INTO refunds(ref,order_id,capture_id,amount_cents,paypal_id,status) VALUES(?,?,?,?,?,'COMPLETED')")
          .run(`pp-${rid}`, orderId, capId?.id || "", cents(res.amount?.value ?? "0"), rid);
      }
    }
  })();
  return { handled: true };
}

app.post("/webhooks/paypal", async (req: any, res) => {
  try {
    if (!(await verifyWebhook(req))) return res.status(400).json({ error: "invalid signature" });
  } catch {
    return res.status(503).json({ error: "verification unavailable" });
  }
  const ev = req.body;
  if (!ev || typeof ev.id !== "string" || typeof ev.event_type !== "string" && typeof ev.type !== "string")
    return res.status(400).json({ error: "bad event" });
  ev.type = ev.event_type || ev.type;
  try {
    handleEvent(ev);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---- refunds ----
async function refund(req: express.Request, res: express.Response) {
  const { orderId, amount, refundRef } = req.body || {};
  if (typeof orderId !== "string" || !orderId || typeof refundRef !== "string" || !refundRef)
    return res.status(400).json({ error: "orderId and refundRef required" });
  if (!validMoney(amount) || cents(amount) <= 0) return res.status(400).json({ error: "invalid amount" });
  const amt = cents(amount);
  if (!getOrder(orderId)) return res.status(404).json({ error: "unknown order" });
  try {
    const out = await withLock(orderId, async () => {
      const existing: any = db.prepare("SELECT * FROM refunds WHERE ref=?").get(refundRef);
      if (existing) {
        if (existing.order_id !== orderId || existing.amount_cents !== amt)
          return { code: 409, body: { error: "refundRef reused with different parameters" } };
        if (existing.status !== "FAILED")
          return { code: 200, body: { orderId, refundRef, refundId: existing.paypal_id, amount: money(amt), status: existing.status, duplicate: true } };
        db.prepare("DELETE FROM refunds WHERE ref=?").run(refundRef);
      }
      const caps = db.prepare("SELECT id,amount_cents FROM captures WHERE order_id=? AND status='COMPLETED'").all(orderId) as any[];
      if (!caps.length) return { code: 409, body: { error: "no completed capture" } };
      let target: any = null;
      for (const c of caps) {
        const used = (db.prepare("SELECT COALESCE(SUM(amount_cents),0) s FROM refunds WHERE capture_id=? AND status!='FAILED'").get(c.id) as any).s;
        if (c.amount_cents - used >= amt) { target = c; break; }
      }
      if (!target) return { code: 422, body: { error: "refund exceeds remaining captured amount" } };
      db.prepare("INSERT INTO refunds(ref,order_id,capture_id,amount_cents,status) VALUES(?,?,?,?,'PENDING')")
        .run(refundRef, orderId, target.id, amt);
      let r;
      try {
        r = await pp("POST", `/v2/payments/captures/${encodeURIComponent(target.id)}/refund`,
          { amount: { currency_code: CUR, value: money(amt) } }, `refund-${refundRef}`);
      } catch (e) {
        // outcome unknown: keep PENDING reservation so we never over-refund; retry with same ref is safe
        return { code: 502, body: { error: "paypal unreachable; refund pending", refundRef } };
      }
      if (!r.ok) {
        if (r.status >= 500) return { code: 502, body: { error: "paypal error; refund pending", refundRef } };
        db.prepare("UPDATE refunds SET status='FAILED' WHERE ref=?").run(refundRef);
        return { code: 422, body: { error: "paypal refused refund", detail: r.json } };
      }
      const st = String(r.json?.status || "COMPLETED").toUpperCase();
      db.prepare("UPDATE refunds SET paypal_id=?, status=? WHERE ref=?").run(r.json?.id, st === "CANCELLED" || st === "FAILED" ? "FAILED" : st, refundRef);
      return { code: 200, body: { orderId, refundRef, refundId: r.json?.id, amount: money(amt), status: st } };
    });
    res.status(out.code).json(out.body);
  } catch (e: any) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
app.post("/admin/refund", refund);
app.post("/support/refund", refund);

// ---- echobench adapter ----
if (ADAPTER) {
  app.get("/__echobench/state", (req, res) => {
    const id = String(req.query.paypal_order_id || "");
    const o = getOrder(id);
    if (!o) return res.json({ exists: false, status: null, on_hold: false, fulfilled_count: 0, shipments: [], captures: [], refunds: [], processed_event_ids: [] });
    const ships = db.prepare("SELECT id,at_event,capture_recorded FROM shipments WHERE order_id=? ORDER BY id").all(id) as any[];
    const caps = db.prepare("SELECT id,amount_cents FROM captures WHERE order_id=?").all(id) as any[];
    const refs = db.prepare("SELECT ref,paypal_id,amount_cents FROM refunds WHERE order_id=? AND status!='FAILED'").all(id) as any[];
    const evs = db.prepare("SELECT id FROM events WHERE order_id=?").all(id) as any[];
    res.json({
      exists: true, status: o.status, on_hold: !!o.on_hold, fulfilled_count: ships.length,
      shipments: ships.map((s) => ({ id: String(s.id), at_event: s.at_event, capture_recorded: !!s.capture_recorded })),
      captures: caps.map((c) => ({ id: c.id, amount: money(c.amount_cents) })),
      refunds: refs.map((r) => ({ id: r.paypal_id || r.ref, amount: money(r.amount_cents) })),
      processed_event_ids: evs.map((e) => e.id),
    });
  });
  app.post("/__echobench/snapshot", (req, res) => {
    try {
      const dir = process.env.SNAPSHOT_DIR;
      const to = req.body?.to;
      if (!dir || typeof to !== "string") return res.status(400).json({ error: "SNAPSHOT_DIR and to required" });
      const root = path.resolve(dir);
      const dest = path.resolve(root, to);
      if (dest !== root && !dest.startsWith(root + path.sep)) return res.status(400).json({ error: "path outside SNAPSHOT_DIR" });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      db.prepare("VACUUM INTO ?").run(dest);
      res.json({ ok: true, path: dest });
    } catch (e: any) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });
}

app.listen(PORT, () => console.log(`listening on ${PORT}`));
