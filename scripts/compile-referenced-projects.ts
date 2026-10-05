/** Compile package projects with their existing diagnostics and outputs, excluding the aggregate test program. */

import { spawnSync } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import ts from 'typescript'

/**
 * Compile one aggregate's project references with the ordinary serial TypeScript builder.
 * @param root - Repository root containing the aggregate tsconfig.
 * @param face - Independent compiler face whose package projects are emitted.
 * @throws If the aggregate emits files, its configuration is invalid, or package compilation fails.
 */
export function compileReferencedProjects(root: string, face: 'host' | 'client'): void {
  const configPath = resolve(root, `tsconfig.${face}.json`)
  const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    },
  })
  if (config === undefined) throw new Error(`compile-referenced-projects: cannot read ${configPath}`)
  const references = config.projectReferences
  if (references === undefined || references.length === 0) {
    throw new Error(`compile-referenced-projects: ${configPath} requires non-empty project references`)
  }
  if (config.errors.length > 0) {
    throw new Error(config.errors
      .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('\n'))
  }
  if (config.options.noEmit !== true) {
    throw new Error(`compile-referenced-projects: ${configPath} requires noEmit: true to exclude its aggregate program`)
  }
  const compiler = fileURLToPath(import.meta.resolve('typescript/bin/tsc'))
  const result = spawnSync(process.execPath, [
    ...face === 'host' ? ['--max-old-space-size=4096'] : [],
    compiler,
    '-b',
    // Relative arguments keep the complete workspace graph below Windows' command-line limit.
    ...references.map(reference => relative(root, reference.path)),
  ], { cwd: root, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`compile-referenced-projects: ${face} compiler exited with ${String(result.status ?? result.signal)}`)
  }
}

if (import.meta.main) {
  const { positionals } = parseArgs({ allowPositionals: true })
  const [face] = positionals
  if (positionals.length !== 1 || (face !== 'host' && face !== 'client')) {
    throw new Error('compile-referenced-projects: expected exactly one compiler face: host or client')
  }
  compileReferencedProjects(resolve(import.meta.dirname, '..'), face)
}
