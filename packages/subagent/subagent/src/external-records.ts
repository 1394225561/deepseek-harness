/**
 * Parent-owned execution records for external subagents without child Sessions.
 * The projection retains creation and terminal results independently of notices.
 *
 * @module @deepseek-ai/dsh-subagent/external-records
 */

import { z } from 'zod'
import { appendChunkedList, chunkedListSchema, iterateChunkedList } from '@deepseek-ai/dsh-chunked-list'
import type { ChunkedList } from '@deepseek-ai/dsh-chunked-list'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SubagentResult } from './types.ts'

/** Durable start of an external execution owned by the recording parent. */
export interface ExternalSubagentStart {
  readonly version: 0
  readonly childId: SessionId
  readonly provider: string
  readonly label: string
}

/** Tagged JSON output retained without dropping product-specific content fields. */
export interface ExternalSubagentContent {
  readonly type: string
  readonly [key: string]: JsonValue
}

/** Serializable terminal result available from the parent's log and projection. */
export interface ExternalSubagentResult {
  readonly output: ExternalSubagentContent[]
  readonly structured?: JsonValue | undefined
  readonly diagnostic?: string | undefined
  readonly stopReason: string
}

/** Terminal result retained after the external execution releases its process. */
export interface ExternalSubagentEnd {
  readonly version: 0
  readonly childId: SessionId
  readonly result: ExternalSubagentResult
}

/** Parent-owned external execution, including its terminal result when recorded. */
export interface ExternalSubagentRecord {
  readonly childId: SessionId
  readonly provider: string
  readonly label: string
  readonly createdAt: number
  readonly result?: ExternalSubagentResult | undefined
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * An external child accepted its initial task without creating a DSH Session.
     * @param data - parent-owned execution identity and creation label.
     */
    'subagent/external-start': ExternalSubagentStart
    /**
     * An external child settled with its complete retained result.
     * @param data - execution identity and terminal result.
     */
    'subagent/external-end': ExternalSubagentEnd
  }
}

type ExternalFact =
  | { readonly kind: 'start'; readonly record: ExternalSubagentRecord }
  | { readonly kind: 'end'; readonly childId: SessionId; readonly result: ExternalSubagentResult }

/** Serializable own-event execution state for a parent Session. */
export interface ExternalSubagentState {
  readonly inheritedEventCount: SessionLogOffset
  readonly head?: ChunkedList<ExternalFact> | undefined
}

const childIdSchema = z.string().min(1).transform(SessionId)
// Content tags are merge-extensible. Retain tagged JSON blocks without
// dropping fields owned by product-specific content consumers.
const resultSchema: z.ZodType<ExternalSubagentResult> = z.object({
  output: z.array(z.object({ type: z.string().min(1) }).catchall(z.json())),
  structured: z.json().optional(),
  diagnostic: z.string().optional(),
  stopReason: z.string().min(1),
}).strict()
const startSchema = z.object({
  version: z.literal(0),
  childId: childIdSchema,
  provider: z.string().min(1),
  label: z.string(),
}).strict()
const endSchema = z.object({
  version: z.literal(0),
  childId: childIdSchema,
  result: resultSchema,
}).strict()
const recordSchema: z.ZodType<ExternalSubagentRecord> = z.object({
  childId: childIdSchema,
  provider: z.string().min(1),
  label: z.string(),
  createdAt: z.number().int().nonnegative(),
  result: resultSchema.optional(),
}).strict()
const factSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('start'), record: recordSchema }).strict(),
  z.object({ kind: z.literal('end'), childId: childIdSchema, result: resultSchema }).strict(),
])
const stateSchema: z.ZodType<ExternalSubagentState> = z.object({
  inheritedEventCount: z.number().int().nonnegative().transform(SessionLogOffset),
  head: chunkedListSchema(factSchema).optional(),
}).strict()

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    subagentExternal: ExternalSubagentState
  }
  interface SessionProjectionMap {
    /** External children whose execution records belong to this parent. */
    subagentExternal: ExternalSubagentRecord[]
  }
}

/** Materialize execution state in creation order, rejecting unpaired terminal facts. */
function externalRecords(state: ExternalSubagentState): ExternalSubagentRecord[] {
  const records = new Map<SessionId, ExternalSubagentRecord>()
  for (const fact of iterateChunkedList(state.head)) {
    if (fact.kind === 'start') {
      if (records.has(fact.record.childId)) throw new Error('duplicate external subagent start')
      records.set(fact.record.childId, fact.record)
    } else {
      const record = records.get(fact.childId)
      if (record === undefined || record.result !== undefined) {
        throw new Error('external subagent end has no unsettled start')
      }
      records.set(fact.childId, { ...record, result: fact.result })
    }
  }
  return [...records.values()]
}

/** Fold external execution records, excluding facts inherited from another parent. */
export const externalSubagentProjectionDefinition = {
  key: 'subagentExternal',
  stateSchema,
  init: (_header: SessionHeader, inheritedEventCount: SessionLogOffset) => ({ inheritedEventCount }),
  apply: (state, event: SessionEvent) => {
    if (event.seq < state.inheritedEventCount) return state
    let fact: ExternalFact
    if (event.type === 'subagent/external-start') {
      const { version: _version, ...record } = startSchema.parse(event.data)
      fact = { kind: 'start', record: { ...record, createdAt: event.time } }
    } else if (event.type === 'subagent/external-end') {
      const { version: _version, ...end } = endSchema.parse(event.data)
      fact = { kind: 'end', ...end }
    } else return state
    return { ...state, head: appendChunkedList(state.head, fact) }
  },
  stateVersion: 1,
  wire: { viewSchema: z.array(recordSchema), view: externalRecords },
} satisfies ProjectionDefinition<'subagentExternal', ExternalSubagentState>

/**
 * Record an accepted external execution in its direct parent's log.
 * @param parent - parent Session owning the external task.
 * @param childId - stable external child identity; no child Session is required.
 * @param provider - registered backend that accepted the task.
 * @param label - creation label retained for discovery.
 */
export function recordExternalStart(parent: Session, childId: SessionId, provider: string, label: string): void {
  parent.append('subagent/external-start', { version: 0, childId, provider, label })
}

/**
 * Record the external execution's terminal outcome independently of parent notifications.
 * @param parent - same parent that recorded the execution start.
 * @param childId - external child identity from that start.
 * @param result - complete settled output, structured value, diagnostic, and stop reason; rejects non-JSON values.
 */
export function recordExternalEnd(parent: Session, childId: SessionId, result: SubagentResult): void {
  const persisted = resultSchema.parse(result)
  parent.append('subagent/external-end', { version: 0, childId, result: persisted })
}
