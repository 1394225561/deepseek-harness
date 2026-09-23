import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { generationLogPath } from '../../../session/session-persistence-jsonl/src/format.ts'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { startTestActivation } from './local-activation.ts'
import { TestSessionQuery } from './test-session-query.ts'

type Script = ConstructorParameters<typeof MockAdapter>[0]

const roots: string[] = []
const persistenceDisposers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(persistenceDisposers.splice(0).map(dispose => dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

/** Boot the continuable stack with real JSONL session persistence. */
async function setup(
  script: Script,
  options: { compression?: 'none' | 'zstd' } = {},
) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const root = mkdtempSync(join(tmpdir(), 'dsh-subagent-list-'))
  roots.push(root)
  const persistence = await ctx.plugin(JsonlSessionPersistence, {
    root,
    ...options.compression === undefined ? {} : { compression: options.compression },
  })
  persistenceDisposers.push(() => persistence.dispose())
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  const loop = ctx.get('agentLoop')
  const parent = loop === undefined
    ? (() => {
      const session = ctx.sessions.create(SessionId('parent'))
      return { id: session.id, session } as Awaited<ReturnType<Context['agentLoop']['create']>>
    })()
    : await loop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent, root }
}

const testSignal = new AbortController().signal

/** Start one continuable child through the real service path and await Activation release. */
async function startChild(
  ctx: Context,
  parent: Agent,
  label: string,
): Promise<SessionId> {
  const started = await ctx.subagents.startActivation({ delivery: 'parent',
    provider: 'spawn',
    label,
    request: { prompt: [{ type: 'text', text: `task: ${label}` }], parent },
    signal: testSignal,
  })
  await vi.waitFor(() => {
    expect(ctx.agents.get(started.childId)).toBeUndefined()
  }, { timeout: 5_000 })
  return started.childId
}

describe('SubagentRuntime.listChildren', () => {
  it('lists historical children through a migrated parent while preserving V3 files', async () => {
    const { ctx, root } = await setup([], { compression: 'none' })
    const parent = SessionId('historical-parent')
    const child = SessionId('historical-child')
    const header = { type: 'session', version: 3, id: parent, createdAt: 1, isSeeded: false, delegationDepth: 0 }
    const source = [
      [header, []],
      [{ ...header, id: child, createdAt: 2, origin: 'subagent', parentSession: parent, delegationDepth: 1 }, [{
        type: 'subagent/descriptor', seq: 0, time: 2,
        data: { version: 3, mode: 'continuable', provider: 'spawn', label: 'historical child' },
      }]],
    ] as const
    const originals = source.map(([meta, events]) => {
      const path = generationLogPath(root, undefined, meta.id, 3, 'none')
      const content = [meta, ...events].map(row => JSON.stringify(row)).join('\n') + '\n'
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
      return { path, content }
    })

    expect(await ctx.subagents.listChildren(parent)).toEqual([{
      id: child, createdAt: 2, mode: 'continuable', label: 'historical child',
    }])
    for (const { path, content } of originals) {
      expect(readFileSync(path, 'utf8')).toBe(content)
      expect(readdirSync(dirname(path))).toEqual(['session.v3.jsonl'])
    }
  })

  it('lists parent-delivery children without caller-owned children or corpus reads', async () => {
    const { ctx, parent } = await setup([textResponse('once'), textResponse('again')])
    const oneShot = await startTestActivation(ctx, 'spawn', {
      prompt: [{ type: 'text', text: 'finish once' }],
      agentOptions: { model: 'child-model' },
      parent,
      signal: testSignal,
    })
    expect(await ctx.subagents.listChildren(parent.id)).toEqual([])
    await oneShot.result
    await oneShot.dispose()
    const continuableId = await startChild(ctx, parent, 'continuable child')
    const listSessions = vi.spyOn(ctx.sessionQuery, 'listSessions')
    const observeSession = vi.spyOn(ctx.sessionQuery, 'observeSession')

    const children = await ctx.subagents.listChildren(parent.id)
    expect(children.map(({ createdAt: _createdAt, ...child }) => child)).toEqual([
      { id: continuableId, label: 'continuable child', mode: 'continuable' },
    ])
    expect(children.every(child => Number.isFinite(child.createdAt))).toBe(true)
    expect(listSessions).not.toHaveBeenCalled()
    expect(observeSession).toHaveBeenCalledOnce()
  })

  it('releases its observation after reading the catalog view', async () => {
    const { ctx, parent } = await setup([])
    const childId = SessionId('cold-state-child')
    parent.session.append('subagent/catalog', {
      version: 0,
      childId,
      childCreatedAt: 3,
      mode: 'one-shot',
      label: 'state child',
    })
    using observed = await ctx.sessionQuery.observeSession(parent.id)
    const dispose = vi.fn()
    vi.spyOn(ctx.sessionQuery, 'observeSession').mockResolvedValue({
      ...observed,
      [Symbol.dispose]: dispose,
    })
    expect(await ctx.subagents.listChildren(parent.id)).toEqual([{
      id: childId, createdAt: 3, label: 'state child', mode: 'one-shot',
    }])
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('releases the observation when its catalog projection is unavailable', async () => {
    const { ctx, parent } = await setup([])
    using observed = await ctx.sessionQuery.observeSession(parent.id, { projectionMode: 'none' })
    const dispose = vi.fn()
    vi.spyOn(ctx.sessionQuery, 'observeSession').mockResolvedValue({ ...observed, [Symbol.dispose]: dispose })
    await expect(ctx.subagents.listChildren(parent.id)).rejects.toMatchObject({
      code: 'SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE',
    })
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('forwards cancellation and preserves query failures', async () => {
    const { ctx, parent } = await setup([])
    const controller = new AbortController()
    controller.abort(new Error('cancel catalog'))
    await expect(ctx.subagents.listChildren(parent.id, controller.signal)).rejects.toMatchObject({
      code: 'SESSION_QUERY_ABORTED',
    })
    const failure = new Error('parent read failed')
    vi.spyOn(ctx.sessionQuery, 'observeSession').mockRejectedValue(failure)
    await expect(ctx.subagents.listChildren(parent.id)).rejects.toBe(failure)
  })

  it('ignores inherited fork facts and accepts facts in the fork own suffix', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(TestSessionQuery)
    await ctx.plugin(SubagentRuntime)
    const ancestor = ctx.sessions.create(SessionId('catalog-ancestor'))
    ancestor.append('turn/start', { turn: 1 })
    ancestor.append('subagent/catalog', {
      version: 0,
      childId: SessionId('inherited-child'),
      childCreatedAt: 1,
      mode: 'one-shot',
    })
    ancestor.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const fork = ctx.sessions.fork(ancestor, undefined, SessionId('catalog-fork'))
    fork.append('subagent/catalog', {
      version: 0,
      childId: SessionId('own-child'),
      childCreatedAt: 2,
      mode: 'continuable',
      label: 'own',
    })

    expect(await ctx.subagents.listChildren(fork.id)).toEqual([{
      id: SessionId('own-child'), createdAt: 2, mode: 'continuable', label: 'own',
    }])
  })

  it('bounds chunk growth and ignores more than 1,000 unrelated Sessions', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(TestSessionQuery)
    await ctx.plugin(SubagentRuntime)
    const parent = ctx.sessions.create(SessionId('chunk-parent'))
    for (let index = 0; index < 1_001; index += 1) {
      ctx.sessions.create(SessionId(`unrelated-${String(index).padStart(4, '0')}`))
    }
    for (let index = 0; index < 1_025; index += 1) {
      parent.append('subagent/catalog', {
        version: 0,
        childId: SessionId(`child-${String(index).padStart(3, '0')}`),
        childCreatedAt: index,
        mode: 'one-shot',
      })
    }
    const listSessions = vi.spyOn(ctx.sessionQuery, 'listSessions')
    const state = ctx.sessionProjections.stateOf(parent, 'subagentCatalog')
    const chunkLengths: number[] = []
    for (let chunk = state?.head; chunk !== undefined; chunk = chunk.previous) {
      chunkLengths.push(chunk.values.length)
    }
    expect(chunkLengths).toEqual([1, ...Array.from({ length: 16 }, () => 64)])
    const entries = await ctx.subagents.listChildren(parent.id)
    expect(listSessions).not.toHaveBeenCalled()
    expect(entries).toHaveLength(1_025)
    expect(entries.find(entry => entry.id === 'child-064')).toEqual({
      id: SessionId('child-064'), createdAt: 64, mode: 'one-shot',
    })
  })

  it('fails loud when the query service is unavailable', async () => {
    const withoutProjection = new Context()
    await withoutProjection.plugin(SessionStore)
    await withoutProjection.plugin(SubagentRuntime)
    const parent = withoutProjection.sessions.create(SessionId('parent'))
    await expect(withoutProjection.subagents.listChildren(parent.id)).rejects.toMatchObject({
      code: 'SUBAGENT_CONTROL_QUERY_UNAVAILABLE',
    })
  })
})
