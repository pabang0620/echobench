import { PaypalClient } from "paypal";

export const BASE_URL = (process.env.PAYPAL_BASE_URL ?? "").replace(/\/+$/, "");
const clientId = process.env.PAYPAL_CLIENT_ID ?? "";
const clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? "";

export const client = new PaypalClient({
  serverOptions: { baseUrl: BASE_URL },
  oauth2: { clientId, clientSecret },
  retry: { maxRetries: 2, timeout: 20_000 },
});

// Only used for webhook signature verification (not covered by the SDK).
export async function verifyWebhook(headers: Record<string, string | string[] | undefined>, event: unknown): Promise<boolean> {
  const h = (n: string) => String(headers[n] ?? "");
  const tok = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!tok.ok) throw new Error(`token ${tok.status}`);
  const { access_token } = (await tok.json()) as { access_token: string };
  const res = await fetch(`${BASE_URL}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: process.env.PAYPAL_WEBHOOK_ID ?? "",
      webhook_event: event,
    }),
  });
  if (!res.ok) throw new Error(`verify ${res.status}`);
  return ((await res.json()) as { verification_status?: string }).verification_status === "SUCCESS";
}
