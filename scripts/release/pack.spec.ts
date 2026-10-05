/** Real-pnpm regression coverage for release packing, selection, hooks, and payload checks. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { officialClientBuildEnvironment, writeClientBuildRecord } from '../client-build-environment.ts'
import { runGate, type Gate } from '../run-gates.ts'
import { removeFixtureSafely } from '../test-fixture-cleanup.ts'
import { releaseFamily, tarballName } from './families.ts'
import { packedIdentity, PUBLISH_ORDER_FILE, readPublishOrder } from './tarball.ts'

const require = createRequire(import.meta.url)
const packScript = resolve(import.meta.dirname, 'pack.ts')
const tsxHook = pathToFileURL(require.resolve('tsx/esm')).href
const pnpmEntry = join(dirname(require.resolve('pnpm')), 'bin/pnpm.cjs')
const roots: string[] = []
const commit = 'abcdef0'

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-release-pack-'))
  roots.push(root)
  write(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/pack-root', private: true, version: '1.2.3' }))
  write(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - vendor/*\n  - native/*\n  - packages/*/*\n  - apps/*\n')
  return root
}

function packageFixture(root: string, directory: string, name: string, additions: Record<string, unknown> = {}): void {
  write(join(root, directory, 'package.json'), JSON.stringify({
    name, version: '1.2.3', files: ['lib/index.js', 'hook.cjs'],
    scripts: {
      prepack: 'node hook.cjs prepack',
      prepare: 'node hook.cjs prepare',
      postpack: 'node hook.cjs postpack',
    },
    ...additions,
  }))
  write(join(root, directory, 'lib/index.js'), 'export const value = 1;\n')
  write(join(root, directory, 'hook.cjs'), [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const manifest = require('./package.json');",
    "fs.appendFileSync(path.join(process.env.DSH_PACK_FIXTURE, 'hooks.log'), `${manifest.name}:${process.argv[2]}\\n`);",
    '',
  ].join('\n'))
}

function packGate(root: string, args: string[] = []): Gate {
  return {
    id: 'release-pack-fixture',
    label: 'release pack fixture',
    displayCommand: 'pnpm exec node release pack fixture',
    command: process.execPath,
    args: [pnpmEntry, '--dir', root, 'exec', process.execPath, '--import', tsxHook, packScript, '--family', 'vendor', '--out', 'packed', ...args],
    env: { npm_execpath: pnpmEntry, DSH_PACK_FIXTURE: root, DSH_CLIENT_COMMIT_HASH: commit },
  }
}

async function runPack(root: string, args: string[] = []) {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, 90_000)
  try {
    const result = await runGate(packGate(root, args), controller.signal)
    expect(result.error).toBeUndefined()
    expect(result.aborted).toBe(false)
    expect(result.signalCode).toBeNull()
    return {
      status: result.exitCode,
      stderr: result.output.filter(chunk => chunk.stream === 'stderr').map(chunk => chunk.text).join(''),
    }
  } finally {
    clearTimeout(timer)
  }
}

function stopped(pid: number): boolean {
  if (process.platform === 'linux') {
    try {
      return /\)\s+Z\s/.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
      throw error
    }
  }
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true
    throw error
  }
}

function readyHookPids(root: string): number[] {
  const ready: unknown = JSON.parse(readFileSync(join(root, 'hook-ready.json'), 'utf8'))
  if (ready === null || typeof ready !== 'object' || !('hook' in ready) || !('child' in ready)
    || typeof ready.hook !== 'number' || !Number.isSafeInteger(ready.hook) || ready.hook < 1
    || typeof ready.child !== 'number' || !Number.isSafeInteger(ready.child) || ready.child < 1) {
    throw new Error('pack fixture hook readiness requires positive process ids')
  }
  return [ready.hook, ready.child]
}

afterEach(() => {
  for (const root of roots.splice(0)) removeFixtureSafely(root)
})

describe('release pack CLI', () => {
  it.each([undefined, '1', '2'])('packs only public family members and records their publish order (concurrency=%s)', async (concurrency) => {
    const root = fixture()
    // Publication places zebra before alpha; pnpm's workspace dev edge points in the opposite direction.
    packageFixture(root, 'vendor/alpha', '@deepseek-ai/alpha', { peerDependencies: { '@deepseek-ai/zebra': '*' } })
    packageFixture(root, 'vendor/zebra', '@deepseek-ai/zebra', { devDependencies: { '@deepseek-ai/alpha': 'workspace:*' } })
    write(join(root, 'vendor/zebra/node_modules/@deepseek-ai/alpha/package.json'), JSON.stringify({ name: '@deepseek-ai/alpha', version: '1.2.3' }))
    packageFixture(root, 'vendor/private', '@deepseek-ai/private', { private: true })
    packageFixture(root, 'native/unselected', '@deepseek-ai/unselected')
    const family = releaseFamily('vendor')
    const members = family.publishOrder(family.members(root)).order
    const expectedOrder = members.map(tarballName)

    const result = await runPack(root, concurrency === undefined ? [] : ['--concurrency', concurrency])

    expect(result.status, result.stderr).toBe(0)
    expect(readPublishOrder(join(root, 'packed'))).toEqual(expectedOrder)
    expect(readdirSync(join(root, 'packed')).sort()).toEqual([...expectedOrder, PUBLISH_ORDER_FILE].sort())
    for (const member of members) {
      expect(packedIdentity(join(root, 'packed', tarballName(member))))
        .toEqual({ name: member.name, version: member.version })
    }
    const hooks = readFileSync(join(root, 'hooks.log'), 'utf8').trim().split('\n')
    const expectedHooks = members.flatMap(member => ['prepack', 'prepare', 'postpack'].map(phase => `${member.name}:${phase}`))
    expect([...hooks].sort()).toEqual([...expectedHooks].sort())
    if (concurrency !== '2') expect(hooks).toEqual(expectedHooks)
  }, 120_000)

  it('does not broaden an empty parallel family to the whole workspace', async () => {
    const root = fixture()
    packageFixture(root, 'vendor/private', '@deepseek-ai/private', { private: true })
    packageFixture(root, 'native/unselected', '@deepseek-ai/unselected')

    const result = await runPack(root, ['--concurrency', '8'])

    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(join(root, 'packed', PUBLISH_ORDER_FILE), 'utf8')).toBe('\n')
    expect(readdirSync(join(root, 'packed'))).toEqual([PUBLISH_ORDER_FILE])
    expect(existsSync(join(root, 'hooks.log'))).toBe(false)
  })

  it('leaves no publish order after a pack hook fails', async () => {
    const root = fixture()
    packageFixture(root, 'vendor/failing', '@deepseek-ai/failing', { scripts: { prepack: 'node failing.cjs' } })
    write(join(root, 'vendor/failing/failing.cjs'), "throw new Error('pack fixture failure')\n")

    const result = await runPack(root, ['--concurrency', '8'])

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('pack fixture failure')
    expect(existsSync(join(root, 'packed', PUBLISH_ORDER_FILE))).toBe(false)
  })

  it('rejects a successful command that did not produce the expected member tarball', async () => {
    const root = fixture()
    packageFixture(root, 'vendor/expected', '@deepseek-ai/expected', { scripts: { prepack: 'node rename.cjs' } })
    write(join(root, 'vendor/expected/rename.cjs'), [
      "const fs = require('node:fs');",
      "const manifest = require('./package.json');",
      "manifest.name = '@deepseek-ai/renamed';",
      "fs.writeFileSync('package.json', JSON.stringify(manifest));",
      '',
    ].join('\n'))

    const result = await runPack(root, ['--concurrency', '8'])

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('@deepseek-ai/expected produced no tarball')
    expect(existsSync(join(root, 'packed', 'deepseek-ai-renamed-1.2.3.tgz'))).toBe(true)
    expect(existsSync(join(root, 'packed', PUBLISH_ORDER_FILE))).toBe(false)
  })

  it('validates every parallel tarball before recording the publish order', async () => {
    const root = fixture()
    packageFixture(root, 'packages/util/alpha', '@deepseek-ai/alpha')
    packageFixture(root, 'packages/util/zebra', '@deepseek-ai/zebra', { files: ['lib/index.js', 'src/index.ts'] })
    write(join(root, 'packages/util/zebra/src/index.ts'), 'export const source = 1\n')
    write(join(root, 'apps/web/dist/index.html'), '<main></main>')
    writeClientBuildRecord(root, officialClientBuildEnvironment(root, { DSH_CLIENT_COMMIT_HASH: commit }))

    const result = await runPack(root, ['--family', 'dsh', '--concurrency', '8'])

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('@deepseek-ai/zebra publishes source file package/src/index.ts')
    expect(readdirSync(join(root, 'packed')).filter(name => name.endsWith('.tgz'))).toHaveLength(2)
    expect(existsSync(join(root, 'packed', PUBLISH_ORDER_FILE))).toBe(false)
  })

  it('stops the ready pack hook and its stalled descendant before fixture cleanup', async () => {
    const root = fixture()
    packageFixture(root, 'vendor/stalled', '@deepseek-ai/stalled', { scripts: { prepack: 'node stalled.cjs' } })
    write(join(root, 'vendor/stalled/stalled.cjs'), [
      "const { spawn } = require('node:child_process');",
      "spawn(process.execPath, ['descendant.cjs'], { stdio: 'inherit' });",
      '',
    ].join('\n'))
    write(join(root, 'vendor/stalled/descendant.cjs'), [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "process.on('SIGTERM', () => {});",
      'setInterval(() => {}, 1000);',
      "fs.writeFileSync(path.join(process.env.DSH_PACK_FIXTURE, 'hook-ready.json'), JSON.stringify({ hook: process.ppid, child: process.pid }));",
      '',
    ].join('\n'))
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, 90_000)
    const pending = runGate(packGate(root, ['--concurrency', '8']), controller.signal)
    try {
      let pids: number[] = []
      await vi.waitFor(() => {
        pids = readyHookPids(root)
        expect(pids.every(pid => !stopped(pid))).toBe(true)
      }, { timeout: 30_000, interval: 25 })

      controller.abort()
      const result = await pending

      expect(result.aborted).toBe(true)
      expect(result.status).toBe('failed')
      await vi.waitFor(() => { expect(pids.every(stopped)).toBe(true) }, { timeout: 10_000, interval: 25 })
      expect(existsSync(join(root, 'packed', PUBLISH_ORDER_FILE))).toBe(false)
    } finally {
      clearTimeout(timer)
      controller.abort()
      await pending
    }
  }, 120_000)
})
