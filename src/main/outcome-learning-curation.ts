import type { OutcomeCurationV1 } from '../shared/run-learning'
import type { InboxMove } from './brain-inbox'

export interface CurationCompensation {
  moved: InboxMove
  action: 'retract' | 'restore'
  knowledgeId: string
  targetId: string
  rollbackId?: string
  previousEventId: string
}

/** Compense uniquement la mutation introduite par l'événement ciblé. */
export function compensateOutcomeCuration(
  curation: OutcomeCurationV1,
  operations: {
    restore: (id: string) => InboxMove
    retract: (id: string) => InboxMove
  }
): CurationCompensation {
  if (curation.action === 'retract') {
    const moved = operations.restore(curation.targetId)
    return {
      moved,
      action: 'restore',
      knowledgeId: curation.knowledgeId,
      targetId: moved.to,
      rollbackId: curation.targetId,
      previousEventId: curation.eventId
    }
  }
  if (curation.action === 'restore') {
    const moved = operations.retract(curation.targetId)
    return {
      moved,
      action: 'retract',
      knowledgeId: curation.knowledgeId,
      targetId: moved.to,
      previousEventId: curation.eventId
    }
  }
  if (!curation.rollbackId) throw new Error('supersession sans point de rollback')
  const moved = operations.restore(curation.rollbackId)
  return {
    moved,
    action: 'restore',
    knowledgeId: curation.knowledgeId,
    targetId: moved.to,
    rollbackId: curation.rollbackId,
    previousEventId: curation.eventId
  }
}
