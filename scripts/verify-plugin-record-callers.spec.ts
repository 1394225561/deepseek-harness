import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkPluginRecordCallers,
  findPluginRecordReferences,
  isAdmittedCaller,
  OWNER_FILE,
  readRepositorySources,
} from './verify-plugin-record-callers.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A temporary git repository with the given files written and none of them staged. */
function repository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-plugin-record-callers-'))
  roots.push(root)
  execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'pipe' })
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), contents)
  }
  return root
}

const OWNER_SOURCE = 'export function appendPluginRecord(session, type, data) { return commit(session, type, data) }\n'
const EXPERIMENTAL = 'packages/experimental/bridge/src/index.ts'
const RELEASE = 'packages/core/agent/src/index.ts'

/** A minimal corpus: the owner, one experimental file, and one release file with the given source. */
function corpus(release: string, extra: Record<string, string> = {}): Map<string, string> {
  return new Map(Object.entries({
    [OWNER_FILE]: OWNER_SOURCE,
    [EXPERIMENTAL]: "import { appendPluginRecord } from '@deepseek-ai/dsh-session'\nappendPluginRecord(session, 'plugin:a', {})\n",
    [RELEASE]: release,
    ...extra,
  }))
}

describe('verify-plugin-record-callers', () => {
  it.each([
    ['a named import', "import { appendPluginRecord } from '@deepseek-ai/dsh-session'"],
    ['an aliased import', "import { appendPluginRecord as write } from '@deepseek-ai/dsh-session'"],
    ['a re-export', "export { appendPluginRecord } from '@deepseek-ai/dsh-session'"],
    ['a namespace member call', "S.appendPluginRecord(session, 'plugin:a', {})"],
    ['a destructured binding', 'const { appendPluginRecord: write } = S'],
    ['an element access', "S['appendPluginRecord'](session, 'plugin:a', {})"],
    ['a template element access', 'S[`appendPluginRecord`](session, `plugin:a`, {})'],
    ['an escaped identifier', 'S.\\u0061ppendPluginRecord(session, "plugin:a", {})'],
    ['a hexadecimal escape in an element access', "S['\\x61ppendPluginRecord'](session, 'plugin:a', {})"],
    ['a code point escape in an element access', "S['\\u{61}ppendPluginRecord'](session, 'plugin:a', {})"],
    ['needless character escapes in an element access', "S['\\a\\ppendPluginRecord'](session, 'plugin:a', {})"],
    ['an escaped template element access', 'S[`\\x61ppendPluginRecord`](session, `plugin:a`, {})'],
  ])('rejects %s in release package source', (_form, source) => {
    expect(checkPluginRecordCallers(corpus(`${source}\n`))).toEqual([{ file: RELEASE, line: 1, text: source }])
  })

  it('parses JSX and JavaScript sources by extension', () => {
    const files = corpus('', {
      'packages/client/ui/src/view.tsx': 'const view = <div>{S.appendPluginRecord(session, "plugin:a", {})}</div>\n',
      'scripts/tool.mjs': "S['appendPluginRecord'](session, 'plugin:a', {})\n",
    })
    expect(checkPluginRecordCallers(files).map(caller => caller.file))
      .toEqual(['packages/client/ui/src/view.tsx', 'scripts/tool.mjs'])
  })

  it('rejects a string that spells the name across a line continuation', () => {
    expect(checkPluginRecordCallers(corpus("S['append\\\nPluginRecord'](session, 'plugin:a', {})\n"))).toEqual([
      { file: RELEASE, line: 1, text: "S['append\\" },
    ])
  })

  it('reports nothing for escapes that spell no reference, including one that names no code point', () => {
    const source = "const path = 'C:\\\\temp\\\\appendPlugin'\nconst big = '\\u{110000}'\nconst newline = 'a\\nb'\n"
    expect(findPluginRecordReferences(RELEASE, source)).toEqual([])
  })

  it('ignores comments, JSDoc links, longer strings, other identifiers, and wildcard re-exports', () => {
    const source = [
      '// appendPluginRecord is restricted',
      '/** Plugin state uses {@link appendPluginRecord} in experimental packages. */',
      "const message = 'call appendPluginRecord only from experimental packages'",
      'const appendPluginRecords = 1',
      "export * from '@deepseek-ai/dsh-session'",
    ].join('\n')
    expect(checkPluginRecordCallers(corpus(source))).toEqual([])
  })

  it('admits experimental source, the owner, tests, and this gate', () => {
    for (const file of [
      EXPERIMENTAL,
      OWNER_FILE,
      'packages/session/session-persistence/tests/live-write-contract.ts',
      'apps/web/tests/session.e2e.ts',
      'examples/demo/tests/demo.spec.ts',
      'scripts/verify-plugin-record-callers.spec.ts',
      'scripts/verify-plugin-record-callers.ts',
    ]) expect(isAdmittedCaller(file), file).toBe(true)
    for (const file of [RELEASE, 'packages/core/session/src/surface.ts', 'scripts/tool.ts', 'apps/web/src/main.ts']) {
      expect(isAdmittedCaller(file), file).toBe(false)
    }
  })

  it('reports the line of each reference', () => {
    expect(findPluginRecordReferences(RELEASE, 'const a = 1\n\nS.appendPluginRecord()\n'))
      .toEqual([{ file: RELEASE, line: 3, text: 'S.appendPluginRecord()' }])
  })

  it('refuses a corpus whose owner no longer exports the function', () => {
    for (const owner of [undefined, 'function appendPluginRecord() {}\n', 'export const appendPluginRecord = () => {}\n']) {
      const files = corpus('')
      if (owner === undefined) files.delete(OWNER_FILE)
      else files.set(OWNER_FILE, owner)
      expect(() => checkPluginRecordCallers(files)).toThrow(/no longer exports function appendPluginRecord/)
    }
  })

  it('refuses a corpus without experimental or release package source', () => {
    const withoutExperimental = corpus('')
    withoutExperimental.delete(EXPERIMENTAL)
    const withoutRelease = corpus('')
    withoutRelease.delete(RELEASE)
    for (const files of [withoutExperimental, withoutRelease]) {
      expect(() => checkPluginRecordCallers(files)).toThrow(/lacks experimental or release package source/)
    }
  })

  it('reads tracked and unignored sources outside vendor, skipping other files and deleted ones', () => {
    const root = repository({
      '.gitignore': 'ignored/\n',
      [OWNER_FILE]: OWNER_SOURCE,
      'scripts/tool.mjs': 'export {}\n',
      'ignored/scratch.ts': 'export {}\n',
      'vendor/cordis/src/index.ts': 'export {}\n',
      'docs/page.md': '# Page\n',
      'packages/core/gone/src/index.ts': 'export {}\n',
    })
    execFileSync('git', ['add', '.'], { cwd: root, stdio: 'pipe' })
    rmSync(join(root, 'packages/core/gone/src/index.ts'))
    mkdirSync(join(root, 'packages/core/agent/src'), { recursive: true })
    writeFileSync(join(root, 'packages/core/agent/src/new.ts'), 'export {}\n')

    expect([...readRepositorySources(root).keys()].sort()).toEqual([
      'packages/core/agent/src/new.ts',
      OWNER_FILE,
      'scripts/tool.mjs',
    ])
  })
})
