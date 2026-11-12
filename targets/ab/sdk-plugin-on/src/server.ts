import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { openDb } from "./db.js";
import { buildClient, loadConfig, makeRaw, HttpFailure } from "./paypal.js";
import { Shop } from "./shop.js";

const cfg = loadConfig();
const db = openDb(cfg.dataPath);
const shop = new Shop(db, buildClient(cfg));
const verifyWebhook = makeRaw(cfg);
const adapter = process.env.ECHOBENCH_ADAPTER === "1" || ["mock", "sandbox"].includes(process.env.PAYPAL_ENV ?? "");

function send(res: http.ServerResponse, status: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(s) });
  res.end(s);
}
async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
function parseJson(s: string): any {
  try { return s ? JSON.parse(s) : {}; } catch { throw new HttpFailure(400, "Body must be valid JSON."); }
}
function sendResult(res: http.ServerResponse, r: any) {
  if (r && typeof r.status === "number" && r.body !== undefined) send(res, r.status, r.body);
  else send(res, 200, r);
}

async function route(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const m = req.method ?? "GET";
  const p = url.pathname;

  if (m === "GET" && p === "/health") return send(res, 200, { ok: true });

  if (m === "POST" && p === "/checkout") {
    const base = process.env.PUBLIC_BASE_URL ?? `http://${req.headers.host ?? `localhost:${cfg.port}`}`;
    return send(res, 200, await shop.createCheckout(parseJson(await readBody(req)), base.replace(/\/+$/, "")));
  }
  if (m === "GET" && p === "/checkout/return") {
    const token = url.searchParams.get("token");
    if (!token) throw new HttpFailure(400, "token is required.");
    return sendResult(res, await shop.captureOnReturn(token));
  }
  if (m === "GET" && p === "/checkout/cancel") return send(res, 200, { status: "cancelled" });

  if (m === "POST" && p === "/webhooks/paypal") {
    const event = parseJson(await readBody(req));
    let ok: boolean;
    try { ok = await verifyWebhook(req.headers, event); }
    catch (e) { console.error("webhook verification unavailable:", (e as Error).message); return send(res, 503, { error: "cannot verify webhook right now" }); }
    if (!ok) return send(res, 400, { error: "invalid webhook signature" });
    const r = shop.handleEvent(event);
    return send(res, 200, r);
  }

  if (m === "POST" && (p === "/admin/refund" || p === "/support/refund")) {
    const b = parseJson(await readBody(req));
    return sendResult(res, await shop.refund(b.orderId, b.amount, b.refundRef));
  }

  if (adapter && m === "GET" && p === "/__echobench/state") {
    return send(res, 200, shop.state(url.searchParams.get("paypal_order_id") ?? ""));
  }
  if (adapter && m === "POST" && p === "/__echobench/snapshot") {
    const b = parseJson(await readBody(req));
    if (typeof b.to !== "string" || !b.to) throw new HttpFailure(400, "to is required.");
    const dir = process.env.SNAPSHOT_DIR ? path.resolve(process.env.SNAPSHOT_DIR) : undefined;
    const target = dir ? path.resolve(dir, b.to) : path.resolve(b.to);
    if (dir && target !== dir && !target.startsWith(dir + path.sep)) throw new HttpFailure(400, "to must be inside SNAPSHOT_DIR.");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.rmSync(target, { force: true });
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    return send(res, 200, { ok: true, path: target });
  }

  send(res, 404, { error: "not found" });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    if (e instanceof HttpFailure) {
      if (e.status >= 500 || e.cause) console.error(`${req.method} ${req.url} -> ${e.status}`, e.cause ?? e.message);
      return send(res, e.status, { error: e.reason });
    }
    console.error("unexpected", e);
    send(res, 500, { error: "Unexpected error." });
  });
});
server.listen(cfg.port, () => console.log(`listening on ${cfg.port}`));
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { server.close(); db.close(); process.exit(0); });
