import { createHash } from 'node:crypto'
import type { ExecutionEvidence } from './providers/types'
import {
  OUTCOME_LEARNING_SCHEMA,
  type LearningDecisionV1,
  type LearningEvidenceRef,
  type LearningOutcome,
  type OutcomeLearningEventV1,
  type LearningProposalV1,
  type OutcomeObservedV1
} from '../shared/run-learning'
import { OutcomeLearningLedger } from './activity/outcome-learning-ledger'
import { projectOutcomeLearning } from './outcome-learning-projector'

export type OutcomeLearningMode = 'off' | 'shadow' | 'inbox' | 'auto'
export type OutcomeLearningState =
  'none' | 'off' | 'shadow' | 'inbox' | 'escrow' | 'published' | 'suppressed' | 'unknown'

export interface OutcomeLearningResult {
  state: OutcomeLearningState
  detail: string
  candidateId?: string
  knowledgeId?: string
}

export interface OutcomeLearningSupervisorDeps {
  ledger: OutcomeLearningLedger
  mode?: OutcomeLearningMode
  promote?: (candidateId: string, scope: string) => { to: string }
  invalidate?: () => Promise<void>
  now?: () => string
}

export function parseOutcomeLearningMode(value: string | undefined): OutcomeLearningMode {
  const normalized = value?.trim().toLowerCase()
  return normalized === 'off' ||
    normalized === 'shadow' ||
    normalized === 'inbox' ||
    normalized === 'auto'
    ? normalized
    : 'auto'
}

export class OutcomeLearningSupervisor {
  private runtimeMode: OutcomeLearningMode | undefined

  constructor(private readonly deps: OutcomeLearningSupervisorDeps) {}

  private get mode(): OutcomeLearningMode {
    return this.runtimeMode ?? this.deps.mode ?? 'auto'
  }

  getMode(): OutcomeLearningMode {
    return this.mode
  }

  setMode(mode: OutcomeLearningMode): OutcomeLearningMode {
    this.runtimeMode = mode
    return this.mode
  }

  audit(limit = 50): OutcomeLearningEventV1[] {
    const bounded = Math.max(1, Math.min(200, Math.trunc(limit)))
    return this.deps.ledger.read().events.slice(-bounded)
  }

  eventById(eventId: string): OutcomeLearningEventV1 | undefined {
    return this.deps.ledger.read().events.find((event) => event.value.eventId === eventId)
  }

  curationPage(
    offset = 0,
    limit = 20
  ): {
    events: Array<Extract<OutcomeLearningEventV1, { kind: 'curation' }>>
    total: number
  } {
    const start = Math.max(0, Math.trunc(offset))
    const size = Math.max(1, Math.min(100, Math.trunc(limit)))
    const all = this.deps.ledger
      .read()
      .events.filter(
        (event): event is Extract<OutcomeLearningEventV1, { kind: 'curation' }> =>
          event.kind === 'curation'
      )
      .reverse()
    return { events: all.slice(start, start + size), total: all.length }
  }

  latestCurationForStoredId(
    storedId: string
  ): Extract<OutcomeLearningEventV1, { kind: 'curation' }> | undefined {
    return this.deps.ledger
      .read()
      .events.filter(
        (event): event is Extract<OutcomeLearningEventV1, { kind: 'curation' }> =>
          event.kind === 'curation' &&
          (event.value.targetId === storedId || event.value.rollbackId === storedId)
      )
      .at(-1)
  }

  recordCurationIntent(
    action: 'retract' | 'restore' | 'supersede',
    knowledgeId: string,
    requestedTargetId?: string
  ): Extract<OutcomeLearningEventV1, { kind: 'curation-intent' }> {
    const createdAt = this.deps.now?.() ?? new Date().toISOString()
    const identity = digest({ action, knowledgeId, requestedTargetId, createdAt })
    const event: Extract<OutcomeLearningEventV1, { kind: 'curation-intent' }> = {
      kind: 'curation-intent',
      value: {
        schema: OUTCOME_LEARNING_SCHEMA,
        eventId: `curation-intent:${identity}`,
        createdAt,
        action,
        knowledgeId,
        ...(requestedTargetId ? { requestedTargetId } : {}),
        actor: 'user'
      }
    }
    this.deps.ledger.append(event)
    return event
  }

  recordCurationResolution(
    intentId: string,
    status: 'compensated' | 'aborted' | 'failed' | 'deduplicated',
    detail: string
  ): boolean {
    const createdAt = this.deps.now?.() ?? new Date().toISOString()
    const identity = digest({ intentId, status, detail })
    return this.deps.ledger.append({
      kind: 'curation-resolution',
      value: {
        schema: OUTCOME_LEARNING_SCHEMA,
        eventId: `curation-resolution:${identity}`,
        createdAt,
        intentId,
        status,
        detail: detail.slice(0, 500)
      }
    })
  }

  pendingCurationIntents(): Array<Extract<OutcomeLearningEventV1, { kind: 'curation-intent' }>> {
    const events = this.deps.ledger.read().events
    const resolved = new Set(
      events.flatMap((event) => {
        if (event.kind === 'curation' && event.value.intentId) return [event.value.intentId]
        if (
          event.kind === 'curation-resolution' &&
          (event.value.status === 'compensated' ||
            event.value.status === 'aborted' ||
            event.value.status === 'deduplicated')
        )
          return [event.value.intentId]
        return []
      })
    )
    return events.filter(
      (event): event is Extract<OutcomeLearningEventV1, { kind: 'curation-intent' }> =>
        event.kind === 'curation-intent' && !resolved.has(event.value.eventId)
    )
  }

  recordCuration(
    action: 'retract' | 'restore' | 'supersede',
    knowledgeId: string,
    targetId: string,
    rollbackId?: string,
    previousEventId?: string,
    intentId?: string
  ): boolean {
    const previous = previousEventId
      ? this.eventById(previousEventId)
      : this.deps.ledger
          .read()
          .events.filter(
            (event): event is Extract<OutcomeLearningEventV1, { kind: 'curation' }> =>
              event.kind === 'curation' && event.value.knowledgeId === knowledgeId
          )
          .at(-1)
    const previousCuration = previous?.kind === 'curation' ? previous : undefined
    if (previousCuration?.value.action === action && previousCuration.value.targetId === targetId)
      return false
    const createdAt = this.deps.now?.() ?? new Date().toISOString()
    const identity = digest({
      action,
      knowledgeId,
      targetId,
      rollbackId,
      previousEventId: previousCuration?.value.eventId
    })
    return this.deps.ledger.append({
      kind: 'curation',
      value: {
        schema: OUTCOME_LEARNING_SCHEMA,
        eventId: `curation:${identity}`,
        createdAt,
        action,
        knowledgeId,
        targetId,
        ...(rollbackId ? { rollbackId } : {}),
        actor: 'user',
        ...(previousCuration ? { previousEventId: previousCuration.value.eventId } : {}),
        ...(intentId ? { intentId } : {})
      }
    })
  }

  hasProposal(conversationId: string, turnId: string): boolean {
    return this.deps.ledger
      .read()
      .events.some(
        (event) =>
          event.kind === 'proposal' &&
          event.value.conversationId === conversationId &&
          event.value.turnId === turnId
      )
  }

  reserveProposal(conversationId: string, turnId: string): (() => void) | undefined {
    if (this.mode === 'off') return undefined
    return this.deps.ledger.reserveProposalTurn(conversationId, turnId)
  }

  latestOutcome(conversationId: string, turnId: string): OutcomeObservedV1 | undefined {
    return this.deps.ledger
      .read()
      .events.filter(
        (event): event is Extract<OutcomeLearningEventV1, { kind: 'outcome' }> =>
          event.kind === 'outcome' &&
          event.value.conversationId === conversationId &&
          event.value.turnId === turnId
      )
      .map(({ value }) => value)
      .sort((left, right) =>
        [left.createdAt, left.eventId]
          .join('\0')
          .localeCompare([right.createdAt, right.eventId].join('\0'))
      )
      .at(-1)
  }

  recordProposal(input: {
    conversationId: string
    turnId: string
    runId?: string
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
  }): boolean {
    if (this.mode === 'off' || this.hasProposal(input.conversationId, input.turnId)) return false
    const stable = {
      conversationId: input.conversationId,
      turnId: input.turnId,
      runId: input.runId,
      outcome: input.outcome,
      title: input.title,
      body: input.body,
      type: input.type,
      scope: input.scope,
      source: input.source,
      tags: input.tags,
      confidence: input.confidence,
      candidateId: input.candidateId,
      stored: input.stored,
      unknown: input.unknown,
      truncated: input.truncated,
      authorAgent: input.authorAgent ?? 'autowin-os',
      authorModel: input.authorModel ?? 'autowin',
      authorRole: input.authorRole ?? 'orchestrator'
    }
    const eventId = `proposal:${digest(stable)}`
    const value: LearningProposalV1 = {
      schema: OUTCOME_LEARNING_SCHEMA,
      eventId,
      createdAt: this.deps.now?.() ?? new Date().toISOString(),
      ...stable
    }
    return this.deps.ledger.append({ kind: 'proposal', value })
  }

  async observeOutcome(input: {
    conversationId: string
    turnId: string
    runId: string
    workspace: string
    status: 'succeeded' | 'failed'
    terminalClass?: OutcomeObservedV1['terminalClass']
    valid: boolean
    gateBlocked: boolean
    reused: boolean
    evidence: ExecutionEvidence[]
    attestedProposalHashes?: string[]
    independentProposalAttestations?: OutcomeObservedV1['independentProposalAttestations']
  }): Promise<OutcomeLearningResult> {
    if (this.mode === 'off') return { state: 'off', detail: 'apprentissage Brain désactivé' }
    const observation: OutcomeObservedV1 = {
      schema: OUTCOME_LEARNING_SCHEMA,
      eventId: '',
      conversationId: input.conversationId,
      turnId: input.turnId,
      runId: input.runId,
      workspace: input.workspace,
      createdAt: this.deps.now?.() ?? new Date().toISOString(),
      status: input.status,
      terminalClass: input.terminalClass ?? (input.status === 'succeeded' ? 'delivered' : 'defect'),
      valid: input.valid,
      gateBlocked: input.gateBlocked,
      reused: input.reused,
      evidence: evidenceRefs(input.evidence),
      codeFingerprint: digest(
        evidenceRefs(input.evidence)
          .filter(({ kind }) => kind === 'mutation')
          .map(({ signature }) => signature)
      ),
      observer: 'autowin-os',
      attestedProposalHashes: [...new Set(input.attestedProposalHashes ?? [])].sort(),
      independentProposalAttestations: [...(input.independentProposalAttestations ?? [])]
    }
    observation.eventId = `outcome:${digest({
      conversationId: observation.conversationId,
      turnId: observation.turnId,
      runId: observation.runId,
      status: observation.status,
      terminalClass: observation.terminalClass,
      valid: observation.valid,
      gateBlocked: observation.gateBlocked,
      reused: observation.reused,
      evidence: observation.evidence,
      attestedProposalHashes: observation.attestedProposalHashes,
      independentProposalAttestations: observation.independentProposalAttestations
    })}`
    this.deps.ledger.append({ kind: 'outcome', value: observation })

    return await this.reconcile(input.conversationId, input.turnId)
  }

  /**
   * Rejoue la projection d'un tour sans ajouter d'événement. Ce chemin couvre le cas normal où
   * l'orchestration se termine avant que le modèle ne dépose sa leçon via `remember`.
   */
  async reconcile(conversationId: string, turnId: string): Promise<OutcomeLearningResult> {
    if (this.mode === 'off') return { state: 'off', detail: 'apprentissage Brain désactivé' }

    const before = this.deps.ledger.read().events
    const proposal = before.find(
      (event) =>
        event.kind === 'proposal' &&
        event.value.conversationId === conversationId &&
        event.value.turnId === turnId
    )
    if (!proposal || proposal.kind !== 'proposal') {
      return { state: 'none', detail: 'aucune leçon proposée pour ce run' }
    }
    const recorded = before.find(
      (event) => event.kind === 'decision' && event.value.proposalId === proposal.value.eventId
    )
    if (recorded?.kind === 'decision') {
      return resultFor(recorded.value, proposal.value.candidateId, this.mode)
    }

    const projected = projectOutcomeLearning(before)
    const intended = projected.decisions.find(
      ({ proposalId }) => proposalId === proposal.value.eventId
    )
    if (!intended) return { state: 'none', detail: 'issue terminale sans décision de leçon' }

    if (this.mode === 'shadow') {
      const applied = overrideDecision(intended, 'inbox', 'mode-shadow')
      this.deps.ledger.append({ kind: 'decision', value: applied })
      return {
        state: 'shadow',
        detail: `simulation : ${intended.route}, aucune écriture canonique`,
        candidateId: proposal.value.candidateId
      }
    }
    if (this.mode === 'inbox' && intended.route === 'publish') {
      const applied = overrideDecision(intended, 'inbox', 'mode-inbox-only')
      this.deps.ledger.append({ kind: 'decision', value: applied })
      return resultFor(applied, proposal.value.candidateId, this.mode)
    }
    if (intended.route !== 'publish') {
      this.deps.ledger.append({ kind: 'decision', value: intended })
      return resultFor(intended, proposal.value.candidateId, this.mode)
    }
    if (!proposal.value.candidateId || !this.deps.promote) {
      const applied = overrideDecision(intended, 'inbox', 'promoter-unavailable')
      this.deps.ledger.append({ kind: 'decision', value: applied })
      return resultFor(applied, proposal.value.candidateId, this.mode)
    }

    let knowledgeId: string
    try {
      knowledgeId = this.deps.promote(proposal.value.candidateId, proposal.value.scope).to
    } catch {
      const applied = overrideDecision(intended, 'inbox', 'promotion-failed')
      this.deps.ledger.append({ kind: 'decision', value: applied })
      return resultFor(applied, proposal.value.candidateId, this.mode)
    }
    try {
      await this.deps.invalidate?.()
    } catch {
      return {
        state: 'unknown',
        detail: 'leçon copiée ; invalidation Brain incomplète et rejouable',
        candidateId: proposal.value.candidateId,
        knowledgeId
      }
    }
    this.deps.ledger.append({ kind: 'decision', value: intended })
    return {
      state: 'published',
      detail: 'leçon prouvée publiée dans le Brain canonique',
      candidateId: proposal.value.candidateId,
      knowledgeId
    }
  }

  /** Rejoue au démarrage les projections sans décision durable (crash promotion→invalidation). */
  async reconcilePending(): Promise<void> {
    const turns = new Set<string>()
    for (const event of this.deps.ledger.read().events) {
      if (event.kind !== 'proposal') continue
      turns.add(`${event.value.conversationId}\0${event.value.turnId}`)
    }
    for (const key of turns) {
      const [conversationId, turnId] = key.split('\0')
      try {
        await this.reconcile(conversationId, turnId)
      } catch {
        // Best-effort au démarrage ; le prochain événement terminal rejouera la même projection.
      }
    }
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function normalizedCommand(command: string | undefined): string {
  return (command ?? '').replace(/\s+/gu, ' ').trim()
}

function evidenceRefs(evidence: readonly ExecutionEvidence[]): LearningEvidenceRef[] {
  return evidence.map((item, sequence) => {
    const mutationFingerprints = [
      ...Object.values(item.pathFingerprints ?? {}),
      ...(item.writtenLineFingerprints ?? []),
      ...Object.values(item.writtenLineFingerprintsByPath ?? {}).flat()
    ].sort()
    const targetSignatures = [
      ...(item.paths ?? []),
      ...(item.path ? [item.path] : []),
      ...Object.keys(item.pathFingerprints ?? {}),
      ...Object.keys(item.writtenLineFingerprintsByPath ?? {})
    ]
      .map((path) => digest(path.replaceAll('\\', '/').toLowerCase()))
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort()
    const material =
      item.kind === 'verification'
        ? { kind: item.kind, type: item.type, command: normalizedCommand(item.command) }
        : item.kind === 'mutation'
          ? { kind: item.kind, type: item.type, fingerprints: mutationFingerprints }
          : { kind: item.kind, type: item.type, status: item.status }
    return {
      sequence,
      kind: item.kind,
      ok: item.ok,
      signature: `${item.kind}:${digest(material)}`,
      ...(targetSignatures.length > 0 ? { targetSignatures } : {}),
      ...(item.kind === 'verification' ? { oracleStable: item.oracleStable === true } : {}),
      ...(item.oracleAttestation ? { oracleAttestation: item.oracleAttestation } : {}),
      ...(item.kind === 'mutation' ? { material: mutationFingerprints.length > 0 } : {}),
      ...(item.exitCode === undefined ? {} : { exitCode: item.exitCode })
    }
  })
}

function overrideDecision(
  decision: LearningDecisionV1,
  route: LearningDecisionV1['route'],
  reason: string
): LearningDecisionV1 {
  const identity = digest({ base: decision.identity, route, reason })
  return {
    ...decision,
    eventId: `decision:${identity}`,
    route,
    reasons: [...decision.reasons, reason],
    identity
  }
}

function resultFor(
  decision: LearningDecisionV1,
  candidateId: string | undefined,
  mode: OutcomeLearningMode
): OutcomeLearningResult {
  if (mode === 'shadow') {
    return { state: 'shadow', detail: 'simulation déjà enregistrée', candidateId }
  }
  if (decision.route === 'publish') {
    return { state: 'published', detail: 'leçon déjà publiée', candidateId }
  }
  if (decision.route === 'escrow') {
    return {
      state: 'escrow',
      detail: 'preuve locale forte ; confirmation indépendante requise',
      candidateId
    }
  }
  if (decision.route === 'suppress') {
    return { state: 'suppressed', detail: 'aucune nouvelle leçon conservée', candidateId }
  }
  return {
    state: 'inbox',
    detail: `leçon gardée en revue : ${decision.reasons.join(', ')}`,
    candidateId
  }
}
