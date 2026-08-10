import { buildWatchdogPrompt, parseWatchdogOutcome } from './watchdog-prompt'
import type { DispatchResult, TaskDispatcher } from './task-scheduler'
import type { ScheduledTask, TaskOccurrence, WatchdogMutationClaimsSink } from './types'
import type { ReasoningEffort } from '../roles'

export interface ScheduledChatRuntime {
  hasConversation(conversationId: string): boolean
  createConversation(input: { title: string; category: string; provider: string }): { id: string }
  bindConversation(taskId: string, conversationId: string): void
  isConversationBusy(conversationId: string): boolean
  interruptAndWait(conversationId: string, reason: string): Promise<boolean>
  runPrompt(
    conversationId: string,
    prompt: string,
    binding?: { provider: string; model: string; reasoningEffort?: ReasoningEffort }
  ): Promise<{
    ok: boolean
    cancelled?: boolean
    turnId?: string
    error?: string
    /**
     * Réponse de l'agent, quand le runtime peut la fournir. Sert UNIQUEMENT à lire le tri d'un
     * réveil ; absente, l'issue reste non renseignée plutôt que devinée.
     */
    text?: string
    mutatedPaths?: readonly string[]
    mutatedLineFingerprints?: Record<string, readonly string[]>
    mutatedPathGenerationMarkers?: Record<string, string>
    knownCostUsd?: number
    totalTokens?: number
    unpricedCalls?: number
  }>
  /**
   * Lance le PIPELINE complet (scout/frame/terrain/build/clean/judge) sur une tâche, au lieu d'un
   * simple tour de conversation. C'est ce qui apporte l'analyse, le correctif ET la vérification
   * (gate à preuve + juge) sans qu'un déclencheur ait à les redévelopper.
   *
   * Optionnelle : un runtime qui ne sait pas orchestrer fait retomber la règle sur un tour de chat
   * plutôt que d'échouer.
   */
  runOrchestration?(
    conversationId: string,
    task: string,
    scheduledTask: ScheduledTask,
    onLateMutationClaims?: WatchdogMutationClaimsSink
  ): Promise<{
    ok: boolean
    cancelled?: boolean
    turnId?: string
    error?: string
    text?: string
    mutatedPaths?: readonly string[]
    mutatedLineFingerprints?: Record<string, readonly string[]>
    mutatedPathGenerationMarkers?: Record<string, string>
    knownCostUsd?: number
    totalTokens?: number
    unpricedCalls?: number
  }>
}

export class ScheduledChatDispatcher implements TaskDispatcher {
  constructor(private readonly runtime: ScheduledChatRuntime) {}

  async run(
    task: ScheduledTask,
    occurrence: TaskOccurrence,
    onLateMutationClaims?: WatchdogMutationClaimsSink
  ): Promise<DispatchResult> {
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

    const binding =
      task.destination.provider && task.destination.model
        ? {
            provider: task.destination.provider,
            model: task.destination.model,
            ...(task.destination.reasoningEffort
              ? { reasoningEffort: task.destination.reasoningEffort }
              : {})
          }
        : undefined
    // Un agent réveillé par un événement reçoit le CONTEXTE de cet événement et la consigne de
    // TRIER. Une tâche horaire garde exactement son prompt d'avant : le chemin planifié est intact.
    const prompt = occurrence.watchdog
      ? buildWatchdogPrompt(task.prompt, occurrence.watchdog)
      : task.prompt

    // Une règle en action `orchestration` passe par le pipeline complet : l'analyse, le correctif et
    // la VÉRIFICATION y existent déjà. Si le runtime ne sait pas orchestrer, on retombe sur le tour
    // de conversation plutôt que d'échouer — dégradé annoncé, jamais silencieux.
    const wantsOrchestration =
      Boolean(occurrence.watchdog) && task.watchdog?.action === 'orchestration'
    const result =
      wantsOrchestration && this.runtime.runOrchestration
        ? await this.runtime.runOrchestration(conversationId, prompt, task, onLateMutationClaims)
        : binding
          ? await this.runtime.runPrompt(conversationId, prompt, binding)
          : await this.runtime.runPrompt(conversationId, prompt)
    const metering = {
      ...(result.knownCostUsd === undefined ? {} : { knownCostUsd: result.knownCostUsd }),
      ...(result.totalTokens === undefined ? {} : { totalTokens: result.totalTokens }),
      ...(result.unpricedCalls === undefined ? {} : { unpricedCalls: result.unpricedCalls })
    }
    if (result.cancelled) {
      return {
        status: 'cancelled',
        conversationId,
        turnId: result.turnId,
        ...metering,
        error: result.error
      }
    }
    if (!result.ok) {
      return {
        status: 'failed',
        conversationId,
        turnId: result.turnId,
        ...metering,
        error: result.error ?? 'Le tour Chat planifié a échoué.'
      }
    }
    return {
      status: 'completed',
      conversationId,
      ...metering,
      ...(occurrence.watchdog ? { outcome: parseWatchdogOutcome(result.text) } : {}),
      mutatedPaths: result.mutatedPaths,
      mutatedLineFingerprints: result.mutatedLineFingerprints,
      mutatedPathGenerationMarkers: result.mutatedPathGenerationMarkers,
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
      provider: task.destination.provider
    })
    this.runtime.bindConversation(task.id, created.id)
    return created.id
  }
}
