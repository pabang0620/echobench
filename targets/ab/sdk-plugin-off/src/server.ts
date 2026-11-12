import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { PaypalError, ApiError } from "paypal";
import { db, tx, toCents, fromCents } from "./db.js";
import { client, verifyWebhook } from "./paypal.js";
import { refund, RefundError } from "./refund.js";
import { recordCapture, applyCaptureEvent, ship } from "./orders.js";

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;
const PRICE_CENTS = 1200;
const adapter = process.env.ECHOBENCH_ADAPTER === "1" || ["mock", "sandbox"].includes(process.env.PAYPAL_ENV ?? "");

type Json = Record<string, any>;
const send = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
async function readBody(req: http.IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 1_000_000) throw new RefundError(413, "body too large"); chunks.push(c); }
  if (!chunks.length) return {};
  try { const v = JSON.parse(Buffer.concat(chunks).toString("utf8")); return v && typeof v === "object" ? v : {}; }
  catch { throw new RefundError(400, "invalid JSON"); }
}
function authorized(req: http.IncomingMessage, envName: string): boolean {
  const want = process.env[envName];
  if (!want) return true; // not configured: open (local/test use)
  return req.headers.authorization === `Bearer ${want}`;
}

async function checkout(body: Json) {
  const qty = body.quantity ?? 1;
  if (body.sku !== "MUG-001") throw new RefundError(400, "unknown sku");
  if (!Number.isInteger(qty) || qty < 1 || qty > 100) throw new RefundError(400, "invalid quantity");
  const cents = PRICE_CENTS * qty;
  const value = fromCents(cents);
  const order = await client.orders.createOrder({
    prefer: "return=representation",
    body: {
      intent: "CAPTURE",
      purchaseUnits: [{
        referenceId: "MUG-001",
        description: "Mug",
        amount: { currencyCode: "USD", value, breakdown: { itemTotal: { currencyCode: "USD", value } } },
        items: [{ name: "Mug", sku: "MUG-001", quantity: String(qty), unitAmount: { currencyCode: "USD", value: "12.00" } }],
      }],
      applicationContext: { returnUrl: `${PUBLIC_URL}/checkout/return`, cancelUrl: `${PUBLIC_URL}/checkout/cancel`, userAction: "PAY_NOW" },
    },
  });
  const link = order.links?.find((l) => l.rel === "payer-action") ?? order.links?.find((l) => l.rel === "approve");
  if (!order.id || !link) throw new RefundError(502, "PayPal returned no approve link");
  db.prepare("INSERT OR IGNORE INTO orders(paypal_order_id,sku,quantity,amount_cents,currency,status) VALUES(?,?,?,?,?,?)")
    .run(order.id, "MUG-001", qty, cents, "USD", "CREATED");
  return { orderId: order.id, amount: value, approveUrl: link.href };
}

async function checkoutReturn(orderId: string) {
  const row = db.prepare("SELECT * FROM orders WHERE paypal_order_id=?").get(orderId) as Json | undefined;
  if (!row) throw new RefundError(404, "unknown order");
  let order;
  try {
    // Request-Id makes the capture idempotent across double-clicks / reloads.
    order = await client.orders.captureOrder({ id: orderId, payPalRequestId: `capture-${orderId}`, prefer: "return=representation" });
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) {
      order = await client.orders.getOrder({ id: orderId }); // already captured: reconcile
    } else throw e;
  }
  const caps = order.purchaseUnits?.flatMap((u) => u.payments?.captures ?? []) ?? [];
  tx(() => {
    for (const c of caps) {
      const cents = toCents(c.amount?.value ?? "");
      if (c.id && cents !== null) recordCapture(orderId, c.id, cents, String(c.status ?? "COMPLETED"));
    }
    db.prepare("UPDATE orders SET status=? WHERE paypal_order_id=? AND status<>'COMPLETED'").run(String(order.status ?? "CREATED"), orderId);
  });
  const o = db.prepare("SELECT status,on_hold FROM orders WHERE paypal_order_id=?").get(orderId) as Json;
  return { orderId, status: o.status, onHold: !!o.on_hold, captures: caps.map((c) => ({ id: c.id, amount: c.amount?.value, status: c.status })) };
}

async function webhook(req: http.IncomingMessage, res: http.ServerResponse) {
  const ev = await readBody(req);
  let ok: boolean;
  try { ok = await verifyWebhook(req.headers, ev); }
  catch (e) { console.error("webhook verify failed", e); return send(res, 503, { error: "verification unavailable" }); }
  if (!ok) return send(res, 400, { error: "bad signature" });
  const id = ev.id, type = ev.event_type, r = ev.resource ?? {};
  if (typeof id !== "string" || typeof type !== "string") return send(res, 400, { error: "malformed event" });
  const result = tx(() => {
    if (db.prepare("SELECT 1 FROM events WHERE event_id=?").get(id)) return "duplicate";
    const done = applyCaptureEvent(id, type, r);
    if (done) db.prepare("INSERT INTO events(event_id) VALUES(?)").run(id);
    return done ? "processed" : "deferred";
  });
  // deferred (order not known yet): non-2xx so PayPal redelivers later
  send(res, result === "deferred" ? 503 : 200, { result });
}

function state(orderId: string) {
  const o = db.prepare("SELECT * FROM orders WHERE paypal_order_id=?").get(orderId) as Json | undefined;
  const events = (db.prepare("SELECT event_id FROM events ORDER BY rowid").all() as Json[]).map((e) => e.event_id);
  if (!o) return { exists: false, status: null, on_hold: false, fulfilled_count: 0, shipments: [], captures: [], refunds: [], processed_event_ids: events };
  const ships = db.prepare("SELECT id,at_event,capture_recorded FROM shipments WHERE paypal_order_id=? ORDER BY id").all(orderId) as Json[];
  const caps = db.prepare("SELECT id,amount_cents FROM captures WHERE paypal_order_id=?").all(orderId) as Json[];
  const refs = db.prepare("SELECT id,ref,amount_cents FROM refunds WHERE paypal_order_id=? AND status<>'PENDING_LOCAL' ORDER BY rowid").all(orderId) as Json[];
  return {
    exists: true, status: o.status, on_hold: !!o.on_hold, fulfilled_count: ships.length,
    shipments: ships.map((s) => ({ id: s.id, at_event: s.at_event, capture_recorded: !!s.capture_recorded })),
    captures: caps.map((c) => ({ id: c.id, amount: fromCents(c.amount_cents) })),
    refunds: refs.map((r) => ({ id: r.id ?? r.ref, amount: fromCents(r.amount_cents) })),
    processed_event_ids: events,
  };
}

function snapshot(to: unknown) {
  const dir = process.env.SNAPSHOT_DIR;
  if (!dir || typeof to !== "string" || !to) throw new RefundError(400, "SNAPSHOT_DIR and `to` required");
  const root = path.resolve(dir);
  const target = path.resolve(root, to);
  if (!target.startsWith(root + path.sep)) throw new RefundError(400, "path outside SNAPSHOT_DIR");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { force: true });
  db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  db.prepare("VACUUM INTO ?").run(target);
  return { ok: true, path: target };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const route = `${req.method} ${url.pathname}`;
  try {
    switch (route) {
      case "GET /health": return send(res, 200, { ok: true });
      case "POST /checkout": return send(res, 200, await checkout(await readBody(req)));
      case "GET /checkout/return": {
        const t = url.searchParams.get("token");
        if (!t) return send(res, 400, { error: "token required" });
        return send(res, 200, await checkoutReturn(t));
      }
      case "GET /checkout/cancel": return send(res, 200, { status: "cancelled" });
      case "POST /webhooks/paypal": return await webhook(req, res);
      case "POST /admin/refund":
      case "POST /support/refund": {
        const who = url.pathname.startsWith("/admin") ? "admin" : "support";
        if (!authorized(req, who === "admin" ? "ADMIN_TOKEN" : "SUPPORT_TOKEN")) return send(res, 401, { error: "unauthorized" });
        return send(res, 200, await refund(await readBody(req), who));
      }
      case "GET /__echobench/state":
        if (!adapter) break;
        return send(res, 200, state(url.searchParams.get("paypal_order_id") ?? ""));
      case "POST /__echobench/snapshot":
        if (!adapter) break;
        return send(res, 200, snapshot((await readBody(req)).to));
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    if (e instanceof RefundError) return send(res, e.status, { error: e.message });
    if (e instanceof PaypalError) {
      console.error("paypal error", e.message);
      return send(res, 502, { error: "paypal_error", kind: e.kind, status: (e as any).status });
    }
    console.error(e);
    send(res, 500, { error: "internal" });
  }
});
server.listen(PORT, () => console.log(`listening on ${PORT}`));
