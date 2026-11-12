import { createEvershopTarget } from '../server/targets/evershop.js'
import { loadConfig } from '../server/config.js'

// Read-only: compares targets/evershop/schema.json with the real EverShop tables.
const cfg = loadConfig()
if (!cfg.evershopDir) {
  process.stderr.write('Set EVERSHOP_DIR and EVERSHOP_DB_READONLY_URL in .env first (targets/evershop/README.md).\n')
  process.exit(2)
}
const result = await createEvershopTarget({ cfg }).checkSchema()
process.stdout.write(result.ok ? 'All columns in schema.json exist.\n' : `Missing columns, edit targets/evershop/schema.json:\n  ${result.missing.join('\n  ')}\n`)
process.exitCode = result.ok ? 0 : 1
