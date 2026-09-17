/**
 * Admission and closure for one activation execution driver.
 *
 * @module @deepseek-ai/dsh-subagent/inbox
 */

import type { ActivationDriver } from './activation-driver.ts'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { SubagentPromptRequest } from './control-types.ts'
import { SubagentError } from './error.ts'

/** One Agent inbox destination, as the wire request selects it. */
export type SubagentDelivery = SubagentPromptRequest['delivery']

/** Admit driver input until the activation starts closing. */
export class SubagentInbox {
  private closingPromise: Promise<void> | undefined

  /**
   * Wrap one activation driver.
   * @param driver - execution receiving accepted input.
   */
  constructor(private readonly driver: ActivationDriver) {}

  /**
   * Read the Activation's close transaction.
   * @returns the memoized transaction, or `undefined` while delivery remains open.
   */
  get closing(): Promise<void> | undefined {
    return this.closingPromise
  }

  /**
   * Read whether the underlying Agent still has accepted work to claim.
   * @returns whether either Agent inbox destination is non-empty.
   */
  get hasPending(): boolean {
    return this.driver.hasPending
  }

  /**
   * Submit through the Agent only while its Activation remains resident.
   * @param message - the accepted input to submit.
   * @param delivery - whether to queue a distinct turn or steer the nearest step.
   */
  deliver(message: UserMessage, delivery: SubagentDelivery): void {
    if (this.closingPromise !== undefined) {
      throw new SubagentError(
        'subagent activation is being disposed; the message was not accepted',
        'ACTIVATION_CLOSING',
      )
    }
    this.driver.deliver(message, delivery)
  }

  /**
   * Close delivery synchronously and share one asynchronous release.
   * @param release - the one release operation to start after closing admission.
   * @returns the memoized release transaction.
   */
  close(release: () => Promise<void>): Promise<void> {
    const existing = this.closingPromise
    if (existing !== undefined) return existing
    const completion = Promise.withResolvers<void>()
    this.closingPromise = completion.promise
    void release().then(completion.resolve, completion.reject)
    return completion.promise
  }
}
