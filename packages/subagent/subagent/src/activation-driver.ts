/**
 * Activation execution and settlement over a local Agent or an external run.
 * The manager owns admission and residency; each driver owns its execution handle.
 *
 * @module @deepseek-ai/dsh-subagent/activation-driver
 */

import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionLogOffset, UserMessage } from '@deepseek-ai/dsh-session'
import { finalAssistantOutput } from './assistant-output.ts'
import { SubagentError } from './error.ts'
import { epochStopReason } from './lifecycle.ts'
import type { SubagentPromptRequest } from './control-types.ts'
import type { SubagentResult, SubagentRun } from './types.ts'

/** Local or external execution; only the local driver accepts further input. */
export type ActivationDriver = LocalActivationDriver | ExternalActivationDriver

/** Execution operations used by the activation manager. */
interface ActivationLifecycle {
  /** The local Agent, absent for an external product run. */
  readonly agent: Agent | undefined
  /** Whether accepted input remains unclaimed. */
  readonly hasPending: boolean
  /** Monotonic revision for detecting work committed during settlement. */
  readonly version: number
  /**
   * Wait until execution and maintenance reach quiescence.
   * @returns fulfillment after current activity settles.
   */
  whenIdle(): Promise<void>
  /**
   * Cancel active execution and optionally preserve unclaimed input.
   * @param kind - the actor requesting cancellation.
   * @param keepInbox - preserve local queued input when true.
   */
  cancel(kind: 'user' | 'parent', keepInbox?: boolean): void
  /**
   * Flush owned durable state; failures remain visible to the manager.
   * @returns fulfillment after persistence completes.
   */
  flush(): Promise<void>
  /**
   * Read the settled outcome of this activation's own execution.
   * @returns final output and stop reason, with any committed structured value.
   * @throws when an external result has not settled yet.
   */
  capture(): SubagentResult
  /**
   * Claim idle execution and synchronously close manager admission.
   * The callback starts teardown but must not await it or throw.
   * @param close - synchronously close admission and start resource release.
   * @returns whether idle execution was claimed and admission closed.
   */
  closeWhenIdle(close: () => void): boolean
  /**
   * Subscribe for the driver's lifetime to input removal.
   * @param wake - wake the manager's settlement observation.
   */
  onInputRemoved(wake: () => void): void
  /**
   * Release the owned execution handle and reach quiescence.
   * @returns fulfillment after resource release.
   */
  dispose(): Promise<void>
}

/** Read access to a requested structured result after tool acceptance. */
export interface ActivationStructuredCapture {
  /**
   * Read the value committed by the structured-output tool.
   * @returns the committed value, or undefined when no value was accepted.
   */
  captured(): { value: unknown } | undefined
}

/** Local execution with output restricted to events produced during residency. */
export class LocalActivationDriver implements ActivationLifecycle {
  /** Execution with a local Agent inbox. */
  readonly kind = 'local'
  readonly agent: Agent
  private readonly boundary: SessionLogOffset

  /**
   * Own one published local handle before submitting activation input.
   * @param handle - the local Agent and its resource release operation.
   * @param structured - committed-value reader when structured output is required.
   */
  constructor(
    private readonly handle: AgentHandle,
    private readonly structured?: ActivationStructuredCapture,
  ) {
    this.agent = handle.agent
    this.boundary = this.agent.session.seq
  }

  get hasPending(): boolean {
    return this.agent.inbox.nextTurn.length > 0 || this.agent.inbox.nextStep.length > 0
  }

  get version(): number {
    return this.agent.session.seq
  }

  whenIdle(): Promise<void> {
    return this.agent.whenIdle()
  }

  /**
   * Submit accepted input to the local Agent.
   * @param message - identified input accepted by the manager.
   * @param delivery - queue a new turn or steer the nearest step.
   * @throws when this activation has already submitted its structured result.
   */
  deliver(message: UserMessage, delivery: SubagentPromptRequest['delivery']): void {
    if (this.structured?.captured() !== undefined) {
      throw new SubagentError('subagent already submitted its structured result; wait for this activation to close before sending another message', 'INPUT_CLOSED')
    }
    if (delivery === 'steer') this.agent.steer(message)
    else this.agent.followup(message)
  }

  cancel(kind: 'user' | 'parent', keepInbox?: boolean): void {
    if (keepInbox === undefined) this.agent.cancel({ kind })
    else this.agent.cancel({ kind }, { keepInbox })
  }

  async flush(): Promise<void> {
    await this.agent.ctx.sessions.flush(this.agent.session)
  }

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

  onInputRemoved(wake: () => void): void {
    this.agent.ctx.on('agent/inbox/claimed', wake)
    this.agent.ctx.on('agent/inbox/discarded', wake)
  }

  dispose(): Promise<void> {
    return this.handle.dispose()
  }
}

/** External execution that settles once and accepts no further input. */
export class ExternalActivationDriver implements ActivationLifecycle {
  /** Execution without continuation input. */
  readonly kind = 'external'
  readonly agent = undefined
  readonly hasPending = false
  private terminal: SubagentResult | undefined
  private failure: { error: unknown } | undefined
  private readonly settled: Promise<void>
  private disposal: Promise<void> | undefined

  /**
   * Observe one published external run until its terminal result is available.
   * @param run - provider-owned execution handle.
   * @param controller - cancellation controller passed to the provider at start.
   */
  constructor(
    private readonly run: SubagentRun,
    private readonly controller: AbortController,
  ) {
    this.settled = run.result.then(
      (result) => { this.terminal = result },
      (error: unknown) => {
        this.failure = { error }
        this.terminal = {
          output: [],
          stopReason: 'error',
          diagnostic: 'External subagent execution failed before returning a result.',
        }
      },
    )
  }

  get version(): number {
    return this.terminal === undefined ? 0 : 1
  }

  whenIdle(): Promise<void> {
    return this.settled
  }

  cancel(kind: 'user' | 'parent', _keepInbox?: boolean): void {
    this.controller.abort({ kind })
    void this.dispose().catch(() => undefined)
  }

  flush(): Promise<void> {
    return Promise.resolve()
  }

  capture(): SubagentResult {
    if (this.failure !== undefined) throw this.failure.error
    if (this.terminal === undefined) {
      throw new SubagentError(`subagent "${this.run.id}" has not settled`, 'NOT_IDLE')
    }
    return this.terminal
  }

  closeWhenIdle(close: () => void): boolean {
    if (this.terminal === undefined) return false
    close()
    return true
  }

  onInputRemoved(_wake: () => void): void {}

  dispose(): Promise<void> {
    this.disposal ??= Promise.resolve().then(() => this.run.dispose())
    return this.disposal
  }
}
