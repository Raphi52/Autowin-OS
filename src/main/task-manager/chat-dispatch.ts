import type { DispatchResult, TaskDispatcher } from './task-scheduler'
import type { ScheduledTask, TaskOccurrence } from './types'

export interface ScheduledChatRuntime {
  hasConversation(conversationId: string): boolean
  createConversation(input: {
    title: string
    category: string
    provider: string
    authorityMode?: 'plan' | 'ask' | 'auto'
  }): { id: string }
  bindConversation(taskId: string, conversationId: string): void
  isConversationBusy(conversationId: string): boolean
  interruptAndWait(conversationId: string, reason: string): Promise<boolean>
  runPrompt(
    conversationId: string,
    prompt: string
  ): Promise<{ ok: boolean; cancelled?: boolean; turnId?: string; error?: string }>
}

export class ScheduledChatDispatcher implements TaskDispatcher {
  constructor(private readonly runtime: ScheduledChatRuntime) {}

  async run(task: ScheduledTask, _occurrence: TaskOccurrence): Promise<DispatchResult> {
    const conversationId = this.resolveConversation(task)
    if (!conversationId) {
      return {
        status: 'failed',
        error:
          task.destination.kind === 'existing'
            ? `Conversation cible introuvable: ${task.destination.conversationId}`
            : 'Impossible de créer la conversation dédiée.'
      }
    }

    if (this.runtime.isConversationBusy(conversationId)) {
      await this.runtime.interruptAndWait(conversationId, 'scheduled-task')
    }

    const result = await this.runtime.runPrompt(conversationId, task.prompt)
    if (result.cancelled) {
      return {
        status: 'cancelled',
        conversationId,
        turnId: result.turnId,
        error: result.error
      }
    }
    if (!result.ok) {
      return {
        status: 'failed',
        conversationId,
        turnId: result.turnId,
        error: result.error ?? 'Le tour Chat planifié a échoué.'
      }
    }
    return {
      status: 'completed',
      conversationId,
      turnId: result.turnId
    }
  }

  private resolveConversation(task: ScheduledTask): string | undefined {
    if (task.destination.kind === 'existing') {
      return this.runtime.hasConversation(task.destination.conversationId)
        ? task.destination.conversationId
        : undefined
    }
    if (
      task.destination.conversationId &&
      this.runtime.hasConversation(task.destination.conversationId)
    ) {
      return task.destination.conversationId
    }
    const created = this.runtime.createConversation({
      title: task.destination.title,
      category: task.destination.category,
      provider: task.destination.provider,
      authorityMode: task.destination.authorityMode
    })
    this.runtime.bindConversation(task.id, created.id)
    return created.id
  }
}
