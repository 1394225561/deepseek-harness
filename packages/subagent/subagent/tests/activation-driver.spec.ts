/** Driver readiness and terminal behavior before and after an external execution settles. */

import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ExternalActivationDriver } from '../src/activation-driver.ts'
import type { SubagentResult } from '../src/types.ts'

it('cannot close or expose a result before the backend settles', async () => {
  const result = Promise.withResolvers<SubagentResult>()
  const dispose = vi.fn(() => Promise.resolve())
  const controller = new AbortController()
  const driver = new ExternalActivationDriver({
    id: SessionId('pending-external'), result: result.promise, dispose,
  }, controller)
  const close = vi.fn()
  expect(driver.version).toBe(0)
  expect(driver.closeWhenIdle(close)).toBe(false)
  expect(close).not.toHaveBeenCalled()
  expect(() => driver.capture()).toThrow('has not settled')
  const terminal: SubagentResult = { output: [{ type: 'text', text: 'ready' }], stopReason: 'completed' }
  result.resolve(terminal)
  await driver.whenIdle()
  expect(driver.version).toBe(1)
  expect(driver.capture()).toEqual(terminal)
  expect(driver.closeWhenIdle(close)).toBe(true)
  expect(close).toHaveBeenCalledTimes(1)
  await driver.dispose()
})

describe('external driver infrastructure rejection', () => {
  it('waits for settlement while preserving the failure for the activation owner', async () => {
    const result = Promise.withResolvers<SubagentResult>()
    const failure = new Error('transport unavailable')
    const dispose = vi.fn(() => Promise.resolve())
    const driver = new ExternalActivationDriver({
      id: SessionId('failed-external'), result: result.promise, dispose,
    }, new AbortController())
    result.reject(failure)
    await driver.whenIdle()
    expect(driver.version).toBe(1)
    expect(() => driver.capture()).toThrow(failure)
    await driver.dispose()
  })
})
