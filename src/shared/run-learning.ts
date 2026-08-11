export const OUTCOME_LEARNING_SCHEMA = 'autowin.learning/v1' as const

export type LearningOutcome = 'success' | 'failure'
export type LearningRoute = 'publish' | 'inbox' | 'escrow' | 'suppress'

export interface LearningEvidenceRef {
  sequence: number
  kind: 'mutation' | 'verification' | 'inspection' | 'other'
  ok: boolean
  signature: string
  targetSignatures?: string[]
  oracleStable?: boolean
  oracleAttestation?: string
  /** Une mutation n'est causale que si le moteur a observé une empreinte de contenu écrite. */
  material?: boolean
  exitCode?: number
}

export interface LearningProposalV1 {
  schema: typeof OUTCOME_LEARNING_SCHEMA
  eventId: string
  conversationId: string
  turnId: string
  runId?: string
  createdAt: string
  outcome: LearningOutcome
  title: string
  body: string
  type: 'lesson' | 'decision' | 'preference' | 'domain'
  scope: string
  source: string
  tags: string[]
  confidence: 'low' | 'medium' | 'high'
  candidateId?: string
  stored: boolean
  unknown?: boolean
  truncated: boolean
  authorAgent?: string
  authorModel?: string
  authorRole?: string
}

export interface OutcomeObservedV1 {
  schema: typeof OUTCOME_LEARNING_SCHEMA
  eventId: string
  conversationId: string
  turnId: string
  runId: string
  workspace: string
  createdAt: string
  status: 'succeeded' | 'failed'
  terminalClass?: 'delivered' | 'defect' | 'external' | 'expected-negative' | 'indeterminate'
  valid: boolean
  gateBlocked: boolean
  reused: boolean
  evidence: LearningEvidenceRef[]
  /** Empreinte de l'état effectivement muté/vérifié, jamais le contenu ni les chemins bruts. */
  codeFingerprint?: string
  observer?: string
  attestedProposalHashes?: string[]
  independentProposalAttestations?: LearningJudgeAttestationV1[]
}

export interface LearningJudgeAttestationV1 {
  proposalHash: string
  runId: string
  attestorRole: 'judge'
  attestorId: string
  attestation: string
}

export interface LearningDecisionV1 {
  schema: typeof OUTCOME_LEARNING_SCHEMA
  eventId: string
  proposalId: string
  observationId: string
  route: LearningRoute
  reasons: string[]
  identity: string
}

export interface LearningProjectionV1 {
  schema: typeof OUTCOME_LEARNING_SCHEMA
  decisionId: string
  proposalId: string
  observationId: string
  identity: string
  route: LearningRoute
  candidateId?: string
  title: string
  scope: string
}

export interface OutcomeCurationV1 {
  schema: typeof OUTCOME_LEARNING_SCHEMA
  eventId: string
  createdAt: string
  action: 'retract' | 'restore' | 'supersede'
  knowledgeId: string
  targetId: string
  rollbackId?: string
  actor: 'user'
  previousEventId?: string
  intentId?: string
}

export interface OutcomeCurationIntentV1 {
  schema: typeof OUTCOME_LEARNING_SCHEMA
  eventId: string
  createdAt: string
  action: 'retract' | 'restore' | 'supersede'
  knowledgeId: string
  requestedTargetId?: string
  actor: 'user'
}

export interface OutcomeCurationResolutionV1 {
  schema: typeof OUTCOME_LEARNING_SCHEMA
  eventId: string
  createdAt: string
  intentId: string
  status: 'compensated' | 'aborted' | 'failed' | 'deduplicated'
  detail: string
}

export type OutcomeLearningEventV1 =
  | { kind: 'proposal'; value: LearningProposalV1 }
  | { kind: 'outcome'; value: OutcomeObservedV1 }
  | { kind: 'decision'; value: LearningDecisionV1 }
  | { kind: 'curation-intent'; value: OutcomeCurationIntentV1 }
  | { kind: 'curation-resolution'; value: OutcomeCurationResolutionV1 }
  | { kind: 'curation'; value: OutcomeCurationV1 }
