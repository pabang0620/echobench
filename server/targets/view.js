import { existsSync } from 'node:fs'
import path from 'node:path'
import { APP_ROOT } from '../config.js'
import { changedFiles } from '../agent/patch.js'

const SOURCE_DIR = path.join(APP_ROOT, 'targets', 'mugshop')

// True when the editable MugShop copy no longer equals the repository's planted source (someone pressed Apply).
export function isPatched(target) {
  const workspace = target.meta?.workspace
  if (target.meta?.variant !== 'planted' || !workspace || !existsSync(path.join(workspace, 'src'))) return false
  return changedFiles(SOURCE_DIR, workspace).length > 0
}

const NOTES = {
  planted: "MugShop's webhook handler has three planted bugs, documented in targets/mugshop/README.md. Everything else in MugShop is written to be correct.",
  patched: 'You applied a patch to your own working copy (other visitors still see the planted bugs). EchoBench re-ran every scenario on it; the counts above are those results. Press "Reset to planted bugs" to drop your copy.',
  contrast: "Not a planted bug. This is MugShop's reference fix with the plan's refund claim and retry switched off (REFUND_CLAIM=off), to show what the Contract tab catches when the plan's promise is missing.",
}

// What the screen needs to know about a target. The label follows the state of the working copy, so it is never stale.
export function targetView(target) {
  const patched = isPatched(target)
  return {
    id: target.id,
    label: patched ? 'MugShop (your patched copy)' : target.label,
    variant: target.meta?.variant || null,
    editable: Boolean(target.meta?.editable),
    patched,
    note: patched ? NOTES.patched : NOTES[target.meta?.variant] || null,
    capabilities: target.capabilities,
  }
}
