import { db, toCents } from "./db.js";

type Json = Record<string, any>;

export function recordCapture(orderId: string, capId: string, cents: number, status: string) {
  const ex = db.prepare("SELECT status FROM captures WHERE id=?").get(capId) as Json | undefined;
  if (!ex) db.prepare("INSERT INTO captures(id,paypal_order_id,amount_cents,status) VALUES(?,?,?,?)").run(capId, orderId, cents, status);
  else if (ex.status !== "COMPLETED") db.prepare("UPDATE captures SET status=? WHERE id=?").run(status, capId);
  syncOrder(orderId);
}

// Order status/hold derived from capture states.
function syncOrder(orderId: string) {
  const caps = db.prepare("SELECT status FROM captures WHERE paypal_order_id=?").all(orderId) as Json[];
  if (!caps.length) return;
  const bad = caps.some((c) => ["DENIED", "REVERSED", "DECLINED", "FAILED"].includes(c.status));
  const pending = caps.some((c) => c.status === "PENDING");
  const completed = caps.some((c) => ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(c.status));
  db.prepare("UPDATE orders SET on_hold=?, status=? WHERE paypal_order_id=?")
    .run(bad || pending ? 1 : 0, completed && !pending ? "COMPLETED" : pending ? "PENDING" : "CREATED", orderId);
}

export function ship(orderId: string, atEvent: string) {
  const o = db.prepare("SELECT on_hold FROM orders WHERE paypal_order_id=?").get(orderId) as Json;
  if (o.on_hold) return;
  const c = db.prepare("SELECT 1 FROM captures WHERE paypal_order_id=? AND status IN ('COMPLETED','PARTIALLY_REFUNDED')").get(orderId);
  if (!c) return;
  db.prepare("INSERT OR IGNORE INTO shipments(paypal_order_id,at_event,capture_recorded) VALUES(?,?,1)").run(orderId, atEvent);
}

/** Returns false when the event could not be applied yet (order unknown). Runs inside a transaction. */
export function applyCaptureEvent(eventId: string, type: string, r: Json): boolean {
  if (type.startsWith("PAYMENT.CAPTURE.")) {
    const isRefundEvt = type === "PAYMENT.CAPTURE.REFUNDED";
    if (isRefundEvt) {
      const up = String((r.links ?? []).find((l: Json) => l.rel === "up")?.href ?? "");
      const capId = up.split("/").pop() ?? "";
      const cap = db.prepare("SELECT paypal_order_id FROM captures WHERE id=?").get(capId) as Json | undefined;
      const cents = toCents(r.amount?.value ?? "");
      if (cap && r.id && cents !== null && !db.prepare("SELECT 1 FROM refunds WHERE id=?").get(r.id))
        db.prepare("INSERT INTO refunds(ref,id,paypal_order_id,capture_id,amount_cents,status,source) VALUES(?,?,?,?,?,?,?)")
          .run(`pp-${r.id}`, r.id, cap.paypal_order_id, capId, cents, "COMPLETED", "webhook");
      return true;
    }
    const orderId: string | undefined = r.supplementary_data?.related_ids?.order_id;
    if (!orderId || !r.id) return true; // nothing we can act on
    if (!db.prepare("SELECT 1 FROM orders WHERE paypal_order_id=?").get(orderId)) return false;
    const status = ({ "PAYMENT.CAPTURE.COMPLETED": "COMPLETED", "PAYMENT.CAPTURE.PENDING": "PENDING",
      "PAYMENT.CAPTURE.DENIED": "DENIED", "PAYMENT.CAPTURE.REVERSED": "REVERSED", "PAYMENT.CAPTURE.DECLINED": "DECLINED" } as Record<string, string>)[type];
    if (!status) return true;
    const cents = toCents(r.amount?.value ?? "");
    const known = db.prepare("SELECT amount_cents FROM captures WHERE id=?").get(r.id) as Json | undefined;
    if (!known && cents === null) return true;
    recordCapture(orderId, r.id, known?.amount_cents ?? cents!, status);
    if (status === "COMPLETED") ship(orderId, eventId);
    return true;
  }
  return true; // other events: acknowledged
}
