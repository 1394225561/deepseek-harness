/** Exercise the published webhook example from an isolated installed Web profile. */
import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, globSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import yaml from 'js-yaml'
import { expect, it, onTestFinished } from 'vitest'
import { pnpmCommand } from '../../../../scripts/release/process.ts'
import { packedWorkspaceClosure, type WorkspacePackage } from '../../../../packages/sandbox/sandbox-local/tests/packed-workspace-closure.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const adapter = '@deepseek-ai/dsh-experimental-webhook-github'
const runtime = '@deepseek-ai/dsh-experimental-webhook'
const built = existsSync(join(root, 'apps/cli/lib/bin.js'))
  && existsSync(join(root, 'packages/experimental/webhook-github/lib/index.js'))
const secret = 'packed-webhook-test-secret'

/** Capture workspace dependency links without following their targets. */
async function workspaceLinks(directories: string[]): Promise<Record<string, string>> {
  const links: Record<string, string> = {}
  for (const directory of directories) {
    const modules = join(directory, 'node_modules')
    links[modules] = existsSync(modules) ? 'directory' : 'absent'
    if (!existsSync(modules)) continue
    for (const entry of await readdir(modules, { withFileTypes: true })) {
      const path = join(modules, entry.name)
      const paths = entry.name.startsWith('@') && entry.isDirectory()
        ? (await readdir(path)).map(name => join(path, name)) : [path]
      for (const dependency of paths) {
        const stat = await lstat(dependency)
        links[dependency] = stat.isSymbolicLink() ? await readlink(dependency) : stat.isDirectory() ? 'directory' : 'file'
      }
    }
  }
  return links
}

/** Reject workspace links throughout the installed dependency tree. */
async function assertInstalledTree(directory: string): Promise<void> {
  const installedRoot = await realpath(directory)
  const visited = new Set<string>()
  const visit = async (path: string): Promise<void> => {
    const resolved = await realpath(path)
    expect(resolved === installedRoot || resolved.startsWith(installedRoot + sep), `${path} escapes its installation`).toBe(true)
    if (visited.has(resolved)) return
    visited.add(resolved)
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isSymbolicLink()) {
        const target = await realpath(child)
        expect(target.startsWith(installedRoot + sep), `${child} escapes its installation`).toBe(true)
      } else if (entry.isDirectory()) await visit(child)
    }
  }
  await visit(directory)
}

it.skipIf(!built)('loads the packed GitHub example with its explicitly installed runtime peer', {
  // Packing and installing the complete product closure owns this budget; no model request runs.
  timeout: 360_000,
  retry: 0,
}, async () => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'dsh-webhook-packed-')))
  onTestFinished(() => rm(temporary, { recursive: true, force: true }))
  const installation = join(temporary, 'installation')
  const home = join(temporary, 'home')
  const profile = join(home, 'profiles', 'web')
  const archives = join(temporary, 'archives')
  await mkdir(profile, { recursive: true })
  await mkdir(archives)
  const environment: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => (
    !/KEY|SECRET|TOKEN|PASSWORD/.test(key) && key !== 'NODE_OPTIONS' && key !== 'NODE_PATH'
  )))
  Object.assign(environment, {
    DSH_HOME: home,
    DSH_AGENTS_HOME: join(temporary, 'agents'),
    DSH_TELEMETRY_DISABLED: '1',
    DSH_GITHUB_WEBHOOK_SECRET: secret,
    DSH_GITHUB_WEBHOOK_PORT: '0',
    CI: 'true',
  })
  const [pnpm, ...prefix] = pnpmCommand()
  const packageCommand = async (args: string[], cwd: string) => {
    const result = await execa(pnpm, [...prefix, ...args], {
      cwd, env: environment, extendEnv: false, timeout: 180_000, reject: false,
    })
    expect(result.timedOut, `${result.stdout}\n${result.stderr}`).toBe(false)
    expect(result.signal, result.stderr).toBeUndefined()
    expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(0)
    return result
  }
  const packages = new Map<string, WorkspacePackage>()
  for (const path of globSync([
    'apps/*/package.json', 'packages/*/*/package.json', 'vendor/*/package.json', 'native/system/packages/*/package.json',
  ], { cwd: root })) {
    const manifest = JSON.parse(await readFile(join(root, path), 'utf8')) as Record<string, unknown>
    if (typeof manifest.name !== 'string') throw new Error(`${path} has no package name`)
    packages.set(manifest.name, { name: manifest.name, manifest, directory: dirname(join(root, path)) })
  }
  const sourceDirectories = [root, ...[...packages.values()].map(member => member.directory)]
  const initialLinks = await workspaceLinks(sourceDirectories)
  onTestFinished(async () => { expect(await workspaceLinks(sourceDirectories)).toEqual(initialLinks) })
  const closure = packedWorkspaceClosure('@deepseek-ai/dsh', packages)
  // A signed ping creates no Session and runs no confined process. The native
  // platform packages load lazily for those operations and have separate smokes.
  const runtimeMembers = closure.filter(member => (
    !member.name.startsWith('@deepseek-ai/node-addon-system-')
    && (!Array.isArray(member.manifest.os) || member.manifest.os.includes(process.platform))
    && (!Array.isArray(member.manifest.cpu) || member.manifest.cpu.includes(process.arch))
  ))
  const members = new Map(runtimeMembers.map(member => [member.name, member]))
  for (const name of [runtime, adapter]) {
    const member = packages.get(name)
    if (member === undefined) throw new Error(`missing workspace package ${name}`)
    members.set(name, member)
  }
  // Packing reads package-owned files; installation never runs in the workspace.
  await packageCommand([
    'pack', '--recursive', '--workspace-concurrency=4',
    ...[...members.keys()].map(name => `--filter=${name}`), '--pack-destination', archives,
  ], root)
  const tarballs = new Map([...members.values()].map((member) => {
    if (typeof member.manifest.version !== 'string') throw new Error(`${member.name} has no version`)
    const name = member.name.replaceAll('/', '-').replace('@', '')
    const archive = join(archives, `${name}-${member.manifest.version}.tgz`)
    expect(existsSync(archive), `missing packed payload for ${member.name}`).toBe(true)
    return [member.name, archive]
  }))
  const workspaceSettings = yaml.load(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')) as {
    allowBuilds: Record<string, boolean>
    patchedDependencies: Record<string, string>
    minimumReleaseAgeExclude: string[]
    overrides: Record<string, string>
  }
  const externalVersions: Record<string, string> = {}
  for (const member of members.values()) {
    const require = createRequire(join(member.directory, 'package.json'))
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      const dependencies = member.manifest[section] as Record<string, string> | undefined
      for (const [name, range] of Object.entries(dependencies ?? {})) {
        if (range.startsWith('workspace:')) continue
        const manifest = require.resolve.paths(name)?.map(path => join(path, name, 'package.json')).find(path => existsSync(path))
        if (manifest === undefined) continue
        const installed = JSON.parse(await readFile(manifest, 'utf8')) as { version: string }
        externalVersions[`${name}@${range}`] = installed.version
      }
    }
  }
  await mkdir(installation)
  for (const path of Object.values(workspaceSettings.patchedDependencies)) {
    await mkdir(dirname(join(installation, path)), { recursive: true })
    await writeFile(join(installation, path), await readFile(join(root, path)))
  }
  await writeFile(join(installation, 'package.json'), JSON.stringify({
    name: 'packed-webhook-installation', private: true,
    dependencies: Object.fromEntries(runtimeMembers.map(member => [member.name, `file:${tarballs.get(member.name)!}`])),
  }))
  await writeFile(join(installation, 'pnpm-workspace.yaml'), yaml.dump({
    packages: ['.'], nodeLinker: 'hoisted', autoInstallPeers: false, allowUnusedPatches: true,
    ignoredOptionalDependencies: closure.filter(member => !members.has(member.name)).map(member => member.name),
    allowBuilds: {
      ...workspaceSettings.allowBuilds,
      [`@deepseek-ai/dsh-subprocess-local@file:${relative(installation, tarballs.get('@deepseek-ai/dsh-subprocess-local')!).split(sep).join('/')}`]: true,
    },
    patchedDependencies: workspaceSettings.patchedDependencies,
    minimumReleaseAgeExclude: workspaceSettings.minimumReleaseAgeExclude,
    overrides: {
      ...workspaceSettings.overrides,
      ...externalVersions,
      ...Object.fromEntries(runtimeMembers.map(member => [member.name, `file:${tarballs.get(member.name)!}`])),
    },
  }))
  await packageCommand(['install', '--offline', '--no-frozen-lockfile'], installation)
  await assertInstalledTree(installation)
  expect(existsSync(join(installation, 'node_modules', runtime))).toBe(false)
  expect(existsSync(join(installation, 'node_modules', adapter))).toBe(false)
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'packed-webhook-profile', private: true, dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }))
  const profileDependencies = new Set([runtime, adapter])
  for (const name of profileDependencies) {
    const member = members.get(name)
    if (member === undefined) throw new Error(`missing packed dependency ${name}`)
    for (const [dependency, range] of Object.entries(member.manifest.dependencies as Record<string, string> | undefined ?? {})) {
      if (range.startsWith('workspace:')) profileDependencies.add(dependency)
    }
  }
  await writeFile(join(profile, 'pnpm-workspace.yaml'), yaml.dump({
    packages: ['.'], nodeLinker: 'hoisted', autoInstallPeers: false,
    overrides: {
      ...externalVersions,
      ...Object.fromEntries([...profileDependencies].map(name => [name, `file:${tarballs.get(name)!}`])),
    },
  }))
  const adapterArchive = tarballs.get(adapter)
  const runtimeArchive = tarballs.get(runtime)
  if (adapterArchive === undefined || runtimeArchive === undefined) throw new Error('webhook tarballs were not packed')
  await packageCommand(['add', runtimeArchive, adapterArchive, '--offline', '--ignore-scripts'], profile)
  const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
  expect(Object.keys(manifest.dependencies).sort()).toEqual([runtime, adapter].sort())
  await assertInstalledTree(profile)

  const example = join(profile, 'node_modules', adapter, 'examples/github-review/cordis.yml')
  expect(existsSync(example)).toBe(true)
  expect(existsSync(join(dirname(example), 'github-ready-review-rule.mjs'))).toBe(true)
  const observer = join(temporary, 'observe-ingress.mjs')
  await writeFile(observer, `export const name = 'observe-packed-ingress'
export const inject = ['webServer', 'webhookRuntime']
export function apply(ctx) {
  process.stdout.write('PACKED_WEBHOOK_READY=http://127.0.0.1:' + ctx.webServer.port + '\\n')
}
`)
  const patch = join(temporary, 'test.patch.yml')
  await writeFile(patch, yaml.dump([
    { id: 'session-telemetry-otel', disabled: true },
    { id: 'github-webhook-ingress', insert: [{ id: 'observe-packed-ingress', name: observer }] },
  ]))
  const child = execa(process.execPath, [
    join(installation, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', example, '--patch', patch, '--no-open', '--port', '0',
  ], { cwd: temporary, env: environment, extendEnv: false, reject: false, timeout: 90_000 })
  try {
    const ready = new Promise<string>((resolveReady, rejectReady) => {
      let output = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString()
        const origin = /PACKED_WEBHOOK_READY=(http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1]
        if (origin !== undefined && output.includes('dsh web: ')) resolveReady(origin)
      })
      void child.then((result) => {
        rejectReady(new Error(`Web profile exited before readiness:\n${result.stdout}\n${result.stderr}`))
      })
    })
    const origin = await ready
    expect((await fetch(`${origin}/api`, { signal: AbortSignal.timeout(10_000) })).status).toBe(404)
    const body = JSON.stringify({ zen: 'A signed ping does not start an Agent.' })
    const response = await fetch(`${origin}/github`, {
      method: 'POST', body, signal: AbortSignal.timeout(10_000),
      headers: {
        'content-type': 'application/json', 'x-github-event': 'ping', 'x-github-delivery': 'packed-ping',
        'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
      },
    })
    expect(response.status, await response.text()).toBe(202)
  } finally {
    child.kill('SIGTERM')
    const result = await child
    expect(result.timedOut, `${result.stdout}\n${result.stderr}`).toBe(false)
    expect(result.exitCode === 0 || result.signal === 'SIGTERM', result.stderr).toBe(true)
  }
  expect(globSync('sessions/**/*.jsonl*', { cwd: home })).toEqual([])
})
