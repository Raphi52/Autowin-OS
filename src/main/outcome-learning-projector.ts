import { createHash } from 'node:crypto'
import type {
  LearningDecisionV1,
  LearningProposalV1,
  LearningProjectionV1,
  OutcomeCurationV1,
  OutcomeLearningEventV1,
  OutcomeObservedV1
} from '../shared/run-learning'
import { decideOutcomeLearning } from './outcome-learning-policy'

export interface OutcomeLearningProjection {
  decisions: LearningDecisionV1[]
  projections: LearningProjectionV1[]
  curations: OutcomeCurationV1[]
}

export function projectOutcomeLearning(
  events: readonly OutcomeLearningEventV1[]
): OutcomeLearningProjection {
  const proposals = events
    .filter(
      (event): event is Extract<OutcomeLearningEventV1, { kind: 'proposal' }> =>
        event.kind === 'proposal'
    )
    .map(({ value }) => value)
    .sort((left, right) =>
      [left.conversationId, left.turnId, left.createdAt, left.eventId]
        .join('\0')
        .localeCompare(
          [right.conversationId, right.turnId, right.createdAt, right.eventId].join('\0')
        )
    )
  const outcomes = events
    .filter(
      (event): event is Extract<OutcomeLearningEventV1, { kind: 'outcome' }> =>
        event.kind === 'outcome'
    )
    .map(({ value }) => value)
  const recorded = new Map(
    events
      .filter(
        (event): event is Extract<OutcomeLearningEventV1, { kind: 'decision' }> =>
          event.kind === 'decision'
      )
      .map(({ value }) => [value.proposalId, value] as const)
  )
  const decisions: LearningDecisionV1[] = []
  const claimedTurns = new Set<string>()

  for (const proposal of proposals) {
    const observation = latestOutcomeFor(proposal, outcomes)
    if (!observation) continue
    const turnKey = `${proposal.conversationId}\0${proposal.turnId}`
    let next = recorded.get(proposal.eventId)
    if (!next) {
      next = claimedTurns.has(turnKey)
        ? suppressedDuplicateDecision(proposal, observation)
        : decideOutcomeLearning(proposal, observation)
    }
    claimedTurns.add(turnKey)
    decisions.push(next)
  }

  const projections = decisions.flatMap((next): LearningProjectionV1[] => {
    if (next.route === 'suppress') return []
    const proposal = proposals.find(({ eventId }) => eventId === next.proposalId)
    if (!proposal) return []
    return [
      {
        schema: 'autowin.learning/v1',
        decisionId: next.eventId,
        proposalId: next.proposalId,
        observationId: next.observationId,
        identity: next.identity,
        route: next.route,
        candidateId: proposal.candidateId,
        title: proposal.title,
        scope: proposal.scope
      }
    ]
  })
  const curationGroups = new Map<string, OutcomeCurationV1[]>()
  for (const { value } of events.filter(
    (item): item is Extract<OutcomeLearningEventV1, { kind: 'curation' }> =>
      item.kind === 'curation'
  )) {
    curationGroups.set(value.knowledgeId, [...(curationGroups.get(value.knowledgeId) ?? []), value])
  }
  const curations = [...curationGroups.entries()]
    .map(([, group]) => {
      const compensated = new Set(
        group.flatMap((item) => (item.previousEventId ? [item.previousEventId] : []))
      )
      const leaves = group.filter((item) => !compensated.has(item.eventId))
      return (leaves.length > 0 ? leaves : group)
        .sort((left, right) =>
          [left.createdAt, left.eventId]
            .join('\0')
            .localeCompare([right.createdAt, right.eventId].join('\0'))
        )
        .at(-1) as OutcomeCurationV1
    })
    .sort((left, right) => left.knowledgeId.localeCompare(right.knowledgeId))
  return { decisions, projections, curations }
}

function latestOutcomeFor(
  proposal: LearningProposalV1,
  outcomes: readonly OutcomeObservedV1[]
): OutcomeObservedV1 | undefined {
  return outcomes
    .filter(
      (outcome) =>
        outcome.conversationId === proposal.conversationId &&
        outcome.turnId === proposal.turnId &&
        (!proposal.runId || outcome.runId === proposal.runId)
    )
    .sort((left, right) =>
      [left.createdAt, left.eventId]
        .join('\0')
        .localeCompare([right.createdAt, right.eventId].join('\0'))
    )
    .at(-1)
}

function suppressedDuplicateDecision(
  proposal: LearningProposalV1,
  observation: OutcomeObservedV1
): LearningDecisionV1 {
  const identity = createHash('sha256')
    .update(`${proposal.conversationId}\0${proposal.turnId}\0${proposal.eventId}\0duplicate`)
    .digest('hex')
  return {
    schema: 'autowin.learning/v1',
    eventId: `decision:${identity}`,
    proposalId: proposal.eventId,
    observationId: observation.eventId,
    route: 'suppress',
    reasons: ['one-lesson-per-turn'],
    identity
  }
}
