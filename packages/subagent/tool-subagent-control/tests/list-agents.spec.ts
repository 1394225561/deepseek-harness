import { startTestActivation } from '../../subagent/tests/local-activation.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentCatalogEntry } from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as tool from '../src/list-agents.ts'
import { parkParent } from './park-parent.ts'
import { TestSessionQuery } from './test-session-query.ts'

const testToolSignal = new AbortController().signal

const roots: string[] = []
const contexts = new Set<Context>()
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function setupWith(adapter: MockAdapter) {
  const ctx = new Context()
  contexts.add(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const root = mkdtempSync(join(tmpdir(), 'dsh-tool-list-agents-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(tool)
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = await ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  parkParent(ctx, parent)
  return { ctx, parent, adapter }
}

async function setup(script: ConstructorParameters<typeof MockAdapter>[0]) {
  return setupWith(new MockAdapter(script))
}

function text(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

let calls = 0
function callTool(
  ctx: Context,
  name: string,
  args: unknown,
  agent?: unknown,
  signal: AbortSignal = testToolSignal,
) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId(`call-${++calls}`),
    name,
    arguments: args,
    ...agent !== undefined ? { agent: agent as never } : {},
  })
}

/** Wait until a continuable child released its current Activation. */
async function waitNoActivation(ctx: Context, childId: SessionId): Promise<void> {
  await vi.waitFor(() => {
    expect(ctx.agents.get(childId)).toBeUndefined()
  }, { timeout: 5_000 })
}

describe('dsh-tool-subagent-control/list-agents', () => {
  it('registers list_agents once, globally, without parameters', async () => {
    const { ctx } = await setup([])
    const schemas = ctx.tools.schemas().filter(schema => schema.name === 'list_agents')
    expect(schemas).toHaveLength(1)
    const parameters = schemas[0]!.parameters as {
      properties?: Record<string, { enum?: string[] }>
      required?: string[]
    }
    expect(Object.keys(parameters.properties ?? {})).toEqual([])
    expect(parameters.required ?? []).toEqual([])
    expect(schemas[0]!.description).toContain('send_message')
    expect(schemas[0]!.description).toContain('steers a running child at its nearest step boundary')
    expect(schemas[0]!.description).not.toContain('send_message` starts a new turn')
  })

  it('renders the empty result as (no subagents)', async () => {
    const { ctx, parent } = await setup([])
    await ctx.sessions.flush(parent.session)
    const result = await callTool(ctx, 'list_agents', {}, parent)
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('(no subagents)')
  })

  it('renders direct children in array order with registry statuses', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    const started = await ctx.subagents.startActivation({ delivery: 'parent',
      provider: 'spawn',
      label: 'real child',
      request: { prompt: [{ type: 'text', text: 'child task' }], parent },
      signal: testToolSignal,
    })
    await waitNoActivation(ctx, started.childId)
    // Pin the render deterministically past the service: the tool is a thin
    // adapter, so its fixed text forms are what this test pins. Status comes
    // from the live Agent registry, stubbed per candidate id.
    const entries: SubagentCatalogEntry[] = [
      {
        id: SessionId('one-shot-child'),
        createdAt: 1,
        label: 'finished once',
        mode: 'one-shot',
      },
      {
        id: started.childId,
        createdAt: 2,
        label: 'real child',
        mode: 'continuable',
      },
      {
        id: SessionId('running-child'),
        createdAt: 3,
        label: 'still working',
        mode: 'continuable',
      },
      {
        id: SessionId('waiting-child'),
        createdAt: 4,
        label: 'waiting on descendants',
        mode: 'continuable',
      },
    ]
    ctx.subagents.listChildren = () => Promise.resolve(entries)
    const agents = new Map<string, {
      status: 'running' | 'idle'
    }>([
      ['running-child', { status: 'running' }],
      ['waiting-child', { status: 'idle' }],
    ])
    vi.spyOn(ctx.agents, 'get').mockImplementation(id => agents.get(id) as never)
    const result = await callTool(ctx, 'list_agents', {}, parent)
    expect(result.isError).toBe(false)
    expect(text(result)).toBe(
      `${started.childId} [inactive] — real child\n`
      + 'running-child [running] — still working\n'
      + 'waiting-child [inactive] — waiting on descendants',
    )
  })

  it('passes the parent id and cancellation signal', async () => {
    const { ctx, parent } = await setup([])
    const signal = new AbortController().signal
    const listChildren = vi.spyOn(ctx.subagents, 'listChildren').mockResolvedValue([])

    const result = await callTool(ctx, 'list_agents', {}, parent, signal)

    expect(result.isError).toBe(false)
    expect(listChildren).toHaveBeenCalledWith(parent.id, signal)
  })

  it('omits caller-owned activations and lists parent-delivery children', async () => {
    const { ctx, parent } = await setup([textResponse('once'), textResponse('done')])
    const oneShot = await startTestActivation(ctx, 'spawn', {
      label: 'finished once',
      prompt: [{ type: 'text', text: 'one-shot task' }],
      parent,
      signal: new AbortController().signal,
    })
    await oneShot.result
    await oneShot.dispose()
    const started = await ctx.subagents.startActivation({ delivery: 'parent',
      provider: 'spawn',
      label: 'summarize the doc',
      request: { prompt: [{ type: 'text', text: 'child task' }], parent },
      signal: testToolSignal,
    })
    await waitNoActivation(ctx, started.childId)
    const result = await callTool(ctx, 'list_agents', {}, parent)
    expect(result.isError).toBe(false)
    expect(text(result)).toBe(`${started.childId} [inactive] — summarize the doc`)
  })

  it('describes inactive as turn availability and pins the status vocabulary', async () => {
    const { ctx } = await setup([])
    const schema = ctx.tools.schemas().find(candidate => candidate.name === 'list_agents')
    // Completion reaches the parent through its notice; listing is discovery,
    // so its inactive status must not send the model looking for a result.
    expect(schema?.description).toContain('you are told when one finishes')
    expect(schema?.description).toContain('inactive does not describe task completion, success, failure,')
    // The enum is the closed vocabulary the model renders, so pin it rather than
    // scanning prose that legitimately reads "not to poll for completion".
    const child = ctx.tools.get('list_agents')?.output.schema.items
    expect(child?.properties?.status?.enum).toEqual(['running', 'inactive'])
  })

  it('fails loud when invoked without a calling agent', async () => {
    const { ctx } = await setup([])
    const result = await callTool(ctx, 'list_agents', {})
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires a calling agent')
  })

  it('unregisters with its plugin fiber (HMR safety)', async () => {
    const ctx = new Context()
    contexts.add(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    const fiber = await ctx.plugin(tool)
    expect(ctx.tools.schemas().some(schema => schema.name === 'list_agents')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === 'list_agents')).toBe(false)
  })

  it('has the namespace-plugin export shape', () => {
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-subagent-list-agents')
    expect(tool.inject).toEqual(['tools', 'subagents', 'agents'])
    expect(typeof tool.apply).toBe('function')
  })

  it('omits external children', async () => {
    const { ctx, parent } = await setup([])
    vi.spyOn(ctx.subagents, 'listChildren').mockResolvedValue([
      { id: SessionId('external-task'), createdAt: 1, mode: 'external' },
      { id: SessionId('resumable-child'), createdAt: 2, mode: 'continuable', label: 'local task' },
    ])
    const result = await callTool(ctx, 'list_agents', {}, parent)
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('resumable-child [inactive] — local task')
  })
})
