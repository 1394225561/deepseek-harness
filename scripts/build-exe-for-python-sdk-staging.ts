/** Turn the deploy-time package links of the Python runtime payload into real files. */
import { cp, lstat, readdir, realpath, rm } from 'node:fs/promises'
import { join, sep } from 'node:path'

/** Return the first symbolic link below a directory, if one exists. */
async function findSymlink(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/**
 * Replace every deploy-time package link below the staged payload with real files.
 *
 * Legacy deploy links workspace packages into the target's `node_modules`, and
 * those links must survive packaging as files. One link is not a package: when
 * the deploy target sits inside the deployed project, pnpm links that project
 * into its own `node_modules`. Dereferencing it would copy the payload into
 * itself, and the packaged payload never carries the project source, so the
 * entry is dropped instead.
 * @param staging - Deployed payload root whose `node_modules` becomes symlink-free.
 */
export async function materializeStagedLinks(staging: string): Promise<void> {
  const payload = await realpath(staging)
  const nodeModules = join(staging, 'node_modules')
  let remaining = await findSymlink(nodeModules)
  while (remaining !== undefined) {
    const segments = remaining.slice(nodeModules.length + 1).split(sep)
    const binIndex = segments.lastIndexOf('.bin')
    if (binIndex >= 0) {
      await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
      remaining = await findSymlink(nodeModules)
      continue
    }
    const destination = remaining
    const source = await realpath(destination)
    if (payload === source || payload.startsWith(source + sep)) {
      await rm(destination, { recursive: true, force: true })
      remaining = await findSymlink(nodeModules)
      continue
    }
    const nestedNodeModules = join(source, 'node_modules')
    await rm(destination, { recursive: true, force: true })
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    })
    remaining = await findSymlink(nodeModules)
  }
}
