import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MEMORY_PRESSURE_FILES,
  memoryPressureMachine,
  memoryScopeCommand,
} from './run-memory-pressure-bench.ts'

const root = resolve(import.meta.dirname, '..')

describe('memory-pressure benchmark launcher', () => {
  it('selects existing benchmark files', () => {
    for (const file of MEMORY_PRESSURE_FILES) expect(existsSync(resolve(root, file)), file).toBe(true)
  })

  it('accepts only the modeled machines', () => {
    expect(memoryPressureMachine('4g')).toBe('4g')
    expect(memoryPressureMachine('8g')).toBe('8g')
    expect(() => memoryPressureMachine('16g')).toThrow('usage')
    expect(() => memoryPressureMachine(undefined)).toThrow('usage')
  })

  it('confines the command to the machine memory without swap', () => {
    expect(memoryScopeCommand('4g', ['node', 'x.js'])).toEqual([
      'systemd-run', '--user', '--scope', '--quiet', '-p', 'MemoryMax=4G', '-p', 'MemorySwapMax=0', '--', 'node', 'x.js',
    ])
  })
})
