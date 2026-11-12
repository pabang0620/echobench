import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

// Plain JSON files. Recordings are folders (recording.json + snapshots/), runs are single files.
function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, file)
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function createStore({ dataDir, builtinDir }) {
  const recordingsDir = path.join(dataDir, 'recordings')
  const runsDir = path.join(dataDir, 'runs')
  const appliesFile = path.join(dataDir, 'applies.json')

  function recordingDirs() {
    const dirs = []
    for (const [root, builtin] of [[builtinDir, true], [recordingsDir, false]]) {
      if (!root || !existsSync(root)) continue
      for (const name of readdirSync(root)) {
        const dir = path.join(root, name)
        if (existsSync(path.join(dir, 'recording.json'))) dirs.push({ dir, builtin })
      }
    }
    return dirs
  }

  return {
    recordingDir: (id) => path.join(recordingsDir, id),
    listRecordings() {
      return recordingDirs().map(({ dir, builtin }) => {
        const rec = readJson(path.join(dir, 'recording.json'), null)
        return rec && { id: rec.id, name: rec.name, source: rec.source, createdAt: rec.createdAt, targetId: rec.targetId, deliveries: rec.deliveries.length, builtin }
      }).filter(Boolean)
    },
    getRecording(id) {
      for (const { dir, builtin } of recordingDirs()) {
        const rec = readJson(path.join(dir, 'recording.json'), null)
        if (rec && rec.id === id) return { ...rec, dir, builtin }
      }
      return null
    },
    saveRecording(rec) {
      const dir = path.join(recordingsDir, rec.id)
      const { dir: _dir, builtin: _builtin, ...plain } = rec
      writeJson(path.join(dir, 'recording.json'), plain)
      return dir
    },
    saveRun(run) {
      writeJson(path.join(runsDir, `${run.id}.json`), run)
    },
    // Forget every run of one target (used when the demo workspace goes back to the planted bugs).
    deleteRuns({ targetId }) {
      if (!existsSync(runsDir)) return 0
      let removed = 0
      for (const f of readdirSync(runsDir).filter((name) => name.endsWith('.json'))) {
        const run = readJson(path.join(runsDir, f), null)
        if (run?.targetId !== targetId) continue
        rmSync(path.join(runsDir, f), { force: true })
        removed += 1
      }
      return removed
    },
    getRun: (id) => readJson(path.join(runsDir, `${id}.json`), null),
    listRuns({ recordingId, targetId } = {}) {
      if (!existsSync(runsDir)) return []
      return readdirSync(runsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => readJson(path.join(runsDir, f), null))
        .filter((run) => run && (!recordingId || run.recordingId === recordingId) && (!targetId || run.targetId === targetId))
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    },
    listApplies: () => readJson(appliesFile, []),
    addApply(entry) {
      const list = readJson(appliesFile, [])
      writeJson(appliesFile, [...list, entry])
    },
  }
}

export const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
