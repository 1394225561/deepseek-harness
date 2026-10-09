/** Keep LibreOffice workers, prebuilt engines, and their dependencies on the real filesystem. */
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { downloadRuntimeNpmPackage, type RuntimeNpmArchive } from './primary-runtime/prepare.ts'
import { officePackageDirectories } from './libreoffice-packages.mjs'

/** pkg applies these exclusions to dependency `files` as well as root asset globs. */
export const OFFICE_ASSET_IGNORES = [
  '**/node_modules/@deepseek-ai/libreoffice-kit/**',
  '**/node_modules/@deepseek-ai/libreoffice-kit-*/**',
]

/**
 * Copy the installed Office dependency tree without changing package contents or executable modes.
 * Harness sidecars require the kit's declared target native engine, or WASM for other targets.
 * Missing target engines fail with their package name; missing required dependencies or paths outside the deployed closure also fail.
 * @param staging - Symlink-free deployed Node closure.
 * @param destination - Target-specific Office directory beside the executable; replaced when present.
 * @param target - Node platform and CPU of the executable.
 * @returns Relative package directories included in the sidecar.
 */
export async function copyOfficeSidecar(
  staging: string,
  destination: string,
  target: { platform: string; arch: string },
): Promise<string[]> {
  const directories = await officePackageDirectories(staging, target)
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  for (const source of directories) {
    const nestedModules = join(source, 'node_modules')
    await cp(source, join(destination, relative(staging, source)), {
      recursive: true,
      filter: path => path !== nestedModules && !path.startsWith(nestedModules + sep),
    })
  }
  return directories.map(directory => relative(staging, directory))
}

/** One npm package at its existing sidecar dependency location. */
export interface OfficePackageArchive extends RuntimeNpmArchive {
  /** Relative package directory inside the sidecar. */
  readonly directory: string
}

/**
 * Read exact npm tarball metadata for a version already selected by the workspace lock.
 * @param name - Published package name.
 * @param version - Exact installed version.
 * @returns Immutable npm tarball identity.
 */
export async function runtimeNpmArchive(name: string, version: string): Promise<RuntimeNpmArchive> {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`)
  if (!response.ok) throw new Error(`runtime npm metadata: HTTP ${String(response.status)} for ${name}@${version}`)
  const metadata = await response.json() as { name: string; version: string; dist: { tarball: string; integrity: string } }
  if (metadata.name !== name || metadata.version !== version || !metadata.dist.integrity.startsWith('sha512-')) {
    throw new Error(`runtime npm metadata: invalid identity for ${name}@${version}`)
  }
  return { name, version, url: metadata.dist.tarball, integrity: metadata.dist.integrity }
}

/**
 * Lock the installed Office closure to published npm tarballs, preserving nested dependency locations.
 * @param staging - Complete installed Node closure.
 * @param target - Sidecar platform and CPU.
 * @returns Download records for the selected engine and all dependencies.
 */
export async function officeSidecarArchives(staging: string, target: { platform: string; arch: string }): Promise<OfficePackageArchive[]> {
  const directories = await officePackageDirectories(staging, target)
  return Promise.all(directories.map(async (directory) => {
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as { name: string; version: string }
    return { ...await runtimeNpmArchive(manifest.name, manifest.version), directory: relative(staging, directory).split(sep).join('/') }
  }))
}

/**
 * Download the complete pinned Office sidecar without npm or package lifecycle scripts.
 * @param packages - Build-locked npm packages and dependency locations.
 * @param destination - Empty sidecar directory.
 * @param cache - Verified archive cache.
 * @returns Resolves after all packages are unpacked and checked.
 */
export async function downloadOfficeSidecar(packages: readonly OfficePackageArchive[], destination: string, cache: string): Promise<void> {
  for (const artifact of packages) {
    if (isAbsolute(artifact.directory) || artifact.directory.split(/[\\/]/u).some(part => part === '..')
      || !artifact.directory.startsWith('node_modules/')) throw new Error(`Office download: invalid package directory ${artifact.directory}`)
    await downloadRuntimeNpmPackage(artifact, join(destination, artifact.directory), cache)
  }
}
