// Frontière d'apprentissage de AppCommandBus (`observeOutcomeLearning`), sortie de commands.ts telle quelle
// (lot 6).
// Les membres du bus lus ici sont publics et marqués @internal : ce module fait partie du bus.
import type { AppCommandBus } from './commands'
import { appendBrainTrace } from '../activity/brain-trace-spool'
import { createHash } from 'node:crypto'
import { rememberFact } from '../brain/brain-remember'
import { brainServiceToken } from '../brain/brain-retrieval'
import { classeTerminaleDuControle } from '../orchestration/classe-terminale-echec'
import { type OutcomeLearningResult } from '../brain/outcome-learning-supervisor'
import {
  learningProposalAttestation,
  porteeDeLecon,
  parseAttestedLearningProposal,
  verifyIndependentLearningAttestation,
  type IndependentLearningAttestation
} from '../brain/outcome-learning-proposal'

/** Frontière terminale unique, réutilisée par le bus chat et l'IPC direct. */
export async function observeOutcomeLearning(bus: AppCommandBus, input: {
  conversationId: string
  turnId: string
  runId: string
  resultText: string
  valid: boolean
  gateBlocked: boolean
  gateReasons: string[]
  reused: boolean
  evidence: import('../providers/types').ExecutionEvidence[]
  model?: string
  role?: string
  terminalClass?: 'delivered' | 'defect' | 'external' | 'expected-negative' | 'indeterminate'
  proposalAttestations?: IndependentLearningAttestation[]
}): Promise<OutcomeLearningResult | undefined> {
  if (!bus.outcomeLearning) return undefined
  try {
    const attestedProposal = parseAttestedLearningProposal(input.resultText)
    const trustedProposal = attestedProposal
      ? {
          ...attestedProposal,
          // MEME definition que du cote attestation : c'est leur divergence qui vidait les 256
          // observations. Deux calculs de la meme valeur, c'est un defaut qui attend son heure.
          scope: porteeDeLecon(attestedProposal.scope, bus.workspaceDuTour)
        }
      : undefined
    const proposalHash = trustedProposal
      ? learningProposalAttestation(trustedProposal)
      : undefined
    const independentProposalAttestations =
      proposalHash && input.valid && !input.gateBlocked && input.role !== 'judge'
        ? (input.proposalAttestations ?? []).filter((attestation) =>
            verifyIndependentLearningAttestation(attestation, proposalHash, input.runId)
          )
        : []
    const attestedProposalHashes = independentProposalAttestations.map(
      (attestation) => attestation.proposalHash
    )
    if (trustedProposal?.scope) {
      const release = bus.outcomeLearning.reserveProposal(input.conversationId, input.turnId)
      if (release) {
        try {
          const proposalHash = learningProposalAttestation(trustedProposal)
          const proofHash = createHash('sha256')
            .update(
              JSON.stringify(
                input.evidence.flatMap((item) => [
                  ...Object.values(item.pathFingerprints ?? {}),
                  ...(item.writtenLineFingerprints ?? []),
                  ...Object.values(item.writtenLineFingerprintsByPath ?? {}).flat()
                ])
              )
            )
            .digest('hex')
          const provenanceTags = [
            `run:${createHash('sha256').update(input.runId).digest('hex').slice(0, 16)}`,
            `workspace:${createHash('sha256').update(bus.workspaceDuTour).digest('hex').slice(0, 16)}`,
            `role:${(input.role ?? 'orchestrator').slice(0, 30)}`,
            `proposal:${proposalHash.slice(0, 16)}`,
            `proof:${proofHash.slice(0, 16)}`
          ]
          const canonicalBody = `${trustedProposal.body}\n\nProvenance Autowin (v1):\n- run: ${input.runId}\n- workspace: ${bus.workspaceDuTour}\n- role: ${input.role ?? 'orchestrator'}\n- model: ${input.model ?? 'autowin'}\n- proposal-sha256: ${proposalHash}\n- proof-sha256: ${proofHash}`
          const deposited = await rememberFact(
            {
              title: trustedProposal.title,
              fact: canonicalBody,
              type: trustedProposal.type,
              scope: trustedProposal.scope,
              source: `session:${input.turnId}`,
              // Ces quatre tags restent dans la fiche canonique après promotion : la provenance ne
              // dépend donc pas du ledger local. Les tags sémantiques exacts restent dans l'attestation.
              tags: [...trustedProposal.tags.slice(0, 3), ...provenanceTags],
              confidence: trustedProposal.confidence,
              learningOutcome: trustedProposal.outcome
            },
            {
              token: brainServiceToken(),
              authorAgent: 'autowin-os',
              model: input.model ?? 'autowin',
              workspace: bus.workspaceDuTour
            }
          )
          /**
           * LA PROMOTION AUTOMATIQUE EST UNE ECRITURE VERS LE BRAIN, et elle n'en laissait aucune
           * trace : seule la commande `remember` explicite ecrivait la sienne. L'Observatory
           * montrait donc un tour muet la ou un fait venait d'etre depose — et un depot tombe
           * dans un service injoignable y etait aussi invisible qu'un depot reussi.
           *
           * `injectedChars: 0` A DESSEIN, comme pour `remember` : une ecriture n'injecte rien
           * dans le prompt, et y mettre la taille du fait gonflerait des totaux d'injection avec
           * du texte jamais injecte.
           */
          appendBrainTrace({
            timestamp: new Date().toISOString(),
            conversationId: input.conversationId,
            turnId: input.turnId,
            kind: 'depot',
            query: `promotion: ${trustedProposal.title}`,
            found: deposited.stored,
            status: deposited.stored ? 'found' : deposited.unknown ? 'unavailable' : 'empty',
            injectedChars: 0
          })
          if (deposited.fact) {
            bus.outcomeLearning.recordProposal({
              conversationId: input.conversationId,
              turnId: input.turnId,
              runId: input.runId,
              outcome: trustedProposal.outcome,
              ...deposited.fact,
              body: trustedProposal.body,
              tags: trustedProposal.tags,
              candidateId: deposited.candidateId,
              stored: deposited.stored,
              unknown: deposited.unknown,
              truncated: deposited.fact.truncated,
              authorAgent: 'autowin-os',
              authorModel: input.model ?? 'autowin',
              authorRole: input.role ?? 'orchestrator'
            })
          }
        } finally {
          release()
        }
      }
    }
    const terminalClass =
      input.terminalClass ??
      (input.valid && !input.gateBlocked
        ? 'delivered'
        : classeTerminaleDuControle(input.gateReasons))
    return await bus.outcomeLearning.observeOutcome({
      conversationId: input.conversationId,
      turnId: input.turnId,
      runId: input.runId,
      workspace: bus.workspaceDuTour,
      status: input.valid && !input.gateBlocked ? 'succeeded' : 'failed',
      terminalClass,
      valid: input.valid,
      gateBlocked: input.gateBlocked,
      reused: input.reused,
      evidence: input.evidence,
      attestedProposalHashes,
      independentProposalAttestations
    })
  } catch {
    return { state: 'unknown', detail: 'état Brain indisponible ; issue du run préservée' }
  }
}
