// Caps on live model runs: per client IP per hour and per host per day. One run = one Diagnose press.
// Reaching a cap is not an error: the caller falls back to the recorded run or the stand-in and labels it.
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export function createLiveLimiter({ perIpHour = 10, perDay = 150, now = () => Date.now() } = {}) {
  const byIp = new Map()
  let day = []
  const prune = (list, span, t) => list.filter((x) => t - x < span)
  return {
    // Returns { ok: true } and counts the run, or { ok: false, reason } without counting.
    take(ip) {
      const t = now()
      day = prune(day, DAY_MS, t)
      const hits = prune(byIp.get(ip) || [], HOUR_MS, t)
      byIp.set(ip, hits)
      if (day.length >= perDay) return { ok: false, reason: 'live limit reached (daily cap for this demo)' }
      if (hits.length >= perIpHour) return { ok: false, reason: 'live limit reached (hourly cap per visitor)' }
      hits.push(t)
      day.push(t)
      return { ok: true }
    },
  }
}

// nginx appends the real peer address last in X-Forwarded-For; earlier entries can be forged by the client.
export function clientIp(req) {
  const parts = String(req.headers?.['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean)
  return parts.at(-1) || req.socket?.remoteAddress || 'unknown'
}
