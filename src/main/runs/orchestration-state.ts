import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { PIPELINE_PHASES, type PipelinePhase } from '../skill-pipeline'
import { decodeRoleBinding } from '../role-store'
import { ALL_ROLES, type RoleBinding } from '../roles'
import type { ExecutionQuote } from '../execution-quote'
import type { ExecutionUsageSnapshot } from '../execution-supervisor'
import type { OrchestrationRuntimeSnapshot } from '../orchestrator'
import type { ExecutionEvidence } from '../providers/types'
// La fenetre de peremption des reprises vit dans `shared/` : le renderer l'applique aussi, aux tours
// de chat inacheves. Deux constantes qui divergent, c'est un mecanisme qui oublie et l'autre qui se
// souvient pour le MEME demarrage. Re-exportee pour les appelants qui la nommaient d'ici.
import { RESUME_STALE_AFTER_MS, resumeIsStale } from '../../shared/resume-staleness'
export { RESUME_STALE_AFTER_MS }

/**
 * SURVIE NIVEAU 3 — état reprenable d'une ORCHESTRATION.
 *
 * Les niveaux 1 et 2 couvrent déjà : l'app reste vivante en tray quand la fenêtre se ferme, et un
 * CLI enfant spawné détaché continue d'écrire dans son journal même si le process main meurt. Mais
 * la BOUCLE d'orchestration (scout→frame→…→judge) vit dans le process main : tué en pleine phase,
 * les phases restantes ne s'exécutaient JAMAIS — on pouvait relire ce qui avait été produit, pas
 * reprendre l'exécution. D'où « 1 action interrompue · Orchestration ».
 *
 * Ce module persiste, APRÈS CHAQUE PHASE, de quoi redémarrer à la phase suivante : la tâche, la
 * conversation, et le livrable de chaque phase déjà faite. Au démarrage, l'app relance le run en
 * REJOUANT cet acquis (aucune phase refaite, aucun token regaspillé).
 *
 * Robustesse : écriture par fichier-par-run (aucun verrou partagé), lecture qui IGNORE un fichier
 * illisible (un crash en pleine écriture ne doit pas empêcher de reprendre les autres runs).
 */
export interface OrchestrationPhaseOutput {
  phase: PipelinePhase
  text: string
  /** CLI exact ayant produit cette occurrence ; absent sur les checkpoints historiques/fan-out. */
  agentToken?: string
  /** Preuves outils acquises avec cette phase, indispensables au gate apres un redemarrage. */
  executionEvidence?: ExecutionEvidence[]
}

export interface OrchestrationRunState {
  runId: string
  /** Lignée immuable d'une branche créée depuis un checkpoint persistant. */
  forkedFrom?: {
    checkpointId: string
    runId: string
    checkpointCreatedAt: string
    contentHash: string
  }
  task: string
  conversationId?: string
  /** Tour Chat d'origine ; absent seulement sur les états historiques. */
  turnId?: string
  /** Binding figé du run; absent sur les états historiques. */
  bindingOverride?: RoleBinding
  /** Topologie complete figee avant le premier appel provider; absente sur les anciens checkpoints. */
  runtimeSnapshot?: OrchestrationRuntimeSnapshot
  /** Livrables des phases DÉJÀ terminées, dans l'ordre — rejoués tels quels à la reprise. */
  phaseOutputs: OrchestrationPhaseOutput[]
  /** Devis originel : une reprise continue CE contrat, elle n'en compile pas un nouveau. */
  executionQuote?: ExecutionQuote
  /** Consommation deja engagee : une reprise ne repart jamais avec des compteurs a zero. */
  usage?: ExecutionUsageSnapshot
  /** Decision durable : ce pipeline doublon ne doit plus jamais etre relance. */
  resumeDisposition?: {
    kind: 'superseded-duplicate'
    electedRunId: string
    decidedAt: number
  }
  /** Fin durable d'un appel dont l'issue provider est indémontrable. Jamais repris implicitement. */
  terminal?: {
    status: 'interrupted'
    reason: string
    decidedAt: number
  }
  startedAt: number
  updatedAt: number
  /**
   * Agents CLI lancés par ce run. Un CLI détaché SURVIT à la mort de l'app et continue d'écrire dans
   * son journal ; sans ces références, l'app qui revient ne sait ni s'il vit encore, ni où lire ce
   * qu'il a produit pendant son absence — elle relance donc un travail déjà fait.
   */
  agents?: Array<{
    token: string
    /** Provider qui a produit le journal brut. */
    provider?: string
    /** Phase réellement exécutée par ce CLI ; ne jamais la redéduire de l'ordre du devis. */
    phase?: PipelinePhase
    /** `true` de la réservation jusqu'au règlement provider, y compris après la sortie du PID. */
    active?: boolean
    /** Un membre de fan-out ne peut pas, seul, devenir le livrable agrégé de sa phase. */
    fanOut?: boolean
    /** Réservation provider exacte encore associée à cette occurrence. */
    reservationId?: string
    pid?: number
    /** Empreinte du processus au lancement — distingue notre agent d'un pid recyclé. */
    identity?: string
    journalPath?: string
    offset?: number
  }>
}

function isPhaseOutput(value: unknown): value is OrchestrationPhaseOutput {
  if (!value || typeof value !== 'object') return false
  const output = value as Record<string, unknown>
  return (
    typeof output.phase === 'string' &&
    PIPELINE_PHASES.includes(output.phase as PipelinePhase) &&
    typeof output.text === 'string' &&
    (output.agentToken === undefined || isNonEmptyString(output.agentToken)) &&
    (output.executionEvidence === undefined ||
      (Array.isArray(output.executionEvidence) &&
        output.executionEvidence.every(isExecutionEvidence)))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isStringRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => typeof item === 'string' || item === null)
  )
}

function isStringArrayRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isStringArray)
}

function isExecutionEvidence(value: unknown): value is ExecutionEvidence {
  if (!isRecord(value)) return false
  return (
    typeof value.type === 'string' &&
    ['mutation', 'verification', 'inspection', 'other'].includes(String(value.kind)) &&
    typeof value.status === 'string' &&
    typeof value.ok === 'boolean' &&
    typeof value.summary === 'string' &&
    isOptionalString(value.command) &&
    (value.exitCode === undefined || Number.isSafeInteger(value.exitCode)) &&
    isOptionalString(value.stdout) &&
    isOptionalString(value.diff) &&
    isOptionalString(value.path) &&
    (value.paths === undefined || isStringArray(value.paths)) &&
    (value.writtenLineFingerprints === undefined || isStringArray(value.writtenLineFingerprints)) &&
    (value.writtenLineFingerprintsByPath === undefined ||
      isStringArrayRecord(value.writtenLineFingerprintsByPath)) &&
    isOptionalString(value.workspaceRoot) &&
    (value.pathFingerprints === undefined || isStringRecord(value.pathFingerprints)) &&
    (value.pathBaseFingerprints === undefined || isStringRecord(value.pathBaseFingerprints)) &&
    (value.pathGenerationMarkers === undefined || isStringRecord(value.pathGenerationMarkers)) &&
    (value.pathBaseGenerationMarkers === undefined ||
      isStringRecord(value.pathBaseGenerationMarkers))
  )
}

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/

function isRunId(value: unknown): value is string {
  return typeof value === 'string' && RUN_ID_PATTERN.test(value)
}

function isRoleBinding(value: unknown): value is RoleBinding {
  const decoded = decodeRoleBinding(value)
  if (!decoded || !isRecord(value)) return false
  if (value.provider !== decoded.provider || value.model !== decoded.model) return false
  if (value.phaseModel === undefined) return true
  const rawPhaseModel = value.phaseModel as Record<string, Record<string, unknown>>
  return Object.entries(rawPhaseModel).every(
    ([phase, override]) => override.model === decoded.phaseModel?.[phase as PipelinePhase]?.model
  )
}

function isRuntimeSnapshot(value: unknown): value is OrchestrationRuntimeSnapshot {
  if (!isRecord(value) || !isRecord(value.roles)) return false
  const roles = value.roles
  if (!ALL_ROLES.every((role) => isRoleBinding(roles[role]))) return false
  if (!isRecord(value.phaseFanOut)) return false
  if (
    !Object.entries(value.phaseFanOut).every(
      ([phase, members]) =>
        PIPELINE_PHASES.includes(phase as PipelinePhase) &&
        Array.isArray(members) &&
        members.every(isRoleBinding)
    )
  ) {
    return false
  }
  return Array.isArray(value.judgeFanOut) && value.judgeFanOut.every(isRoleBinding)
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isExecutionQuote(value: unknown): value is ExecutionQuote {
  if (!isRecord(value) || value.schema !== 'autowin.execution-quote/v1') return false
  if (
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.taskFingerprint !== 'string' ||
    !value.taskFingerprint.trim() ||
    !['trivial', 'standard', 'critical'].includes(String(value.regime)) ||
    !Array.isArray(value.phases) ||
    !value.phases.every(
      (phase) => typeof phase === 'string' && PIPELINE_PHASES.includes(phase as PipelinePhase)
    )
  ) {
    return false
  }
  if (!isRecord(value.decomposition) || !isPositiveInteger(value.decomposition.maxNodes)) {
    return false
  }
  if (
    (value.decomposition.mode !== 'disabled' && value.decomposition.mode !== 'build-only') ||
    (value.decomposition.mode === 'disabled' && value.decomposition.maxNodes !== 1)
  ) {
    return false
  }
  if (!isRecord(value.limits)) return false
  const positiveLimits = [
    value.limits.maxProviderCalls,
    value.limits.maxFreshTokens,
    value.limits.maxTotalTokens,
    value.limits.maxAgents,
    value.limits.maxConcurrency,
    value.limits.maxDurationMs
  ]
  if (
    !positiveLimits.every(isPositiveInteger) ||
    !isNonNegativeInteger(value.limits.maxRecoveries) ||
    (value.limits.maxUsd !== null &&
      !(
        typeof value.limits.maxUsd === 'number' &&
        Number.isFinite(value.limits.maxUsd) &&
        value.limits.maxUsd >= 0
      ))
  ) {
    return false
  }
  if (value.allocation === undefined) return true
  if (!isRecord(value.allocation) || !isRecord(value.allocation.phaseMembers)) return false
  if (
    !Object.entries(value.allocation.phaseMembers).every(
      ([phase, count]) =>
        PIPELINE_PHASES.includes(phase as PipelinePhase) && isPositiveInteger(count)
    )
  ) {
    return false
  }
  return (
    isNonNegativeInteger(value.allocation.judgeMembers) &&
    isPositiveInteger(value.allocation.maxGreedyNodes) &&
    isNonNegativeInteger(value.allocation.reservedMandatoryAgents) &&
    isNonNegativeInteger(value.allocation.plannedMaxAgents) &&
    isNonNegativeInteger(value.allocation.plannedMaxCalls)
  )
}

/**
 * `estimatedMax*` s'appelle `plannedMax*` depuis le renommage du vocabulaire de couts. Ces deux
 * champs traversent une frontiere SERIALISEE : l'etat est ecrit en JSON sur disque et relu au
 * demarrage, et un etat qui echoue la validation est SILENCIEUSEMENT ignore. Un renommage nu
 * perdrait donc, sans un seul message, tout run en vol au moment du basculement.
 *
 * Migration TOLERANTE dans les DEUX sens, parce que la tolerance ne valait que pour la MONTEE :
 *  - MONTEE : on accepte l'ancien nom a la relecture et on normalise en memoire vers `plannedMax*`,
 *    qui reste la seule source de verite en LECTURE (priorite au nouveau nom).
 *  - DESCENTE : on ECRIT les DEUX jeux de noms (cf. `withLegacyAllocationMirror`). Sans ce miroir,
 *    un retour arriere du binaire perd en silence tout run en vol — exactement le defaut que cette
 *    migration se donnait pour raison d'etre, applique a la descente au lieu de la montee : le
 *    validateur d'avant EXIGE `estimatedMax*`, le fichier echoue la validation, et
 *    `loadOrchestrationStates` l'avale sans un message.
 *
 * Le miroir est TEMPORAIRE — fenetre de transition. Il pourra etre retire quand plus aucun rollback
 * vers un binaire anterieur a `77cbf012` ne sera envisage. Le retirer avant cela reproduira le
 * defaut a l'identique, et de facon INVISIBLE (aucune erreur, juste des runs disparus).
 */
function normalizeLegacyAllocationNames(value: unknown): void {
  if (!isRecord(value)) return
  const quote = value.executionQuote
  if (!isRecord(quote)) return
  const allocation = quote.allocation
  if (!isRecord(allocation)) return
  for (const [ancien, nouveau] of [
    ['estimatedMaxAgents', 'plannedMaxAgents'],
    ['estimatedMaxCalls', 'plannedMaxCalls']
  ] as const) {
    if (allocation[nouveau] === undefined && allocation[ancien] !== undefined) {
      allocation[nouveau] = allocation[ancien]
    }
    // Pas de `delete` de l'ancienne cle : c'est lui qui rendait le fichier reecrit illisible par le
    // binaire d'avant. L'ancien nom est un MIROIR, jamais une source de lecture.
  }
}

/**
 * Rend l'etat serialisable en portant l'allocation sous les DEUX vocabulaires. Miroir TEMPORAIRE,
 * meme fenetre de transition que `normalizeLegacyAllocationNames` : a retirer seulement quand plus
 * aucun rollback vers un binaire anterieur a `77cbf012` n'est envisage.
 */
function withLegacyAllocationMirror(state: OrchestrationRunState): OrchestrationRunState {
  const quote = state.executionQuote
  const allocation = quote?.allocation
  if (!quote || !allocation) return state
  return {
    ...state,
    executionQuote: {
      ...quote,
      allocation: {
        ...allocation,
        estimatedMaxAgents: allocation.plannedMaxAgents,
        estimatedMaxCalls: allocation.plannedMaxCalls
      } as typeof allocation
    }
  }
}

function isExecutionUsageSnapshot(value: unknown): value is ExecutionUsageSnapshot {
  if (!isRecord(value) || typeof value.quoteId !== 'string' || !value.quoteId.trim()) return false
  const counters = [
    value.startedCalls,
    value.completedCalls,
    value.failedCalls,
    value.activeCalls,
    value.inputTokens,
    value.outputTokens,
    value.cacheReadTokens,
    value.totalTokens,
    value.freshTokens,
    value.unpricedCalls,
    value.unmeteredCalls
  ]
  return (
    (value.startedAgents === undefined || isNonNegativeInteger(value.startedAgents)) &&
    counters.every(isNonNegativeInteger) &&
    (value.activeReservationIds === undefined ||
      (Array.isArray(value.activeReservationIds) &&
        value.activeReservationIds.every(isNonEmptyString) &&
        new Set(value.activeReservationIds).size === value.activeReservationIds.length &&
        value.activeReservationIds.length === value.activeCalls)) &&
    (value.knownCostUsd === null ||
      (typeof value.knownCostUsd === 'number' &&
        Number.isFinite(value.knownCostUsd) &&
        value.knownCostUsd >= 0)) &&
    (value.tokenCoverage === 'complete' || value.tokenCoverage === 'partial') &&
    (value.stoppedReason === undefined || typeof value.stoppedReason === 'string')
  )
}

function isRunAgentRef(
  value: unknown
): value is NonNullable<OrchestrationRunState['agents']>[number] {
  if (!isRecord(value) || typeof value.token !== 'string' || !value.token.trim()) return false
  return (
    (value.provider === undefined || typeof value.provider === 'string') &&
    (value.phase === undefined ||
      (typeof value.phase === 'string' &&
        PIPELINE_PHASES.includes(value.phase as PipelinePhase))) &&
    (value.active === undefined || typeof value.active === 'boolean') &&
    (value.fanOut === undefined || typeof value.fanOut === 'boolean') &&
    (value.reservationId === undefined || isNonEmptyString(value.reservationId)) &&
    (value.pid === undefined || isPositiveInteger(value.pid)) &&
    (value.identity === undefined || typeof value.identity === 'string') &&
    (value.journalPath === undefined || typeof value.journalPath === 'string') &&
    (value.offset === undefined || isNonNegativeInteger(value.offset))
  )
}

function hasConsistentActiveReservationLinks(value: Record<string, unknown>): boolean {
  const usage = value.usage as ExecutionUsageSnapshot | undefined
  const activeReservationIds = usage?.activeReservationIds
  if (activeReservationIds === undefined) return true // checkpoint historique
  const agents = (value.agents ?? []) as NonNullable<OrchestrationRunState['agents']>
  const linkedAgents = agents.filter((agent) => agent.reservationId !== undefined)
  if (new Set(linkedAgents.map((agent) => agent.reservationId)).size !== linkedAgents.length) {
    return false
  }
  const activeAgents = agents.filter((agent) => agent.active === true)
  if (activeAgents.length !== activeReservationIds.length) return false
  return activeReservationIds.every(
    (reservationId) =>
      activeAgents.filter((agent) => agent.reservationId === reservationId).length === 1
  )
}

function isForkOrigin(value: unknown): value is NonNullable<OrchestrationRunState['forkedFrom']> {
  if (!isRecord(value)) return false
  return (
    isNonEmptyString(value.checkpointId) &&
    isRunId(value.runId) &&
    isNonEmptyString(value.checkpointCreatedAt) &&
    Number.isFinite(Date.parse(value.checkpointCreatedAt)) &&
    isNonEmptyString(value.contentHash)
  )
}

function isResumeDisposition(
  value: unknown,
  currentRunId: string
): value is NonNullable<OrchestrationRunState['resumeDisposition']> {
  return (
    isRecord(value) &&
    value.kind === 'superseded-duplicate' &&
    isRunId(value.electedRunId) &&
    value.electedRunId !== currentRunId &&
    typeof value.decidedAt === 'number' &&
    Number.isFinite(value.decidedAt) &&
    value.decidedAt >= 0
  )
}

function isTerminalDisposition(
  value: unknown
): value is NonNullable<OrchestrationRunState['terminal']> {
  return (
    isRecord(value) &&
    value.status === 'interrupted' &&
    isNonEmptyString(value.reason) &&
    typeof value.decidedAt === 'number' &&
    Number.isFinite(value.decidedAt) &&
    value.decidedAt >= 0
  )
}

function isOrchestrationRunState(value: unknown): value is OrchestrationRunState {
  if (!isRecord(value)) return false
  return (
    isRunId(value.runId) &&
    isNonEmptyString(value.task) &&
    (value.conversationId === undefined || isNonEmptyString(value.conversationId)) &&
    (value.turnId === undefined || isNonEmptyString(value.turnId)) &&
    (value.forkedFrom === undefined || isForkOrigin(value.forkedFrom)) &&
    Array.isArray(value.phaseOutputs) &&
    value.phaseOutputs.every(isPhaseOutput) &&
    (value.bindingOverride === undefined || isRoleBinding(value.bindingOverride)) &&
    (value.runtimeSnapshot === undefined || isRuntimeSnapshot(value.runtimeSnapshot)) &&
    (value.executionQuote === undefined || isExecutionQuote(value.executionQuote)) &&
    (value.usage === undefined || isExecutionUsageSnapshot(value.usage)) &&
    (value.resumeDisposition === undefined ||
      isResumeDisposition(value.resumeDisposition, value.runId)) &&
    (value.terminal === undefined || isTerminalDisposition(value.terminal)) &&
    (value.agents === undefined ||
      (Array.isArray(value.agents) && value.agents.every(isRunAgentRef))) &&
    hasConsistentActiveReservationLinks(value) &&
    typeof value.startedAt === 'number' &&
    Number.isFinite(value.startedAt) &&
    value.startedAt >= 0 &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) &&
    value.updatedAt >= 0
  )
}

/** Un `runId` est un nom de fichier : on refuse tout ce qui pourrait sortir du dossier. */
function safeRunId(runId: string): string {
  if (!isRunId(runId)) throw new Error('runId invalide')
  return runId
}

function statePath(root: string, runId: string): string {
  return join(root, `${safeRunId(runId)}.json`)
}

export function saveOrchestrationState(root: string, state: OrchestrationRunState): void {
  safeRunId(state.runId)
  if (!isOrchestrationRunState(state)) {
    throw new Error('checkpoint orchestration causalement invalide')
  }
  mkdirSync(root, { recursive: true })
  // Écriture atomique : un kill au milieu d'un `writeFileSync` laisserait un JSON tronqué que la
  // reprise devrait jeter. On écrit à côté puis on renomme (rename = atomique sur le même volume).
  const target = statePath(root, state.runId)
  const temporary = `${target}.tmp`
  writeFileSync(temporary, JSON.stringify(withLegacyAllocationMirror(state)), 'utf8')
  // `rename` remplace la cible sur les plateformes supportées par Node. Supprimer d'abord le JSON
  // créerait une fenêtre de crash où seul le `.tmp` subsiste et où le loader perdrait le checkpoint.
  renameSync(temporary, target)
}

/**
 * Rend irreversible l'election d'un autre workflow pour la meme demande. L'agent eventuellement
 * actif reste dans le checkpoint pour etre draine, mais ce pipeline ne redeviendra jamais candidat.
 */
export function suppressOrchestrationPipeline(
  root: string,
  runId: string,
  electedRunId: string,
  nowMs = Date.now()
): OrchestrationRunState {
  const current = loadOrchestrationStates(root).find((candidate) => candidate.runId === runId)
  if (!current) throw new Error(`checkpoint orchestration absent ou invalide: ${runId}`)
  if (current.resumeDisposition) {
    if (current.resumeDisposition.electedRunId !== electedRunId) {
      throw new Error(
        `suppression de pipeline deja liee a ${current.resumeDisposition.electedRunId}`
      )
    }
    return current
  }
  const suppressed: OrchestrationRunState = {
    ...current,
    resumeDisposition: { kind: 'superseded-duplicate', electedRunId, decidedAt: nowMs },
    updatedAt: nowMs
  }
  saveOrchestrationState(root, suppressed)
  return suppressed
}

/**
 * Le spawn d'un agent arrive avant la fin de sa phase. Il faut donc checkpoint-er dans la même
 * écriture ses références de rattachement ET la réservation provider déjà active ; sinon un crash
 * entre les deux fait croire à la reprise que cet appel n'a jamais été lancé.
 */
export function saveOrchestrationAgentCheckpoint(
  root: string,
  runId: string,
  agents: NonNullable<OrchestrationRunState['agents']>,
  usage: ExecutionUsageSnapshot | undefined,
  nowMs = Date.now()
): OrchestrationRunState {
  const current = loadOrchestrationStates(root).find((candidate) => candidate.runId === runId)
  if (!current) {
    throw new Error(`checkpoint orchestration absent ou invalide: ${runId}`)
  }
  const updated: OrchestrationRunState = {
    ...current,
    agents,
    ...(usage ? { usage } : {}),
    updatedAt: nowMs
  }
  saveOrchestrationState(root, updated)
  return updated
}

export function clearOrchestrationState(root: string, runId: string): void {
  try {
    rmSync(statePath(root, runId), { force: true })
  } catch {
    /* déjà supprimé / dossier absent : rien à faire */
  }
}

/** États encore présents = runs qui n'ont jamais atteint leur clôture (l'app est morte avant). */
export function loadOrchestrationStates(root: string): OrchestrationRunState[] {
  if (!existsSync(root)) return []
  const states: OrchestrationRunState[] = []
  for (const entry of readdirSync(root)) {
    if (!entry.endsWith('.json')) continue
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(root, entry), 'utf8'))
      normalizeLegacyAllocationNames(parsed)
      if (isOrchestrationRunState(parsed) && entry === `${parsed.runId}.json`) states.push(parsed)
    } catch {
      // JSON tronqué par un crash : on ignore ce run plutôt que de perdre les autres.
    }
  }
  return states
}

/**
 * Run à reprendre = le plus récemment actif, et seulement s'il a DÉJÀ produit au moins une phase
 * (sans acquis, une reprise équivaut à relancer de zéro — c'est à l'utilisateur de le décider, pas
 * à l'app de dépenser des tokens à son insu). Rien à reprendre → `null`.
 */
export function pickOrchestrationToResume(
  states: readonly OrchestrationRunState[]
): OrchestrationRunState | null {
  // Deux situations à ne pas confondre :
  //  - AUCUNE phase enregistrée : le run est mort avant d'avoir produit quoi que ce soit. Il n'y a
  //    rien à sauter, donc rien à risquer : on le relance depuis le début plutôt que de PERDRE la
  //    tâche (c'est le cas le plus courant, la première phase étant la plus longue).
  //  - Des phases enregistrées mais TOUTES sans livrable (vu en réel) : les reprendre les ferait
  //    sauter sans avoir leur travail → pire que tout rejouer. Celui-là reste écarté.
  return electStartupOrchestrationResumes(states).elected[0] ?? null
}

/**
 * Tous les runs à reprendre au démarrage, dans l'ordre de priorité : travail déjà payé d'abord,
 * puis tâches mortes avant leur première phase. Les phases présentes mais vides restent exclues.
 */
/**
 * Un checkpoint est-il trop vieux pour etre repris ?
 *
 * Un run dont des appels provider sont ENCORE EN VOL echappe a la peremption quel que soit son age :
 * son verrou est ce qui empeche de le repayer en double, et une date ne doit jamais lever un verrou.
 */
function resumeCheckpointIsStale(state: OrchestrationRunState, nowMs: number): boolean {
  if ((state.usage?.activeCalls ?? 0) > 0) return false
  return resumeIsStale(state.updatedAt, nowMs)
}

/**
 * `nowMs` est OPTIONNEL a dessein : omis, aucune peremption n'est appliquee et le comportement est
 * exactement l'historique. Fourni par l'appelant (`os.resumableOrchestrations`), il ecarte les
 * checkpoints hantes — ce module n'a donc pas d'horloge cachee.
 */
export function pickOrchestrationsToResume(
  states: readonly OrchestrationRunState[],
  nowMs?: number
): OrchestrationRunState[] {
  const mostRecentFirst = (candidates: readonly OrchestrationRunState[]): OrchestrationRunState[] =>
    [...candidates].sort((left, right) => right.updatedAt - left.updatedAt)

  const resumable = states.filter(
    (state) =>
      state.terminal === undefined &&
      (nowMs === undefined || !resumeCheckpointIsStale(state, nowMs))
  )
  const suppressed = resumable.filter((state) => state.resumeDisposition !== undefined)
  const suppressedIds = new Set(suppressed.map((state) => state.runId))
  const activeLocks = resumable.filter(
    (state) => !suppressedIds.has(state.runId) && (state.usage?.activeCalls ?? 0) > 0
  )
  const activeIds = new Set(activeLocks.map((state) => state.runId))
  const withWork = resumable.filter(
    (state) =>
      !suppressedIds.has(state.runId) &&
      !activeIds.has(state.runId) &&
      state.phaseOutputs.some((output) => typeof output.text === 'string' && output.text.trim())
  )
  const neverStarted = resumable.filter(
    (state) =>
      !suppressedIds.has(state.runId) &&
      !activeIds.has(state.runId) &&
      state.phaseOutputs.length === 0
  )
  return [
    ...mostRecentFirst(activeLocks),
    ...mostRecentFirst(withWork),
    ...mostRecentFirst(neverStarted),
    ...mostRecentFirst(suppressed)
  ]
}

/** Normalise un libelle de tache pour comparer « la meme tache » ecrite a l'espace pres. */
export function normalizeTaskKey(task: string): string {
  return task.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Portee d'une reprise : une conversation et une demande canonique forment un seul workflow. */
export function orchestrationResumeScopeKey(state: OrchestrationRunState): string {
  return `${state.conversationId ?? '__autonomous__'}\u0000${normalizeTaskKey(state.task)}`
}

export interface StartupOrchestrationResumeElection {
  elected: OrchestrationRunState[]
  suppressed: Array<{ state: OrchestrationRunState; electedRunId: string }>
}

/**
 * Elit un seul workflow par demande au demarrage. Un provider encore actif gagne sur un simple
 * livrable, puis le checkpoint le plus recent gagne. Les autres occurrences restent observables :
 * l'appelant doit laisser finir leur provider eventuel, mais ne doit jamais relancer leur pipeline.
 */
export function electStartupOrchestrationResumes(
  states: readonly OrchestrationRunState[]
): StartupOrchestrationResumeElection {
  const candidates = pickOrchestrationsToResume(states)
  const alreadySuppressed = candidates.filter((candidate) => candidate.resumeDisposition)
  const contenders = candidates.filter((candidate) => !candidate.resumeDisposition)
  const byScope = new Map<string, OrchestrationRunState[]>()
  for (const candidate of contenders) {
    const key = orchestrationResumeScopeKey(candidate)
    byScope.set(key, [...(byScope.get(key) ?? []), candidate])
  }

  const winners = new Map<string, OrchestrationRunState>()
  for (const [key, group] of byScope) {
    winners.set(
      key,
      group.reduce((best, candidate) => {
        const bestActive = (best.usage?.activeCalls ?? 0) > 0
        const candidateActive = (candidate.usage?.activeCalls ?? 0) > 0
        if (candidateActive !== bestActive) return candidateActive ? candidate : best
        const bestHasWork = best.phaseOutputs.some((output) => output.text.trim())
        const candidateHasWork = candidate.phaseOutputs.some((output) => output.text.trim())
        if (candidateHasWork !== bestHasWork) return candidateHasWork ? candidate : best
        return candidate.updatedAt > best.updatedAt ? candidate : best
      })
    )
  }

  const electedIds = new Set([...winners.values()].map((state) => state.runId))
  const newlySuppressed = contenders
    .filter((candidate) => !electedIds.has(candidate.runId))
    .map((state) => ({
      state,
      electedRunId: winners.get(orchestrationResumeScopeKey(state))!.runId
    }))
  return {
    elected: contenders.filter((candidate) => electedIds.has(candidate.runId)),
    suppressed: [
      ...alreadySuppressed.map((state) => ({
        state,
        electedRunId: state.resumeDisposition!.electedRunId
      })),
      ...newlySuppressed
    ]
  }
}

export interface ResumeLookup {
  task: string
  /** Conversation d'origine ; un acquis d'une AUTRE conversation n'est jamais repris. */
  conversationId?: string
  /** Empêche de rejouer des phases produites par un autre modèle. */
  bindingOverride?: RoleBinding
  /** Topologie du nouveau run; requise hors override pour ne pas melanger des acquis de modeles. */
  runtimeSnapshot?: OrchestrationRuntimeSnapshot
  nowMs: number
  /** Au-dela, l'acquis est trop vieux pour etre reinjecte sans surprendre (defaut 24 h). */
  maxAgeMs?: number
}

const DEFAULT_RESUME_MAX_AGE_MS = 24 * 60 * 60 * 1_000

function bindingIdentity(binding: RoleBinding | undefined): string {
  if (!binding) return ''
  const phaseModel = Object.fromEntries(
    Object.entries(binding.phaseModel ?? {}).sort(([left], [right]) => left.localeCompare(right))
  )
  return JSON.stringify({
    provider: binding.provider,
    model: binding.model,
    reasoningEffort: binding.reasoningEffort,
    phaseModel
  })
}

function runtimeSnapshotIdentity(snapshot: OrchestrationRuntimeSnapshot | undefined): string {
  if (!snapshot) return ''
  const phaseFanOut = Object.fromEntries(
    Object.entries(snapshot.phaseFanOut)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([phase, bindings]) => [phase, (bindings ?? []).map(bindingIdentity)])
  )
  return JSON.stringify({
    roles: {
      orchestrator: bindingIdentity(snapshot.roles.orchestrator),
      subagent: bindingIdentity(snapshot.roles.subagent),
      judge: bindingIdentity(snapshot.roles.judge),
      scout: bindingIdentity(snapshot.roles.scout)
    },
    phaseFanOut,
    judgeFanOut: snapshot.judgeFanOut.map(bindingIdentity)
  })
}

/**
 * Migration explicite des checkpoints historiques : leur topologie n'existe pas sur disque, donc
 * on adopte celle qui vient d'etre admise, mais l'appelant doit ouvrir un NOUVEAU tour. L'ancienne
 * carte reste ainsi un fait historique et n'est jamais rebaptisee avec un modele actuel.
 */
export function resolveResumableRuntime(
  state: OrchestrationRunState,
  currentRuntime: OrchestrationRuntimeSnapshot
): {
  runtimeSnapshot: OrchestrationRuntimeSnapshot
  migratedLegacyCheckpoint: boolean
} {
  return state.runtimeSnapshot
    ? { runtimeSnapshot: state.runtimeSnapshot, migratedLegacyCheckpoint: false }
    : { runtimeSnapshot: currentRuntime, migratedLegacyCheckpoint: true }
}

export interface PersistedTurnRuntimeIdentity {
  provider: string
  model?: string
  reasoningEffort?: string
}

export interface LiveReattachmentAdmission {
  identityKnown: boolean
  resumeExisting: boolean
  turnId: string
  turnBinding?: RoleBinding
  task: string
}

function sameRuntimeIdentity(
  recorded: PersistedTurnRuntimeIdentity | undefined,
  expected: RoleBinding
): boolean {
  return (
    recorded?.provider === expected.provider &&
    recorded.model === expected.model &&
    recorded.reasoningEffort === expected.reasoningEffort
  )
}

/**
 * Admet le rattachement d'un processus encore vivant sans réécrire son identité historique.
 * Un checkpoint legacy ne transporte pas le provider réellement lancé : il ouvre donc un tour
 * explicitement inconnu. Un tour existant n'est réactivé que si sa carte correspond au snapshot.
 */
export function admitLiveReattachment(
  state: OrchestrationRunState,
  recordedTurnRuntime: PersistedTurnRuntimeIdentity | undefined,
  migrationTurnId: string
): LiveReattachmentAdmission {
  if (!state.runtimeSnapshot) {
    return {
      identityKnown: false,
      resumeExisting: false,
      turnId: migrationTurnId,
      task: `[Rattachement — identité provider inconnue] ${state.task}`
    }
  }

  const turnBinding = state.bindingOverride ?? state.runtimeSnapshot.roles.orchestrator
  const resumeExisting =
    Boolean(state.turnId) && sameRuntimeIdentity(recordedTurnRuntime, turnBinding)
  return {
    identityKnown: true,
    resumeExisting,
    turnId: resumeExisting ? state.turnId! : migrationTurnId,
    turnBinding,
    task: resumeExisting ? state.task : `[Rattachement automatique] ${state.task}`
  }
}

export interface AutomaticResumeRuntimeAdmission {
  runtimeSnapshot: OrchestrationRuntimeSnapshot
  migratedLegacyCheckpoint: boolean
  resumeExisting: boolean
  turnId: string
  turnBinding: RoleBinding
  task: string
  /** Ferme l'identite admise dans l'appel : carte et provider ne peuvent plus relire deux topologies. */
  run<T>(execute: (runtimeSnapshot: OrchestrationRuntimeSnapshot) => T | Promise<T>): Promise<T>
}

/**
 * Admission atomique d'une reprise automatique. Le plan visible de la carte et le snapshot remis au
 * provider sont derives une seule fois, puis transportes ensemble par `run`.
 */
export function admitAutomaticResumeRuntime(
  state: OrchestrationRunState,
  currentRuntime: OrchestrationRuntimeSnapshot,
  migrationTurnId: string,
  recordedTurnRuntime?: PersistedTurnRuntimeIdentity
): AutomaticResumeRuntimeAdmission {
  const resolved = resolveResumableRuntime(state, currentRuntime)
  const runtimeSnapshot = resolved.runtimeSnapshot
  const turnBinding = state.bindingOverride ?? runtimeSnapshot.roles.orchestrator
  const resumeExisting =
    Boolean(state.turnId) &&
    !resolved.migratedLegacyCheckpoint &&
    sameRuntimeIdentity(recordedTurnRuntime, turnBinding)
  return {
    ...resolved,
    resumeExisting,
    turnId: resumeExisting ? state.turnId! : migrationTurnId,
    turnBinding,
    task: resumeExisting ? state.task : `[Reprise automatique] ${state.task}`,
    run: async (execute) => execute(runtimeSnapshot)
  }
}

/**
 * Acquis reutilisable pour une tache RELANCEE depuis le chat.
 *
 * Le chemin de reprise n'existait qu'au REDEMARRAGE de l'app : quand l'utilisateur ecrit « reprend »
 * dans une conversation, la commande `orchestrate` relancait de zero et repayait les phases deja
 * produites (constate le 2026-07-29). Ce selecteur repond a « ai-je deja paye une partie de CETTE
 * tache, dans CETTE conversation, recemment ? ».
 *
 * Conditions CUMULATIVES, volontairement strictes — reinjecter un acquis fait SAUTER des phases, donc
 * un faux positif produit un livrable base sur du travail etranger :
 *  - meme tache (a la normalisation d'espaces pres) ;
 *  - meme conversation (un acquis sans conversation n'est pas repris ici : il appartient au demarrage) ;
 *  - au moins un livrable NON VIDE, OU un appel encore actif qui doit verrouiller la relance ;
 *  - moins de `maxAgeMs`.
 * Plusieurs candidats -> le plus recent.
 */
/**
 * Phases dont l'acquis est un TEXTE, donc réutilisable tel quel dans la même conversation.
 * `build` et `clean` en sont exclues par nature : leur acquis vit sur le disque, le workspace a pu
 * bouger depuis, et les rejouer est la seule façon honnête de savoir où en est le code.
 */
const PHASES_ANALYSE_REUTILISABLES: readonly PipelinePhase[] = ['scout', 'frame', 'terrain']

/**
 * Acquis d'analyse déjà produit DANS LA MÊME CONVERSATION, réutilisable même si le libellé de la
 * demande a changé.
 *
 * `pickResumeForTask` exige la même tâche à la clé près. Le parcours réel ne la respecte jamais :
 * mesuré sur `conv-1061`, l'utilisateur enchaîne « scout des améliorations de la vue Chat » puis
 * « Fais tout. Mène les chantiers retenus… ». Deux libellés, donc aucun acquis reconnu, donc le
 * scout est intégralement rejoué — 11,20 $ de scout+frame+terrain sur 15,16 $ de sous-agents.
 *
 * Ce relâchement est borné : même conversation, acquis non vide, fenêtre de fraîcheur de la
 * reprise, aucun appel encore actif (un verrou n'est pas un livrable), et la phase n'est pas
 * explicitement redemandée par l'utilisateur.
 */
export function pickAcquiredAnalysis(
  states: readonly OrchestrationRunState[],
  lookup: {
    conversationId: string | undefined
    task: string
    nowMs: number
    maxAgeMs?: number
  }
): Array<{ phase: PipelinePhase; text: string }> {
  if (!lookup.conversationId) return []
  const maxAge = lookup.maxAgeMs ?? DEFAULT_RESUME_MAX_AGE_MS
  // Une phase nommée dans la demande est un ordre de la rejouer, pas un acquis à recycler.
  const redemandees = new Set(
    PHASES_ANALYSE_REUTILISABLES.filter((phase) =>
      new RegExp(`(^|\\s)/${phase}\\b`, 'i').test(lookup.task)
    )
  )
  const utilisables = states
    .filter((state) => state.conversationId === lookup.conversationId)
    .filter((state) => (state.usage?.activeCalls ?? 0) === 0)
    .filter((state) => !state.resumeDisposition)
    .filter((state) => lookup.nowMs >= state.updatedAt && lookup.nowMs - state.updatedAt <= maxAge)
    .sort((a, b) => a.updatedAt - b.updatedAt)

  // Le plus récent gagne : on écrase au fil du tri croissant.
  const parPhase = new Map<PipelinePhase, string>()
  for (const state of utilisables) {
    for (const output of state.phaseOutputs ?? []) {
      if (!PHASES_ANALYSE_REUTILISABLES.includes(output.phase)) continue
      if (redemandees.has(output.phase)) continue
      if (typeof output.text !== 'string' || !output.text.trim()) continue
      parPhase.set(output.phase, output.text)
    }
  }
  return PHASES_ANALYSE_REUTILISABLES.filter((phase) => parPhase.has(phase)).map((phase) => ({
    phase,
    text: parPhase.get(phase) as string
  }))
}

export function pickResumeForTask(
  states: readonly OrchestrationRunState[],
  lookup: ResumeLookup
): OrchestrationRunState | null {
  if (!lookup.conversationId) return null
  const wanted = normalizeTaskKey(lookup.task)
  if (!wanted) return null
  const maxAge = lookup.maxAgeMs ?? DEFAULT_RESUME_MAX_AGE_MS
  const usable = states.filter((state) => {
    if (state.terminal) return false
    if (state.conversationId !== lookup.conversationId || normalizeTaskKey(state.task) !== wanted) {
      return false
    }
    // Un appel encore actif est un VERROU, pas un livrable à réutiliser. Il reste prioritaire
    // même si le modèle/topologie a changé ou si le délai de reprise a expiré : aucun de ces
    // changements ne prouve que l'ancien provider a cessé d'être facturé.
    if ((state.usage?.activeCalls ?? 0) > 0) return true
    if (state.resumeDisposition) return false
    return (
      bindingIdentity(state.bindingOverride) === bindingIdentity(lookup.bindingOverride) &&
      (lookup.bindingOverride !== undefined ||
        runtimeSnapshotIdentity(state.runtimeSnapshot) ===
          runtimeSnapshotIdentity(lookup.runtimeSnapshot)) &&
      lookup.nowMs - state.updatedAt <= maxAge &&
      lookup.nowMs >= state.updatedAt &&
      state.phaseOutputs.some((output) => typeof output.text === 'string' && output.text.trim())
    )
  })
  if (usable.length === 0) return null
  const activeLocks = usable.filter((state) => (state.usage?.activeCalls ?? 0) > 0)
  const candidates = activeLocks.length > 0 ? activeLocks : usable
  return candidates.reduce((best, state) => (state.updatedAt > best.updatedAt ? state : best))
}
