/** Workspace bundle discovery after a package moves or is removed. */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { build, type TsdownBundle } from 'tsdown'
import { describe, expect, it, onTestFinished } from 'vitest'
import { buildWorkspaceDirectories } from './build-workspace.ts'
import { removeFixtureSafely } from './test-fixture-cleanup.ts'

function write(root: string, path: string, content: string): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

describe('repository bundle workspaces', () => {
  it.each(['host', 'client'] as const)('builds live %s packages without bundling a moved package’s residue', async (face) => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-build-workspace-'))
    onTestFinished(() => { removeFixtureSafely(root) })
    write(root, 'package.json', JSON.stringify({ private: true, type: 'module' }))
    const shared = [
      'apps/cli',
      'packages/experimental/session-title-all-prompts-llm',
      'packages/session/session-title-llm',
      'vendor/cordis',
    ]
    for (const directory of [...shared, 'apps/desktop-host', 'apps/desktop', 'apps/web', 'native/system']) {
      write(root, `${directory}/package.json`, JSON.stringify({ name: directory.replaceAll('/', '-'), type: 'module' }))
      write(root, `${directory}/lib/types/index.js`, 'export const executeSessionTitleLlm = "live"\n')
    }
    const staleEntry = 'packages/session/session-title-all-prompts-llm/lib/types/index.js'
    const staleCode = 'export { registerSessionTitleLlmProvider } from "../../../session-title-llm/lib/types/index.js"\n'
    write(root, staleEntry, staleCode)
    write(root, 'packages/session/session-title-all-prompts-llm/node_modules/.cache/residue', '')

    const workspace = buildWorkspaceDirectories(root, face)
    const expected = [...shared, ...face === 'host' ? ['apps/desktop-host'] : []].sort()
    expect(workspace).toEqual(expected)

    let bundles: TsdownBundle[] = []
    try {
      bundles = await build({
        cwd: root, workspace, config: false, tsconfig: false,
        entry: ['lib/types/index.js'], outDir: 'lib', format: 'esm', platform: 'node',
        dts: false, clean: false, report: false, logLevel: 'silent',
      })
      for (const directory of expected) {
        expect(readFileSync(join(root, directory, 'lib/index.mjs'), 'utf8')).toContain('executeSessionTitleLlm')
      }
      expect(readFileSync(join(root, staleEntry), 'utf8')).toBe(staleCode)
    } finally {
      for (const bundle of bundles) await bundle[Symbol.asyncDispose]()
    }
  })
})
