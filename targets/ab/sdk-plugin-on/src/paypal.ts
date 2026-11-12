import { PaypalClient, PaypalError, ApiError } from "paypal";

export class HttpFailure extends Error {
  constructor(public status: number, public reason: string, opts?: ErrorOptions) {
    super(reason, opts);
  }
}
/** The write may have reached PayPal but we do not know the answer. */
export class UnknownOutcome extends Error {}

export interface Config {
  port: number; baseUrl: string; clientId: string; clientSecret: string; webhookId: string; dataPath: string;
}

export function loadConfig(env = process.env): Config {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  const baseUrl = need("PAYPAL_BASE_URL").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(baseUrl)) throw new Error("PAYPAL_BASE_URL must be http(s)");
  return {
    port: Number(env.PORT ?? 3000), baseUrl,
    clientId: need("PAYPAL_CLIENT_ID"), clientSecret: need("PAYPAL_CLIENT_SECRET"),
    webhookId: env.PAYPAL_WEBHOOK_ID ?? "", dataPath: need("DATA_PATH"),
  };
}

export function buildClient(cfg: Config, fetchImpl?: typeof fetch): PaypalClient {
  return new PaypalClient({
    serverOptions: { baseUrl: cfg.baseUrl },
    oauth2: { clientId: cfg.clientId, clientSecret: cfg.clientSecret },
    retry: { timeout: 15_000 },
    logging: { level: "off" },
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

function reasonOf(err: ApiError): string | undefined {
  const p = err.payload as { body?: { message?: string; details?: { issue?: string; description?: string }[] }; rawBody?: ArrayBuffer };
  const b = p.body;
  if (b && typeof b === "object") {
    const parts = [b.message, ...(b.details ?? []).map((d) => d.description ?? d.issue)].filter(Boolean);
    if (parts.length) return parts.join("; ").slice(0, 500);
  }
  return undefined;
}

/**
 * Translate an SDK failure. `write` = the call may have taken effect on a no-answer failure.
 * Returns an UnknownOutcome for those; callers settle by re-reading.
 * Never-sent failures (auth, encode) are definite 502s.
 */
export function translate(err: unknown, write: boolean): never {
  if (err instanceof PaypalError) {
    switch (err.kind) {
      case "api": {
        const s = err.status;
        if (s === 401 || s === 403) throw new HttpFailure(502, "Payment provider rejected our credentials.", { cause: err });
        if (s === 429) throw new HttpFailure(503, "Payment provider is rate limiting us; try again later.", { cause: err });
        if (s >= 400 && s < 500) throw new HttpFailure(s, reasonOf(err) ?? "Request rejected by payment provider.", { cause: err });
        throw new HttpFailure(502, "Payment provider error.", { cause: err });
      }
      case "connection":
      case "timeout":
      case "decode":
        if (write) throw new UnknownOutcome(err.kind, { cause: err });
        throw new HttpFailure(502, "Payment provider unreachable or unreadable.", { cause: err });
      case "auth":
      case "encode":
        throw new HttpFailure(502, "Payment provider unavailable.", { cause: err });
    }
  }
  throw err;
}

/** Raw (non-SDK) PayPal calls: webhook verification. Same base URL. */
export function makeRaw(cfg: Config) {
  let token: { v: string; exp: number } | undefined;
  async function getToken(): Promise<string> {
    if (token && token.exp > Date.now() + 30_000) return token.v;
    const r = await fetch(`${cfg.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: "Basic " + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64"),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`token ${r.status}`);
    const j = (await r.json()) as { access_token: string; expires_in?: number };
    token = { v: j.access_token, exp: Date.now() + (j.expires_in ?? 300) * 1000 };
    return token.v;
  }
  /** true = verified, false = signature failed. Throws when we could not ask. */
  return async function verifyWebhook(headers: Record<string, string | string[] | undefined>, event: unknown): Promise<boolean> {
    const h = (k: string) => String(headers[k] ?? "");
    const r = await fetch(`${cfg.baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: { authorization: `Bearer ${await getToken()}`, "content-type": "application/json" },
      body: JSON.stringify({
        auth_algo: h("paypal-auth-algo"), cert_url: h("paypal-cert-url"),
        transmission_id: h("paypal-transmission-id"), transmission_sig: h("paypal-transmission-sig"),
        transmission_time: h("paypal-transmission-time"), webhook_id: cfg.webhookId, webhook_event: event,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status >= 500 || r.status === 401 || r.status === 429) throw new Error(`verify ${r.status}`);
    if (!r.ok) return false;
    const j = (await r.json()) as { verification_status?: string };
    return j.verification_status === "SUCCESS";
  };
}
