import type { ProviderRegistry } from './providers/registry'
import type { RoleModelConfig } from './roles'
import type { CostAggregator } from './dashboards/cost'
import type { TrustLedger } from './trust/ledger'
import type { AuthoritySas } from './authority/sas'
import { evaluateClosure } from './gates/stopgate'
import { capabilityInstruction } from './capability-profiles'
import type { PromptEnvelope, SendOptions, Usage } from './providers/types'

/**
 * Boucle d'orchestration DISCIPLINÉE — le cœur d'Autowin OS.
 *
 * Une tâche traverse le pipeline réel : un sous-agent (rôle `subagent`) l'exécute,
 * un juge (rôle `judge`, potentiellement un AUTRE modèle → décorrélation) évalue le
 * résultat, le gate déterministe tranche la clôture, et CHAQUE tour alimente le coût
 * réel + le ledger de confiance des juges. Rien de simulé : ce sont de vrais appels
 * provider, de vrais tokens, un vrai verdict.
 */
export interface OrchestrationStep {
  step: 'exec' | 'judge' | 'gate'
  provider?: string
  role?: string
  text?: string
  tokens?: number
  costUsd?: number
  detail?: string
  prompt?: PromptEnvelope
  usage?: Usage
  status?: 'completed' | 'failed'
  error?: string
  durationMs?: number
}

export interface OrchestrationResult {
  task: string
  result: string
  valid: boolean
  gateBlocked: boolean
  gateReasons: string[]
  costUsd: number
  /** Id de la décision d'autorité ouverte si le gate a bloqué (sinon undefined). */
  pendingDecisionId?: string
  trace: OrchestrationStep[]
}

export interface OrchestratorDeps {
  registry: ProviderRegistry
  roles: RoleModelConfig
  cost: CostAggregator
  trust: TrustLedger
  authority: AuthoritySas
}

export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  /** Exécute une tâche à travers le pipeline discipliné complet (appels réels). */
  async run(task: string, onStep?: (s: OrchestrationStep) => void): Promise<OrchestrationResult> {
    const { registry, roles, cost, trust, authority } = this.deps
    const trace: OrchestrationStep[] = []
    const push = (s: OrchestrationStep): void => {
      trace.push(s)
      onStep?.(s)
    }

    // 1. Un sous-agent EXÉCUTE la tâche (appel réel, kit injecté par le registry).
    const subBinding = roles.getBinding('subagent')
    const subProvider = subBinding.provider
    const execMessages = [{ role: 'user' as const, content: task }]
    let execPrompt = registry.describePrompt(subProvider, execMessages, {
      model: subBinding.model,
      reasoningEffort: subBinding.reasoningEffort
    }, subBinding.model)
    const subOptions: SendOptions = {
      system: capabilityInstruction(subBinding.capabilityProfileId),
      model: subBinding.model,
      reasoningEffort: subBinding.reasoningEffort,
      observePrompt: (observed) => { execPrompt = observed }
    }
    const execStartedAt = performance.now()
    let exec
    try {
      exec = await registry.send(subProvider, execMessages, subOptions)
    } catch (error) {
      push({
        step: 'exec', provider: subProvider, role: 'subagent', text: '', prompt: execPrompt,
        status: 'failed', error: error instanceof Error ? error.message : String(error),
        durationMs: performance.now() - execStartedAt
      })
      throw error
    }
    if (exec.usage) {
      cost.add({
        provider: subProvider,
        role: 'subagent',
        inputTokens: exec.usage.inputTokens,
        outputTokens: exec.usage.outputTokens,
        cacheReadTokens: exec.usage.cacheReadTokens,
        costUsd: exec.usage.costUsd
      })
    }
    push({
      step: 'exec',
      provider: subProvider,
      role: 'subagent',
      text: exec.text,
      tokens: exec.usage ? exec.usage.inputTokens + exec.usage.outputTokens : undefined,
      costUsd: exec.usage?.costUsd,
      usage: exec.usage,
      prompt: execPrompt,
      status: 'completed',
      durationMs: performance.now() - execStartedAt
    })

    // 2. Un JUGE (autre rôle → potentiellement autre modèle) évalue le résultat.
    const judgeBinding = roles.getBinding('judge')
    const judgeProvider = judgeBinding.provider
    const judgePrompt =
      `Tu es un juge. Évalue si cette réponse répond correctement à la tâche.\n` +
      `TÂCHE: ${task}\nRÉPONSE: ${exec.text}\n` +
      `Réponds STRICTEMENT par "VALIDE" ou "DEFAUT: <raison courte>".` + capabilityInstruction(judgeBinding.capabilityProfileId)
    const judgeMessages = [{ role: 'user' as const, content: judgePrompt }]
    let judgeEnvelope = registry.describePrompt(judgeProvider, judgeMessages, {
      model: judgeBinding.model,
      reasoningEffort: judgeBinding.reasoningEffort
    }, judgeBinding.model)
    const judgeOptions: SendOptions = {
      model: judgeBinding.model,
      reasoningEffort: judgeBinding.reasoningEffort,
      observePrompt: (observed) => { judgeEnvelope = observed }
    }
    const judgeStartedAt = performance.now()
    let verdict
    try {
      verdict = await registry.send(judgeProvider, judgeMessages, judgeOptions)
    } catch (error) {
      push({
        step: 'judge', provider: judgeProvider, role: 'judge', text: '', prompt: judgeEnvelope,
        status: 'failed', error: error instanceof Error ? error.message : String(error),
        durationMs: performance.now() - judgeStartedAt
      })
      throw error
    }
    if (verdict.usage) {
      cost.add({
        provider: judgeProvider,
        role: 'judge',
        inputTokens: verdict.usage.inputTokens,
        outputTokens: verdict.usage.outputTokens,
        cacheReadTokens: verdict.usage.cacheReadTokens,
        costUsd: verdict.usage.costUsd
      })
    }
    const valid = /^\s*valide/i.test(verdict.text)
    trust.record({ judgeModel: judgeProvider, verdict: valid ? 'green' : 'red' })
    push({
      step: 'judge',
      provider: judgeProvider,
      role: 'judge',
      text: verdict.text.trim(),
      tokens: verdict.usage ? verdict.usage.inputTokens + verdict.usage.outputTokens : undefined,
      costUsd: verdict.usage?.costUsd,
      usage: verdict.usage,
      detail: valid ? 'validé' : 'défaut',
      prompt: judgeEnvelope,
      status: 'completed',
      durationMs: performance.now() - judgeStartedAt
    })

    // 3. Le GATE déterministe tranche la clôture (model-agnostic).
    const gate = evaluateClosure({
      status: valid ? 'green' : 'red',
      dod: [{ checked: valid, hasContent: true }]
    })
    push({
      step: 'gate',
      detail: gate.blocked ? `BLOQUÉ: ${gate.reasons.join('; ')}` : 'clôture autorisée'
    })

    // 4. Gate BLOQUÉ → la décision remonte à l'humain via le sas d'autorité
    // (rejouer/abandonner) ; défaut sûr = abandonner si personne ne répond (AFK).
    let pendingDecisionId: string | undefined
    if (gate.blocked) {
      pendingDecisionId = authority.propose({
        question: `Tâche "${task}" : le juge a rejeté le résultat. Rejouer ou abandonner ?`,
        options: ['rejouer', 'abandonner'],
        safeDefault: 'abandonner',
        ttlMs: 10 * 60 * 1000
      })
    }

    return {
      task,
      result: exec.text,
      valid,
      gateBlocked: gate.blocked,
      gateReasons: gate.reasons,
      pendingDecisionId,
      costUsd: cost.totalUsd(),
      trace
    }
  }
}
