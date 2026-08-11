import { describe, expect, it } from 'vitest'
import {
  OUTCOME_LEARNING_SCHEMA,
  type LearningProposalV1,
  type OutcomeLearningEventV1,
  type OutcomeObservedV1
} from '../shared/run-learning'
import { projectOutcomeLearning } from './outcome-learning-projector'
import {
  createIndependentLearningAttestation,
  learningProposalAttestation
} from './outcome-learning-proposal'

const proposal = (
  eventId = 'proposal-1',
  createdAt = '2026-08-11T10:00:00.000Z'
): LearningProposalV1 => ({
  schema: OUTCOME_LEARNING_SCHEMA,
  eventId,
  conversationId: 'conv-1',
  turnId: 'turn-1',
  runId: 'run-1',
  createdAt,
  outcome: 'success',
  title: `Leçon ${eventId}`,
  body: 'Corps',
  type: 'lesson',
  scope: 'autowin-os',
  source: 'session:turn-1',
  tags: [],
  confidence: 'high',
  candidateId: `inbox/${eventId}.md`,
  stored: true,
  truncated: false
})

const outcome = (patch: Partial<OutcomeObservedV1> = {}): OutcomeObservedV1 => ({
  schema: OUTCOME_LEARNING_SCHEMA,
  eventId: 'outcome-1',
  conversationId: 'conv-1',
  turnId: 'turn-1',
  runId: 'run-1',
  workspace: 'C:/repo',
  createdAt: '2026-08-11T10:01:00.000Z',
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  reused: false,
  evidence: [
    {
      sequence: 0,
      kind: 'verification',
      ok: false,
      oracleStable: true,
      oracleAttestation: 'manifest:test',
      targetSignatures: ['path:x'],
      signature: 'test:x'
    },
    {
      sequence: 1,
      kind: 'mutation',
      ok: true,
      material: true,
      targetSignatures: ['path:x'],
      signature: 'mutation:x'
    },
    {
      sequence: 2,
      kind: 'verification',
      ok: true,
      oracleStable: true,
      oracleAttestation: 'manifest:test',
      targetSignatures: ['path:x'],
      signature: 'test:x'
    },
    {
      sequence: 3,
      kind: 'verification',
      ok: true,
      oracleStable: true,
      oracleAttestation: 'manifest:test',
      targetSignatures: ['path:x'],
      signature: 'test:x'
    }
  ],
  attestedProposalHashes: [learningProposalAttestation(proposal())],
  independentProposalAttestations: [
    createIndependentLearningAttestation(
      learningProposalAttestation(proposal()),
      'run-1',
      'judge:test'
    )
  ],
  ...patch
})

const events = (...values: OutcomeLearningEventV1[]): OutcomeLearningEventV1[] => values

describe('outcome learning projector', () => {
  it('converge vers la même projection quel que soit l’ordre des événements', () => {
    const proposalEvent = { kind: 'proposal' as const, value: proposal() }
    const outcomeEvent = { kind: 'outcome' as const, value: outcome() }
    const forward = projectOutcomeLearning(events(proposalEvent, outcomeEvent))
    const reverse = projectOutcomeLearning(events(outcomeEvent, proposalEvent))
    expect(JSON.stringify(reverse)).toBe(JSON.stringify(forward))
    expect(forward.projections).toMatchObject([
      { route: 'publish', candidateId: 'inbox/proposal-1.md' }
    ])
  })

  it('ne conserve qu’une leçon par tour et supprime les propositions suivantes', () => {
    const first = proposal('first', '2026-08-11T10:00:00.000Z')
    const projection = projectOutcomeLearning(
      events(
        { kind: 'proposal', value: first },
        { kind: 'proposal', value: proposal('second', '2026-08-11T10:00:01.000Z') },
        {
          kind: 'outcome',
          value: outcome({
            attestedProposalHashes: [learningProposalAttestation(first)],
            independentProposalAttestations: [
              createIndependentLearningAttestation(
                learningProposalAttestation(first),
                'run-1',
                'judge:test'
              )
            ]
          })
        }
      )
    )
    expect(projection.decisions.map(({ route }) => route).sort()).toEqual(['publish', 'suppress'])
    expect(projection.projections).toHaveLength(1)
    expect(projection.projections[0].proposalId).toBe('first')
  })

  it('ne projette rien avant une issue terminale correspondante', () => {
    expect(projectOutcomeLearning(events({ kind: 'proposal', value: proposal() }))).toEqual({
      decisions: [],
      projections: [],
      curations: []
    })
  })

  it('rejoue une décision persistée sans la dupliquer', () => {
    const first = projectOutcomeLearning(
      events({ kind: 'proposal', value: proposal() }, { kind: 'outcome', value: outcome() })
    )
    const replay = projectOutcomeLearning(
      events(
        { kind: 'proposal', value: proposal() },
        { kind: 'outcome', value: outcome() },
        ...first.decisions.map((value) => ({ kind: 'decision' as const, value }))
      )
    )
    expect(replay).toEqual(first)
  })

  it('ne fusionne pas deux récidives distinctes dont le texte est identique', () => {
    const firstProposal = proposal('recurrence-1')
    const secondProposal = {
      ...proposal('recurrence-2'),
      turnId: 'turn-2',
      runId: 'run-2',
      source: 'session:turn-2',
      title: firstProposal.title,
      body: firstProposal.body
    }
    const secondOutcome = {
      ...outcome(),
      eventId: 'outcome-2',
      turnId: 'turn-2',
      runId: 'run-2',
      attestedProposalHashes: [learningProposalAttestation(secondProposal)],
      independentProposalAttestations: [
        createIndependentLearningAttestation(
          learningProposalAttestation(secondProposal),
          'run-2',
          'judge:test'
        )
      ]
    }
    const projection = projectOutcomeLearning(
      events(
        { kind: 'proposal', value: firstProposal },
        { kind: 'outcome', value: outcome() },
        { kind: 'proposal', value: secondProposal },
        { kind: 'outcome', value: secondOutcome }
      )
    )
    expect(projection.projections).toHaveLength(2)
    expect(new Set(projection.projections.map(({ identity }) => identity)).size).toBe(2)
  })

  it('reconstruit la dernière curation indépendamment de l’ordre de lecture', () => {
    const retract = {
      kind: 'curation' as const,
      value: {
        schema: OUTCOME_LEARNING_SCHEMA,
        eventId: 'curation-a',
        createdAt: '2026-08-11T10:00:00.000Z',
        action: 'retract' as const,
        knowledgeId: 'knowledge/a',
        targetId: '.trash/a',
        actor: 'user' as const
      }
    }
    const restore = {
      kind: 'curation' as const,
      value: {
        ...retract.value,
        eventId: 'curation-b',
        createdAt: '2026-08-11T10:00:00.000Z',
        action: 'restore' as const,
        targetId: 'knowledge/a-2',
        rollbackId: '.trash/a',
        previousEventId: 'curation-a'
      }
    }
    expect(projectOutcomeLearning([restore, retract]).curations).toEqual([restore.value])
  })
})
