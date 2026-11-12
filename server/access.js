import { timingSafeEqual } from 'node:crypto'

const COOKIE = 'echobench_token'

function same(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return ''
}

// Optional shared token (ECHOBENCH_ACCESS_TOKEN). With a token set, only PayPal's receiver
// (POST /hooks/paypal) is open; every other route needs the token in the x-echobench-token header,
// the echobench_token cookie, or ?token= once (which sets the cookie). Without a token nothing changes:
// the server listens on 127.0.0.1 only.
export function accessGuard(token) {
  return (req, res, next) => {
    if (!token) return next()
    if (req.method === 'POST' && req.path === '/hooks/paypal') return next()
    const given = req.headers['x-echobench-token'] || cookieValue(req.headers.cookie, COOKIE) || (typeof req.query.token === 'string' ? req.query.token : '')
    if (!given || !same(given, token)) {
      return res.status(401).json({ success: false, message: 'This EchoBench needs an access token. Open the page with ?token=<ECHOBENCH_ACCESS_TOKEN> once.' })
    }
    if (typeof req.query.token === 'string') {
      res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`)
      if (req.method === 'GET' && !req.path.startsWith('/api')) return res.redirect(req.path)
    }
    next()
  }
}
