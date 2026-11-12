import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createApp } from '../server/app.js'
import { createLab } from '../server/lab.js'
import { APP_ROOT } from '../server/config.js'

// R1: records one purchase made INSIDE an unmodified EverShop, on the local PayPal stand-in.
// EverShop's own storefront and admin REST APIs do everything; EchoBench only receives the stand-in's
// deliveries, stores them, hands them to EverShop's webhook route and takes start points (template databases).
//   node --env-file=.evershop-pg/evershop.env scripts/record-evershop.js
// Needs EVERSHOP_* (targets/evershop/README.md) and `npm install --no-save pg`. Output: builtin/evershop-demo.
process.env.FORCE_MOCK = '1'
const ID = 'evershop-demo'
const PRICE = 12
const scratch = path.join(APP_ROOT, '.scratch')
mkdirSync(scratch, { recursive: true })
const { default: pg } = await import('pg')

// A tiny cookie-keeping client for EverShop's storefront and admin sessions.
function client(base) {
  const jar = new Map()
  return async (method, url, body) => {
    const res = await fetch(`${base}${url}`, {
      method,
      redirect: 'manual',
      headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';')
      const at = pair.indexOf('=')
      jar.set(pair.slice(0, at), pair.slice(at + 1))
    }
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      // HTML page or redirect
    }
    if (res.status >= 400 || json?.error) throw new Error(`${method} ${url} -> ${res.status} ${String(json?.error?.message ?? text).slice(0, 300)}`)
    return { status: res.status, location: res.headers.get('location'), data: json?.data ?? json }
  }
}

async function sql(url, text, params = []) {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    return (await c.query(text, params)).rows
  } finally {
    await c.end()
  }
}

// One admin user for this script, created the way EverShop's own `user:create` stores it (bcrypt via its helper).
// The password is random, held in memory only, never printed or saved.
async function adminSession(base) {
  const { hashPassword } = await import(pathToFileURL(path.join(process.env.EVERSHOP_DIR, 'packages/evershop/dist/lib/util/passwordHelper.js')).href)
  const dbUrl = new URL(process.env.EVERSHOP_DB_ADMIN_URL)
  dbUrl.pathname = `/${process.env.EVERSHOP_DB_NAME || 'evershop'}`
  const email = 'echobench-admin@example.test'
  const password = randomBytes(18).toString('base64url')
  await sql(dbUrl.href, 'DELETE FROM admin_user WHERE email = $1', [email])
  await sql(dbUrl.href, 'INSERT INTO admin_user (uuid, status, full_name, email, password) VALUES ($1, true, $2, $3, $4)', [randomUUID(), 'EchoBench R1', email, hashPassword(password)])
  const admin = client(base)
  await admin('POST', '/admin/user/login', { email, password })
  return admin
}

// Shipping zone, flat-rate method, package and one 12.00 product, through EverShop's admin REST API
// (the same calls EverShop's own release check makes in tests/e2e/release/support/checkout.ts).
async function shopSetup(admin) {
  const tag = Date.now().toString(36)
  const zone = (await admin('POST', '/api/shippingZones', { name: `EchoBench US ${tag}`, countries: ['US'] })).data
  const method = (await admin('POST', '/api/shippingProviders/core/methods', { name: `EchoBench flat ${tag}`, is_enabled: true })).data
  await admin('POST', '/api/shippingProviders/core/rates', { method_id: method.uuid, zone_id: zone.uuid, is_enabled: true, cost: 0 })
  const pkg = (await admin('POST', '/api/packages', { name: `EchoBench box ${tag}`, length: 20, width: 15, height: 10 })).data
  const sku = `MUG-${tag}`.toUpperCase()
  await admin('POST', '/api/products', { name: `EchoBench mug ${tag}`, sku, url_key: `echobench-mug-${tag}`, price: PRICE, qty: 1000, weight: 1, status: 1, visibility: 1, manage_stock: 1, stock_availability: 1, group_id: 1, package_id: pkg.package_id, description: [] })
  return { sku, methodUuid: method.uuid }
}

// A guest order paid with PayPal, the way the storefront places it.
async function placePaypalOrder(base, world) {
  const shop = client(base)
  await shop('GET', '/cart')
  await shop('POST', '/api/cart/mine/items', { sku: world.sku, qty: 1 })
  const cart = (await shop('POST', '/api/graphql', { query: '{ myCart { uuid totalQty } }' })).data.myCart
  const address = { recipient: 'Jane Bench', telephone: '+1 650 253 0000', address_line_1: '1600 Amphitheatre Pkwy', locality: 'Mountain View', administrative_area: 'US-CA', postal_code: '94043', country: 'US' }
  const order = (await shop('POST', `/api/carts/${cart.uuid}/checkout`, { cart_id: cart.uuid, customer: { email: 'buyer@example.test' }, shippingAddress: address, billingAddress: address, shippingMethod: world.methodUuid, shippingProvider: 'core', paymentMethod: 'paypal' })).data
  await shop('POST', '/api/paypal/orders', { order_id: order.uuid })
  const [row] = await sql(process.env.EVERSHOP_DB_READONLY_URL, 'SELECT integration_order_id, grand_total FROM "order" WHERE uuid = $1', [order.uuid])
  return { shop, uuid: order.uuid, paypalOrderId: row.integration_order_id, total: Number(row.grand_total).toFixed(2) }
}

const dataDir = mkdtempSync(path.join(scratch, 'es-rec-'))
const lab = await createLab({ dataDir, mode: 'mock', settleWindowMs: 3000 })
const server = createApp(lab).listen(0, '127.0.0.1')
await new Promise((r) => server.once('listening', r))
lab.publicUrl = `http://127.0.0.1:${server.address().port}`
lab.mock.registerWebhook(`${lab.publicUrl}/hooks/paypal`)
const mock = async (p, body = {}) => {
  const res = await fetch(`${lab.ledgerUrl}${p}`, { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`${p} -> ${res.status} ${await res.text()}`)
  return res.json()
}
const say = (line) => process.stdout.write(`${line}\n`)

try {
  const target = lab.target('evershop')
  await target.start()
  const admin = await adminSession(target.baseUrl)
  const world = await shopSetup(admin)
  say(`EverShop set up: product ${world.sku}`)

  const order = await placePaypalOrder(target.baseUrl, world)
  say(`EverShop order ${order.uuid}, PayPal order ${order.paypalOrderId}, total ${order.total}`)
  const rec = lab.recorder.start({ id: ID, name: 'A purchase made inside an unmodified EverShop 2.4.0 (local PayPal stand-in)', targetId: 'evershop', source: 'builtin-mock', webhookId: lab.cfg.webhookId })
  rec.orderId = order.paypalOrderId

  await mock(`/__mock/orders/${order.paypalOrderId}/approve`)
  await lab.recorder.waitForDeliveries(1, 120000)
  // The buyer comes back to EverShop's own return page.
  const back = await order.shop('GET', `/paypal/processing/${order.uuid}?token=${order.paypalOrderId}`)
  say(`Return page answered ${back.status} -> ${back.location}`)
  await lab.recorder.waitForDeliveries(2, 120000)

  // Two partial refunds from EverShop's admin, through its one core refund route.
  await admin('POST', `/api/orders/${order.uuid}/refunds`, { amount: 4 })
  await lab.recorder.waitForDeliveries(3, 120000)
  await admin('POST', `/api/orders/${order.uuid}/refunds`, { amount: Number(order.total) - 4 })
  await lab.recorder.waitForDeliveries(4, 120000)

  lab.recorder.session.ledger = lab.mock.exportLedger()
  const saved = await lab.recorder.finish()
  const outDir = path.join(APP_ROOT, 'builtin', ID)
  rmSync(outDir, { recursive: true, force: true })
  cpSync(saved.dir, outDir, { recursive: true })
  say(`Recorded ${saved.deliveries.map((d) => `${d.label} ${d.targetResponse?.status}`).join(', ')}; start points ${Object.keys(saved.startPoints).join(', ')}`)

  // Plan R1 step 7: the recorded order and capture must exist in EverShop's own tables.
  const check = await target.precheck({ orderId: saved.orderId, captureId: saved.captureId })
  say(`Precheck: ${check.ok ? 'ok' : 'FAILED'} (${check.reason})`)
  if (!check.ok) process.exitCode = 1
} finally {
  server.close()
  await lab.stop()
  rmSync(dataDir, { recursive: true, force: true })
}
