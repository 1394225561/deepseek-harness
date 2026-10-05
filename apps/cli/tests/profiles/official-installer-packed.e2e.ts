/** Install actual packed Official providers through the ordinary manager in a source-independent Web process. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, globSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import yaml from 'js-yaml'
import { expect, it, onTestFinished } from 'vitest'
import type { BundleInfo, ChangeResult } from '@deepseek-ai/dsh-plugin-manager'
import { packedManifest } from '../../../../scripts/release/tarball.ts'
import { assertInstalledTree, createPackedInstallation } from './packed-installation.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const packages = ['@deepseek-ai/dsh-subagent-claude-code', '@deepseek-ai/dsh-subagent-codex']
const built = existsSync(join(root, 'apps/cli/lib/bin.js'))
  && packages.every(name => existsSync(join(root, 'packages/subagent', name.slice('@deepseek-ai/dsh-'.length), 'lib/index.js')))

interface Observation {
  initial: BundleInfo[]
  sessionCount: number
  steps: Array<{
    name: string
    install: ChangeResult
    savedVersion: string
    installed: BundleInfo
    providerEnabled: boolean
    nativeArtifact: boolean
    presets: Array<{ id: string; broken?: string }>
    unavailable: ChangeResult
    unchangedAfterUnavailable: boolean
    off: ChangeResult
    disabled: BundleInfo
    on: ChangeResult
    enabled: BundleInfo
    removed: ChangeResult
    absent: BundleInfo
  }>
}

it.skipIf(!built)('installs exact Official versions and switches/removes them through the generic package manager', {
  // Real tarball packing and isolated dependency installation own this budget; no native model request runs.
  timeout: 360_000,
  retry: 0,
}, async () => {
  const fixture = await createPackedInstallation('dsh-official-packed-', packages)
  const { temporary, installation, home, profile, environment, tarballs, members, externalVersions } = fixture
  const manifests = new Map(packages.map((name) => {
    const archive = tarballs.get(name)
    if (archive === undefined) throw new Error(`missing provider archive ${name}`)
    return [name, { archive, manifest: packedManifest(archive) }]
  }))
  const version = manifests.get(packages[0]!)?.manifest.version
  if (typeof version !== 'string') throw new Error('packed provider has no version')
  const integrity = new Map(await Promise.all([...manifests].map(async ([name, entry]) =>
    [name, `sha512-${createHash('sha512').update(await readFile(entry.archive)).digest('base64')}`] as const)))
  const requests: string[] = []
  let requestsBeforeCatalog: string[] | undefined
  let registry = ''
  const namespace = `/${randomUUID()}/`
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://registry.invalid').pathname
    if (!pathname.startsWith(namespace)) { response.writeHead(404).end(); return }
    const path = decodeURIComponent(pathname.slice(namespace.length))
    if (path === 'catalog-observed') {
      requestsBeforeCatalog = [...requests]
      response.end('ok')
      return
    }
    requests.push(path)
    const archive = [...manifests].find(([name]) => path === `tarballs/${name}`)?.[1].archive
    if (archive !== undefined) {
      response.setHeader('content-type', 'application/octet-stream')
      createReadStream(archive).on('error', error => response.destroy(error)).pipe(response)
      return
    }
    const entry = manifests.get(path)
    if (entry === undefined) {
      // Only package publication is local: third-party metadata and payloads retain npm's real bytes.
      response.writeHead(302, { location: `https://registry.npmjs.org/${request.url?.slice(namespace.length) ?? ''}` }).end()
      return
    }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ name: path, 'dist-tags': { latest: version }, time: { [version]: '2000-01-01T00:00:00.000Z' },
      versions: { [version]: { ...entry.manifest, dist: { tarball: `${registry}tarballs/${encodeURIComponent(path)}`, integrity: integrity.get(path) } } },
    }))
  })
  onTestFinished(async () => {
    server.closeAllConnections()
    if (!server.listening) return
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => { if (error) reject(error); else resolveClose() })
    })
  })
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolveListen() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test registry has no TCP address')
  registry = `http://127.0.0.1:${String(address.port)}${namespace}`

  const dependencies = new Set(packages)
  for (const name of dependencies) {
    const member = members.get(name)
    if (member === undefined) throw new Error(`missing packed dependency ${name}`)
    for (const [dependency, range] of Object.entries(member.manifest.dependencies as Record<string, string> | undefined ?? {})) {
      if (range.startsWith('workspace:')) dependencies.add(dependency)
    }
  }
  for (const name of packages) {
    dependencies.delete(name)
    expect(existsSync(join(installation, 'node_modules', name))).toBe(false)
  }
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'packed-official-profile', private: true, dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }))
  const lock = yaml.load(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8')) as {
    packages: Record<string, { os?: string[]; cpu?: string[]; libc?: string[] }>
    snapshots: Record<string, { optionalDependencies?: Record<string, string> }>
  }
  const report = process.report.getReport() as { header: { glibcVersionRuntime?: string } }
  const libc = process.platform === 'linux' ? report.header.glibcVersionRuntime === undefined ? 'musl' : 'glibc' : undefined
  // The fixture owns one host installation; foreign native artifacts are never executed or required here.
  const foreignPackages = new Set(Object.entries(lock.packages).filter(([, constraints]) =>
    ([['os', process.platform], ['cpu', process.arch], ['libc', libc]] as const).some(([field, current]) => {
      const allowed = constraints[field]
      return current !== undefined && allowed !== undefined && !allowed.includes(current)
        && !allowed.includes('any') && allowed.every(value => !value.startsWith('!'))
    })).map(([name]) => name))
  const ignoredOptionalDependencies = [...new Set(Object.values(lock.snapshots).flatMap(snapshot =>
    Object.entries(snapshot.optionalDependencies ?? {})
      .filter(([name, version]) => foreignPackages.has(`${name}@${version}`) || foreignPackages.has(version)).map(([name]) => name)))]
  const nativePackages = {
    '@deepseek-ai/dsh-subagent-claude-code': `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${libc === 'musl' ? '-musl' : ''}`,
    '@deepseek-ai/dsh-subagent-codex': `@openai/codex-${process.platform}-${process.arch}`,
  }
  for (const name of Object.values(nativePackages)) expect(ignoredOptionalDependencies).not.toContain(name)
  await writeFile(join(profile, 'pnpm-workspace.yaml'), yaml.dump({ packages: ['.'], nodeLinker: 'hoisted', autoInstallPeers: false,
    ignoredOptionalDependencies,
    overrides: { ...externalVersions, ...Object.fromEntries([...dependencies].map(name => [name, `file:${tarballs.get(name)!}`])) },
  }))
  const externalScopes = new Set(Object.keys(externalVersions)
    .filter(name => name.startsWith('@') && !name.startsWith('@deepseek-ai/')).map(name => name.slice(0, name.indexOf('/'))))
  await writeFile(join(profile, '.npmrc'), [...externalScopes].map(scope => `${scope}:registry=https://registry.npmjs.org/`).join('\n') + '\n')
  const userConfig = join(temporary, 'empty.npmrc')
  await writeFile(userConfig, '')
  environment.npm_config_userconfig = userConfig
  const observer = join(temporary, 'official-installer-observer.mjs')
  await writeFile(observer, await readFile(new URL('./fixtures/official-installer-observer.mjs', import.meta.url), 'utf8'))
  const patch = join(temporary, 'official-installer.patch.yml')
  await writeFile(patch, yaml.dump([{ insert: [{ id: 'official-installer-observer', name: observer,
    config: { registry, profile, packages, nativePackages },
  }] }]))
  const child = execa(process.execPath, [join(installation, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
    'web', '--patch', patch, '--no-open', '--port', '0'], {
    cwd: temporary, env: environment, extendEnv: false, reject: false, timeout: 240_000,
  })
  if (child.stdout === null) throw new Error('installed Web process has no stdout')
  const lines = createInterface({ input: child.stdout })
  try {
    const observed = await new Promise<Observation>((resolveObservation, reject) => {
      lines.on('line', (line) => {
        if (!line.startsWith('PACKED_OFFICIAL_RESULT=')) return
        const report = JSON.parse(line.slice('PACKED_OFFICIAL_RESULT='.length)) as { value?: Observation; error?: string }
        if (report.error !== undefined) reject(new Error(report.error))
        else if (report.value !== undefined) resolveObservation(report.value)
      })
      void child.then((result) => { reject(new Error(`Web process exited before observation:\n${result.stdout}\n${result.stderr}`)) })
    })
    expect(requestsBeforeCatalog).toEqual([])
    for (const name of packages) expect(observed.initial.find(entry => entry.name === name)).toMatchObject({
      official: true, availability: 'missing', installed: false, enabled: false, installTarget: { spec: `${name}@${version}`, version },
    })
    for (const step of observed.steps) {
      expect(step.install, JSON.stringify(step.install)).toMatchObject({ application: 'applied', enabled: true, version })
      expect(step.savedVersion).toBe(version)
      expect(step.installed).toMatchObject({ official: true, availability: 'profile', enabled: true, installed: true, version })
      expect(step.installed.rows.filter(row => row.preset !== undefined).map(row => row.preset).sort())
        .toEqual(['preset-cordis', 'preset-ptc', 'preset-standard'])
      expect(step.providerEnabled).toBe(true)
      expect(step.nativeArtifact).toBe(true)
      expect(step.presets.every(preset => preset.broken === undefined)).toBe(true)
      expect(step.unavailable).toMatchObject({ application: 'failed', stage: 'install' })
      expect(step.unchangedAfterUnavailable).toBe(true)
      expect(step.off).toMatchObject({ application: 'applied' })
      expect(step.disabled).toMatchObject({ official: true, installed: true, enabled: false })
      expect(step.on).toMatchObject({ application: 'applied' })
      expect(step.enabled).toMatchObject({ official: true, installed: true, enabled: true })
      expect(step.removed, JSON.stringify(step.removed)).toMatchObject({ application: 'applied' })
      expect(step.absent).toMatchObject({ official: true, availability: 'missing', enabled: false, installed: false })
    }
    expect(observed.steps).toHaveLength(packages.length)
    expect(observed.sessionCount).toBe(0)
    expect(globSync('sessions/**/*.jsonl*', { cwd: home })).toEqual([])
    await assertInstalledTree(profile)
  } finally {
    lines.close()
    child.kill('SIGTERM')
    const result = await child
    expect(result.timedOut, `${result.stdout}\n${result.stderr}`).toBe(false)
    expect(result.exitCode === 0 || result.signal === 'SIGTERM', result.stderr).toBe(true)
  }
})
