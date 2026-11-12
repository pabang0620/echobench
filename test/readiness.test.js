import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ProcessSqliteTarget } from '../server/targets/processSqlite.js'

// REVIEW_4 A4: a fixed 15 s wait failed under load. The start now waits for the health route (ready)
// or the child's exit (failed), not for a clock.

function target(script) {
  const runtimeDir = mkdtempSync(path.join(tmpdir(), 'echobench-ready-'))
  const t = new ProcessSqliteTarget({ id: 'probe', label: 'probe', command: process.execPath, args: ['-e', script], cwd: runtimeDir, runtimeDir })
  return { t, cleanup: () => rmSync(runtimeDir, { recursive: true, force: true }) }
}

test('a slow target is waited for until its health route answers', async () => {
  // Answers only after 1.5 s, the way a target does when tsx is compiling under load.
  const { t, cleanup } = target("setTimeout(() => require('node:http').createServer((q, s) => { s.end('ok') }).listen(Number(process.env.PORT), '127.0.0.1'), 1500)")
  try {
    const started = Date.now()
    await t.start()
    assert.ok(Date.now() - started >= 1400)
    assert.ok(t.child)
  } finally {
    await t.stop()
    cleanup()
  }
})

test('a target that exits is reported at once, with its exit code, not after a timeout', async () => {
  const { t, cleanup } = target("console.error('boom'); process.exit(3)")
  try {
    const started = Date.now()
    await assert.rejects(t.start(), /could not start.*boom/s)
    assert.ok(Date.now() - started < 5000)
  } finally {
    cleanup()
  }
})
