import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { APP_ROOT } from '../config.js'
import { ProcessSqliteTarget } from './processSqlite.js'
import { createEvershopTarget } from './evershop.js'

// Targets beyond MugShop:
//  - targets/ab/<name>/echobench.target.json : the agent-built handlers of the plugin off/on test (R2)
//  - EverShop (R1) when EVERSHOP_DIR is set
export function loadExtraTargets(lab) {
  const found = []
  const abRoot = path.join(APP_ROOT, 'targets', 'ab')
  if (existsSync(abRoot)) {
    for (const name of readdirSync(abRoot)) {
      const descriptor = path.join(abRoot, name, 'echobench.target.json')
      if (!existsSync(descriptor)) continue
      const spec = JSON.parse(readFileSync(descriptor, 'utf8'))
      found.push(
        new ProcessSqliteTarget({
          id: `ab-${name}`,
          label: spec.label || `Agent-built handler (${name})`,
          command: spec.command || process.execPath,
          args: spec.args || ['server.js'],
          cwd: path.join(abRoot, name),
          runtimeDir: path.join(lab.cfg.dataDir, 'runtime', `ab-${name}`),
          env: {
            PAYPAL_BASE_URL: lab.proxy.baseUrl,
            PAYPAL_CLIENT_ID: lab.cfg.clientId,
            PAYPAL_CLIENT_SECRET: lab.cfg.clientSecret,
            PAYPAL_WEBHOOK_ID: lab.cfg.webhookId,
            ...(lab.cfg.mode === 'mock' ? { PAYPAL_CERT_PEM_PATH: path.join(APP_ROOT, 'fixtures', 'keys', 'paypal-mock.cert.pem') } : {}),
            ...(spec.env || {}),
          },
          paths: spec.paths || {},
          capabilities: spec.capabilities || {},
          meta: { variant: 'agent-built', group: spec.group || name },
        }),
      )
    }
  }
  if (lab.cfg.evershopDir) found.push(createEvershopTarget(lab))
  return found
}
