import { createHash } from 'node:crypto'
import type { LearningJudgeAttestationV1 } from '../shared/run-learning'
import { workspaceSlug } from './brain-corpus-scope'
import { racineHorsCopieAgent } from './app-data'

export const OUTCOME_LESSON_MARKER = 'AUTOWIN_LESSON_V1:'

export interface AttestedLearningProposal {
  outcome: 'success' | 'failure'
  title: string
  body: string
  type: 'lesson' | 'decision' | 'preference' | 'domain'
  scope: string
  tags: string[]
  confidence: 'low' | 'medium' | 'high'
}

export type IndependentLearningAttestation = LearningJudgeAttestationV1

const TYPES = new Set<AttestedLearningProposal['type']>([
  'lesson',
  'decision',
  'preference',
  'domain'
])
const CONFIDENCES = new Set<AttestedLearningProposal['confidence']>(['low', 'medium', 'high'])

/** Parse une unique enveloppe de leçon que le judge a vue dans l'agrégat exact. */
export function parseAttestedLearningProposal(text: string): AttestedLearningProposal | undefined {
  const lines = text
    .split(/\r?\n/u)
    .filter((line) => line.trimStart().startsWith(OUTCOME_LESSON_MARKER))
  if (lines.length !== 1) return undefined
  const raw = lines[0].trimStart().slice(OUTCOME_LESSON_MARKER.length).trim()
  return parseProposalJson(raw)
}

function parseProposalJson(raw: string): AttestedLearningProposal | undefined {
  if (!raw || raw.length > 12_000) return undefined
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expected = ['body', 'confidence', 'outcome', 'scope', 'tags', 'title', 'type']
  if (JSON.stringify(keys) !== JSON.stringify(expected)) return undefined
  if (record.outcome !== 'success' && record.outcome !== 'failure') return undefined
  if (typeof record.title !== 'string' || typeof record.body !== 'string') return undefined
  if (typeof record.scope !== 'string' || !TYPES.has(record.type as never)) return undefined
  if (!CONFIDENCES.has(record.confidence as never) || !Array.isArray(record.tags)) return undefined
  if (!record.tags.every((tag) => typeof tag === 'string')) return undefined
  return {
    outcome: record.outcome,
    title: record.title,
    body: record.body,
    type: record.type as AttestedLearningProposal['type'],
    scope: record.scope,
    tags: record.tags as string[],
    confidence: record.confidence as AttestedLearningProposal['confidence']
  }
}

export function learningProposalAttestation(
  proposal: Pick<
    AttestedLearningProposal,
    'outcome' | 'title' | 'body' | 'type' | 'scope' | 'tags' | 'confidence'
  >
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        outcome: proposal.outcome,
        title: proposal.title,
        body: proposal.body,
        type: proposal.type,
        scope: proposal.scope,
        tags: proposal.tags,
        confidence: proposal.confidence
      })
    )
    .digest('hex')
}

function independentAttestationDigest(
  value: Omit<IndependentLearningAttestation, 'attestation'>
): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Émis par la frontière orchestrateur uniquement après un verdict judge vert sur l'agrégat exact. */
export function createIndependentLearningAttestation(
  proposalHash: string,
  runId: string,
  attestorId: string
): IndependentLearningAttestation {
  const value = { proposalHash, runId, attestorRole: 'judge' as const, attestorId }
  return { ...value, attestation: independentAttestationDigest(value) }
}

export function verifyIndependentLearningAttestation(
  value: IndependentLearningAttestation,
  proposalHash: string,
  runId: string
): boolean {
  if (
    value.attestorRole !== 'judge' ||
    value.proposalHash !== proposalHash ||
    value.runId !== runId ||
    !value.attestorId.trim()
  )
    return false
  const unsigned = {
    proposalHash: value.proposalHash,
    runId: value.runId,
    attestorRole: value.attestorRole,
    attestorId: value.attestorId
  }
  return value.attestation === independentAttestationDigest(unsigned)
}

/**
 * LA PORTEE d'une lecon -- UNE seule definition, appelee par les DEUX cotes.
 *
 * LE DEFAUT, mesure le 2026-08-25 : la portee etait calculee a deux endroits depuis deux chemins
 * differents. L'attestation (`orchestrator.ts`) partait de `workCwd`, qui vaut
 * `isolatedCwd ?? executionWorkspace` -- donc, sur tout run ISOLE (c'est-a-dire tout run de
 * mutation), le chemin de la COPIE AGENT. Le consommateur (`commands.ts`) partait du depot reel.
 * Mesure sur un chemin reel : `agent-run-d66740cfa68e-1` d'un cote, `autowin-os` de l'autre. Deux
 * portees, deux empreintes, et `verifyIndependentLearningAttestation` echouait TOUJOURS -- 256
 * observations sur 256 sans la moindre attestation, et le dernier verrou entre `inbox` et `publish`
 * qui ne pouvait jamais tomber.
 *
 * LA BONNE PORTEE est celle du DEPOT. Une lecon decrit un projet, pas la copie jetable ou elle a ete
 * apprise : une portee par run polluerait le Brain de valeurs que rien ne pourrait jamais relire.
 *
 * On REMONTE donc hors de la copie plutot que de faire confiance au chemin recu. C'est deliberement
 * plus robuste que « passer le bon argument » : l'appelant qui se trompe est precisement ce qui a
 * cause le defaut, et un argument juste ne se verifie pas au type.
 */
export function porteeDeLecon(scope: string, workspacePath: string): string {
  if (scope.trim().toLowerCase() === 'global') return 'global'
  return workspaceSlug(racineHorsCopieAgent(workspacePath))
}
