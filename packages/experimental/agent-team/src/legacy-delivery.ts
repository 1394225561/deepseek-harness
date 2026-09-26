/** Compatibility delivery for pending messages written by the historical Team mailbox. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { steerHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import { errorMessage } from './error.ts'
import type { TeamJournal } from './journal.ts'
import { readPersistedSession } from './persisted.ts'
import type { TeamRoster } from './roster.ts'
import { messageAccepted } from './session-message.ts'
import { TeamId } from './types.ts'
import type { TeamMessageId, TeamMessageSnapshot } from './types.ts'

/** Drains historical queued records without admitting new Team mailbox writes. */
export class LegacyTeamDelivery {
  private readonly recoveries = new Map<SessionId, Promise<void>>()

  /**
   * @param ctx - Team service context with Agent, Session, persistence, and subagent services.
   * @param journal - authoritative Lead-log transaction owner.
   * @param roster - Team membership and member-name resolver.
   */
  constructor(
    private readonly ctx: Context,
    private readonly journal: TeamJournal,
    private readonly roster: TeamRoster,
  ) {}

  /**
   * Retry durable pending messages relevant to one started Team member.
   * @param agent - newly started exact live Agent.
   * @param signal - shared runtime cancellation.
   */
  async recoverFor(agent: Agent, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const membership = this.roster.tryMembership(agent)
    if (membership === undefined) return
    const root = membership.root
    const existing = this.recoveries.get(root.id)
    if (existing !== undefined) {
      await existing
      return
    }
    const operation = Promise.resolve().then(async () => {
      const state = this.journal.state(root)
      const blockedTargets = new Set<SessionId>()
      for (const message of state.messages) {
        if (state.delivered.includes(message.id) || blockedTargets.has(message.targetId)) continue
        signal.throwIfAborted()
        if (!await this.dispatchOnce(root, message, signal)) blockedTargets.add(message.targetId)
      }
    })
    this.recoveries.set(root.id, operation)
    try {
      await operation
    } finally {
      this.recoveries.delete(root.id)
    }
  }

  /**
   * Return admitted legacy recovery operations for runtime disposal.
   * @returns a detached snapshot of ongoing recovery passes.
   */
  pendingDispatches(): readonly Promise<unknown>[] {
    return [...this.recoveries.values()]
  }

  /** Attempt one historical delivery, retaining its pending record on failure. */
  private async dispatchOnce(root: Agent, message: TeamMessageSnapshot, signal: AbortSignal): Promise<boolean> {
    try {
      const target = message.targetId === root.id ? root : this.ctx.agents.get(message.targetId)
      if (target !== undefined && this.targetRecorded(target.session, message.id)) {
        return await this.checkpointDelivered(root, target.session, message.id)
      }
      const source = {
        kind: 'team-message' as const,
        teamId: TeamId(root.id),
        messageId: message.id,
        senderId: message.senderId,
        senderName: message.senderName,
      }
      const content = this.deliveryContent(message)
      if (message.targetId === root.id) {
        const input = createUserMessage({ content, source })
        root.steer(input)
        return await this.checkpointDelivered(root, root.session, message.id)
      }
      if (target === undefined) {
        const recorded = await this.persistedTargetRecorded(message.targetId, message.id, signal)
        if (recorded === undefined) return false
        if (recorded) {
          await this.markDelivered(root, message.id, message.targetId)
          return true
        }
      }
      await steerHostSubagentPrompt(this.ctx.subagents, root, message.targetId, content, source, signal)
      const resumed = this.ctx.agents.get(message.targetId)
      if (resumed !== undefined) return await this.checkpointDelivered(root, resumed.session, message.id)
      if (!await this.persistedTargetRecorded(message.targetId, message.id, signal)) return false
      await this.markDelivered(root, message.id, message.targetId)
      return true
    } catch (error: unknown) {
      this.ctx.logger.warn(`team message "${message.id}" remains queued: ${errorMessage(error)}`)
      return false
    }
  }

  /** Flush one live target receipt before the Lead records its delivered edge. */
  private async checkpointDelivered(
    root: Agent,
    target: Session,
    messageId: TeamMessageId,
  ): Promise<boolean> {
    await this.ctx.sessions.flush(target)
    if (!this.targetRecorded(target, messageId)) return false
    await this.markDelivered(root, messageId, target.id)
    return true
  }

  /** Record delivery unless the acknowledgement already exists. */
  private async markDelivered(root: Agent, messageId: TeamMessageId, targetId: SessionId): Promise<void> {
    await this.journal.transact(root.id, async () => {
      await this.journal.appendAndFlush(root, 'team/message/delivered', {
        version: 2,
        teamId: TeamId(root.id),
        messageId,
        targetId,
      })
    })
  }

  /** Whether a target Session already contains the durable message identity. */
  private targetRecorded(session: Session, messageId: TeamMessageId): boolean {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const suffix = session.snapshotEvents(session.inheritedEventCount)
    return messageAccepted(suffix, message => message.source.kind === 'team-message'
      && message.source.messageId === messageId)
  }

  /** Frame peer content with stable sender and message identity for the receiving model. */
  private deliveryContent(message: TeamMessageSnapshot): ContentBlock[] {
    return [
      { type: 'text', text: `Team message ${message.id} from ${message.senderName}:` },
      ...structuredClone(message.content),
    ]
  }

  /** Read an inactive target's durable log before cold resume; uncertainty keeps the mailbox queued. */
  private async persistedTargetRecorded(
    targetId: SessionId,
    messageId: TeamMessageId,
    signal: AbortSignal,
  ): Promise<boolean | undefined> {
    try {
      const stored = await readPersistedSession(this.ctx.sessionPersistence, targetId, signal)
      const suffix = stored.events.slice(stored.inheritedEventCount)
      return messageAccepted(suffix, message => message.source.kind === 'team-message'
        && message.source.messageId === messageId)
    } catch (error: unknown) {
      this.ctx.logger.warn(`cannot read Team message target "${targetId}": ${errorMessage(error)}`)
      return undefined
    }
  }
}
