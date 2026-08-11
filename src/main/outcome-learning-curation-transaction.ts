import type { OutcomeCurationIntentV1 } from '../shared/run-learning'
import type { InboxMove } from './brain-inbox'
import type { OutcomeLearningSupervisor } from './outcome-learning-supervisor'

export interface CurationMutationResult {
  moved: InboxMove
  knowledgeId: string
  targetId: string
  rollbackId?: string
  previousEventId?: string
}

export interface CurationTransactionRequest {
  action: OutcomeCurationIntentV1['action']
  knowledgeId: string
  requestedTargetId?: string
}

const curationTransactionTails = new WeakMap<OutcomeLearningSupervisor, Promise<void>>()

async function serializeCurationTransaction<T>(
  supervisor: OutcomeLearningSupervisor,
  operation: () => Promise<T>
): Promise<T> {
  const previous = curationTransactionTails.get(supervisor) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.catch(() => undefined).then(() => current)
  curationTransactionTails.set(supervisor, tail)
  await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release()
    void tail.then(() => {
      if (curationTransactionTails.get(supervisor) === tail) {
        curationTransactionTails.delete(supervisor)
      }
    })
  }
}

async function executeCurationTransactionUnserialized(
  supervisor: OutcomeLearningSupervisor,
  request: CurationTransactionRequest,
  operations: {
    mutate: () => CurationMutationResult
    compensate: (result: CurationMutationResult) => InboxMove
    invalidate: () => Promise<void>
  }
): Promise<InboxMove> {
  const intent = supervisor.recordCurationIntent(
    request.action,
    request.knowledgeId,
    request.requestedTargetId
  )
  let result: CurationMutationResult | undefined
  try {
    result = operations.mutate()
    await operations.invalidate()
    const recorded = supervisor.recordCuration(
      request.action,
      result.knowledgeId,
      result.targetId,
      result.rollbackId,
      result.previousEventId,
      intent.value.eventId
    )
    if (!recorded) {
      supervisor.recordCurationResolution(
        intent.value.eventId,
        'deduplicated',
        'mutation-replayed; curation-already-recorded'
      )
    }
    return result.moved
  } catch (error) {
    if (!result) {
      supervisor.recordCurationResolution(
        intent.value.eventId,
        'aborted',
        error instanceof Error ? error.message : String(error)
      )
      throw error
    }
    try {
      operations.compensate(result)
      await operations.invalidate()
      supervisor.recordCurationResolution(intent.value.eventId, 'compensated', 'rollback-applied')
    } catch (compensationError) {
      // L'intention reste pending : le démarrage la rejouera idempotemment au lieu de perdre l'undo.
      supervisor.recordCurationResolution(
        intent.value.eventId,
        'failed',
        compensationError instanceof Error ? compensationError.message : String(compensationError)
      )
    }
    throw error
  }
}

export function executeCurationTransaction(
  supervisor: OutcomeLearningSupervisor,
  request: CurationTransactionRequest,
  operations: {
    mutate: () => CurationMutationResult
    compensate: (result: CurationMutationResult) => InboxMove
    invalidate: () => Promise<void>
  }
): Promise<InboxMove> {
  return serializeCurationTransaction(supervisor, () =>
    executeCurationTransactionUnserialized(supervisor, request, operations)
  )
}

export async function reconcileCurationIntents(
  supervisor: OutcomeLearningSupervisor,
  replay: (intent: OutcomeCurationIntentV1) => CurationMutationResult,
  invalidate: () => Promise<void>
): Promise<number> {
  let completed = 0
  for (const pending of supervisor.pendingCurationIntents()) {
    try {
      const result = replay(pending.value)
      await invalidate()
      const recorded = supervisor.recordCuration(
        pending.value.action,
        result.knowledgeId,
        result.targetId,
        result.rollbackId,
        result.previousEventId,
        pending.value.eventId
      )
      if (!recorded) {
        supervisor.recordCurationResolution(
          pending.value.eventId,
          'deduplicated',
          'startup-replay; curation-already-recorded'
        )
      }
      if (
        !supervisor
          .pendingCurationIntents()
          .some((event) => event.value.eventId === pending.value.eventId)
      ) {
        completed += 1
      }
    } catch {
      // Best-effort au démarrage : conserver l'intention permet un prochain replay, sans faux succès.
    }
  }
  return completed
}
