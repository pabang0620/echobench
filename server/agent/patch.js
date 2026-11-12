import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { APP_ROOT } from '../config.js'
import { newId } from '../store.js'
import { linkDependencies } from '../targets/mugshop.js'
import { unifiedDiff } from './diff.js'

// A patch never touches the running workspace. It is applied to a copy (a "candidate"), the copy is
// type-checked with tsc, and only then re-run by the scenarios. Apply copies the candidate files
// over the workspace, after a person confirms.

// The model may change the handler logic only. The adapter the judge reads (state.ts, server.ts, db.ts),
// the configuration and the PayPal client port are out of reach, so a patch cannot change what is judged.
export const PATCHABLE_FILES = ['src/webhook.ts', 'src/checkout.ts', 'src/refunds.ts', 'src/events.ts', 'src/money.ts', 'src/signature.ts']

export function candidateDir(dataDir, id) {
  return path.join(dataDir, 'candidates', id)
}

export function createCandidate(dataDir, baseWorkspace) {
  const id = newId('cand')
  const dir = candidateDir(dataDir, id)
  mkdirSync(dir, { recursive: true })
  cpSync(path.join(baseWorkspace, 'src'), path.join(dir, 'src'), { recursive: true })
  cpSync(path.join(baseWorkspace, 'tsconfig.json'), path.join(dir, 'tsconfig.json'))
  linkDependencies(dir)
  return { id, dir }
}

export function discardCandidate(dir) {
  rmSync(dir, { recursive: true, force: true })
}

// edits: [{ file, old_str, new_str }] or [{ file, content }]. All or none.
export function applyEdits(dir, edits) {
  const staged = new Map()
  for (const edit of edits) {
    if (!PATCHABLE_FILES.includes(edit.file)) throw new Error(`Patch rejected: ${edit.file} is not a source file the model may change. Handler files only: ${PATCHABLE_FILES.join(', ')}`)
    const target = path.resolve(dir, edit.file)
    if (!target.startsWith(`${path.resolve(dir)}${path.sep}`)) throw new Error('Patch rejected: path escapes the copy')
    const current = staged.get(target) ?? (existsSync(target) ? readFileSync(target, 'utf8') : null)
    if (typeof edit.content === 'string') {
      staged.set(target, edit.content)
      continue
    }
    if (current === null) throw new Error(`Patch rejected: ${edit.file} does not exist`)
    const first = current.indexOf(edit.old_str)
    if (first < 0 || current.indexOf(edit.old_str, first + 1) >= 0) throw new Error(`Patch rejected: old_str must occur exactly once in ${edit.file}`)
    staged.set(target, current.replace(edit.old_str, () => edit.new_str))
  }
  for (const [target, text] of staged) writeFileSync(target, text)
  return [...staged.keys()].map((t) => path.relative(dir, t))
}

export function typecheck(dir) {
  return new Promise((resolve) => {
    const tsc = path.join(APP_ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
    const child = spawn(process.execPath, [tsc, '-p', path.join(dir, 'tsconfig.json')], { cwd: APP_ROOT })
    let output = ''
    child.stdout.on('data', (c) => (output += c))
    child.stderr.on('data', (c) => (output += c))
    child.on('exit', (code) => resolve({ ok: code === 0, output: output.trim().slice(0, 3000) }))
  })
}

export function diffAgainst(baseDir, candDir) {
  const parts = []
  const files = new Set([...readdirSync(path.join(candDir, 'src')), ...readdirSync(path.join(baseDir, 'src'))])
  for (const name of [...files].sort()) {
    const before = existsSync(path.join(baseDir, 'src', name)) ? readFileSync(path.join(baseDir, 'src', name), 'utf8') : ''
    const after = existsSync(path.join(candDir, 'src', name)) ? readFileSync(path.join(candDir, 'src', name), 'utf8') : ''
    const diff = unifiedDiff(before, after, `src/${name}`)
    if (diff) parts.push(diff)
  }
  return parts.join('\n')
}

export function changedFiles(baseDir, candDir) {
  return readdirSync(path.join(candDir, 'src')).filter((name) => {
    const base = path.join(baseDir, 'src', name)
    return !existsSync(base) || readFileSync(base, 'utf8') !== readFileSync(path.join(candDir, 'src', name), 'utf8')
  }).map((name) => `src/${name}`)
}

// Copies the changed candidate files over the workspace. Caller has already checked the confirmation.
export function applyCandidate(baseDir, candDir) {
  const files = changedFiles(baseDir, candDir)
  const refused = files.filter((f) => !PATCHABLE_FILES.includes(f))
  if (refused.length) throw new Error(`Apply refused: ${refused.join(', ')} is not a handler file`)
  for (const file of files) cpSync(path.join(candDir, file), path.join(baseDir, file))
  return files
}
