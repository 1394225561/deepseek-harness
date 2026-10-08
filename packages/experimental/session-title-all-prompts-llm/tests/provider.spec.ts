import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import LlmRuntime, { createUserMessage, LlmAdapter  } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import SessionTitleService, { SessionTitleProviderId, type SessionTitleProvider, type SessionTitleSource } from '@deepseek-ai/dsh-session-title'
import * as providerPlugin from '@deepseek-ai/dsh-session-title-all-prompts-llm'

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'text-delta', index: 0, text: 'All messages model title' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const TITLE_CONFIG = { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } as const
const LLM_CONFIG = {
  targetWords: 5,
  targetCjkCharacters: 10,
  maxInputBytes: 1_000,
  maxOutputTokens: 32,
  timeoutMs: 1_000,
} as const

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('all-messages LLM title provider', () => {
  it.each([
    undefined,
    { kind: 'fallback' },
    { kind: 'user' },
    { kind: 'provider', provider: SessionTitleProviderId('previous-provider') },
  ] satisfies Array<SessionTitleSource | undefined>)('preserves only an existing provider title (%j)', async (source) => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
    await ctx.plugin(SessionTitleService, TITLE_CONFIG)
    const adapter = new RecordingAdapter()
    ctx.llm.registerAdapter(['current-route'], adapter)
    let registered: SessionTitleProvider | undefined
    vi.spyOn(ctx.sessionTitle, 'register').mockImplementation((provider) => {
      registered = provider
      return async () => undefined
    })
    providerPlugin.apply(ctx, LLM_CONFIG)
    const session = ctx.sessions.create(SessionId(`title-source-${source?.kind ?? 'absent'}`))
    const first = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '阳台种番茄和罗勒' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    if (source !== undefined) {
      session.append('session/title', { title: '阳台种植建议', messageSeqs: [first.seq], source })
    }
    await registered!.generate({
      session,
      messages: [{ seq: first.seq, text: '阳台种番茄和罗勒' }],
      route: { provider: 'current-route', model: 'current-model' },
      signal: new AbortController().signal,
    })

    const options = adapter.requests[0]!
    const content = options.messages[0]!.content[0]!
    if (content.type !== 'text') throw new Error('expected title input text')
    if (source?.kind === 'provider') {
      expect(content.text).toContain('"currentTitle":"阳台种植建议"')
      expect(options.system).toContain('return it exactly unchanged')
    } else {
      expect(content.text).toContain('Generate the session title from this JSON array')
      expect(content.text).not.toContain('currentTitle')
      expect(options.system).not.toContain('return it exactly unchanged')
    }
  })

  it('includes seeded history and the latest prompt while inheriting the logged request route', async () => {
    const seeded = Session.create(SessionId('seed-source'))
    seeded.append('turn/start', { turn: 1 })
    const inherited = seeded.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'inherited prompt' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    seeded.append('session/title', {
      title: 'Inherited fallback', messageSeqs: [inherited.seq], source: { kind: 'fallback' },
    })
    seeded.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
    await ctx.plugin(SessionTitleService, TITLE_CONFIG)
    const adapter = new RecordingAdapter()
    ctx.llm.registerAdapter(['current-route'], adapter)
    await ctx.plugin(providerPlugin, LLM_CONFIG)
    const session = ctx.sessions.create(SessionId('all-plugin'), {
      seed: seeded.snapshotEvents(),
      inheritedEventCount: seeded.seq,
      meta: { parentSession: seeded.id, isSeeded: true },
    })
    session.append('turn/start', { turn: 2 })
    const latest = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'latest prompt' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await settle()
    session.append('request/header', {
      header: { config: { provider: 'current-route', model: 'current-model' } }, reason: 'resume',
    })
    await settle()

    expect(adapter.requests[0]).toMatchObject({ provider: 'current-route', model: 'current-model' })
    const content = adapter.requests[0]?.messages[0]?.content[0]
    expect(content?.type === 'text' && content.text).toContain('inherited prompt')
    expect(content?.type === 'text' && content.text).toContain('latest prompt')
    expect(ctx.sessionTitle.get(session)).toMatchObject({
      messageSeqs: [inherited.seq, latest.seq],
    })
  })
})
