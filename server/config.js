import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export class ConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConfigError'
    this.status = 500
    this.expose = true
  }
}

const SANDBOX_HOSTS = new Set(['api-m.sandbox.paypal.com', 'api.sandbox.paypal.com'])

// Strict check: https, no credentials in the URL, and the host is exactly a PayPal sandbox host.
export function assertSandboxUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new ConfigError(`PAYPAL_BASE_URL is not a valid URL: ${value}`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || !SANDBOX_HOSTS.has(url.hostname)) {
    throw new ConfigError(`Refusing to start: PAYPAL_BASE_URL must be https://api-m.sandbox.paypal.com (or api.sandbox.paypal.com), got ${url.origin}. Remove it to use the local stand-in.`)
  }
  return url.origin
}

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function loadConfig(env = process.env) {
  const forceMock = env.FORCE_MOCK === '1'
  const hasSandbox = Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) && !forceMock
  const port = Number(env.PORT || 3101)
  const paypalBaseUrl = (env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com').replace(/\/$/, '')
  if (hasSandbox) assertSandboxUrl(paypalBaseUrl)
  return {
    port,
    publicUrl: (env.PUBLIC_URL || `http://127.0.0.1:${port}`).replace(/\/$/, ''),
    dataDir: path.resolve(env.DATA_DIR || path.join(APP_ROOT, 'data')),
    builtinDir: path.join(APP_ROOT, 'builtin'),
    // Where a recorded live model run (live-diagnosis.json) is looked for. Empty = never replay one.
    recordedDir: path.join(APP_ROOT, 'builtin'),
    // 'mock' = local PayPal stand-in (default, no keys). 'sandbox' = api-m.sandbox.paypal.com, only with credentials.
    mode: hasSandbox ? 'sandbox' : 'mock',
    paypalBaseUrl,
    clientId: hasSandbox ? env.PAYPAL_CLIENT_ID : 'mock-client',
    clientSecret: hasSandbox ? env.PAYPAL_CLIENT_SECRET : 'mock-secret',
    webhookId: env.PAYPAL_WEBHOOK_ID || 'WH-MOCK-0001',
    // 'sdk' = the APIMatic-generated PayPal SDK (default). 'rest' = the same calls by plain fetch, to run a scenario through both.
    clientImpl: env.PAYPAL_CLIENT_IMPL === 'rest' ? 'rest' : 'sdk',
    // 'account' = the developer's Claude Code login through the Agent SDK (LLM_BACKEND=account, local use). The API key is not read then.
    // 'api' = ANTHROPIC_API_KEY. 'mock' = the scripted stand-in (default).
    llmBackend: forceMock ? 'mock' : env.LLM_BACKEND === 'account' ? 'account' : env.ANTHROPIC_API_KEY ? 'api' : 'mock',
    anthropicKey: forceMock || env.LLM_BACKEND === 'account' ? '' : env.ANTHROPIC_API_KEY || '',
    anthropicModel: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    // Live model run caps: per client IP per hour, per host per day (one run = one Diagnose press).
    liveLimitPerIpHour: Math.max(1, Number(env.LLM_LIVE_PER_IP_HOUR || 10)),
    liveLimitPerDay: Math.max(1, Number(env.LLM_LIVE_PER_DAY || 150)),
    operator: env.ECHOBENCH_OPERATOR || 'you',
    settleWindowMs: Number(env.SETTLE_WINDOW_MS || 6000),
    accessToken: env.ECHOBENCH_ACCESS_TOKEN || '',
    evershopDir: env.EVERSHOP_DIR || '',
    // Hosted demo: start every process from the planted MugShop, whatever an earlier visitor applied.
    resetWorkspaceOnStart: env.RESET_WORKSPACE_ON_START === '1',
    // How many visitors may hold their own patched MugShop copy at once (each is a folder and, while used, a process).
    maxVisitorCopies: Math.max(1, Number(env.MAX_VISITOR_COPIES || 8)),
  }
}

// Which model backend a lab uses. Tests override `anthropicKey` or `llmBackend` directly.
export function llmBackendOf(cfg) {
  if (cfg.llmBackend === 'account') return 'account'
  return cfg.anthropicKey ? 'api' : 'mock'
}
