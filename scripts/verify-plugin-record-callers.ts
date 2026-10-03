/**
 * Verify that only experimental packages call `appendPluginRecord` from production source.
 *
 * `appendPluginRecord` in `@deepseek-ai/dsh-session` appends an ignorable `plugin:` record that the
 * persistence catalog does not list and that a Session format migration keeps only on a best-effort
 * basis. Experimental packages may rely on that; a release package must declare its events instead.
 * The owning module and test files, which exercise the operation, are exempt.
 *
 * Discovery is syntax-aware: every identifier spelled `appendPluginRecord` counts — an import, a
 * named re-export, a call, a namespace member, a destructured binding, or an alias source — and so
 * does a string literal of exactly that name, which reaches the function by element access.
 * Comments, including JSDoc links, and longer strings do not count. A wildcard re-export
 * (`export * from`) names no identifier and is not reported; code that calls the function through
 * it still names the function, and that reference is. Only files whose text contains the name or a
 * `\u` escape are parsed, so an escaped spelling of the name is still found.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')

/** The restricted function. */
export const RESTRICTED_NAME = 'appendPluginRecord'

/** The module that declares the restricted function. */
export const OWNER_FILE = 'packages/core/session/src/index.ts'

/** Production source under this prefix may call the restricted function. */
export const EXPERIMENTAL_PREFIX = 'packages/experimental/'

/** This gate and its spec name the restricted function to find it. */
const GATE_FILES: ReadonlySet<string> = new Set([
  'scripts/verify-plugin-record-callers.ts',
  'scripts/verify-plugin-record-callers.spec.ts',
])

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]s|[jt]sx)$/u

/** One production-source reference to the restricted function outside its admitted callers. */
export interface PluginRecordCaller {
  /** Repository-relative path, in POSIX separators. */
  readonly file: string
  /** One-based line number. */
  readonly line: number
  /** The trimmed source line. */
  readonly text: string
}

/**
 * Whether a repository path is a test file under the repository's lint-override globs.
 * @param file - repository-relative path, in POSIX separators.
 * @returns whether the file is a package, app, or example test, or a script spec.
 */
export function isTestFile(file: string): boolean {
  return /^(?:packages\/[^/]+\/[^/]+|apps\/[^/]+|examples\/[^/]+)\/tests\//u.test(file)
    || /^scripts\/.+\.spec\.tsx?$/u.test(file)
}

/**
 * Whether a file may reference the restricted function.
 * @param file - repository-relative path, in POSIX separators.
 * @returns whether the file is experimental source, the owner, a test, or this gate.
 */
export function isAdmittedCaller(file: string): boolean {
  return file.startsWith(EXPERIMENTAL_PREFIX) || file === OWNER_FILE || isTestFile(file) || GATE_FILES.has(file)
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (/\.[cm]?js$/u.test(file)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

/**
 * Find references to the restricted function in one source file, admitted or not.
 * @param file - repository-relative path; its extension selects the parser.
 * @param source - file contents.
 * @returns one entry per referencing identifier or exact-name string literal, in source order.
 */
export function findPluginRecordReferences(file: string, source: string): PluginRecordCaller[] {
  if (!source.includes(RESTRICTED_NAME) && !source.includes('\\u')) return []
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file))
  const lines = source.split(/\r?\n/u)
  const references: PluginRecordCaller[] = []
  const visit = (node: ts.Node): void => {
    const named = ts.isIdentifier(node)
      || ts.isStringLiteral(node)
      || ts.isNoSubstitutionTemplateLiteral(node)
    if (named && node.text === RESTRICTED_NAME) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
      references.push({ file, line: line + 1, text: lines[line]?.trim() ?? '' })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return references
}

/** Whether the owner still exports a function declaration under the restricted name. */
function declaresRestrictedFunction(source: string): boolean {
  const sourceFile = ts.createSourceFile(OWNER_FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  return sourceFile.statements.some(statement => ts.isFunctionDeclaration(statement)
    && statement.name?.text === RESTRICTED_NAME
    && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) === true)
}

/**
 * Check a source corpus and return its unadmitted references.
 * @param files - repository-relative path, in POSIX separators, to contents.
 * @returns every reference outside experimental source, the owner, tests, and this gate.
 * @throws when the corpus lacks the owner's exported declaration or any experimental or release
 *   package source, because the gate would then pass by checking the wrong files.
 */
export function checkPluginRecordCallers(files: ReadonlyMap<string, string>): PluginRecordCaller[] {
  const owner = files.get(OWNER_FILE)
  if (owner === undefined || !declaresRestrictedFunction(owner)) {
    throw new Error(`verify-plugin-record-callers: ${OWNER_FILE} no longer exports function ${RESTRICTED_NAME}; update this gate with the move or rename.`)
  }
  const paths = [...files.keys()]
  if (!paths.some(file => file.startsWith(EXPERIMENTAL_PREFIX))
    || !paths.some(file => file.startsWith('packages/') && !isAdmittedCaller(file))) {
    throw new Error('verify-plugin-record-callers: the corpus lacks experimental or release package source; the file listing no longer matches the repository.')
  }
  return paths
    .filter(file => !isAdmittedCaller(file))
    .flatMap(file => findPluginRecordReferences(file, files.get(file) ?? ''))
}

/**
 * Read every tracked or unignored source file outside `vendor/`.
 * @param repoRoot - the repository root; defaults to this checkout.
 * @returns repository-relative path, in POSIX separators, to contents.
 */
export function readRepositorySources(repoRoot: string = root): Map<string, string> {
  const listing = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const files = new Map<string, string>()
  for (const entry of listing.split('\0')) {
    const file = entry.replaceAll('\\', '/')
    if (file === '' || file.startsWith('vendor/') || !SOURCE_EXTENSION.test(file)) continue
    try {
      files.set(file, readFileSync(resolve(repoRoot, file), 'utf8'))
    } catch (error: unknown) {
      // A file deleted in the working tree is still listed until the deletion is staged.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return files
}

function main(): void {
  const callers = checkPluginRecordCallers(readRepositorySources())
  if (callers.length === 0) {
    console.log(`verify-plugin-record-callers: ${RESTRICTED_NAME} has no production caller outside ${EXPERIMENTAL_PREFIX}.`)
    return
  }
  console.error(`verify-plugin-record-callers: only ${EXPERIMENTAL_PREFIX} source may call ${RESTRICTED_NAME}.\n`)
  for (const caller of callers) console.error(`  ${caller.file}:${String(caller.line)} ${caller.text}`)
  console.error('\nA release package declares its events in SessionEventMap instead of writing plugin records.')
  process.exit(1)
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) main()
