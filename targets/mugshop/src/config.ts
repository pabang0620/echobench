// MugShop configuration. Everything comes from the environment (see ../README.md).
const env = process.env

export const config = {
  port: Number(env.PORT || 4100),
  dataPath: env.DATA_PATH || './mugshop.sqlite',
  snapshotDir: env.SNAPSHOT_DIR || '',
  // 'mock' = the local PayPal stand-in, 'sandbox' = api-m.sandbox.paypal.com. Never anything else.
  paypalEnv: env.PAYPAL_ENV === 'sandbox' ? 'sandbox' : 'mock',
  paypalBaseUrl: (env.PAYPAL_BASE_URL || 'http://127.0.0.1:4200').replace(/\/$/, ''),
  // Placeholder credentials exist for the local stand-in only. A sandbox run with none configured must fail at start.
  clientId: env.PAYPAL_CLIENT_ID || (env.PAYPAL_ENV === 'sandbox' ? '' : 'mock-client'),
  clientSecret: env.PAYPAL_CLIENT_SECRET || (env.PAYPAL_ENV === 'sandbox' ? '' : 'mock-secret'),
  webhookId: env.PAYPAL_WEBHOOK_ID || 'WH-MOCK-0001',
  // Hosts the signature certificate may be downloaded from. Anything else is rejected.
  trustedCertHosts: (env.TRUSTED_CERT_HOSTS || 'api.paypal.com,api-m.paypal.com,api.sandbox.paypal.com,api-m.sandbox.paypal.com').split(',').map((s) => s.trim()),
  // Local runs pin the mock PayPal certificate instead of downloading it.
  pinnedCertPath: env.PAYPAL_CERT_PEM_PATH || '',
  // 'sdk' = the APIMatic-generated PayPal SDK (default), 'rest' = plain fetch, kept to run the same scenario through both.
  clientImpl: env.PAYPAL_CLIENT_IMPL === 'rest' ? 'rest' : 'sdk',
  // 'off' is a contrast switch used by the contract tests to show the verifier turns red. Not a planted bug.
  refundClaim: env.REFUND_CLAIM === 'off' ? 'off' : 'on',
  reconcileIntervalMs: Number(env.RECONCILE_INTERVAL_MS || 1000),
  adapter: env.ECHOBENCH_ADAPTER === '1',
} as const

export const PRODUCT_PRICES: Record<string, string> = { 'MUG-001': '12.00' }
