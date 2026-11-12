import { ApiError, PaypalError } from "paypal";
import { db, tx, toCents, fromCents } from "./db.js";
import { client } from "./paypal.js";

type Json = Record<string, any>;
export class RefundError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

/** Shared by /admin/refund and /support/refund: partial refund of a captured payment. */
export async function refund(body: Json, source: string) {
  const { orderId, amount, refundRef } = body;
  if (typeof orderId !== "string" || typeof refundRef !== "string" || !refundRef || refundRef.length > 128)
    throw new RefundError(400, "orderId and refundRef required");
  const cents = typeof amount === "string" ? toCents(amount) : null;
  if (cents === null || cents <= 0) throw new RefundError(400, "amount must be a positive decimal string like \"4.00\"");

  // Reserve atomically (refunds in flight count against the captured total).
  const resv = tx(() => {
    const prior = db.prepare("SELECT * FROM refunds WHERE ref=?").get(refundRef) as Json | undefined;
    if (prior) {
      if (prior.paypal_order_id !== orderId || prior.amount_cents !== cents) throw new RefundError(409, "refundRef reused with different parameters");
      return { cap: { id: prior.capture_id }, prior };
    }
    const cap = db.prepare("SELECT id,amount_cents FROM captures WHERE paypal_order_id=? AND status IN ('COMPLETED','PARTIALLY_REFUNDED') ORDER BY rowid LIMIT 1").get(orderId) as Json | undefined;
    if (!cap) throw new RefundError(404, "no captured payment for order");
    const used = (db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS s FROM refunds WHERE capture_id=?").get(cap.id) as Json).s as number;
    if (used + cents > cap.amount_cents)
      throw new RefundError(422, `refund exceeds captured amount (refundable ${fromCents(cap.amount_cents - used)})`);
    db.prepare("INSERT INTO refunds(ref,paypal_order_id,capture_id,amount_cents,status,source) VALUES(?,?,?,?,'PENDING_LOCAL',?)")
      .run(refundRef, orderId, cap.id, cents, source);
    return { cap, prior: undefined };
  });
  if (resv.prior && resv.prior.status !== "PENDING_LOCAL")
    return { orderId, refundId: resv.prior.id, amount: fromCents(cents), refundRef, status: resv.prior.status, replayed: true };

  try {
    const r = await client.payments.refundCapturedPayment({
      captureId: resv.cap.id,
      payPalRequestId: `refund-${refundRef}`, // same ref => PayPal dedupes
      prefer: "return=representation",
      body: { amount: { currencyCode: "USD", value: fromCents(cents) }, invoiceId: undefined, noteToPayer: undefined },
    });
    const status = String(r.status ?? "COMPLETED");
    db.prepare("UPDATE refunds SET id=?, status=? WHERE ref=?").run(r.id ?? null, status, refundRef);
    return { orderId, refundId: r.id, amount: fromCents(cents), refundRef, status };
  } catch (e) {
    if (e instanceof ApiError) {
      db.prepare("DELETE FROM refunds WHERE ref=? AND status='PENDING_LOCAL'").run(refundRef); // definite rejection
      throw new RefundError(e.status === 422 || e.status === 409 ? 422 : 502, `PayPal rejected refund (${e.status})`);
    }
    // ambiguous (timeout/connection): keep reservation; retry with same refundRef is safe
    if (e instanceof PaypalError) throw new RefundError(502, "PayPal unreachable; retry with the same refundRef");
    throw e;
  }
}
