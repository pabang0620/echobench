import type { DatabaseSync } from "node:sqlite";
import type { PaypalClient, Order } from "paypal";
import { fromCents, isUniqueViolation, toCents, tx } from "./db.js";
import { HttpFailure, UnknownOutcome, translate } from "./paypal.js";

export const SKU = "MUG-001";
export const UNIT_CENTS = 1200;
export const CURRENCY = "USD";

type Row = Record<string, any>;

export class Shop {
  constructor(public db: DatabaseSync, public client: PaypalClient) {}

  getOrderRow(id: string): Row | undefined {
    return this.db.prepare("SELECT * FROM orders WHERE order_id = ?").get(id) as Row | undefined;
  }

  // ---------- checkout ----------
  async createCheckout(body: any, publicBase: string) {
    const sku = body?.sku;
    const quantity = body?.quantity ?? 1;
    // invariant: only the one product, positive integer quantity — checked before any PayPal call
    if (sku !== SKU) throw new HttpFailure(400, `Unknown sku; only ${SKU} is sold.`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new HttpFailure(400, "quantity must be an integer between 1 and 100.");
    const amount = fromCents(UNIT_CENTS * quantity);

    let order: Order;
    try {
      order = await this.client.orders.createOrder({
        body: {
          intent: "CAPTURE",
          purchaseUnits: [{ amount: { currencyCode: CURRENCY, value: amount } }],
          paymentSource: {
            paypal: {
              experienceContext: {
                returnUrl: `${publicBase}/checkout/return`,
                cancelUrl: `${publicBase}/checkout/cancel`,
              },
            },
          },
        },
      });
    } catch (e) {
      try { translate(e, true); } catch (t) {
        if (t instanceof UnknownOutcome) throw new HttpFailure(502, "Payment provider did not answer; the outcome is unknown. Nothing was charged. Please try again.", { cause: t });
        throw t;
      }
    }
    const approve = order!.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
    if (!order!.id || !approve) throw new HttpFailure(502, "Payment provider returned an unreadable order.");
    this.db.prepare("INSERT INTO orders (order_id, sku, quantity, amount, currency, status) VALUES (?,?,?,?,?,'CREATED')")
      .run(order!.id, SKU, quantity, amount, CURRENCY);
    return { orderId: order!.id, amount, approveUrl: approve };
  }

  // ---------- capture on return ----------
  private recordCaptures(orderId: string, order: Order): boolean {
    const caps = (order.purchaseUnits ?? []).flatMap((u) => u.payments?.captures ?? []).filter((c) => c.id);
    if (!caps.length) return false;
    const local = this.getOrderRow(orderId)!;
    tx(this.db, () => {
      for (const c of caps) {
        this.upsertCapture(orderId, c.id!, c.amount?.value ?? local.amount, c.amount?.currencyCode ?? local.currency, String(c.status ?? "PENDING"));
      }
    });
    return true;
  }

  /** Must run inside a transaction. */
  upsertCapture(orderId: string, id: string, amount: string, currency: string, status: string) {
    this.db.prepare(`INSERT INTO captures (capture_id, order_id, amount, currency, status) VALUES (?,?,?,?,?)
      ON CONFLICT(capture_id) DO UPDATE SET status = excluded.status`).run(id, orderId, amount, currency, status);
    const hold = status === "COMPLETED" ? 0 : 1;
    this.db.prepare("UPDATE orders SET status='CAPTURED', on_hold=? WHERE order_id=?").run(hold, orderId);
  }

  private capturedResult(orderId: string) {
    const caps = this.db.prepare("SELECT * FROM captures WHERE order_id=? ORDER BY rowid").all(orderId) as Row[];
    const o = this.getOrderRow(orderId)!;
    return { orderId, status: o.on_hold ? "PENDING" : "COMPLETED", captureId: caps[0]?.capture_id, amount: caps[0]?.amount ?? o.amount, currency: o.currency };
  }

  /** Re-read the order from PayPal and settle from what it holds. true = a capture is now recorded. */
  private async reconcileCapture(orderId: string): Promise<boolean> {
    let order: Order;
    try { order = await this.client.orders.getOrder({ id: orderId }); } catch (e) { try { translate(e, false); } catch { return false; } throw e; }
    return this.recordCaptures(orderId, order);
  }

  async captureOnReturn(token: string) {
    const row = this.getOrderRow(token); // invariant: only orders this shop created
    if (!row) throw new HttpFailure(404, "Unknown order.");
    if (row.status === "CAPTURED") return this.capturedResult(token);

    const claimed = this.db.prepare("UPDATE orders SET status='CAPTURING' WHERE order_id=? AND status='CREATED'").run(token).changes === 1;
    const unknown = () => ({ status: 202, body: { orderId: token, status: "unknown", message: "Payment outcome not yet known; please retry shortly." } });
    if (!claimed) {
      // somebody else holds the claim (or an earlier attempt's outcome was unknown): read-only settle
      if (await this.reconcileCapture(token)) return this.capturedResult(token);
      return unknown();
    }

    const release = () => this.db.prepare("UPDATE orders SET status='CREATED' WHERE order_id=? AND status='CAPTURING'").run(token);
    try {
      const res = await this.client.orders.captureOrder({ id: token, payPalRequestId: token });
      if (!res.id) throw new UnknownOutcome("missing id");
      if (!(await this.reconcileCapture(token))) throw new UnknownOutcome("capture not visible");
      return this.capturedResult(token);
    } catch (e) {
      if (e instanceof UnknownOutcome) return await this.settleUnknownCapture(token, release);
      try { translate(e, true); } catch (t) {
        if (t instanceof UnknownOutcome) return await this.settleUnknownCapture(token, release);
        release(); // PayPal (or we) definitively refused: free the claim
        throw t;
      }
      throw e;
    }
  }

  private async settleUnknownCapture(token: string, release: () => void) {
    if (await this.reconcileCapture(token)) return this.capturedResult(token);
    // not found / re-read failed: still unknown. Keep the claim; a later return re-reads.
    void release;
    return { status: 202, body: { orderId: token, status: "unknown", message: "Payment outcome not yet known; please retry shortly." } };
  }

  // ---------- refunds ----------
  async refund(orderId: unknown, amount: unknown, refundRef: unknown) {
    if (typeof orderId !== "string" || !orderId) throw new HttpFailure(400, "orderId is required.");
    if (typeof refundRef !== "string" || !refundRef.trim()) throw new HttpFailure(400, "refundRef is required.");
    if (typeof amount !== "string" || !/^\d+(\.\d{1,2})?$/.test(amount) || toCents(amount) <= 0) throw new HttpFailure(400, "amount must be a positive decimal string with at most 2 decimals.");
    const cents = toCents(amount);
    const order = this.getOrderRow(orderId);
    if (!order) throw new HttpFailure(404, "Unknown order.");
    const cap = this.db.prepare("SELECT * FROM captures WHERE order_id=? AND status IN ('COMPLETED','PARTIALLY_REFUNDED') ORDER BY rowid").get(orderId) as Row | undefined;
    if (!cap) throw new HttpFailure(409, "Order has no captured payment to refund.");

    const claim = tx(this.db, () => {
      const ex = this.db.prepare("SELECT * FROM refunds WHERE refund_ref=?").get(refundRef) as Row | undefined;
      if (ex) {
        if (ex.order_id !== orderId || toCents(ex.amount) !== cents) throw new HttpFailure(409, "refundRef already used for a different refund.");
        return ex;
      }
      const used = (this.db.prepare("SELECT COALESCE(SUM(CAST(ROUND(amount*100) AS INTEGER)),0) AS s FROM refunds WHERE capture_id=?").get(cap.capture_id) as Row).s as number;
      if (used + cents > toCents(cap.amount)) throw new HttpFailure(422, `Refund exceeds the captured amount (${cap.amount} ${cap.currency}; already refunded ${fromCents(used)}).`);
      try {
        this.db.prepare("INSERT INTO refunds (refund_ref, order_id, capture_id, amount, currency, status) VALUES (?,?,?,?,?,'pending')")
          .run(refundRef, orderId, cap.capture_id, amount, cap.currency);
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
      return this.db.prepare("SELECT * FROM refunds WHERE refund_ref=?").get(refundRef) as Row;
    });
    const view = (r: Row) => ({ orderId, refundId: r.paypal_refund_id, amount: r.amount, currency: r.currency, refundRef, status: r.status });
    if (claim.status !== "pending") return view(claim);

    const unknown = { status: 202, body: { orderId, refundRef, status: "unknown", message: "Refund outcome not yet known; retry with the same refundRef." } };
    // an earlier attempt may have gone through: look first
    if (await this.reconcileRefund(orderId, refundRef)) return view(this.db.prepare("SELECT * FROM refunds WHERE refund_ref=?").get(refundRef) as Row);

    try {
      const res = await this.client.payments.refundCapturedPayment({
        captureId: cap.capture_id,
        payPalRequestId: refundRef,
        body: { amount: { currencyCode: cap.currency, value: amount }, customId: refundRef },
      });
      if (!res.id) throw new UnknownOutcome("missing id");
      this.db.prepare("UPDATE refunds SET status=?, paypal_refund_id=? WHERE refund_ref=?").run(String(res.status ?? "COMPLETED"), res.id, refundRef);
      return view(this.db.prepare("SELECT * FROM refunds WHERE refund_ref=?").get(refundRef) as Row);
    } catch (e) {
      let t: unknown = e;
      if (!(e instanceof UnknownOutcome)) { try { translate(e, true); } catch (x) { t = x; } }
      if (t instanceof UnknownOutcome) {
        if (await this.reconcileRefund(orderId, refundRef)) return view(this.db.prepare("SELECT * FROM refunds WHERE refund_ref=?").get(refundRef) as Row);
        return unknown;
      }
      if (t instanceof HttpFailure) this.db.prepare("DELETE FROM refunds WHERE refund_ref=? AND status='pending'").run(refundRef); // refused: free the claim
      throw t;
    }
  }

  private async reconcileRefund(orderId: string, refundRef: string): Promise<boolean> {
    let order: Order;
    try { order = await this.client.orders.getOrder({ id: orderId }); } catch { return false; }
    const found = (order.purchaseUnits ?? []).flatMap((u) => u.payments?.refunds ?? []).find((r) => r.customId === refundRef && r.id);
    if (!found) return false;
    this.db.prepare("UPDATE refunds SET status=?, paypal_refund_id=? WHERE refund_ref=?").run(String(found.status ?? "COMPLETED"), found.id!, refundRef);
    return true;
  }

  // ---------- webhook ----------
  handleEvent(event: any): { ok: boolean; note: string } {
    const id = String(event?.id ?? "");
    const type = String(event?.event_type ?? "");
    if (!id || !type) throw new HttpFailure(400, "Malformed event.");
    const r = event.resource ?? {};
    return tx(this.db, () => {
      if (this.db.prepare("SELECT 1 FROM processed_events WHERE event_id=?").get(id)) return { ok: true, note: "duplicate" };
      const done = (note: string) => {
        this.db.prepare("INSERT INTO processed_events (event_id, event_type) VALUES (?,?)").run(id, type);
        return { ok: true, note };
      };
      if (type.startsWith("PAYMENT.CAPTURE.") && type !== "PAYMENT.CAPTURE.REFUNDED") {
        const capId = String(r.id ?? "");
        let orderId = r.supplementary_data?.related_ids?.order_id as string | undefined;
        if (!orderId) orderId = (this.db.prepare("SELECT order_id FROM captures WHERE capture_id=?").get(capId) as Row | undefined)?.order_id;
        const order = orderId ? this.getOrderRow(orderId) : undefined;
        if (!capId || !order) return { ok: true, note: "unknown order; ignored" };
        const status = type === "PAYMENT.CAPTURE.COMPLETED" ? "COMPLETED" : String(r.status ?? type.split(".")[2]);
        // record the capture FIRST, then ship
        this.upsertCapture(order.order_id, capId, r.amount?.value ?? order.amount, r.amount?.currency_code ?? order.currency, status);
        if (status === "COMPLETED") {
          this.db.prepare("INSERT OR IGNORE INTO shipments (order_id, at_event, capture_recorded) VALUES (?,?,1)").run(order.order_id, type);
        }
        return done("applied");
      }
      if (type === "PAYMENT.CAPTURE.REFUNDED") {
        const refundId = String(r.id ?? "");
        const ref = String(r.custom_id ?? "");
        const known = this.db.prepare("SELECT 1 FROM refunds WHERE paypal_refund_id=?").get(refundId);
        if (refundId && !known && ref) {
          this.db.prepare("UPDATE refunds SET status='COMPLETED', paypal_refund_id=? WHERE refund_ref=? AND paypal_refund_id IS NULL").run(refundId, ref);
        }
        return done("refund noted");
      }
      return done("ignored");
    });
  }

  // ---------- adapter state ----------
  state(orderId: string) {
    const o = this.getOrderRow(orderId);
    if (!o) return { exists: false, status: null, on_hold: false, fulfilled_count: 0, shipments: [], captures: [], refunds: [], processed_event_ids: this.eventIds() };
    const q = (sql: string) => this.db.prepare(sql).all(orderId) as Row[];
    const shipments = q("SELECT id, at_event, capture_recorded FROM shipments WHERE order_id=? ORDER BY id").map((s) => ({ id: s.id, at_event: s.at_event, capture_recorded: !!s.capture_recorded }));
    return {
      exists: true, status: o.status, on_hold: !!o.on_hold, fulfilled_count: shipments.length, shipments,
      captures: q("SELECT capture_id AS id, amount FROM captures WHERE order_id=? ORDER BY rowid"),
      refunds: q("SELECT paypal_refund_id AS id, amount FROM refunds WHERE order_id=? AND paypal_refund_id IS NOT NULL ORDER BY rowid"),
      processed_event_ids: this.eventIds(),
    };
  }
  private eventIds(): string[] {
    return (this.db.prepare("SELECT event_id FROM processed_events ORDER BY rowid").all() as Row[]).map((r) => r.event_id);
  }
}
