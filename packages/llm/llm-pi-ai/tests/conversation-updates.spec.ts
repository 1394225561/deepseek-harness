/** Capability-driven transcript updates through the real pi-ai serializers and shared runtime. */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createDeveloperMessage, createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, ToolSchema, ToolUpdate } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import type { Api, Model } from '@earendil-works/pi-ai'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'
import { conversationUpdates } from '../src/models.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer } from './mock-server.ts'

const baseline: ToolSchema = { name: 'read', description: 'Read a file', parameters: { type: 'object', properties: {} } }
const added: ToolSchema = { name: 'search', description: 'Search files', parameters: { type: 'object', properties: {} } }
const system = (text: string) => createMessage({ role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text }] })
const user = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

function model(api: Api, compat?: Model<Api>['compat']): Model<Api> {
  return {
    id: 'fixture', name: 'Fixture', provider: 'fixture', api, baseUrl: 'https://example.invalid',
    reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 10000, maxTokens: 1000, ...compat === undefined ? {} : { compat },
  }
}

describe('conversation capability mapping', () => {
  it.each<{ api: Api; compat: Model<Api>['compat']; toolUpdate?: ToolUpdate }>([
    { api: 'openai-completions', compat: { supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: true }, toolUpdate: 'addition-only' },
    { api: 'anthropic-messages', compat: { supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true }, toolUpdate: 'in-history' },
    ...['openai-responses', 'azure-openai-responses', 'openai-codex-responses'].flatMap(api => [
      { api, compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true }, toolUpdate: 'addition-only' as const },
      { api, compat: { supportsMidConvoSystemMessages: true, supportsToolSearch: true }, toolUpdate: 'addition-only' as const },
    ]),
    { api: 'mistral-conversations', compat: { supportsMidConvoSystemMessages: true } },
    { api: 'openai-completions', compat: { supportsMidConvoSystemMessages: true } },
    { api: 'anthropic-messages', compat: { supportsMidConvoSystemMessages: true } },
    { api: 'openai-responses', compat: { supportsMidConvoSystemMessages: true } },
  ])('maps $api capabilities $compat', ({ api, compat, toolUpdate }) => {
    expect(conversationUpdates(model(api, compat))).toEqual({
      systemPromptUpdate: 'in-history', ...toolUpdate === undefined ? {} : { toolUpdate },
    })
  })

  it.each([
    undefined, {}, { supportsMidConvoSystemMessages: false, supportsMidConvoToolAdditions: true },
    { supportsMidConvoToolChanges: true }, { supportsAdditionalTools: true },
  ])('does not enable updates without system support: %j', (compat) => {
    expect(conversationUpdates(model('openai-completions', compat))).toEqual({})
  })
})

afterEach(closeMockServers)

async function send(provider: string, modelId: string, options: Omit<GenerateOptions, 'provider' | 'model'>) {
  const server = await mockServer([{ status: 401, body: JSON.stringify({ error: { message: 'fixture rejection' } }) }])
  const ctx = new Context()
  const runtime = ctx.plugin(LlmRuntime)
  try {
    await runtime
    // The serializer requires an API key even though the local server does not authenticate.
    const adapter = new LlmPiAi.PiAiAdapter({
      profiles: () => resolveProfiles({ [provider]: { baseURL: server.url } }),
      resolveApiKey: () => Promise.resolve('fixture-key'),
      auth: memoryAuth(),
    })
    // Use the runtime's own tool projection with this explicitly authenticated adapter.
    const dispose = ctx.llm.registerAdapter([provider], adapter)
    try {
      const result = await assemble(ctx, { provider, model: modelId, ...options })
      return { result, requests: server.requests, paths: server.paths }
    } finally { dispose() }
  } finally { await runtime.dispose() }
}

const addition = () => createDeveloperMessage({ source: { kind: 'tool-registry' }, content: [
  { type: 'text', text: 'Instruction one.' }, { type: 'text', text: 'Instruction two.' },
  { type: 'tool-addition', toolName: added.name },
] })

describe('serialized conversation updates', () => {
  it('sends full prompt snapshots and grouped tool additions through Anthropic', async () => {
    const update = addition()
    const { requests } = await send('anthropic', 'claude-opus-4-8', {
      messages: [system('initial'), user('first'), system('full updated prompt'), user('next'), update],
      tools: [baseline, added], toolHistory: { tools: [baseline], updates: [{ messageId: update.id, additions: [added] }] },
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      system: [{ type: 'text', text: 'initial' }],
      messages: [
        { role: 'user', content: 'first' }, { role: 'user', content: 'next' },
        { role: 'system', content: [{ type: 'text', text: 'full updated prompt' }] },
        { role: 'system', content: [
          { type: 'text', text: 'Instruction one.\nInstruction two.' },
          { type: 'tool_addition', tool: { type: 'tool_reference', name: 'search' } },
        ] },
      ],
      tools: [expect.objectContaining({ name: 'read' }), expect.anything(), expect.objectContaining({ name: 'search', defer_loading: true })],
    })
  })

  it('refuses an empty initial Anthropic tool set before provider I/O', async () => {
    const update = addition()
    const { result, requests } = await send('anthropic', 'claude-opus-4-8', {
      messages: [user('first'), update], tools: [added],
      toolHistory: { tools: [], updates: [{ messageId: update.id, additions: [added] }] },
    })
    expect(requests).toEqual([])
    expect(result.finish).toMatchObject({
      kind: 'error', failure: {
        code: 'UNSUPPORTED_CONTENT',
        message: 'pi-ai Anthropic tool updates require an initially active tool; this request would otherwise move tool activation out of history.',
      },
    })
  })

  it('sends only the latest prompt and current tools on unsupported routes', async () => {
    const update = addition()
    const { requests } = await send('openai', 'gpt-4.1', {
      messages: [system('initial'), user('first'), system('current'), user('next'), update], tools: [added],
      toolHistory: { tools: [baseline], updates: [{ messageId: update.id, additions: [added] }] },
    })
    expect(requests).toHaveLength(1)
    expect(JSON.stringify(requests[0])).toContain('current')
    expect(JSON.stringify(requests[0])).not.toContain('initial')
    expect(JSON.stringify(requests[0])).not.toContain('Instruction one.')
    expect(JSON.stringify(requests[0])).not.toContain('additional_tools')
  })
})

describe('historical tool availability on the wire', () => {
  it('retains removed declarations and reactivates them through Anthropic history', async () => {
    const remove = createDeveloperMessage({ source: { kind: 'tool-registry' }, content: [{ type: 'tool-removal', toolName: 'search' }] })
    const restore = createDeveloperMessage({ source: { kind: 'tool-registry' }, content: [{ type: 'tool-addition', toolName: 'search' }] })
    const { requests } = await send('anthropic', 'claude-opus-4-8', {
      messages: [user('first'), remove, user('restore'), restore], tools: [baseline, added],
      toolHistory: { tools: [baseline, added], updates: [
        { messageId: remove.id, additions: [] }, { messageId: restore.id, additions: [added] },
      ] },
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ messages: [
      { role: 'user', content: 'first' }, { role: 'user', content: 'restore' },
      { role: 'system', content: [{ type: 'tool_removal', tool: { type: 'tool_reference', name: 'search' } }] },
      { role: 'system', content: [{ type: 'tool_addition', tool: { type: 'tool_reference', name: 'search' } }] },
    ] })
  })

  it('anchors additions in Responses without emitting removal updates', async () => {
    const update = addition()
    const remove = createDeveloperMessage({ source: { kind: 'tool-registry' }, content: [{ type: 'tool-removal', toolName: 'read' }] })
    const { requests } = await send('openai', 'gpt-5.4', {
      messages: [user('first'), update, remove], tools: [added],
      toolHistory: { tools: [baseline], updates: [
        { messageId: update.id, additions: [added] }, { messageId: remove.id, additions: [] },
      ] },
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toHaveProperty('input', expect.arrayContaining([
      expect.objectContaining({ type: 'additional_tools', tools: [expect.objectContaining({ name: 'search' })] }),
    ]))
    expect(JSON.stringify(requests[0])).not.toContain('tool_removal')
    expect(JSON.stringify(requests[0])).not.toContain('Read a file')
  })

  it('uses current declarations when a request prefix omits recorded updates', async () => {
    const update = addition()
    const { requests } = await send('anthropic', 'claude-opus-4-8', {
      messages: [user('prefix')], tools: [added],
      toolHistory: { tools: [baseline], updates: [{ messageId: update.id, additions: [added] }] },
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toHaveProperty('tools', expect.arrayContaining([expect.objectContaining({ name: 'search' })]))
    expect(JSON.stringify(requests[0])).not.toContain('tool_addition')
    expect(JSON.stringify(requests[0])).not.toContain('Read a file')
  })
})
