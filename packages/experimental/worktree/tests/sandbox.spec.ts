import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { git, harness, repository, testAgent } from './harness.ts'

let ctx: Context | undefined
let root: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

// The local sandbox's POSIX kernel runners are covered here; Windows ACL enforcement has its own native lane.
describe.runIf(process.platform === 'darwin' || process.platform === 'linux')('worktree standing sandbox policy', () => {
  it('refuses creation under read-only policy without changing the Session directory', async () => {
    root = await repository(process.cwd())
    ctx = await harness(root, {}, 'read-only')
    const agent = testAgent(ctx, root)
    const confine = vi.spyOn(ctx.sandbox, 'confine')
    await expect(ctx.worktrees.create(agent, { name: 'denied' })).rejects.toThrow(/permission denied|operation not permitted|read-only file system/i)
    expect(ctx.workingDirectory.get(agent.session)).toBe(root)
    expect(await git(root, 'branch', '--list', 'denied')).toBe('')
    expect(confine.mock.calls.length).toBeGreaterThan(0)
    expect(confine.mock.calls.every(call => call[1].mode === 'read-only' && call[1].workspaceRoot === root)).toBe(true)
  })

  it('does not widen a linked-checkout grant to the shared Git administration directory', async () => {
    root = await repository(process.cwd())
    const linked = join(root, 'linked')
    await git(root, 'worktree', 'add', '-b', 'linked', linked)
    ctx = await harness(linked, {}, 'workspace-write')
    const agent = testAgent(ctx, linked)
    const confine = vi.spyOn(ctx.sandbox, 'confine')
    await expect(ctx.worktrees.create(agent, { name: 'denied-admin' })).rejects.toThrow(/permission denied|operation not permitted|read-only file system/i)
    expect(ctx.workingDirectory.get(agent.session)).toBe(linked)
    expect(await git(root, 'branch', '--list', 'denied-admin')).toBe('')
    expect(confine.mock.calls.every(call => call[1].mode === 'workspace-write' && call[1].workspaceRoot === linked)).toBe(true)
  })
})
