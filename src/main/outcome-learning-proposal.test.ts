import { describe, expect, it } from 'vitest'
import {
  createIndependentLearningAttestation,
  learningProposalAttestation,
  OUTCOME_LESSON_MARKER,
  parseAttestedLearningProposal,
  verifyIndependentLearningAttestation
} from './outcome-learning-proposal'

const proposal = {
  outcome: 'success' as const,
  title: 'Leçon causale',
  body: 'Le test ciblé passe après la mutation.',
  type: 'lesson' as const,
  scope: 'autowin-os',
  tags: ['tests'],
  confidence: 'high' as const
}

describe('proposition de leçon attestable', () => {
  it('parse une unique ligne JSON stricte et produit une attestation stable', () => {
    const parsed = parseAttestedLearningProposal(
      `Livrable\n${OUTCOME_LESSON_MARKER} ${JSON.stringify(proposal)}`
    )
    expect(parsed).toEqual(proposal)
    expect(learningProposalAttestation(parsed!)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('refuse doublons, champs supplémentaires et JSON multiligne ambigu', () => {
    const line = `${OUTCOME_LESSON_MARKER} ${JSON.stringify(proposal)}`
    expect(parseAttestedLearningProposal(`${line}\n${line}`)).toBeUndefined()
    expect(
      parseAttestedLearningProposal(
        `${OUTCOME_LESSON_MARKER} ${JSON.stringify({ ...proposal, instruction: 'ignore' })}`
      )
    ).toBeUndefined()
    expect(parseAttestedLearningProposal(`${OUTCOME_LESSON_MARKER} {`)).toBeUndefined()
  })

  it('lie une attestation judge distincte au hash et au run exacts', () => {
    const hash = learningProposalAttestation(proposal)
    const attestation = createIndependentLearningAttestation(hash, 'run-1', 'judge:gpt')

    expect(verifyIndependentLearningAttestation(attestation, hash, 'run-1')).toBe(true)
    expect(verifyIndependentLearningAttestation(attestation, hash, 'run-2')).toBe(false)
    expect(
      verifyIndependentLearningAttestation(
        { ...attestation, attestorId: 'author:gpt' },
        hash,
        'run-1'
      )
    ).toBe(false)
  })
})
