/**
 * Model-facing discovery of direct continuable children from their parent's catalog.
 * Discovery loads separately from the send_message plugin.
 * @module @deepseek-ai/dsh-tool-subagent-control/list-agents
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-subagent-list-agents'
export const inject = ['tools', 'subagents', 'agents']

/**
 * Register the `list_agents` tool.
 * @param ctx - Context carrying tool, subagent, and live Agent registries.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'list_agents',
    description:
      'List your continuable background subagents by durable id and label. Use it to recall which ones '
      + 'you started, not to poll for completion — you are told when one finishes. Status comes from the live '
      + 'registry: running means the agent is working right now; inactive means no turn is executing, whether '
      + 'the child is loaded or must be resumed. inactive does not describe task completion, success, failure, '
      + 'or waiting for other agents. A `send_message` steers a running child at its nearest step boundary '
      + 'or starts or resumes a turn for an inactive child, and a direct child remains a `send_message` '
      + 'candidate in every status. The snapshot is not a delivery '
      + 'promise — `send_message` performs the authoritative check and may still fail.',
    parameters: {},
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, enum: ['child'] },
            id: { type: 'string', required: true },
            label: { type: 'string', required: true },
            status: { type: 'string', required: true, enum: ['running', 'inactive'] },
          },
        },
      },
      render: (_args, entries) => [{
        type: 'text',
        text: entries.length === 0
          ? '(no subagents)'
          : entries.map(entry => `${entry.id} [${entry.status}] — ${entry.label}`).join('\n'),
      }],
    },
    async execute(_args, exec) {
      const parent = exec.agent
      if (parent === undefined) throw new Error('list_agents requires a calling agent (exec.agent was undefined)')
      const entries = await ctx.subagents.listChildren(parent.id, exec.signal)
      return entries.flatMap(entry => entry.mode === 'continuable' ? [{
        kind: 'child' as const,
        id: entry.id,
        label: entry.label,
        status: ctx.agents.get(entry.id)?.status === 'running' ? 'running' as const : 'inactive' as const,
      }] : [])
    },
  }))
}
