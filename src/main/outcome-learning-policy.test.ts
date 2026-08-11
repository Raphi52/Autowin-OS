import { describe, expect, it } from 'vitest'
import {
  OUTCOME_LEARNING_SCHEMA,
  type LearningProposalV1,
  type OutcomeObservedV1
} from '../shared/run-learning'
import { decideOutcomeLearning } from './outcome-learning-policy'
import {
  createIndependentLearningAttestation,
  learningProposalAttestation
} from './outcome-learning-proposal'

const proposal = (patch: Partial<LearningProposalV1> = {}): LearningProposalV1 => ({
  schema: OUTCOME_LEARNING_SCHEMA,
  eventId: 'proposal-1',
  conversationId: 'conv-1',
  turnId: 'turn-1',
  runId: 'run-1',
  createdAt: '2026-08-11T10:00:00.000Z',
  outcome: 'success',
  title: 'Le test discriminant évite la régression',
  body: 'Rejouer le même signal avant et après la mutation établit la causalité locale.',
  type: 'lesson',
  scope: 'autowin-os',
  source: 'session:turn-1',
  tags: ['outcome-learning'],
  confidence: 'high',
  candidateId: 'inbox/lesson.md',
  stored: true,
  truncated: false,
  ...patch
})

const observed = (patch: Partial<OutcomeObservedV1> = {}): OutcomeObservedV1 => ({
  schema: OUTCOME_LEARNING_SCHEMA,
  eventId: 'outcome-1',
  conversationId: 'conv-1',
  turnId: 'turn-1',
  runId: 'run-1',
  workspace: 'C:/Amitel/Autowin OS',
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
      signature: 'test:focused',
      exitCode: 1
    },
    {
      sequence: 1,
      kind: 'mutation',
      ok: true,
      material: true,
      targetSignatures: ['path:x'],
      signature: 'mutation:src/main/x.ts'
    },
    {
      sequence: 2,
      kind: 'verification',
      ok: true,
      oracleStable: true,
      oracleAttestation: 'manifest:test',
      targetSignatures: ['path:x'],
      signature: 'test:focused',
      exitCode: 0
    },
    {
      sequence: 3,
      kind: 'verification',
      ok: true,
      oracleStable: true,
      oracleAttestation: 'manifest:test',
      targetSignatures: ['path:x'],
      signature: 'test:focused',
      exitCode: 0
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

describe('outcome learning policy', () => {
  it('auto-publie uniquement un succès rouge→mutation→vert causal et local', () => {
    expect(decideOutcomeLearning(proposal(), observed()).route).toBe('publish')
  })

  it('refuse une stabilité ou une couverture non attestée par le projet', () => {
    expect(
      decideOutcomeLearning(
        proposal(),
        observed({
          evidence: observed().evidence.map(({ oracleAttestation: _ignored, ...item }) => item)
        })
      ).route
    ).toBe('inbox')
  })

  it('laisse en inbox un succès sans baseline rouge ou dont le signal a changé', () => {
    expect(
      decideOutcomeLearning(proposal(), observed({ evidence: observed().evidence.slice(1) })).route
    ).toBe('inbox')
    expect(
      decideOutcomeLearning(
        proposal(),
        observed({
          evidence: [
            { sequence: 0, kind: 'verification', ok: false, signature: 'test:a' },
            { sequence: 1, kind: 'mutation', ok: true, material: true, signature: 'mutation:x' },
            { sequence: 2, kind: 'verification', ok: true, signature: 'test:b' },
            { sequence: 3, kind: 'verification', ok: true, signature: 'test:b' }
          ]
        })
      ).route
    ).toBe('inbox')
  })

  it('met en escrow une preuve locale demandée comme globale', () => {
    const global = proposal({ scope: 'global' })
    expect(
      decideOutcomeLearning(
        global,
        observed({
          attestedProposalHashes: [learningProposalAttestation(global)],
          independentProposalAttestations: [
            createIndependentLearningAttestation(
              learningProposalAttestation(global),
              'run-1',
              'judge:test'
            )
          ]
        })
      ).route
    ).toBe('escrow')
  })

  it('peut publier un échec seulement s’il est reproduit autour d’une tentative', () => {
    const failure = proposal({ outcome: 'failure' })
    const red = observed({
      status: 'failed',
      valid: false,
      gateBlocked: true,
      attestedProposalHashes: [learningProposalAttestation(failure)],
      independentProposalAttestations: [
        createIndependentLearningAttestation(
          learningProposalAttestation(failure),
          'run-1',
          'judge:test'
        )
      ],
      evidence: [
        {
          sequence: 0,
          kind: 'verification',
          ok: false,
          oracleStable: true,
          oracleAttestation: 'manifest:test',
          targetSignatures: ['path:x'],
          signature: 'test:focused',
          exitCode: 1
        },
        {
          sequence: 1,
          kind: 'mutation',
          ok: true,
          material: true,
          targetSignatures: ['path:x'],
          signature: 'attempt:x'
        },
        {
          sequence: 2,
          kind: 'verification',
          ok: false,
          oracleStable: true,
          oracleAttestation: 'manifest:test',
          targetSignatures: ['path:x'],
          signature: 'test:focused',
          exitCode: 1
        },
        {
          sequence: 3,
          kind: 'verification',
          ok: false,
          oracleStable: true,
          oracleAttestation: 'manifest:test',
          targetSignatures: ['path:x'],
          signature: 'test:focused',
          exitCode: 1
        }
      ]
    })
    expect(decideOutcomeLearning(failure, red).route).toBe('publish')
  })

  it('lie l’attestation du judge au contenu exact de la leçon', () => {
    expect(decideOutcomeLearning(proposal(), observed()).route).toBe('publish')
    expect(
      decideOutcomeLearning(proposal(), observed({ independentProposalAttestations: [] })).route
    ).toBe('inbox')
    expect(decideOutcomeLearning(proposal({ body: 'récit opposé' }), observed()).route).toBe(
      'inbox'
    )
  })

  it('refuse de publier les états incertains, tronqués, réutilisés ou hors tour', () => {
    expect(decideOutcomeLearning(proposal({ unknown: true }), observed()).route).toBe('inbox')
    expect(decideOutcomeLearning(proposal({ truncated: true }), observed()).route).toBe('inbox')
    expect(decideOutcomeLearning(proposal(), observed({ reused: true })).route).toBe('inbox')
    expect(decideOutcomeLearning(proposal(), observed({ turnId: 'turn-other' })).route).toBe(
      'suppress'
    )
    expect(decideOutcomeLearning(proposal(), observed({ runId: 'run-other' })).route).toBe(
      'suppress'
    )
  })

  it.each(['external', 'expected-negative', 'indeterminate'] as const)(
    'garde en inbox un rouge causal classé %s',
    (terminalClass) => {
      expect(
        decideOutcomeLearning(
          proposal({ outcome: 'failure' }),
          observed({
            status: 'failed',
            valid: false,
            gateBlocked: true,
            terminalClass,
            evidence: [
              { sequence: 0, kind: 'verification', ok: false, signature: 'test:x' },
              { sequence: 1, kind: 'mutation', ok: true, material: true, signature: 'attempt:x' },
              { sequence: 2, kind: 'verification', ok: false, signature: 'test:x' },
              { sequence: 3, kind: 'verification', ok: false, signature: 'test:x' }
            ]
          })
        ).route
      ).toBe('inbox')
    }
  )

  it('refuse une mutation sans empreinte et un vert unique potentiellement flaky', () => {
    expect(
      decideOutcomeLearning(
        proposal(),
        observed({
          evidence: [
            { sequence: 0, kind: 'verification', ok: false, signature: 'test:x' },
            { sequence: 1, kind: 'mutation', ok: true, material: false, signature: 'mutation:x' },
            { sequence: 2, kind: 'verification', ok: true, signature: 'test:x' },
            { sequence: 3, kind: 'verification', ok: true, signature: 'test:x' }
          ]
        })
      ).route
    ).toBe('inbox')
    expect(
      decideOutcomeLearning(proposal(), observed({ evidence: observed().evidence.slice(0, 3) }))
        .route
    ).toBe('inbox')
    expect(
      decideOutcomeLearning(
        proposal(),
        observed({
          evidence: observed().evidence.map((item) =>
            item.kind === 'mutation' ? { ...item, targetSignatures: ['path:unrelated'] } : item
          )
        })
      ).route
    ).toBe('inbox')
    expect(
      decideOutcomeLearning(
        proposal(),
        observed({
          evidence: observed().evidence.map((item) =>
            item.kind === 'verification' ? { ...item, oracleStable: false } : item
          )
        })
      ).route
    ).toBe('inbox')
  })
})
