import { createApp } from './app.js'
import { createLab } from './lab.js'

let lab
try {
  lab = await createLab()
} catch (err) {
  if (!err.expose) throw err
  process.stderr.write(`${err.message}\n`)
  process.exit(1)
}
const app = createApp(lab)
const server = app.listen(lab.cfg.port, '127.0.0.1', () => {
  lab.localUrl = `http://127.0.0.1:${lab.cfg.port}`
  process.stdout.write(`EchoBench on ${lab.publicUrl} (PayPal: ${lab.cfg.mode})\n`)
  if (!lab.cfg.accessToken && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(lab.publicUrl)) {
    process.stderr.write('Warning: PUBLIC_URL is not local and ECHOBENCH_ACCESS_TOKEN is empty, so every route is reachable through that address. Set a token (see VERIFY.md).\n')
  }
  if (lab.mock) lab.mock.registerWebhook(`${lab.publicUrl}/hooks/paypal`)
})

async function shutdown() {
  server.close()
  await lab.stop()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
