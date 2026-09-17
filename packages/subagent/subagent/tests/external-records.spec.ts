import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ProjectionCheckpoint } from '@deepseek-ai/dsh-session-projection'
import SessionProjectionCache from '@deepseek-ai/dsh-session-projection-cache'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { externalSubagentProjectionDefinition, recordExternalEnd, recordExternalStart } from '../src/external-records.ts'
import { subagentIdentityProjectionDefinition } from '../src/projection.ts'
import { SUBAGENT_DESCRIPTOR_VERSION } from '../src/descriptor.ts'
import SubagentRuntime from '../src/index.ts'
import { externalTestParent } from './external-activation-helpers.ts'
import { listChildren, listDescendants } from '../src/list-children.ts'
import { catalogView } from '../src/control.ts'
import { TestSessionQuery } from './test-session-query.ts'
import { seedStoredSession } from './persistence-helpers.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })))
})

async function setup(externalProjection = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(TestSessionQuery)
  ctx.sessionProjections.register(subagentIdentityProjectionDefinition)
  if (externalProjection) ctx.sessionProjections.register(externalSubagentProjectionDefinition)
  return ctx
}

async function coldReader(sessions: readonly Session[], externalProjection = true) {
  const reader = await setup(externalProjection)
  const root = await mkdtemp(join(tmpdir(), 'dsh-external-cold-'))
  roots.push(root)
  await reader.plugin(JsonlSessionPersistence, { root })
  for (const session of sessions) {
    await seedStoredSession(reader.sessionPersistence, session.header, session.snapshotEvents())
  }
  return reader
}

describe('parent-owned external subagent records', () => {
  it('lists an accepted external child without a child Session and retains its failed result', async () => {
    const ctx = await setup()
    const parent = ctx.sessions.create(SessionId('external-parent'))
    const childId = SessionId('external-child')
    recordExternalStart(parent, childId, 'codex', 'Review changes')
    expect(ctx.sessions.get(childId)).toBeUndefined()
    const running = [{
      kind: 'child', id: childId, mode: 'one-shot', label: 'Review changes',
      external: true, activity: 'inactive', hasChildren: false,
    }]
    await expect(listChildren(ctx, parent.id)).resolves.toEqual(running)
    expect(catalogView(ctx, parent.id, await listChildren(ctx, parent.id)).entries).toEqual(running)

    const result = {
      output: [{ type: 'text' as const, text: 'Partial review' }],
      structured: { files: ['a.ts'], complete: false },
      diagnostic: 'provider transport failed',
      stopReason: 'error' as const,
    }
    recordExternalEnd(parent, childId, result)
    await expect(listChildren(ctx, parent.id)).resolves.toEqual([{ ...running[0], activity: 'inactive' }])
    const records = ctx.sessionProjections.snapshot(parent, ['subagentExternal']).values.subagentExternal
    expect(records).toMatchObject([{
      childId, provider: 'codex', label: 'Review changes', result,
    }])
    // Rebuild from serialized parent facts, without any resident execution or notice.
    const events = JSON.parse(JSON.stringify(parent.snapshotEvents())) as SessionEvent[]
    const restored = ctx.sessionProjections.restore({}, events, SessionLogOffset(0), parent.header, SessionLogOffset(0))
    expect(restored.snapshot.values.subagentExternal).toEqual(records)
    const checkpoint = JSON.parse(JSON.stringify(restored.checkpoint)) as ProjectionCheckpoint
    expect(ctx.sessionProjections.restore(checkpoint, [], parent.seq, parent.header, SessionLogOffset(0))
      .snapshot.values.subagentExternal).toEqual(records)
  })

  it('rejects non-JSON structured results before appending a terminal record', async () => {
    const ctx = await setup()
    const parent = ctx.sessions.create(SessionId('non-json-parent'))
    const childId = SessionId('non-json-child')
    recordExternalStart(parent, childId, 'external', 'Work')
    const seq = parent.seq
    expect(() => { recordExternalEnd(parent, childId, {
      output: [], structured: new Map([['count', 3]]), stopReason: 'completed',
    }) }).toThrow()
    expect(parent.seq).toBe(seq)
    expect(ctx.sessionProjections.snapshot(parent, ['subagentExternal']).values.subagentExternal)
      .toMatchObject([{ childId, provider: 'external', label: 'Work' }])
  })

  it('restores nested content and extension fields without flattening them to text', async () => {
    const ctx = await setup()
    const parent = ctx.sessions.create(SessionId('json-block-parent'))
    const childId = SessionId('json-block-child')
    recordExternalStart(parent, childId, 'external', 'Work')
    const output = [{
      type: 'product-result', metadata: { citations: [{ url: 'https://example.com', scores: [1, 2] }] },
      content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'Nested output' }] }],
    }]
    const events: SessionEvent[] = [
      ...parent.snapshotEvents(),
      { type: 'subagent/external-end', seq: SessionSeq(parent.seq), time: 12, data: {
        version: 0, childId, result: { output, structured: { nested: [true, null] }, stopReason: 'completed' },
      } },
    ]
    const restored = ctx.sessionProjections.restore({}, events, SessionLogOffset(0), parent.header, SessionLogOffset(0))
    expect(restored.snapshot.values.subagentExternal).toMatchObject([{
      result: { output, structured: { nested: [true, null] }, stopReason: 'completed' },
    }])
  })

  it('discovers external descendants through a cold parent using one shared parent observation', async () => {
    const authored = await setup()
    const root = authored.sessions.create(SessionId('tree-root'))
    const parent = authored.sessions.create(SessionId('tree-parent'), {
      meta: { parentSession: root.id, origin: 'subagent' },
    })
    parent.append('subagent/descriptor', { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 'spawn', label: 'Local parent' })
    const childId = SessionId('tree-external')
    recordExternalStart(parent, childId, 'claude-code', 'External leaf')
    recordExternalEnd(parent, childId, { output: [], structured: null, stopReason: 'completed' })

    const reader = await setup()
    const path = await mkdtemp(join(tmpdir(), 'dsh-external-records-'))
    roots.push(path)
    await reader.plugin(JsonlSessionPersistence, { root: path })
    for (const session of [root, parent]) {
      await seedStoredSession(reader.sessionPersistence, session.header, session.snapshotEvents())
    }
    const observe = vi.spyOn(reader.sessionQuery, 'observeSession')
    expect(reader.sessions.get(parent.id)).toBeUndefined()
    expect(reader.sessions.get(childId)).toBeUndefined()
    const entries = await listDescendants(reader, root.id)
    expect(entries).toEqual([
      {
        kind: 'child', id: parent.id, mode: 'continuable', label: 'Local parent',
        activity: 'inactive', hasChildren: true, parentId: root.id, depth: 1,
      },
      {
        kind: 'child', id: childId, mode: 'one-shot', label: 'External leaf', external: true,
        activity: 'inactive', hasChildren: false, parentId: parent.id, depth: 2,
      },
    ])
    expect(observe.mock.calls.filter(([id]) => id === parent.id)).toHaveLength(1)
    expect(observe.mock.calls.some(([id]) => id === childId)).toBe(false)
    await expect(listChildren(reader, parent.id)).resolves.toEqual([{
      kind: 'child', id: childId, mode: 'one-shot', label: 'External leaf', external: true,
      activity: 'inactive', hasChildren: false,
    }])
  })

  it('returns an empty tree for an unknown parent or a composition without external records', async () => {
    const ctx = await setup(false)
    await expect(listChildren(ctx, SessionId('absent'))).resolves.toEqual([])
    await expect(listDescendants(ctx, SessionId('absent'))).resolves.toEqual([])
    const parent = ctx.sessions.create(SessionId('local-only-parent'))
    const child = ctx.sessions.create(SessionId('local-only-child'), { meta: { parentSession: parent.id, origin: 'subagent' } })
    child.append('subagent/descriptor', { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 'spawn', label: 'Local only' })
    await expect(listDescendants(ctx, parent.id)).resolves.toMatchObject([{ id: child.id, hasChildren: false }])
  })

  it.each(['hit', 'miss', 'damaged'] as const)('reads a cold external catalog through a %s cache', async (cacheState) => {
    const authored = await setup()
    const parent = authored.sessions.create(SessionId('cached-parent'))
    recordExternalStart(parent, SessionId('cached-external'), 'codex', 'Cached leaf')
    const snapshot = authored.sessionProjections.snapshot(parent, ['subagentExternal'])
    const reader = await coldReader([parent])
    const cacheRoot = await mkdtemp(join(tmpdir(), 'dsh-external-cache-'))
    roots.push(cacheRoot)
    await reader.plugin(Storage)
    await reader.plugin(StorageJson, { root: cacheRoot })
    await reader.plugin(StorageDomain, { backend: 'json' })
    await reader.plugin(SessionProjectionCache, { writeEveryEvents: 100, writeIntervalMs: 60_000 })
    const cachedSnapshot = vi.spyOn(reader.sessionProjectionCache, 'cachedSnapshot').mockImplementation(() => {
      if (cacheState === 'damaged') throw new Error('damaged derived checkpoint')
      return cacheState === 'hit' ? snapshot : undefined
    })
    const observe = vi.spyOn(reader.sessionQuery, 'observeSession')
    await expect(listChildren(reader, parent.id, new AbortController().signal)).resolves.toMatchObject([
      { id: SessionId('cached-external'), external: true, label: 'Cached leaf' },
    ])
    expect(cachedSnapshot).toHaveBeenCalled()
    expect(observe).toHaveBeenCalledTimes(cacheState === 'hit' ? 0 : 1)
  })

  it('rejects a replaced root parent and isolates an unreadable nested parent', async () => {
    const authored = await setup()
    const root = authored.sessions.create(SessionId('cold-root'))
    const parent = authored.sessions.create(SessionId('cold-child'), { meta: { parentSession: root.id, origin: 'subagent' } })
    parent.append('subagent/descriptor', { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 'spawn', label: 'Unavailable branch' })
    recordExternalStart(parent, SessionId('hidden-external'), 'codex', 'Hidden leaf')
    const reader = await coldReader([root, parent])
    const read = reader.sessionQuery.observeSession.bind(reader.sessionQuery)
    const observe = vi.spyOn(reader.sessionQuery, 'observeSession').mockImplementation(async (id, options) => {
      if (id === parent.id) throw new Error('disk unavailable')
      return read(id, options)
    })
    await expect(listDescendants(reader, root.id)).resolves.toEqual([
      { kind: 'diagnostic', id: parent.id, reason: 'unavailable', parentId: root.id, depth: 1 },
    ])
    observe.mockImplementation(async (id, options) => {
      const observation = await read(id, options)
      return { ...observation, header: { ...observation.header, createdAt: observation.header.createdAt + 1 } }
    })
    await expect(listChildren(reader, root.id)).rejects.toMatchObject({ code: 'SUBAGENT_CONTROL_PARENT_CHANGED' })
  })

  it('propagates root read failures and cancellation instead of hiding an unknown external catalog', async () => {
    const authored = await setup()
    const parent = authored.sessions.create(SessionId('failing-root'))
    const reader = await coldReader([parent])
    const failure = new Error('storage unavailable')
    const observe = vi.spyOn(reader.sessionQuery, 'observeSession').mockRejectedValue(failure)
    await expect(listChildren(reader, parent.id)).rejects.toBe(failure)
    const controller = new AbortController()
    observe.mockImplementation(() => {
      controller.abort()
      return Promise.reject(failure)
    })
    await expect(listChildren(reader, parent.id, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('reads local-only cold projections and accepts a query without optional projections', async () => {
    const authored = await setup()
    const root = authored.sessions.create(SessionId('optional-root'))
    const child = authored.sessions.create(SessionId('optional-local'), { meta: { parentSession: root.id, origin: 'subagent' } })
    child.append('subagent/descriptor', { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 'spawn', label: 'Local only' })
    const reader = await coldReader([root, child], false)
    await expect(listDescendants(reader, root.id)).resolves.toMatchObject([{ id: child.id, hasChildren: false }])
    const read = reader.sessionQuery.observeSession.bind(reader.sessionQuery)
    vi.spyOn(reader.sessionQuery, 'observeSession').mockImplementation(async (id, options) => {
      const observation = await read(id, options)
      const withoutProjections = { ...observation, [Symbol.dispose]: () => { observation[Symbol.dispose]() } }
      delete withoutProjections.projections
      return withoutProjections
    })
    await expect(listChildren(reader, child.id)).resolves.toEqual([])
  })

  it('orders external leaves with equal creation times by identity', async () => {
    const authored = await setup()
    const root = authored.sessions.create(SessionId('ordered-root'))
    recordExternalStart(root, SessionId('z-external'), 'codex', 'Last')
    recordExternalStart(root, SessionId('a-external'), 'codex', 'First')
    const reader = await coldReader([])
    await seedStoredSession(reader.sessionPersistence, root.header, root.snapshotEvents().map(event => ({ ...event, time: 7 })))
    await expect(listDescendants(reader, root.id)).resolves.toMatchObject([
      { id: SessionId('a-external'), parentId: root.id, depth: 1 },
      { id: SessionId('z-external'), parentId: root.id, depth: 1 },
    ])
  })

  it('samples external activity from the live manager and retains the row after disposal', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SubagentRuntime)
    const parent = await externalTestParent(ctx)
    await ctx.plugin(TestSessionQuery)
    const terminal = Promise.withResolvers<{ output: []; stopReason: 'aborted' }>()
    ctx.subagents.registerProvider({
      name: 'external', inheritsParentContext: false,
      capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      start: () => Promise.resolve({
        id: SessionId('live-external'), localAgent: undefined, result: terminal.promise,
        dispose: () => { terminal.resolve({ output: [], stopReason: 'aborted' }); return Promise.resolve() },
      }),
    })
    const activation = await ctx.subagents.startActivation({
      provider: 'external', label: 'Live work', request: { parent, prompt: [{ type: 'text', text: 'Work' }] },
      signal: new AbortController().signal, delivery: 'caller',
    })
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toMatchObject([{ id: activation.childId, activity: 'running' }])
    await expect(ctx.subagents.listDescendants(parent.id)).resolves.toMatchObject([{ id: activation.childId, activity: 'running', depth: 1 }])
    await activation.dispose()
    await expect(ctx.subagents.listChildren(parent.id)).resolves.toMatchObject([{ id: activation.childId, activity: 'inactive' }])
  })

  it('does not inherit another parent’s external children across a fork', async () => {
    const ctx = await setup()
    const parent = ctx.sessions.create(SessionId('fork-source'))
    recordExternalStart(parent, SessionId('ancestor-external'), 'codex', 'Ancestor work')
    recordExternalEnd(parent, SessionId('ancestor-external'), { output: [], stopReason: 'aborted' })
    const inherited = parent.snapshotEvents()
    const own: SessionEvent = {
      type: 'subagent/external-start', seq: SessionSeq(inherited.length), time: 5,
      data: { version: 0, childId: SessionId('own-external'), provider: 'codex', label: 'Own work' },
    }
    const restored = ctx.sessionProjections.restore({}, [...inherited, own], SessionLogOffset(0),
      { ...parent.header, id: SessionId('fork-child'), isSeeded: true }, SessionLogOffset(inherited.length))
    expect(restored.snapshot.values.subagentExternal).toEqual([{
      childId: SessionId('own-external'), provider: 'codex', label: 'Own work', createdAt: 5,
    }])
  })

  it.each(['orphan', 'duplicate-start', 'duplicate-end'] as const)('rejects %s execution records on restoration', async (fault) => {
    const ctx = await setup()
    const parent = ctx.sessions.create(SessionId(`invalid-${fault}`))
    const childId = SessionId('invalid-child')
    if (fault !== 'orphan') recordExternalStart(parent, childId, 'codex', 'Work')
    if (fault === 'duplicate-start') recordExternalStart(parent, childId, 'codex', 'Work')
    else {
      recordExternalEnd(parent, childId, { output: [], stopReason: 'error' })
      if (fault === 'duplicate-end') recordExternalEnd(parent, childId, { output: [], stopReason: 'error' })
    }
    expect(() => ctx.sessionProjections.snapshot(parent, ['subagentExternal'])).toThrow(/external subagent/)
  })
})
