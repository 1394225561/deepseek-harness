/**
 * Direct-child discovery from the parent-owned subagent catalog.
 * Each listing releases its Session observation without reading child logs.
 * @module @deepseek-ai/dsh-subagent
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { SubagentError } from './error.ts'
import type { SubagentCatalogEntry } from './projection-types.ts'

/**
 * Read one parent's durable catalog through a live-preferred Session observation.
 * @param ctx - context carrying the Session query service.
 * @param parentSessionId - parent whose direct children are requested.
 * @param signal - cancellation forwarded to the Session observation.
 * @returns direct-child rows in parent catalog event order.
 * @throws {@link SubagentError} when query or catalog projection is unavailable.
 */
export async function listChildren(
  ctx: Context,
  parentSessionId: SessionId,
  signal?: AbortSignal,
): Promise<SubagentCatalogEntry[]> {
  const query = ctx.get('sessionQuery')
  if (query === undefined) {
    throw new SubagentError(
      'listing subagents requires the sessionQuery service (load @deepseek-ai/dsh-session-query)',
      'SUBAGENT_CONTROL_QUERY_UNAVAILABLE',
    )
  }
  using parent = await query.observeSession(parentSessionId, {
    ...signal === undefined ? {} : { signal },
  })
  const entries = parent.projections?.values.subagentCatalog
  if (entries === undefined) {
    throw new SubagentError(
      'listing subagents requires the registered subagentCatalog projection',
      'SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE',
    )
  }
  return entries
}
