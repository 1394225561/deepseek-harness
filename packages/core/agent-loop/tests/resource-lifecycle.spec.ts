import { setImmediate } from 'node:timers/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import { MockAdapter, textResponse } from './mock-adapter.ts'

it.each([0, 1, 2])('retains Agent resources until all work exits with %i failed teardowns', async (failures) => {
  const ctx = new Context()
  const release = Promise.withResolvers<undefined>()
  onTestFinished(async () => {
    release.resolve(undefined)
    await ctx.fiber.dispose()
  })
  await mountAgentLoopTestDependencies(ctx)
  const loop = await ctx.plugin(AgentLoop, { agents: [] })
  const failed = []
  for (let index = 0; index < failures; index++) {
    const handle = await ctx.agents.create({ sessionId: SessionId(`failed-cleanup-${index}`) })
    const error = new Error(`teardown failure ${index}`)
    vi.spyOn(handle.agent, 'cancel').mockImplementation(() => { throw error })
    failed.push({ handle, error })
  }
  let ownerCtx!: Context
  const owner = await ctx.plugin(Object.assign((inner: Context) => { ownerCtx = inner }, { inject: ['agents'] }))
  const { agent } = await ownerCtx.agents.create({ sessionId: SessionId('pending-cleanup') })
  const aborted = Promise.withResolvers<undefined>()
  let workExited = false
  let scopeDisposedBeforeWorkExit = false
  let projectionPresentAtWorkExit = false
  let scopeDisposed = false
  agent.ctx.effect(() => () => {
    scopeDisposed = true
    scopeDisposedBeforeWorkExit = !workExited
  })
  const projections = ctx.sessionProjections
  const work = agent.runMaintenance(async (signal) => {
    signal.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
    await release.promise
    projectionPresentAtWorkExit = projections.stateOf(agent.session, 'inbox') !== undefined
      && projections.stateOf(agent.session, 'turnBoundary') !== undefined
    workExited = true
  })
  const disposal = loop.dispose()
  await aborted.promise
  const ownerDisposal = owner.dispose()
  // Drain runnable unload callbacks while the Agent is held at an explicit barrier.
  await setImmediate()
  release.resolve(undefined)
  await work
  await Promise.all([disposal, ownerDisposal])
  for (const { handle, error } of failed) await expect(handle.dispose()).rejects.toBe(error)
  expect(scopeDisposedBeforeWorkExit).toBe(false)
  expect(projectionPresentAtWorkExit).toBe(true)
  expect(scopeDisposed).toBe(true)
  expect(projections.stateOf(agent.session, 'inbox')).toBeUndefined()
  expect(projections.stateOf(agent.session, 'turnBoundary')).toBeUndefined()
  expect(ctx.agents.get(agent.id)).toBeUndefined()
  expect(ctx.sessions.get(agent.session.id)).toBeUndefined()
})

it.each(['loop', 'root'] as const)('unloads %s while a background child is stopping', async (owner) => {
  const ctx = new Context()
  const release = Promise.withResolvers<undefined>()
  const root = mkdtempSync(join(tmpdir(), 'dsh-resource-lifecycle-'))
  onTestFinished(async () => {
    release.resolve(undefined)
    await ctx.fiber.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(JsonlSessionPersistence, { root })
  const loop = await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(LocalJobRegistry)
  await ctx.plugin(SubagentSpawn)
  await ctx.plugin(ToolSubagent, { provider: 'spawn' })
  ctx.jobs.attachController('resource-lifecycle')
  const parentId = SessionId('background-parent')
  const childCancelObserved = Promise.withResolvers<undefined>()
  ctx.on('agent/created', ({ agent }) => {
    const cancel = agent.cancel.bind(agent)
    vi.spyOn(agent, 'cancel').mockImplementation((cause, options) => {
      if (agent.id !== parentId) childCancelObserved.resolve(undefined)
      cancel(cause, options)
    })
  })
  ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('unused')]))
  const { agent: parent } = await ctx.agents.create({
    sessionId: parentId, agentOptions: { provider: 'mock', model: 'mock' },
  })
  const requestEntered = Promise.withResolvers<undefined>()
  ctx.on('agent/request', async (event, next) => {
    expect(event.agent).not.toBe(parent)
    requestEntered.resolve(undefined)
    await release.promise
    return next()
  })
  const started = await ctx.tools.execute({
    agent: parent, signal: new AbortController().signal,
    callId: ToolCallId('background-start'), name: 'subagent',
    arguments: { description: 'child', prompt: 'wait' },
  })
  expect(started.isError).toBe(false)
  await requestEntered.promise
  const disposal = owner === 'loop' ? loop.dispose() : ctx.fiber.dispose()
  // Teardown cancels the in-flight child while it is still inside agent/request.
  await childCancelObserved.promise
  release.resolve(undefined)
  await disposal
})

it.each([false, true])('releases the Agent scope after cancel failure with scope failure %s', async (failScope) => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  let ownerCtx!: Context
  const owner = await ctx.plugin(Object.assign((inner: Context) => { ownerCtx = inner }, { inject: ['agents'] }))
  const handle = await ownerCtx.agents.create({ sessionId: SessionId('failed-owner-cleanup') })
  let scopeDisposed = false
  handle.agent.ctx.effect(() => () => { scopeDisposed = true })
  const failure = new Error('teardown failure')
  vi.spyOn(handle.agent, 'cancel').mockImplementation(() => { throw failure })
  const scopeFailure = new Error('scope teardown failure')
  if (failScope) {
    const fiber = handle.agent.ctx.fiber
    const rawDispose = fiber.dispose
    vi.spyOn(fiber, 'dispose').mockImplementation(async () => {
      await rawDispose()
      throw scopeFailure
    })
  }
  await owner.dispose()
  if (failScope) await expect(handle.dispose()).rejects.toMatchObject({ errors: [failure, scopeFailure] })
  else await expect(handle.dispose()).rejects.toBe(failure)
  expect(scopeDisposed).toBe(true)
})
