/**
 * Local Agent input, idle admission, and activation output capture.
 *
 * @module @deepseek-ai/dsh-subagent/activation-driver
 */

import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionLogOffset, UserMessage } from '@deepseek-ai/dsh-session'
import { finalAssistantOutput } from './assistant-output.ts'
import { SubagentError } from './error.ts'
import { epochStopReason } from './lifecycle.ts'
import type { SubagentDelivery } from './control-types.ts'
import type { SubagentResult } from './types.ts'
import type { StructuredAttachment } from './structured.ts'

/** Local execution with output restricted to events produced during residency. */
export class LocalActivationDriver {
  /** Execution with a local Agent inbox. */
  readonly kind = 'local'
  /** The live Agent retained for this residency epoch. */
  readonly agent: Agent
  private readonly boundary: SessionLogOffset

  /**
   * Own one published local handle before submitting activation input.
   * @param handle - the local Agent and its resource release operation.
   * @param structured - committed-value reader when structured output is required.
   */
  constructor(
    private readonly handle: AgentHandle,
    private readonly structured?: StructuredAttachment,
  ) {
    this.agent = handle.agent
    this.boundary = this.agent.session.seq
  }

  /** Whether accepted local input remains unclaimed. */
  get hasPending(): boolean {
    return this.agent.inbox.nextTurn.length > 0 || this.agent.inbox.nextStep.length > 0
  }

  /** Session revision used to recheck idle admission after persistence. */
  get version(): number {
    return this.agent.session.seq
  }

  /**
   * Wait until execution and maintenance reach quiescence.
   * @returns fulfillment after current activity settles.
   */
  whenIdle(): Promise<void> {
    return this.agent.whenIdle()
  }

  /**
   * Submit accepted input to the local Agent.
   * @param message - identified input accepted by the manager.
   * @param delivery - queue a new turn or steer the nearest step.
   * @throws when this activation has already submitted its structured result.
   */
  deliver(message: UserMessage, delivery: SubagentDelivery): void {
    if (this.structured?.captured() !== undefined) {
      throw new SubagentError('subagent already submitted its structured result; wait for this activation to close before sending another message', 'INPUT_CLOSED')
    }
    if (delivery === 'steer') this.agent.steer(message)
    else this.agent.followup(message)
  }

  /**
   * Cancel active execution and optionally preserve unclaimed input.
   * @param kind - the actor requesting cancellation.
   * @param keepInbox - preserve local queued input when true.
   */
  cancel(kind: 'user' | 'parent', keepInbox?: boolean): void {
    if (keepInbox === undefined) this.agent.cancel({ kind })
    else this.agent.cancel({ kind }, { keepInbox })
  }

  /**
   * Flush owned durable state; failures remain visible to the manager.
   * @returns fulfillment after persistence completes.
   */
  async flush(): Promise<void> {
    await this.agent.ctx.sessions.flush(this.agent.session)
  }

  /**
   * Read the settled outcome of this activation's own execution.
   * @returns final output and stop reason, with any committed structured value.
   */
  capture(): SubagentResult {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const events = this.agent.session.snapshotEvents(this.boundary)
    const output = finalAssistantOutput(events) ?? []
    const stopReason = epochStopReason(events)
    if (this.structured !== undefined) {
      const captured = this.structured.captured()
      if (captured !== undefined) return { output, stopReason, structured: captured.value }
      if (stopReason === 'completed') return { output, stopReason: 'error' }
    }
    return { output, stopReason }
  }

  /**
   * Claim idle execution and synchronously close manager admission.
   * The callback starts teardown but must not await it or throw.
   * @param close - synchronously close admission and start resource release.
   * @returns whether idle execution was claimed and admission closed.
   */
  closeWhenIdle(close: () => void): boolean {
    try {
      void this.agent.runMaintenance(() => {
        close()
        return Promise.resolve()
      })
      return true
    } catch (_error: unknown) {
      // Another activity already owns the Agent's idle phase.
      return false
    }
  }

  /**
   * Subscribe for the local handle's lifetime to input removal.
   * @param wake - wake the manager's settlement observation.
   */
  onInputRemoved(wake: () => void): void {
    this.agent.ctx.on('agent/inbox/claimed', wake)
    this.agent.ctx.on('agent/inbox/discarded', wake)
  }

  /**
   * Release the owned execution handle and reach quiescence.
   * @returns fulfillment after resource release.
   */
  dispose(): Promise<void> {
    return this.handle.dispose()
  }
}
