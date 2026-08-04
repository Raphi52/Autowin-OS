import { randomUUID } from 'node:crypto'
import type { ExecutionUsageSnapshot } from '../execution-supervisor'
import { sameExecutionUsage } from '../execution-supervisor'
import { appendConvActivity } from './conv-activity'
import type { TraceStore } from './trace-store'

interface PersistChatUsageSettlementInput {
  conversationId: string
  turnId: string
  usage: ExecutionUsageSnapshot
  previous?: ExecutionUsageSnapshot
  provider: string
  model?: string
  reasoningEffort?: string
  label: string
  durationMs?: number
  text?: string
  activityRoot?: string
  traceStore: TraceStore
}

function counterDelta(current: number, previous?: number): number {
  return Math.max(0, current - (previous ?? 0))
}

/**
 * Projette un snapshot supervise dans les deux journaux visibles par Workflows. Les compteurs du
 * superviseur sont cumulatifs ; l'activite et les metriques de trace recoivent donc uniquement le
 * delta depuis la derniere publication. Le snapshot complet reste dans le payload causal.
 */
export function persistChatUsageSettlement(
  input: PersistChatUsageSettlementInput
): ExecutionUsageSnapshot {
  const current = { ...input.usage }
  if (sameExecutionUsage(input.previous, current)) return current

  const inputTokens = counterDelta(current.inputTokens, input.previous?.inputTokens)
  const outputTokens = counterDelta(current.outputTokens, input.previous?.outputTokens)
  const cacheReadTokens = counterDelta(current.cacheReadTokens, input.previous?.cacheReadTokens)
  const costUsd =
    current.knownCostUsd === null
      ? undefined
      : counterDelta(current.knownCostUsd, input.previous?.knownCostUsd ?? undefined)
  const costLabel =
    current.knownCostUsd === null
      ? 'cout non expose'
      : `${current.knownCostUsd.toFixed(4)} $ connu${current.unpricedCalls > 0 ? ` + ${current.unpricedCalls} appel(s) non chiffre(s)` : ''}`
  const usageSummary = `Usage supervise: ${current.totalTokens} tokens, ${costLabel}, ${current.activeCalls} appel(s) actif(s).`
  const settlementText = input.text ? `${input.text}\n\n${usageSummary}` : usageSummary

  appendConvActivity(
    input.conversationId,
    {
      kind: 'chat-usage',
      label: input.label,
      provider: input.provider,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      costUsd,
      durationMs: input.durationMs,
      text: settlementText
    },
    input.activityRoot
  )

  input.traceStore.append({
    schema: 'autowin.trace/v1',
    id: `${input.turnId}:chat-usage:${randomUUID()}`,
    conversationId: input.conversationId,
    turnId: input.turnId,
    timestamp: new Date().toISOString(),
    sequence: input.traceStore.nextSequence(input.conversationId),
    type: 'boundary',
    status: current.activeCalls > 0 ? 'running' : current.failedCalls > 0 ? 'failed' : 'completed',
    actor: {
      id: 'execution-supervisor',
      kind: 'system',
      label: 'Execution supervisor'
    },
    recipient: {
      id: input.conversationId,
      kind: 'system',
      label: 'Conversation observability'
    },
    channel: 'internal',
    payloads: [
      {
        kind: 'provider-options',
        content: JSON.stringify(current)
      }
    ],
    observation: {
      boundary: 'Execution supervisor -> conversation activity and causal trace',
      fidelity: 'derived',
      limitation:
        current.knownCostUsd === null
          ? 'Le provider ne transporte pas un cout USD exploitable.'
          : undefined
    },
    provider: {
      id: input.provider,
      model: input.model,
      reasoningEffort: input.reasoningEffort
    },
    metrics: {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      ...(costUsd === undefined ? {} : { costUsd }),
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs })
    }
  })

  return current
}
