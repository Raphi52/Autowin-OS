import { createHash } from 'node:crypto'
import type {
  LearningEvidenceRef,
  LearningDecisionV1,
  LearningProposalV1,
  OutcomeObservedV1
} from '../shared/run-learning'
import {
  learningProposalAttestation,
  verifyIndependentLearningAttestation
} from './outcome-learning-proposal'

function decision(
  proposal: LearningProposalV1,
  observation: OutcomeObservedV1,
  route: LearningDecisionV1['route'],
  reasons: string[]
): LearningDecisionV1 {
  const identity = createHash('sha256')
    .update(
      JSON.stringify({
        runId: observation.runId,
        candidateId: proposal.candidateId,
        outcome: proposal.outcome,
        scope: proposal.scope,
        evidence: observation.evidence.map(
          ({
            sequence,
            kind,
            ok,
            signature,
            material,
            targetSignatures,
            oracleStable,
            oracleAttestation
          }) => ({
            sequence,
            kind,
            ok,
            signature,
            material,
            targetSignatures,
            oracleStable,
            oracleAttestation
          })
        )
      })
    )
    .digest('hex')
  return {
    schema: 'autowin.learning/v1',
    eventId: `decision:${identity}`,
    proposalId: proposal.eventId,
    observationId: observation.eventId,
    route,
    reasons,
    identity
  }
}

function causalPair(evidence: readonly LearningEvidenceRef[], terminalOk: boolean): boolean {
  const ordered = [...evidence].sort((left, right) => left.sequence - right.sequence)
  for (let redIndex = 0; redIndex < ordered.length; redIndex += 1) {
    const red = ordered[redIndex]
    if (
      red.kind !== 'verification' ||
      red.ok ||
      red.oracleStable !== true ||
      !red.oracleAttestation
    )
      continue
    const mutationIndex = ordered.findIndex(
      (item, index) =>
        index > redIndex && item.kind === 'mutation' && item.ok && item.material === true
    )
    if (mutationIndex < 0) continue
    const mutation = ordered[mutationIndex]
    const mutationTargets = new Set(mutation.targetSignatures ?? [])
    if (
      mutationTargets.size === 0 ||
      !(red.targetSignatures ?? []).some((target) => mutationTargets.has(target))
    ) {
      continue
    }
    const terminals = ordered.filter(
      (item, index) =>
        index > mutationIndex &&
        item.kind === 'verification' &&
        item.ok === terminalOk &&
        item.signature === red.signature &&
        item.oracleStable === true &&
        item.oracleAttestation === red.oracleAttestation &&
        (item.targetSignatures ?? []).some((target) => mutationTargets.has(target))
    )
    // Deux répétitions identiques après une mutation matérielle réduisent le risque de promouvoir
    // un vert flaky (ou un rouge accidentel) comme apprentissage causal.
    if (terminals.length >= 2) return true
  }
  return false
}

export function decideOutcomeLearning(
  proposal: LearningProposalV1,
  observation: OutcomeObservedV1
): LearningDecisionV1 {
  if (
    proposal.conversationId !== observation.conversationId ||
    proposal.turnId !== observation.turnId
  ) {
    return decision(proposal, observation, 'suppress', ['foreign-turn'])
  }
  if (proposal.runId && proposal.runId !== observation.runId) {
    return decision(proposal, observation, 'suppress', ['foreign-run'])
  }

  const uncertain: string[] = []
  if (!proposal.stored || !proposal.candidateId) uncertain.push('candidate-not-stored')
  if (proposal.unknown) uncertain.push('deposit-unknown')
  if (proposal.truncated) uncertain.push('candidate-truncated')
  if (proposal.confidence !== 'high') uncertain.push('confidence-not-high')
  if (proposal.source !== `session:${proposal.turnId}`) uncertain.push('source-not-current-turn')
  if (!proposal.runId) uncertain.push('proposal-without-run')
  const proposalHash = learningProposalAttestation({
    outcome: proposal.outcome,
    title: proposal.title,
    body: proposal.body,
    type: proposal.type,
    scope: proposal.scope,
    tags: proposal.tags,
    confidence: proposal.confidence
  })
  if (
    !observation.attestedProposalHashes?.includes(proposalHash) ||
    !observation.independentProposalAttestations?.some((attestation) =>
      verifyIndependentLearningAttestation(attestation, proposalHash, observation.runId)
    )
  ) {
    uncertain.push('proposal-not-judge-attested')
  }
  if (observation.reused) uncertain.push('run-reused')

  const delivered =
    (observation.terminalClass === undefined || observation.terminalClass === 'delivered') &&
    observation.status === 'succeeded' &&
    observation.valid &&
    !observation.gateBlocked &&
    !observation.reused
  const failed =
    (observation.terminalClass === undefined || observation.terminalClass === 'defect') &&
    observation.status === 'failed' &&
    (!observation.valid || observation.gateBlocked) &&
    !observation.reused
  const causal =
    proposal.outcome === 'success'
      ? delivered && causalPair(observation.evidence, true)
      : failed && causalPair(observation.evidence, false)

  if (!causal) uncertain.push('causality-not-proven')
  if (
    observation.terminalClass === 'external' ||
    observation.terminalClass === 'expected-negative' ||
    observation.terminalClass === 'indeterminate'
  ) {
    uncertain.push(`terminal-${observation.terminalClass}`)
  }
  if (uncertain.length > 0) return decision(proposal, observation, 'inbox', uncertain)
  if (proposal.scope.trim().toLowerCase() === 'global') {
    return decision(proposal, observation, 'escrow', ['global-scope-needs-independent-proof'])
  }
  return decision(proposal, observation, 'publish', ['causal-proof-strong-and-local'])
}
