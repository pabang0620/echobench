import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { APP_ROOT } from '../config.js'
import { ProcessSqliteTarget } from './processSqlite.js'

const SOURCE = path.join(APP_ROOT, 'targets', 'mugshop')

// MugShop runs from a workspace copy under data/workspace, so applying an AI patch never edits
// the repository source. "planted" starts from targets/mugshop/src, "reference" from the fix.
export function workspaceDir(dataDir, id) {
  return path.join(dataDir, 'workspace', id)
}

// A copy under DATA_DIR may sit anywhere on disk, so it gets its own node_modules link to the app's
// (zod, @types/node) and its own package.json (ES modules). Node and tsc then behave the same wherever DATA_DIR points.
export function linkDependencies(dir) {
  const manifest = path.join(dir, 'package.json')
  if (!existsSync(manifest)) writeFileSync(manifest, '{ "private": true, "type": "module" }\n')
  const link = path.join(dir, 'node_modules')
  if (!existsSync(link)) symlinkSync(path.join(APP_ROOT, 'node_modules'), link, 'dir')
}

export function prepareWorkspace(dataDir, id, variant, { force = false } = {}) {
  const dir = workspaceDir(dataDir, id)
  if (force) rmSync(dir, { recursive: true, force: true })
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    cpSync(path.join(SOURCE, 'src'), path.join(dir, 'src'), { recursive: true })
    cpSync(path.join(SOURCE, 'tsconfig.json'), path.join(dir, 'tsconfig.json'))
    if (variant === 'reference' || variant === 'contrast') cpSync(path.join(SOURCE, 'fixes', 'webhook.fixed.ts'), path.join(dir, 'src', 'webhook.ts'))
  }
  linkDependencies(dir)
  return dir
}

export function createMugshopTarget(lab, { id = 'mugshop', variant = 'planted', env = {}, workspace = '' } = {}) {
  const { cfg } = lab
  const cwd = workspace || prepareWorkspace(cfg.dataDir, id, variant)
  const certPath = path.join(APP_ROOT, 'fixtures', 'keys', 'paypal-mock.cert.pem')
  return new ProcessSqliteTarget({
    id,
    label: { planted: 'MugShop (planted bugs)', reference: 'MugShop (reference fix)', contrast: 'MugShop (contract removed, contrast)', candidate: 'MugShop (AI fix candidate)' }[variant] || 'MugShop',
    command: process.execPath,
    args: ['--no-warnings', 'src/server.ts'],
    cwd,
    runtimeDir: path.join(cfg.dataDir, 'runtime', id),
    env: {
      PAYPAL_ENV: cfg.mode === 'sandbox' ? 'sandbox' : 'mock',
      PAYPAL_BASE_URL: lab.proxy.baseUrl,
      // Placeholders: the lab's proxy adds the real credentials to the token request (server/proxy.js).
      PAYPAL_CLIENT_ID: 'echobench-proxied',
      PAYPAL_CLIENT_SECRET: 'echobench-proxied',
      PAYPAL_WEBHOOK_ID: cfg.webhookId,
      PAYPAL_CLIENT_IMPL: cfg.clientImpl,
      ...(cfg.mode === 'mock' ? { PAYPAL_CERT_PEM_PATH: certPath } : {}),
      RECONCILE_INTERVAL_MS: '1000',
      ...env,
    },
    meta: { variant, workspace: cwd, editable: variant === 'planted' },
    cleanEnv: true,
  })
}
