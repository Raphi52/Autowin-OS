import { buildWatchdogPrompt, parseWatchdogOutcome } from './watchdog-prompt'
import type { DispatchResult, TaskDispatcher } from './task-scheduler'
import type {
  ScheduledTask,
  TaskOccurrence,
  TaskUsageSettlementSink,
  WatchdogMutationClaimsSink,
  WatchdogOrchestrationRequest
} from './types'
import type { ReasoningEffort } from '../roles'
import {
  AGENT_STUDIO_DEFAULT_MODEL_LABEL,
  usesAgentStudioDefault
} from '../../shared/task-provider'

type ScheduledTaskRoleBinding = {
  provider: string
  model?: string
  reasoningEffort?: ReasoningEffort
}

export interface ScheduledChatRuntime {
  /** Résout le rôle orchestrateur Agent Studio au moment de CHAQUE run planifié. */
  agentStudioBinding?(): ScheduledTaskRoleBinding
  hasConversation(conversationId: string): boolean
  createConversation(input: { title: string; category: string; provider: string }): { id: string }
  bindConversation(taskId: string, conversationId: string): void
  isConversationBusy(conversationId: string): boolean
  interruptAndWait(conversationId: string, reason: string): Promise<boolean>
  /** Attend sans interruption que le travail interactif se termine. `false` signifie timeout. */
  waitForInteractiveIdle?(timeoutMs: number): Promise<boolean>
  /** Rend le lease d'inactivite pris par `waitForInteractiveIdle`. */
  releaseInteractiveIdle?(): void
  runPrompt(
    conversationId: string,
    prompt: string,
    binding?: { provider: string; model?: string; reasoningEffort?: ReasoningEffort },
    policy?: {
      readOnly: boolean
      maxIterations: number
      background?: boolean
      maxBudgetUsd?: number
    },
    onLateUsageSettlement?: TaskUsageSettlementSink
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
    resolvedModel?: string
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
    request: WatchdogOrchestrationRequest,
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
    resolvedModel?: string
  }>
}

const WATCHDOG_INTERACTIVE_IDLE_TIMEOUT_MS = 30_000

export function scheduledTaskBinding(
  task: ScheduledTask,
  agentStudioBinding?: ScheduledTaskRoleBinding
): ScheduledTaskRoleBinding | undefined {
  const provider = task.destination.provider
  if (!provider) return undefined
  if (usesAgentStudioDefault(provider)) return agentStudioBinding
  return {
    provider,
    ...(task.destination.model ? { model: task.destination.model } : {}),
    ...(task.destination.reasoningEffort
      ? { reasoningEffort: task.destination.reasoningEffort }
      : {})
  }
}

/** Les alias Claude sont volontaires (`haiku`, `sonnet`, `opus`) : le provider rend un id versionne. */
function requestedClaudeFamily(model: string): 'haiku' | 'sonnet' | 'opus' | undefined {
  const normalized = model.toLowerCase()
  return (['haiku', 'sonnet', 'opus'] as const).find((family) => normalized.includes(family))
}

function watchdogProviderBudgetUsd(task: ScheduledTask): number | undefined {
  const guards = task.watchdog?.guards
  const dailyBudget = guards?.maxKnownCostUsdPerDay
  if (!guards || !Number.isFinite(dailyBudget) || (dailyBudget as number) <= 0) return undefined
  const maximumDailyAdmissions = Math.max(
    1,
    guards.maxTriggersPerDay ?? guards.maxTriggersPerHour * 24
  )
  return (dailyBudget as number) / maximumDailyAdmissions
}

export class ScheduledChatDispatcher implements TaskDispatcher {
  constructor(private readonly runtime: ScheduledChatRuntime) {}

  async run(
    task: ScheduledTask,
    occurrence: TaskOccurrence,
    onLateMutationClaims?: WatchdogMutationClaimsSink,
    onLateUsageSettlement?: TaskUsageSettlementSink
  ): Promise<DispatchResult> {
    // L'autorite de fond appartient a la REGLE, pas a son declencheur : cliquer "Executer" sur une
    // regle Watchdog ne doit pas soudain lui donner le droit d'interrompre le travail humain.
    const isWatchdogTask = Boolean(task.watchdog || occurrence.watchdog)
    let idleLeaseHeld = false
    if (isWatchdogTask && this.runtime.waitForInteractiveIdle) {
      const idle = await this.runtime.waitForInteractiveIdle(WATCHDOG_INTERACTIVE_IDLE_TIMEOUT_MS)
      if (!idle) {
        return {
          status: 'cancelled',
          error: "Reveil Watchdog annule : l'activite interactive n'a pas cesse dans le delai."
        }
      }
      idleLeaseHeld = true
    }

    try {
      const followsAgentStudio = usesAgentStudioDefault(task.destination.provider)
      const binding = scheduledTaskBinding(
        task,
        followsAgentStudio ? this.runtime.agentStudioBinding?.() : undefined
      )
      if (followsAgentStudio && !binding) {
        return {
          status: 'failed',
          error: `${AGENT_STUDIO_DEFAULT_MODEL_LABEL} : aucun modèle Agent Studio n'est configuré.`
        }
      }
      const executionTask =
        followsAgentStudio && binding
          ? {
              ...task,
              destination: { ...task.destination, ...binding }
            }
          : task
      const conversationId = this.resolveConversation(task, binding)
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
        if (isWatchdogTask) {
          // fix-ok: un reveil de fond ne prend jamais autorite sur un tour existant, meme si une course
          // rend la cible occupee juste apres que l'attente globale a signale l'inactivite.
          return {
            status: 'cancelled',
            conversationId,
            error: 'Reveil Watchdog annule : la conversation cible est occupee.'
          }
        }
        await this.runtime.interruptAndWait(conversationId, 'scheduled-task')
      }

      // Une règle en action `orchestration` passe par le pipeline complet : l'analyse, le correctif et
      // la VÉRIFICATION y existent déjà. Si le runtime ne sait pas orchestrer, on retombe sur le tour
      // de conversation plutôt que d'échouer — dégradé annoncé, jamais silencieux.
      const wantsOrchestration = isWatchdogTask && task.watchdog?.action === 'orchestration'
      // Le texte observé reste dans une enveloppe NON FIABLE séparée. Il ne peut donc jamais changer
      // le routage, le régime ou le sandbox calculés depuis la règle enregistrée par l'utilisateur.
      const orchestrationRequest: WatchdogOrchestrationRequest = {
        instruction: task.prompt,
        ...(occurrence.watchdog
          ? { evidence: { trust: 'untrusted' as const, signal: occurrence.watchdog } }
          : {})
      }
      // Le chat de tri est lecture seule et peut afficher le contexte brut. L'orchestration mutante,
      // y compris son fallback sans runtime dédié, ne reçoit comme ordre que le prompt de la règle.
      const prompt =
        occurrence.watchdog && !wantsOrchestration
          ? buildWatchdogPrompt(task.prompt, occurrence.watchdog)
          : task.prompt
      const maxBudgetUsd =
        binding?.provider === 'claude' ? watchdogProviderBudgetUsd(task) : undefined
      const readOnlyPolicy =
        (occurrence.watchdog || task.watchdog) && task.watchdog?.action !== 'orchestration'
          ? {
              readOnly: true,
              maxIterations: 1,
              background: true,
              ...(maxBudgetUsd === undefined ? {} : { maxBudgetUsd })
            }
          : undefined
      const backgroundFallbackPolicy = isWatchdogTask
        ? (readOnlyPolicy ?? { readOnly: false, maxIterations: 6, background: true })
        : undefined
      const result =
        wantsOrchestration && this.runtime.runOrchestration
          ? await this.runtime.runOrchestration(
              conversationId,
              orchestrationRequest,
              executionTask,
              onLateMutationClaims
            )
          : binding
            ? backgroundFallbackPolicy
              ? await this.runtime.runPrompt(
                  conversationId,
                  prompt,
                  binding,
                  backgroundFallbackPolicy,
                  onLateUsageSettlement
                )
              : await this.runtime.runPrompt(conversationId, prompt, binding)
            : backgroundFallbackPolicy
              ? await this.runtime.runPrompt(
                  conversationId,
                  prompt,
                  undefined,
                  backgroundFallbackPolicy,
                  onLateUsageSettlement
                )
              : await this.runtime.runPrompt(conversationId, prompt)
      const metering = {
        ...(result.knownCostUsd === undefined ? {} : { knownCostUsd: result.knownCostUsd }),
        ...(result.totalTokens === undefined ? {} : { totalTokens: result.totalTokens }),
        ...(result.unpricedCalls === undefined ? {} : { unpricedCalls: result.unpricedCalls }),
        ...(binding?.model ? { requestedModel: binding.model } : {}),
        ...(result.resolvedModel ? { resolvedModel: result.resolvedModel } : {})
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
      const requestedFamily =
        binding?.provider === 'claude' && binding.model
          ? requestedClaudeFamily(binding.model)
          : undefined
      if (task.watchdog && requestedFamily && !result.resolvedModel) {
        return {
          status: 'failed',
          conversationId,
          turnId: result.turnId,
          ...metering,
          error:
            `Modele Watchdog invérifiable : ${binding?.model ?? requestedFamily} demande, ` +
            'modele reel non expose par le provider.'
        }
      }
      if (
        task.watchdog &&
        requestedFamily &&
        result.resolvedModel &&
        !result.resolvedModel.toLowerCase().includes(requestedFamily)
      ) {
        return {
          status: 'failed',
          conversationId,
          turnId: result.turnId,
          ...metering,
          error:
            `Modele Watchdog non conforme : ${binding?.model ?? requestedFamily} demande, ` +
            `${result.resolvedModel} execute.`
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
    } finally {
      if (idleLeaseHeld) this.runtime.releaseInteractiveIdle?.()
    }
  }

  private resolveConversation(
    task: ScheduledTask,
    binding?: ScheduledTaskRoleBinding
  ): string | undefined {
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
      provider: binding?.provider ?? task.destination.provider
    })
    this.runtime.bindConversation(task.id, created.id)
    return created.id
  }
}
