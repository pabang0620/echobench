import { rmSync } from 'node:fs'
import path from 'node:path'
import { APP_ROOT } from '../server/config.js'

// `npm run demo:video`: the exact state docs/VIDEO_SCRIPT.md is recorded in.
// Local PayPal stand-in, no model key (the two recorded Claude Sonnet runs replay), MugShop with its planted bugs,
// and an empty data folder of its own (data/video) so no earlier Apply or run shows up. Needs `npm run build` first.
const DATA_DIR = path.join(APP_ROOT, 'data', 'video')
rmSync(DATA_DIR, { recursive: true, force: true })

Object.assign(process.env, {
  FORCE_MOCK: '1',
  LLM_BACKEND: '',
  ANTHROPIC_API_KEY: '',
  RESET_WORKSPACE_ON_START: '1',
  DATA_DIR,
  PORT: process.env.PORT || '3101',
})
process.env.PUBLIC_URL = `http://127.0.0.1:${process.env.PORT}`

await import('../server/index.js')
