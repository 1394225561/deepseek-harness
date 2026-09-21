/** Package-private manager state used to place deterministic lifecycle races. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Activation, ChildLock } from '../src/activation.ts'
import type SubagentManager from '../src/manager.ts'

/** Return the service's bound subagent manager. */
export function subagentManager(ctx: Context): SubagentManager {
  const manager = (ctx.subagents as unknown as {
    manager?: SubagentManager
  }).manager
  if (manager === undefined) throw new Error('expected a bound subagent manager')
  return manager
}

/** Read private lifecycle state for deterministic race placement. */
export function managerState(ctx: Context) {
  return subagentManager(ctx) as unknown as {
    resident: Map<SessionId, Activation>
    locks: ChildLock
    ownerCtx: Context
  }
}

/** Remove only the map entry, leaving its Agent live for collision coverage. */
export function dropActivation(ctx: Context, childId: SessionId): void {
  managerState(ctx).resident.delete(childId)
}
