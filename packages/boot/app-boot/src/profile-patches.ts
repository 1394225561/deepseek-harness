/** Compile preset-scoped profile operations to the native Include patch language. */

import { applyEntryPatches, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'

/** A native entry patch, optionally applied inside one preset row's `config.plugins`. */
export interface ProfilePatch extends PatchOptions {
  /** Literal id of an addressable outer preset row; `id` then addresses one of its child rows. */
  preset?: string
}

/** Native Include diagnostic arguments.
 * @param message Diagnostic format; `%C` marks a value rendered as code.
 * @param args Values substituted into the diagnostic format.
 */
export type ProfilePatchWarning = (message: string, ...args: unknown[]) => void

function visitRows(rows: readonly EntryOptions[], visit: (row: EntryOptions) => void): void {
  for (const row of rows) {
    visit(row)
    if (row.group && Array.isArray(row.config)) visitRows(row.config as EntryOptions[], visit)
  }
}

/** Validate the profile-only target while keeping native patch fields under Include's existing rules.
 * @param patch Parsed or programmatically supplied profile patch.
 * @returns The literal outer row id, or undefined for an ordinary patch.
 * @throws When a declared preset target is not a nonempty literal string.
 */
export function profilePatchPreset(patch: ProfilePatch): string | undefined {
  if (!Object.hasOwn(patch, 'preset')) return undefined
  if (typeof patch.preset !== 'string' || patch.preset.trim() === '') {
    throw new Error('profile patch preset must be a nonempty literal row id')
  }
  return patch.preset
}

function targetOf(initial: EntryOptions[], patches: PatchOptions[], preset: string): EntryOptions {
  // The native index retains replaced-away children and never indexes replacement-created children.
  // A marker override locates its actual reachable target without rebuilding that index from the result.
  const marker = {}
  const rows = applyEntryPatches(initial, [...structuredClone(patches), { id: preset, inject: marker }], () => {})
  let target: EntryOptions | undefined
  visitRows(rows, (row) => { if (row.inject === marker) target = row })
  if (target === undefined) throw new Error(`profile patch preset ${JSON.stringify(preset)} is missing or not addressable`)
  const config: unknown = target.config
  if (config === null || typeof config !== 'object' || Array.isArray(config) || !Array.isArray(Reflect.get(config, 'plugins'))) {
    throw new Error(`profile patch preset ${JSON.stringify(preset)} must have a literal config.plugins entry list`)
  }
  return target
}

function assertInsertedIds(preset: string, rows: readonly EntryOptions[]): void {
  const ids = new Set<string>()
  visitRows(rows, (row) => {
    if (!row.id) return
    if (ids.has(row.id)) throw new Error(`profile patch preset ${JSON.stringify(preset)} has duplicate entry id ${JSON.stringify(row.id)}`)
    ids.add(row.id)
  })
}

/** Lower preset operations to native whole-config replacements without changing native root patch indexing.
 * Each scoped operation sees the then-current preset children. Inputs remain unchanged.
 * @param initial Root entries before profile patches.
 * @param patches Complete ordered profile patch list.
 * @param warn Diagnostic sink for scoped child patches; ordinary patches report when Include applies the result.
 * @returns Detached native patches, suitable for the root Include.
 * @throws For malformed or unaddressable preset targets and duplicate inserted child ids.
 */
export function compileProfilePatches(
  initial: EntryOptions[], patches: readonly ProfilePatch[], warn: ProfilePatchWarning = () => {},
): PatchOptions[] {
  const lowered: PatchOptions[] = []
  for (const patch of structuredClone(patches)) {
    const preset = profilePatchPreset(patch)
    if (preset === undefined) {
      lowered.push(patch)
      continue
    }
    const target = targetOf(initial, lowered, preset)
    const config = target.config as Record<string, unknown> & { plugins: EntryOptions[] }
    const { preset: _preset, ...operation } = patch
    const plugins = applyEntryPatches(config.plugins, [operation], (message: string, ...args: unknown[]) => {
      warn(`preset ${JSON.stringify(preset)}: ${message}`, ...args)
    })
    if (operation.insert !== undefined) assertInsertedIds(preset, plugins)
    lowered.push({ id: preset, config: { ...config, plugins } })
  }
  return lowered
}

/** Compose root entries and profile patches with the same compiler used for startup and reload.
 * @param initial Root entries before profile patches.
 * @param patches Complete ordered profile patch list.
 * @param warn Diagnostic sink for unmatched ordinary and scoped child patches.
 * @returns The effective entry list, with expressions unevaluated.
 * @throws For malformed or unaddressable preset targets and duplicate inserted child ids.
 */
export function applyProfilePatches(
  initial: EntryOptions[], patches: readonly ProfilePatch[], warn: ProfilePatchWarning = () => {},
): EntryOptions[] {
  return applyEntryPatches(initial, compileProfilePatches(initial, patches, warn), warn)
}
