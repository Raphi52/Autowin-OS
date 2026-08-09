import type { ScheduledTask, WatchdogMutationClaimsSink } from './types'

interface OrchestrationAdapterDependencies {
  exec(
    task: string,
    conversationId: string,
    causalWatchPaths: readonly string[],
    onLateMutationClaims?: WatchdogMutationClaimsSink
  ): Promise<unknown>
  readMutatedPaths(conversationId: string, turnId: string): readonly string[]
  readMutatedLineFingerprints?(
    conversationId: string,
    turnId: string
  ): Record<string, readonly string[]>
  readMutatedPathGenerationMarkers?(conversationId: string, turnId: string): Record<string, string>
}

export interface WatchdogOrchestrationDispatch {
  ok: boolean
  cancelled?: boolean
  turnId?: string
  text?: string
  error?: string
  mutatedPaths?: readonly string[]
  mutatedLineFingerprints?: Record<string, readonly string[]>
  mutatedPathGenerationMarkers?: Record<string, string>
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

/**
 * Adapte le vrai contrat de `orchestrate` au scheduler. Un gate rouge reste rouge et les preuves
 * restent rattachées à la tâche courante, jamais à une autre qui partagerait la conversation.
 */
export async function runWatchdogOrchestration(
  dependencies: OrchestrationAdapterDependencies,
  conversationId: string,
  prompt: string,
  task: ScheduledTask,
  onLateMutationClaims?: WatchdogMutationClaimsSink
): Promise<WatchdogOrchestrationDispatch> {
  try {
    const source = task.watchdog?.source
    const causalWatchPaths = source?.kind === 'file-match' ? [source.path] : []
    const envelope = record(
      onLateMutationClaims
        ? await dependencies.exec(
            prompt,
            conversationId,
            causalWatchPaths,
            onLateMutationClaims
          )
        : await dependencies.exec(prompt, conversationId, causalWatchPaths)
    )
    if (!envelope) return { ok: false, error: 'Réponse d’orchestration illisible.' }
    if (envelope.ok !== true) {
      return { ok: false, error: text(envelope.error) ?? 'La commande orchestration a échoué.' }
    }
    const raw = record(envelope.data)
    if (!raw) return { ok: false, error: 'Données d’orchestration illisibles.' }

    const turnId = text(raw.turnId)
    const mutatedPaths = turnId ? dependencies.readMutatedPaths(conversationId, turnId) : []
    const mutatedLineFingerprints = turnId
      ? (dependencies.readMutatedLineFingerprints?.(conversationId, turnId) ?? {})
      : {}
    const mutatedPathGenerationMarkers = turnId
      ? (dependencies.readMutatedPathGenerationMarkers?.(conversationId, turnId) ?? {})
      : {}
    const resultText = text(raw.result)
    const succeeded = raw.status === 'succeeded' && raw.gateBlocked !== true
    if (succeeded) {
      return {
        ok: true,
        ...(resultText ? { text: resultText } : {}),
        ...(turnId ? { turnId } : {}),
        mutatedPaths,
        mutatedLineFingerprints,
        mutatedPathGenerationMarkers
      }
    }

    const reasons = Array.isArray(raw.gateReasons)
      ? raw.gateReasons.filter((reason): reason is string => typeof reason === 'string')
      : []
    return {
      ok: false,
      ...(resultText ? { text: resultText } : {}),
      ...(turnId ? { turnId } : {}),
      mutatedPaths,
      mutatedLineFingerprints,
      mutatedPathGenerationMarkers,
      error:
        reasons.length > 0
          ? `Gate d’orchestration bloqué : ${reasons.join('; ')}`
          : `Orchestration en échec (${text(raw.status) ?? 'statut inconnu'}).`
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
