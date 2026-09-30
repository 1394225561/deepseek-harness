/** Desktop preparation publishes one package manager alongside its private Node launchers. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ root: '' }))
vi.mock('../scripts/desktop-build-paths.mjs', () => ({
  resolveDesktopBuildTarget: () => 'mac-arm64',
  resolveDesktopTargetBuildPaths: () => ({
    runtime: join(state.root, 'runtime'), electron: join(state.root, 'electron'), downloads: join(state.root, 'downloads'),
  }),
}))
vi.mock('@electron/get', () => ({ downloadArtifact: async () => 'electron.zip' }))
vi.mock('extract-zip', () => ({ default: async () => {} }))
vi.mock('node:child_process', () => ({ execFileSync: () => '24.18.1\n' }))
vi.mock('../scripts/prepare-command-link.ts', () => ({ prepareCommandLink: () => {} }))
// The source-plane preparation spec supplies the one compiled CLI input; other copies use real files.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, cpSync: (...args: Parameters<typeof actual.cpSync>) => {
    if (String(args[0]).endsWith(join('lib', 'command-manager-entry.js'))) actual.writeFileSync(args[1], '')
    else actual.cpSync(...args)
  } }
})
vi.mock('../scripts/prepare-primary-runtime.ts', () => ({
  preparePrimaryRuntime: async () => {
    const root = join(state.root, 'runtime', 'primary-runtime')
    const pnpm = join(root, 'dependencies', 'pnpm', 'bin')
    mkdirSync(pnpm, { recursive: true })
    writeFileSync(join(pnpm, 'pnpm.mjs'), '')
    writeFileSync(join(root, 'runtime.json'), JSON.stringify({ pnpm: '11.7.0' }))
  },
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  rmSync(state.root, { recursive: true, force: true })
})

it('replaces stale resources with one pnpm distribution and records its version', async () => {
  state.root = mkdtempSync(join(tmpdir(), 'desktop-runtime-preparation-'))
  const runtime = join(state.root, 'runtime')
  mkdirSync(join(runtime, 'pnpm'), { recursive: true })
  vi.stubGlobal('process', { ...process, argv: [process.execPath, 'prepare-runtime.ts'] })
  vi.stubEnv('DSH_DESKTOP_PACKAGING_RUN_DIR', undefined)
  await import('../scripts/prepare-runtime.ts')
  expect(existsSync(join(runtime, 'pnpm'))).toBe(false)
  expect(existsSync(join(runtime, 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'))).toBe(true)
  expect(existsSync(join(runtime, 'bin', 'node'))).toBe(true)
  expect(existsSync(join(runtime, 'cli', 'bin', 'dsh'))).toBe(true)
  expect(existsSync(join(runtime, 'cli', 'command-manager.js'))).toBe(true)
  expect(JSON.parse(readFileSync(join(runtime, 'versions.json'), 'utf8'))).toEqual({
    schemaVersion: 1, node: '24.18.1', pnpm: '11.7.0',
  })
})
