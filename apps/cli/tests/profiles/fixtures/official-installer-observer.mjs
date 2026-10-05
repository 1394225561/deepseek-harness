/** Observe ordinary manager operations in an installed Web profile without starting native agents. */
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

export const name = 'official-installer-observer'
export const inject = ['pluginManager', 'agentPresets', 'subagents', 'sessions', 'appReady']

export function apply(ctx, config) {
  let active = true
  const stop = ctx.appReady.onReady(() => {
    void exercise(ctx, config).then(
      value => { if (active) process.stdout.write(`PACKED_OFFICIAL_RESULT=${JSON.stringify({ value })}\n`) },
      error => { if (active) process.stdout.write(`PACKED_OFFICIAL_RESULT=${JSON.stringify({ error: String(error) })}\n`) },
    )
  })
  ctx.effect(() => () => { active = false; stop() }, 'packed-official-observer')
}

function applied(stage, result) {
  if (result.application !== 'applied') throw new Error(`${stage}: ${JSON.stringify(result)}`)
}

async function exercise(ctx, config) {
  const initial = await ctx.pluginManager.listBundles()
  await fetch(`${config.registry}catalog-observed`)
  const steps = []
  for (const name of config.packages) {
    const spec = initial.find(bundle => bundle.name === name)?.installTarget?.spec
    if (spec === undefined) throw new Error(`No catalog installation target for ${name}`)
    const options = { enabled: true, saveExact: true, registry: config.registry }
    let install = await ctx.pluginManager.installBundle(spec, options)
    const approval = install.pendingBuilds
    if (approval?.length) install = await ctx.pluginManager.installBundle(spec, { ...options, approvedBuilds: approval })
    applied(`install ${name}`, install)
    const manifest = JSON.parse(await readFile(join(config.profile, 'package.json'), 'utf8'))
    const installed = (await ctx.pluginManager.listBundles()).find(bundle => bundle.name === name)
    const provider = name.endsWith('-codex') ? 'codex' : 'claude-code'
    const providerEnabled = ctx.subagents.list().includes(provider)
    const nativeDir = join(config.profile, 'node_modules', config.nativePackages[name])
    const binaryName = `${provider === 'codex' ? 'codex' : 'claude'}${process.platform === 'win32' ? '.exe' : ''}`
    const nativeBinary = (await readdir(nativeDir, { recursive: true })).find(path => basename(path) === binaryName)
    const nativeArtifact = nativeBinary !== undefined && (await stat(join(nativeDir, nativeBinary))).size > 0
    const presets = await ctx.agentPresets.list()
    const beforeUnavailable = await readFile(join(config.profile, 'package.json'), 'utf8')
    const unavailable = await ctx.pluginManager.installBundle(`${name}@9999.0.0`, options)
    const unchangedAfterUnavailable = beforeUnavailable === await readFile(join(config.profile, 'package.json'), 'utf8')
    const off = await ctx.pluginManager.setBundleEnabled(name, false)
    applied(`disable ${name}`, off)
    const disabled = (await ctx.pluginManager.listBundles()).find(bundle => bundle.name === name)
    const on = await ctx.pluginManager.setBundleEnabled(name, true)
    applied(`enable ${name}`, on)
    const enabled = (await ctx.pluginManager.listBundles()).find(bundle => bundle.name === name)
    const removed = await ctx.pluginManager.removeBundle(name)
    applied(`remove ${name}`, removed)
    const absent = (await ctx.pluginManager.listBundles()).find(bundle => bundle.name === name)
    steps.push({ name, install, savedVersion: manifest.dependencies?.[name], installed, providerEnabled, nativeArtifact, presets,
      unavailable, unchangedAfterUnavailable, off, disabled, on, enabled, removed, absent })
  }
  return { initial, steps, sessionCount: ctx.sessions.list().length }
}
