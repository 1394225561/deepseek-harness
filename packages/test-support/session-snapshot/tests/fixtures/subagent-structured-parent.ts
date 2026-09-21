/** Local structured result delivery through the public activation API. */
import type { Context } from '@deepseek-ai/cordis'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'

export const name = 'subagent-structured-parent'
export const inject = ['subagents', 'tools']

/**
 * Register a fixed-schema consumer and await settlement before the parent request.
 * @param ctx - snapshot runtime with local delegation and tools.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineContentToolFixture({
    name: 'subagent_structured',
    description: 'Ask a local child for a structured answer and receive its completion notice.',
    parameters: {},
    async execute(_args, exec) {
      const parent = exec.agent
      if (parent === undefined) throw new Error('structured snapshot requires a parent Agent')
      const activation = await ctx.subagents.startActivation({
        provider: 'spawn', label: 'Structured answer', delivery: 'parent', signal: exec.signal,
        request: {
          parent, prompt: [{ type: 'text', text: 'Submit answer 42 through structured_output.' }],
          outputSchema: { type: 'object', properties: { answer: { type: 'number' } }, required: ['answer'] },
        },
      })
      await activation.result
      return [{ type: 'text', text: `Child ${activation.childId} settled.` }]
    },
  }))
}
