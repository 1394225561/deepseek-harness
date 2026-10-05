import { spawnSync } from 'node:child_process'
import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { compileReferencedProjects } from './compile-referenced-projects.ts'

const compiler = fileURLToPath(import.meta.resolve('typescript/bin/tsc'))

function fixture(): { root: string; leaf: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-referenced-projects-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const leaf = join(root, 'leaf package')
  mkdirSync(join(leaf, 'src'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }))
  writeFileSync(join(leaf, 'src/index.ts'), 'export const value: number = 42\n')
  const compilerOptions = {
    target: 'ES2024',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    lib: ['ES2024'],
    types: [],
    composite: true,
    strict: true,
  }
  writeFileSync(join(leaf, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      ...compilerOptions,
      rootDir: 'src',
      outDir: 'lib/types',
      declaration: true,
      declarationMap: true,
      sourceMap: true,
    },
    include: ['src'],
  }))
  writeFileSync(join(root, 'aggregate.ts'), 'import { value } from "./leaf package/src/index.js"\nexport const aggregate: number = value\n')
  for (const face of ['host', 'client']) {
    writeFileSync(join(root, `tsconfig.${face}.json`), JSON.stringify({
      compilerOptions: { ...compilerOptions, noEmit: true },
      include: ['aggregate.ts'],
      references: [{ path: './leaf package' }],
    }))
  }
  return { root, leaf }
}

function artifacts(leaf: string): Record<string, string> {
  const output = join(leaf, 'lib')
  return Object.fromEntries(globSync('**/*', { cwd: output })
    .filter(path => statSync(join(output, path)).isFile())
    .sort()
    .map(path => [path, readFileSync(join(output, path)).toString('base64')]))
}

describe('package project compilation', () => {
  it.each(['host', 'client'] as const)('preserves every %s package artifact byte', (face) => {
    const { root, leaf } = fixture()
    const complete = spawnSync(process.execPath, [compiler, '-b', `tsconfig.${face}.json`], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(complete.status, complete.stdout + complete.stderr).toBe(0)
    const expected = artifacts(leaf)
    expect(Object.keys(expected)).toEqual(expect.arrayContaining([
      'types/index.js', 'types/index.js.map', 'types/index.d.ts', 'types/index.d.ts.map',
    ]))
    rmSync(join(leaf, 'lib'), { recursive: true })

    compileReferencedProjects(root, face)

    expect(artifacts(leaf)).toEqual(expected)
  })

  it('keeps aggregate-only errors in the complete compiler check', () => {
    const { root } = fixture()
    writeFileSync(join(root, 'aggregate.ts'), 'export const aggregate: number = "invalid"\n')

    expect(() => { compileReferencedProjects(root, 'host') }).not.toThrow()
    const complete = spawnSync(process.execPath, [compiler, '-b', 'tsconfig.host.json'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(complete.status).not.toBe(0)
    expect(complete.stdout).toContain('aggregate.ts(1,14): error TS2322')
  })

  it('rejects package source errors', () => {
    const { root, leaf } = fixture()
    writeFileSync(join(leaf, 'src/index.ts'), 'export const value: number = "invalid"\n')

    expect(() => { compileReferencedProjects(root, 'host') }).toThrow('host compiler exited with')
  })

  it.each([undefined, []])('rejects an aggregate with missing or empty references: %j', (references) => {
    const { root } = fixture()
    writeFileSync(join(root, 'tsconfig.host.json'), JSON.stringify({ files: [], references }))

    expect(() => { compileReferencedProjects(root, 'host') }).toThrow('requires non-empty project references')
  })

  it('rejects a missing referenced project', () => {
    const { root } = fixture()
    writeFileSync(join(root, 'tsconfig.host.json'), JSON.stringify({
      compilerOptions: { noEmit: true },
      files: [],
      references: [{ path: './absent' }],
    }))

    expect(() => { compileReferencedProjects(root, 'host') }).toThrow('host compiler exited with')
  })

  it.each([undefined, false])('rejects an aggregate capable of emitting files: noEmit=%s', (noEmit) => {
    const { root } = fixture()
    writeFileSync(join(root, 'tsconfig.host.json'), JSON.stringify({
      compilerOptions: { noEmit },
      include: ['aggregate.ts'],
      references: [{ path: './leaf package' }],
    }))

    expect(() => { compileReferencedProjects(root, 'host') }).toThrow(
      `${join(root, 'tsconfig.host.json')} requires noEmit: true`,
    )
  })

  it('rejects a missing aggregate config', () => {
    const { root } = fixture()
    rmSync(join(root, 'tsconfig.host.json'))

    expect(() => { compileReferencedProjects(root, 'host') }).toThrow('Cannot read file')
  })

  it('rejects invalid compiler options', () => {
    const { root } = fixture()
    writeFileSync(join(root, 'tsconfig.host.json'), JSON.stringify({
      compilerOptions: { target: 'invalid' },
      files: [],
      references: [{ path: './leaf package' }],
    }))

    expect(() => { compileReferencedProjects(root, 'host') }).toThrow("Argument for '--target' option must be")
  })

  it('rejects an unsupported compiler face before building', () => {
    const repository = resolve(import.meta.dirname, '..')
    const result = spawnSync(process.execPath, [
      '--import', 'tsx/esm',
      resolve(repository, 'scripts/compile-referenced-projects.ts'),
      'unsupported',
    ], { cwd: repository, encoding: 'utf8' })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('expected exactly one compiler face: host or client')
  })
})
