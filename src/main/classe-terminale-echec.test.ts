import { describe, expect, it } from 'vitest'
import {
  OUTCOME_LEARNING_SCHEMA,
  type LearningProposalV1,
  type OutcomeObservedV1
} from '../shared/run-learning'
import { classeTerminaleDEchec } from './classe-terminale-echec'
import { decideOutcomeLearning } from './outcome-learning-policy'
import {
  createIndependentLearningAttestation,
  learningProposalAttestation
} from './outcome-learning-proposal'

/** Le message RÉELLEMENT écrit dans RUN.md par le run conv-914 du 2026-10-13. */
const MUR_DU_13_10 =
  "Phase clean — le rôle subagent est bindé sur claude (claude-opus-5-5) : Claude a interrompu l'appel : You've hit your session limit · resets 1pm (Europe/Paris)"
/** Et celui du run conv-916, passé par l'agrégat d'un fan-out. */
const MUR_FAN_OUT =
  "Fan-out build (rôle subagent) : aucun modèle n'a produit de sortie · • claude (claude-opus-5-5) : Claude a interrompu l'appel : You've hit your session limit · resets 1pm (Europe/Paris)"

describe('classeTerminaleDEchec', () => {
  it('classe external le mur de quota, y compris agrégé par un fan-out', () => {
    expect(classeTerminaleDEchec(new Error(MUR_DU_13_10), false)).toBe('external')
    expect(classeTerminaleDEchec(new Error(MUR_FAN_OUT), false)).toBe('external')
  })

  it('classe external la surcharge serveur et la session expirée', () => {
    expect(classeTerminaleDEchec(new Error('API Error: 529 Overloaded'), false)).toBe('external')
    expect(
      classeTerminaleDEchec(
        new Error(
          '401 OAuth access token has expired. Re-authenticate to continue' /* conv-1086 */
        ),
        false
      )
    ).toBe('external')
  })

  it('garde external pour une annulation, quel que soit le message', () => {
    expect(classeTerminaleDEchec(new Error('Gate bloqué : test rouge'), true)).toBe('external')
  })

  it('laisse defect un vrai échec du travail, et un rate-limit passager n’est pas un quota', () => {
    expect(classeTerminaleDEchec(new Error('Gate bloqué : 3 tests rouges'), false)).toBe('defect')
    expect(classeTerminaleDEchec('TypeError: x is undefined', false)).toBe('defect')
    expect(classeTerminaleDEchec(new Error(''), false)).toBe('defect')
  })

  it('un code HTTP ou un mot NU dans un vrai défaut ne le fait pas passer pour une panne', () => {
    // Revue du 2026-10-14 : les détecteurs de rejeu prennent ces messages pour des pannes.
    for (const defaut of [
      'Gate bloqué : le test de conv-1401 reste rouge',
      'Phase build — échec dans D:\\AutoWinOS\\runs\\conv-503\\RUN.md : assertion',
      'Phase build — 2401 ms puis TypeError',
      'Le juge refuse : la surcharge de style du bouton casse le thème',
      'Gate bloqué : le test « refuse un appel non authentifié » reste rouge'
    ]) {
      expect(classeTerminaleDEchec(new Error(defaut), false)).toBe('defect')
    }
    expect(
      classeTerminaleDEchec(new Error('codex non authentifié — lance npm run codex:login'), false)
    ).toBe('external')
    expect(
      classeTerminaleDEchec(
        new Error(
          'API Error: 500 Internal server error. This is a server-side issue, usually temporary'
        ),
        false
      )
    ).toBe('external')
  })

  it('un échec « session limit » part en revue humaine (inbox, terminal-external), jamais publié', () => {
    const lecon: LearningProposalV1 = {
      schema: OUTCOME_LEARNING_SCHEMA,
      eventId: 'proposal-1',
      conversationId: 'conv-914',
      turnId: 'turn-1',
      runId: 'run-1',
      createdAt: '2026-10-13T09:17:00.000Z',
      outcome: 'failure',
      title: 'La phase clean échoue',
      body: 'Le run tombe en phase clean.',
      type: 'lesson',
      scope: 'autowin-os',
      source: 'session:turn-1',
      tags: ['outcome-learning'],
      confidence: 'high',
      candidateId: 'inbox/lesson.md',
      stored: true,
      truncated: false
    }
    const rouge = (verification: number): OutcomeObservedV1['evidence'][number] => ({
      sequence: verification,
      kind: 'verification',
      ok: false,
      oracleStable: true,
      oracleAttestation: 'manifest:test',
      targetSignatures: ['path:x'],
      signature: 'test:focused',
      exitCode: 1
    })
    const observation = (terminalClass: 'external' | 'defect'): OutcomeObservedV1 => ({
      schema: OUTCOME_LEARNING_SCHEMA,
      eventId: 'outcome-1',
      conversationId: 'conv-914',
      turnId: 'turn-1',
      runId: 'run-1',
      workspace: 'D:/AutoWinOS',
      createdAt: '2026-10-13T09:17:01.000Z',
      status: 'failed',
      valid: false,
      gateBlocked: true,
      reused: false,
      terminalClass,
      attestedProposalHashes: [learningProposalAttestation(lecon)],
      independentProposalAttestations: [
        createIndependentLearningAttestation(
          learningProposalAttestation(lecon),
          'run-1',
          'judge:test'
        )
      ],
      evidence: [
        rouge(0),
        {
          sequence: 1,
          kind: 'mutation',
          ok: true,
          material: true,
          targetSignatures: ['path:x'],
          signature: 'attempt:x'
        },
        rouge(2),
        rouge(3)
      ]
    })
    // Témoin : la même preuve classée `defect` (l'ancien ternaire) était PUBLIABLE.
    expect(decideOutcomeLearning(lecon, observation('defect')).route).toBe('publish')
    const classe = classeTerminaleDEchec(new Error(MUR_DU_13_10), false)
    const decision = decideOutcomeLearning(lecon, observation(classe))
    expect(decision.route).toBe('inbox')
    expect(decision.reasons).toContain('terminal-external')
  })
})
