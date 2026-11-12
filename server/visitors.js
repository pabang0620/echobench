import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { HttpError } from './http.js'
import { createMugshopTarget, prepareWorkspace, workspaceDir } from './targets/mugshop.js'

// Each visitor gets their own MugShop working copy the first time they press Apply, so one visitor's
// patch never shows up on another visitor's screen. The shared "mugshop" target stays planted.
// Copies live in memory and under data/workspace; the oldest idle ones are removed past a cap.

export const SHARED_ID = 'mugshop'
const PREFIX = 'mugshop-v-'
const COOKIE = 'echobench_sid'
const SID_RE = /^[a-f0-9]{32}$/
const IDLE_MS = 2 * 60 * 60 * 1000

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return ''
}

// The visitor id comes from the echobench_sid cookie (browsers) or the x-echobench-session header (scripts).
// A request without one gets a new id, so a caller without a session can never touch someone else's copy.
export function visitorSession() {
  return (req, res, next) => {
    const given = String(req.headers['x-echobench-session'] || cookieValue(req.headers.cookie, COOKIE) || '')
    if (SID_RE.test(given)) req.visitor = given
    else {
      req.visitor = randomBytes(16).toString('hex')
      res.append('Set-Cookie', `${COOKIE}=${req.visitor}; HttpOnly; SameSite=Lax; Path=/`)
    }
    next()
  }
}

// What is stored in diagnosis files instead of the visitor id itself.
export const ownerTag = (sid) => (sid ? createHash('sha256').update(sid).digest('hex').slice(0, 16) : null)

export const isVisitorCopyId = (id) => String(id).startsWith(PREFIX)

export function createVisitorCopies(lab, { max = 8 } = {}) {
  const copies = new Map()

  // Copies do not survive a restart: remove what an earlier process left on disk.
  const root = path.join(lab.cfg.dataDir, 'workspace')
  if (existsSync(root)) {
    for (const name of readdirSync(root).filter(isVisitorCopyId)) {
      rmSync(path.join(root, name), { recursive: true, force: true })
      rmSync(path.join(lab.cfg.dataDir, 'runtime', name), { recursive: true, force: true })
      lab.store.deleteRuns({ targetId: name })
    }
  }

  async function drop(sid) {
    const copy = copies.get(sid)
    if (!copy) return false
    copies.delete(sid)
    await copy.target.stop().catch(() => {})
    lab.targets.delete(copy.target.id)
    rmSync(workspaceDir(lab.cfg.dataDir, copy.target.id), { recursive: true, force: true })
    rmSync(path.join(lab.cfg.dataDir, 'runtime', copy.target.id), { recursive: true, force: true })
    lab.store.deleteRuns({ targetId: copy.target.id })
    return true
  }

  return {
    get size() {
      return copies.size
    },
    has: (sid) => copies.has(sid),
    copyOf: (sid) => copies.get(sid)?.target || null,
    // The target a visitor means by `id`: their own copy when they ask for "mugshop" and have one.
    // Another visitor's copy is unknown to them.
    resolve(id, sid) {
      const copy = id === SHARED_ID && sid ? copies.get(sid) : null
      if (copy) {
        copy.lastUsed = Date.now()
        return copy.target
      }
      const target = lab.target(id)
      if (target.meta?.visitor && target.meta.visitor !== sid) throw new HttpError(404, `Unknown target ${id}`)
      return target
    },
    // Called inside lab.exclusive, so no scenario is running on a copy that gets removed.
    async ensure(sid) {
      if (!sid) throw new HttpError(400, 'No visitor session')
      const existing = copies.get(sid)
      if (existing) {
        existing.lastUsed = Date.now()
        return existing.target
      }
      const now = Date.now()
      for (const [other, copy] of copies) if (now - copy.lastUsed > IDLE_MS) await drop(other)
      while (copies.size >= max) {
        const [oldest] = [...copies.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0]
        await drop(oldest)
      }
      const id = `${PREFIX}${randomBytes(4).toString('hex')}`
      const dir = prepareWorkspace(lab.cfg.dataDir, id, 'planted', { force: true })
      const target = createMugshopTarget(lab, { id, variant: 'planted', workspace: dir })
      target.meta.visitor = sid
      lab.addTarget(target)
      copies.set(sid, { target, lastUsed: now })
      return target
    },
    drop,
  }
}
