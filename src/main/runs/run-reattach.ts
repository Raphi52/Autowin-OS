import {
  loadOrchestrationStates,
  saveOrchestrationState,
  type OrchestrationRunState
} from './orchestration-state'
import { readFileSync } from 'node:fs'
import { survivableExitCode } from './stdout-journal'
import {
  claudeToolEvidenceKind,
  claudeToolResultText,
  claudeWrittenLineFingerprints
} from '../providers/claude'
import type { ExecutionEvidence } from '../providers/types'
import { normalizeClaudeUsage } from '../providers/claude'
import { codexExecutionEvidenceFromItem, type CodexExecItem } from '../providers/codex'
import { isSameProcessIdentity } from '../process-identity'

/**
 * Un run est-il encore EN TRAIN de travailler ailleurs ?
 *
 * Les CLI sont lancés détachés : ils survivent à la mort de l'app et continuent d'écrire dans leur
 * journal. Au redémarrage, la reprise relançait le run sans jamais poser cette question — donc deux
 * agents pouvaient travailler en parallèle sur la même copie, en s'écrasant l'un l'autre. C'est le
 * risque le plus grave de la survie, et il se ferme ici.
 *
 * Le PID seul ne suffit pas : le système les recycle. On compare l'EMPREINTE du processus (heure de
 * démarrage + chemin), capturée au lancement — sinon un processus étranger ayant hérité du numéro
 * ferait croire que notre agent vit encore, et le travail ne reprendrait jamais.
 */

/** Empreinte d'un processus vivant, `undefined` s'il est absent, `null` si la sonde ne sait pas. */
export type ProcessIdentity = (pid: number) => string | null | undefined

export type AgentState =
  | 'vivant'
  | 'termine'
  | 'pid-recycle'
  /** Agent enregistré avant que son pid ne soit connu : on ne peut rien affirmer. */
  | 'inconnu'

export interface AgentVerdict {
  token: string
  state: AgentState
}

/** Verdict pour UN agent. Ne lance jamais : une sonde qui échoue vaut « on ne sait pas ». */
export function agentVerdict(
  agent: { token: string; pid?: number; identity?: string },
  identityOf: ProcessIdentity
): AgentVerdict {
  if (!agent.pid) return { token: agent.token, state: 'inconnu' }
  let current: string | null | undefined
  try {
    current = identityOf(agent.pid)
  } catch {
    return { token: agent.token, state: 'inconnu' } // sonde en échec : on n'invente pas un verdict
  }
  if (current === undefined) return { token: agent.token, state: 'termine' }
  if (current === null) return { token: agent.token, state: 'inconnu' }
  // Sans empreinte capturée au lancement, on ne peut pas distinguer notre agent d'un pid recyclé.
  // On penche vers « vivant » : relancer par-dessus un agent réel coûte plus cher qu'attendre.
  if (!agent.identity) return { token: agent.token, state: 'vivant' }
  return {
    token: agent.token,
    state: isSameProcessIdentity(agent.identity, current) ? 'vivant' : 'pid-recycle'
  }
}

export interface RunLiveness {
  /** Au moins un agent travaille encore : NE PAS relancer ce run. */
  working: boolean
  agents: AgentVerdict[]
}

/** Verdict pour un run entier. Un seul agent vivant suffit à interdire la relance. */
export function runLiveness(
  state: Pick<OrchestrationRunState, 'agents'>,
  identityOf: ProcessIdentity
): RunLiveness {
  const agents = (state.agents ?? []).map((agent) => agentVerdict(agent, identityOf))
  return { working: agents.some((agent) => agent.state === 'vivant'), agents }
}

/**
 * Ce qu'il faut faire d'un run retrouvé au démarrage.
 *
 * `rattacher` — un agent travaille encore : on se rebranche sur son journal, on ne relance RIEN.
 * `relancer`  — plus personne ne travaille : comportement historique, reprise sur l'acquis.
 * `ignorer`   — rien à reprendre.
 */
export type ResumeAction = 'rattacher' | 'relancer' | 'bloquer' | 'ignorer'

function hasCertifiedRelayExit(agent: { journalPath?: string } | undefined): boolean {
  return Boolean(agent?.journalPath && survivableExitCode(agent.journalPath) !== undefined)
}

function hasCertifiedFailedRelayExit(agent: { journalPath?: string } | undefined): boolean {
  if (!agent?.journalPath) return false
  const exitCode = survivableExitCode(agent.journalPath)
  return exitCode !== undefined && exitCode !== 0
}

function hasCertifiedSuccessfulRelayExit(agent: { journalPath?: string } | undefined): boolean {
  return Boolean(agent?.journalPath && survivableExitCode(agent.journalPath) === 0)
}

function hasUncertainActiveAgent(
  state: Pick<OrchestrationRunState, 'agents'>,
  liveness: RunLiveness
): boolean {
  return (state.agents ?? []).some(
    (agent, index) =>
      agent.active !== false &&
      liveness.agents[index]?.state === 'inconnu' &&
      !hasCertifiedRelayExit(agent)
  )
}

/**
 * Le processus a disparu mais aucun sidecar ne certifie comment il s'est terminé. Le classer en
 * échec puis le relancer pourrait rejouer un appel qui a réellement fini et déjà été facturé.
 */
function hasUnprovenEndedActiveAgent(
  state: Pick<OrchestrationRunState, 'agents'>,
  liveness: RunLiveness
): boolean {
  return (state.agents ?? []).some(
    (agent, index) =>
      agent.active !== false &&
      (liveness.agents[index]?.state === 'termine' ||
        liveness.agents[index]?.state === 'pid-recycle') &&
      !hasCertifiedRelayExit(agent)
  )
}

/**
 * Depuis combien de temps le journal d'un agent n'a-t-il plus bougé ?
 *
 * `runLiveness` répond « ce processus EXISTE-t-il », ce qui n'est pas la même question que « cet
 * agent PRODUIT-il encore ». Un CLI bloqué sur un appel qui ne revient jamais garde son processus
 * vivant : le run est alors rattaché indéfiniment, aucune échéance ne le dépingle
 * (`deadlineAtMs` vit en mémoire dans l'ExecutionRuntime, et une reprise n'en arme aucune), et le
 * chat attend une réponse qui n'arrivera pas.
 *
 * Le journal est le seul témoin de production qu'on ait sur disque. `undefined` = on ne sait pas
 * (pas de journal, ou sonde en échec) — et on n'invente pas un verdict à partir d'une ignorance.
 */
export function agentSilenceMs(
  agent: { journalPath?: string },
  nowMs: number,
  lastWriteMs: (path: string) => number | undefined
): number | undefined {
  if (!agent.journalPath) return undefined
  let ecritA: number | undefined
  try {
    ecritA = lastWriteMs(agent.journalPath)
  } catch {
    return undefined // sonde en échec : on ne sait pas, on ne conclut pas
  }
  if (ecritA === undefined) return undefined
  return Math.max(0, nowMs - ecritA)
}

/**
 * Seuil au-delà duquel un agent vivant mais muet cesse d'être crédité d'un travail en cours.
 *
 * Généreux À DESSEIN : un agent peut légitimement rester silencieux pendant un appel outil long.
 * Se tromper en déclarant « muet » un agent qui travaille coûte un message inexact ; l'inverse — ce
 * qu'on avait — coûte une attente sans fin.
 */
export const SILENCE_TOLERE_MS = 10 * 60_000
/** Même horizon pour une reprise dont aucune preuve de processus ou de sortie n'arrive. */
export const MAX_REATTACH_PROBES = Math.ceil(SILENCE_TOLERE_MS / 1_000)

/**
 * Cet agent produit-il encore, pour de bon ?
 *
 * Distinct de `runLiveness` : un run peut être VIVANT (processus présent, donc à ne surtout pas
 * relancer par-dessus) et pourtant NE PLUS PRODUIRE. Les deux réponses commandent des choses
 * différentes — la première décide s'il faut relancer, la seconde ce qu'on a le droit de DIRE à
 * l'utilisateur.
 *
 * Ne rend jamais `false` sur une ignorance : sans journal lisible, on répond `true` (comportement
 * historique) plutôt que d'annoncer un arrêt qu'on n'a pas constaté.
 */
export function runIsProducing(
  state: Pick<OrchestrationRunState, 'agents'> | null | undefined,
  nowMs: number,
  lastWriteMs: (path: string) => number | undefined,
  seuilMs = SILENCE_TOLERE_MS
): boolean {
  const silences = (state?.agents ?? []).map((agent) => agentSilenceMs(agent, nowMs, lastWriteMs))
  const mesures = silences.filter((silence): silence is number => silence !== undefined)
  if (!mesures.length) return true // rien de mesurable : on n'affirme pas un arrêt
  return mesures.some((silence) => silence < seuilMs)
}

function strandedTokenReservation(
  cap: number,
  used: number,
  startedCalls: number,
  strandedCalls: number,
  maxProviderCalls: number
): number {
  const available = Math.max(0, cap - used)
  let reservation = 0
  const firstStrandedIndex = Math.max(0, startedCalls - strandedCalls)
  for (let callIndex = firstStrandedIndex; callIndex < startedCalls; callIndex += 1) {
    const remainingCalls = Math.max(1, maxProviderCalls - callIndex)
    // Le compteur courant peut déjà contenir des appels réglés après le spawn orphelin. Utiliser le
    // cap complet comme numérateur reste donc une borne haute de sa réservation originelle.
    reservation += Math.ceil(cap / remainingCalls)
  }
  return Math.min(available, reservation)
}

export function resumeActionFor(
  state: Pick<OrchestrationRunState, 'agents' | 'phaseOutputs'> | null | undefined,
  identityOf: ProcessIdentity
): ResumeAction {
  if (!state) return 'ignorer'
  const liveness = runLiveness(state, identityOf)
  if (liveness.working || hasUncertainActiveAgent(state, liveness)) return 'rattacher'
  if (hasUnprovenEndedActiveAgent(state, liveness)) return 'bloquer'
  return 'relancer'
}

/**
 * Réconcilie sur disque un appel resté « actif » parce que le process main est mort avant son
 * règlement. On ne libère le compteur que si CHAQUE agent enregistré est prouvé terminé/recyclé et
 * qu'il y a assez d'identités terminales pour couvrir tous les appels actifs. Au moindre doute, le
 * snapshot reste inchangé et le superviseur refusera la reprise plutôt que de doubler un provider.
 */
export function preparePersistedRunForRelaunch(
  root: string,
  runId: string,
  identityOf: ProcessIdentity,
  nowMs = Date.now(),
  onRecoveredUsage?: (settlement: RecoveredDetachedUsageSettlement) => void
): OrchestrationRunState | null {
  const state = loadOrchestrationStates(root).find((candidate) => candidate.runId === runId)
  if (!state?.usage || state.usage.activeCalls <= 0) return state ?? null

  const liveness = runLiveness(state, identityOf)
  // Un événement terminal peut être déjà flushé alors que le CLI finit encore sa fermeture.
  // Tant que le PID et son empreinte prouvent que CET agent vit, ne consommons ni le journal ni
  // l'appel actif : le rattachement reste propriétaire du règlement.
  if (liveness.working || hasUncertainActiveAgent(state, liveness)) return state
  // PID disparu sans sidecar : le provider a pu finir et facturer avant le crash du main. Cette
  // ignorance ne devient jamais une autorisation de relance.
  if (hasUnprovenEndedActiveAgent(state, liveness)) return state

  // Point d'entrée COMMUN à toutes les reprises (`relancer` immédiat ou après rattachement).
  // Un succès terminal du journal doit devenir un acquis avant que l'appel mort soit facturé comme
  // un échec. Le faire ici ferme les deux chemins sans dépendre du câblage de démarrage.
  const completed = settleCompletedDetachedPhase(root, runId, onRecoveredUsage)
  if (completed) return completed

  // Seule une sortie NON-ZERO certifiee autorise un retry : exit=0 signifie que le provider a pu
  // reussir et facturer, meme si son resultat est devenu illisible. Les checkpoints courants lient
  // chaque compteur actif a l'occurrence agent par reservationId : l'ordre du tableau, le fan-out
  // et un ancien echec ne peuvent donc jamais liberer le mauvais appel.
  const activeReservationIds = state.usage.activeReservationIds
  let failureIsProven = false
  let discardedSuccessfulFanOut = false
  let failedAgentTokens = new Set<string>()
  if (activeReservationIds) {
    const agents = state.agents ?? []
    const activeAgents = agents.filter((agent) => agent.active === true)
    const matchedAgents = activeReservationIds.flatMap((reservationId) =>
      agents.filter((agent) => agent.reservationId === reservationId)
    )
    failureIsProven =
      activeReservationIds.length === state.usage.activeCalls &&
      activeAgents.length === activeReservationIds.length &&
      matchedAgents.length === activeReservationIds.length &&
      activeReservationIds.every((reservationId) => {
        const matches = agents.filter((agent) => agent.reservationId === reservationId)
        if (matches.length !== 1 || matches[0].active !== true) return false
        const failed = hasCertifiedFailedRelayExit(matches[0])
        const completedFanOutWithoutAggregator =
          matches[0].fanOut === true && hasCertifiedSuccessfulRelayExit(matches[0])
        if (completedFanOutWithoutAggregator) discardedSuccessfulFanOut = true
        return failed || completedFanOutWithoutAggregator
      })
    if (failureIsProven) failedAgentTokens = new Set(matchedAgents.map((agent) => agent.token))
  } else {
    // Compatibilite prudente avec les checkpoints anterieurs a l'identite de reservation : aucune
    // inference d'ordre. Il faut exactement autant d'occurrences non reglees que d'appels actifs.
    const paidAgentTokens = new Set(
      state.phaseOutputs.flatMap((output) => (output.agentToken ? [output.agentToken] : []))
    )
    const unsettledAgents = (state.agents ?? []).filter(
      // Sans UUID, seule une occurrence explicitement encore active peut justifier le compteur.
      // Un agent historique inactif avec exit!=0 ne prouve rien sur l'appel actif sans provenance.
      (agent) => agent.active === true && !paidAgentTokens.has(agent.token)
    )
    failureIsProven =
      unsettledAgents.length === state.usage.activeCalls &&
      unsettledAgents.every((agent) => {
        const completedFanOutWithoutAggregator =
          agent.fanOut === true && hasCertifiedSuccessfulRelayExit(agent)
        if (completedFanOutWithoutAggregator) discardedSuccessfulFanOut = true
        return hasCertifiedFailedRelayExit(agent) || completedFanOutWithoutAggregator
      })
    if (failureIsProven) failedAgentTokens = new Set(unsettledAgents.map((agent) => agent.token))
  }
  if (!failureIsProven) return state

  const strandedCalls = state.usage.activeCalls
  const limits = state.executionQuote?.limits
  const totalReservation = limits
    ? strandedTokenReservation(
        limits.maxTotalTokens,
        state.usage.totalTokens,
        state.usage.startedCalls,
        strandedCalls,
        limits.maxProviderCalls
      )
    : 0
  const freshReservation = limits
    ? strandedTokenReservation(
        limits.maxFreshTokens,
        state.usage.freshTokens,
        state.usage.startedCalls,
        strandedCalls,
        limits.maxProviderCalls
      )
    : 0
  const reconciled: OrchestrationRunState = {
    ...state,
    agents: state.agents?.map((agent) => {
      if (!failedAgentTokens.has(agent.token)) return agent
      return { ...agent, reservationId: undefined, active: false }
    }),
    usage: {
      ...state.usage,
      failedCalls: state.usage.failedCalls + strandedCalls,
      activeCalls: 0,
      activeReservationIds: [],
      totalTokens: state.usage.totalTokens + totalReservation,
      freshTokens: state.usage.freshTokens + freshReservation,
      unpricedCalls: state.usage.unpricedCalls + strandedCalls,
      unmeteredCalls: state.usage.unmeteredCalls + strandedCalls,
      tokenCoverage: 'partial',
      stoppedReason: discardedSuccessfulFanOut
        ? `${strandedCalls} membre(s) fan-out termine(s) sans agregateur apres crash — phase a rejouer`
        : `${strandedCalls} appel(s) provider termine(s) sans reglement apres crash`
    },
    updatedAt: nowMs
  }
  saveOrchestrationState(root, reconciled)
  return reconciled
}

interface DetachedProviderSuccess {
  text: string
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
  }
  costUsd?: number
  executionEvidence?: ExecutionEvidence[]
}

function nonNegativeTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function safeCounterSum(...values: number[]): number | undefined {
  return nonNegativeTokenCount(values.reduce((sum, value) => sum + value, 0))
}

export interface RecoveredDetachedUsageSettlement {
  conversationId: string
  callId: string
  phase: OrchestrationRunState['phaseOutputs'][number]['phase']
  provider: string
  costUsd?: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

/**
 * Relit le résultat terminal d'un CLI Claude survivable.
 *
 * Cette lecture reste volontairement stricte : sans événement result explicitement réussi,
 * résultat texte et métriques, on ne fabrique aucun acquis et le chemin de reprise prudent demeure.
 */
function journalLines(journalPath: string): string[] | undefined {
  try {
    return readFileSync(journalPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return undefined
  }
}

function jsonRecord(line: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(line)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function detachedClaudeSuccess(lines: string[]): DetachedProviderSuccess | undefined {
  const executionEvidence = detachedClaudeEvidence(lines)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const event = jsonRecord(lines[index])
    if (!event) continue
    if (event.type !== 'result') continue
    if (
      event.subtype !== 'success' ||
      event.is_error !== false ||
      typeof event.result !== 'string' ||
      !event.result.trim()
    ) {
      return undefined
    }
    const rawUsage =
      event.usage && typeof event.usage === 'object' && !Array.isArray(event.usage)
        ? (event.usage as Record<string, unknown>)
        : undefined
    if (!rawUsage) return undefined
    const hasReportedCost = Object.prototype.hasOwnProperty.call(event, 'total_cost_usd')
    const usage = normalizeClaudeUsage(rawUsage, event.total_cost_usd, hasReportedCost)
    if (!usage) return undefined
    return {
      text: event.result.trim(),
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens ?? 0
      },
      ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
      ...(executionEvidence.length > 0 ? { executionEvidence } : {})
    }
  }
  return undefined
}

function detachedClaudeEvidence(lines: string[]): ExecutionEvidence[] {
  const evidence: ExecutionEvidence[] = []
  const pendingTools = new Map<
    string,
    { name: string; command: string; filePath: string; writtenLineFingerprints: string[] }
  >()
  for (const line of lines) {
    const event = jsonRecord(line)
    if (!event) continue
    const message =
      event.message && typeof event.message === 'object' && !Array.isArray(event.message)
        ? (event.message as Record<string, unknown>)
        : undefined
    const content = Array.isArray(message?.content) ? message.content : []
    if (event.type === 'assistant') {
      for (const rawPart of content) {
        if (!rawPart || typeof rawPart !== 'object' || Array.isArray(rawPart)) continue
        const part = rawPart as Record<string, unknown>
        if (
          part.type !== 'tool_use' ||
          typeof part.id !== 'string' ||
          typeof part.name !== 'string'
        ) {
          continue
        }
        const input =
          part.input && typeof part.input === 'object' && !Array.isArray(part.input)
            ? (part.input as Record<string, unknown>)
            : undefined
        const filePath = String(input?.file_path ?? '')
        pendingTools.set(part.id, {
          name: part.name,
          command: String(input?.command ?? filePath),
          filePath,
          writtenLineFingerprints: claudeWrittenLineFingerprints(input)
        })
      }
      continue
    }
    if (event.type !== 'user') continue
    for (const rawPart of content) {
      if (!rawPart || typeof rawPart !== 'object' || Array.isArray(rawPart)) continue
      const part = rawPart as Record<string, unknown>
      if (part.type !== 'tool_result' || typeof part.tool_use_id !== 'string') continue
      const call = pendingTools.get(part.tool_use_id)
      if (!call) continue
      pendingTools.delete(part.tool_use_id)
      const output = claudeToolResultText(part.content).slice(-20_000)
      evidence.push({
        type: call.name,
        kind: claudeToolEvidenceKind(call.name, call.command),
        status: part.is_error === true ? 'failed' : 'completed',
        ok: part.is_error !== true,
        summary: `${call.name} ${call.command}`.trim(),
        ...(call.filePath
          ? {
              path: call.filePath,
              paths: [call.filePath],
              ...(call.writtenLineFingerprints.length > 0
                ? { writtenLineFingerprints: call.writtenLineFingerprints }
                : {})
            }
          : call.command
            ? { command: call.command }
            : {}),
        ...(output ? { stdout: output } : {})
      })
    }
  }
  return evidence
}

function successfulRelayExit(journalPath: string): boolean {
  return survivableExitCode(journalPath) === 0
}

function detachedCodexSuccess(lines: string[]): DetachedProviderSuccess | undefined {
  let text = ''
  let usage: DetachedProviderSuccess['usage']
  const executionEvidence: ExecutionEvidence[] = []
  for (const line of lines) {
    const event = jsonRecord(line)
    if (!event) continue
    if (event.type === 'item.completed') {
      const item =
        event.item && typeof event.item === 'object' && !Array.isArray(event.item)
          ? (event.item as Record<string, unknown>)
          : undefined
      if (item?.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
        text = item.text.trim()
      } else if (item?.type && item.type !== 'reasoning') {
        executionEvidence.push(...codexExecutionEvidenceFromItem(item as CodexExecItem))
      }
    }
    if (event.type === 'turn.completed') {
      const hasUsage = Object.prototype.hasOwnProperty.call(event, 'usage')
      const raw =
        event.usage && typeof event.usage === 'object' && !Array.isArray(event.usage)
          ? (event.usage as Record<string, unknown>)
          : undefined
      if (!raw) {
        if (hasUsage) return undefined
        continue
      }
      const hasInput = Object.prototype.hasOwnProperty.call(raw, 'input_tokens')
      const hasOutput = Object.prototype.hasOwnProperty.call(raw, 'output_tokens')
      const hasCache = Object.prototype.hasOwnProperty.call(raw, 'cached_input_tokens')
      const inputTokens = hasInput ? nonNegativeTokenCount(raw.input_tokens) : undefined
      const outputTokens = hasOutput ? nonNegativeTokenCount(raw.output_tokens) : undefined
      const cacheReadTokens = hasCache ? nonNegativeTokenCount(raw.cached_input_tokens) : undefined
      if (
        (hasInput && inputTokens === undefined) ||
        (hasOutput && outputTokens === undefined) ||
        (hasCache && cacheReadTokens === undefined)
      ) {
        return undefined
      }
      // Codex peut omettre une partie de l'usage. On ne fabrique aucun zéro : l'appel devient
      // entièrement non mesuré. Une valeur PRÉSENTE mais invalide reste, elle, une preuve corrompue.
      if (!hasInput || !hasOutput || !hasCache) {
        usage = undefined
        continue
      }
      if (
        inputTokens === undefined ||
        outputTokens === undefined ||
        cacheReadTokens === undefined ||
        cacheReadTokens > inputTokens
      ) {
        return undefined
      }
      usage = { inputTokens, outputTokens, cacheReadTokens }
    }
  }
  return text
    ? {
        text,
        ...(usage ? { usage } : {}),
        ...(executionEvidence.length > 0 ? { executionEvidence } : {})
      }
    : undefined
}

function kimiTextFromJournalEvent(event: Record<string, unknown>): string {
  if (typeof event.delta === 'string') return event.delta
  if (typeof event.text === 'string') return event.text
  if (typeof event.message === 'string') return event.message
  if (!event.message || typeof event.message !== 'object' || Array.isArray(event.message)) return ''
  const content = (event.message as Record<string, unknown>).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object' || Array.isArray(part)) return ''
      return typeof (part as Record<string, unknown>).text === 'string'
        ? String((part as Record<string, unknown>).text)
        : ''
    })
    .join('')
}

function detachedKimiSuccess(lines: string[]): DetachedProviderSuccess | undefined {
  const text = lines
    .map(jsonRecord)
    .filter((event): event is Record<string, unknown> => Boolean(event))
    .map(kimiTextFromJournalEvent)
    .join('')
    .trim()
  return text ? { text } : undefined
}

function detachedGeminiSuccess(lines: string[]): DetachedProviderSuccess | undefined {
  const text = lines.join('\n').trim()
  return text ? { text } : undefined
}

function detachedProviderSuccess(
  provider: string,
  journalPath: string
): DetachedProviderSuccess | undefined {
  if (!successfulRelayExit(journalPath)) return undefined
  const lines = journalLines(journalPath)
  if (!lines) return undefined
  if (provider === 'claude') return detachedClaudeSuccess(lines)
  if (provider === 'codex') return detachedCodexSuccess(lines)
  if (provider === 'gemini') return detachedGeminiSuccess(lines)
  if (provider === 'kimi') return detachedKimiSuccess(lines)
  return undefined
}

function detachedSingleAgent(state: OrchestrationRunState): {
  agent: NonNullable<OrchestrationRunState['agents']>[number]
  phase: OrchestrationRunState['phaseOutputs'][number]['phase']
} | null {
  const agents = state.agents ?? []
  const declaredActive = agents.filter((agent) => agent.active === true)
  if (declaredActive.length > 0) {
    if (declaredActive.length !== 1) return null
    const agent = declaredActive[0]
    if (!agent.journalPath || !agent.phase || agent.fanOut !== false) return null
    return { agent, phase: agent.phase }
  }

  // Fenêtre étroite : le processus a rendu son résultat puis annoncé sa sortie, mais la boucle main
  // n'a pas encore persisté `phaseOutputs`. L'occurrence de CLI single en excès désigne ce résultat.
  const paidTokens = new Set(
    state.phaseOutputs.flatMap((output) => (output.agentToken ? [output.agentToken] : []))
  )
  const candidates: Array<{
    agent: NonNullable<OrchestrationRunState['agents']>[number]
    phase: OrchestrationRunState['phaseOutputs'][number]['phase']
  }> = []
  for (const agent of agents) {
    if (
      agent.phase &&
      agent.fanOut === false &&
      agent.journalPath &&
      !paidTokens.has(agent.token)
    ) {
      candidates.push({ agent, phase: agent.phase })
    }
  }
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1) return null

  // Un ancien checkpoint sans attribution ne permet pas de savoir quelle occurrence du graphe a
  // réellement produit le journal. Déduire la phase depuis le devis pourrait solder la mauvaise
  // branche : on refuse donc le règlement et laisse le chemin prudent de reprise prendre la main.
  return null
}

/**
 * Règle le cas exact « main Electron mort, CLI détaché terminé avec succès ».
 *
 * Un seul appel actif et un seul journal sont exigés : agréger un fan-out après crash demanderait
 * de rejouer son agrégateur et ne peut pas être déduit honnêtement ici. Si ces preuves manquent, le
 * comportement conservateur historique (appel classé échoué puis relancé) reste inchangé.
 */
export function settleCompletedDetachedPhase(
  root: string,
  runId: string,
  onRecoveredUsage?: (settlement: RecoveredDetachedUsageSettlement) => void
): OrchestrationRunState | null {
  const state = loadOrchestrationStates(root).find((candidate) => candidate.runId === runId)
  if (!state?.usage || state.usage.activeCalls !== 1) return null
  const attribution = detachedSingleAgent(state)
  if (!attribution?.agent.journalPath || !attribution.agent.provider) return null
  if (
    state.usage.activeReservationIds &&
    (state.usage.activeReservationIds.length !== 1 ||
      attribution.agent.reservationId !== state.usage.activeReservationIds[0])
  ) {
    return null
  }
  const { phase } = attribution
  const success = detachedProviderSuccess(attribution.agent.provider, attribution.agent.journalPath)
  if (!success) return null

  const prior = state.usage
  const measured = success.usage
  const limits = state.executionQuote?.limits
  const totalReservation =
    !measured && limits
      ? strandedTokenReservation(
          limits.maxTotalTokens,
          prior.totalTokens,
          prior.startedCalls,
          1,
          limits.maxProviderCalls
        )
      : 0
  const freshReservation =
    !measured && limits
      ? strandedTokenReservation(
          limits.maxFreshTokens,
          prior.freshTokens,
          prior.startedCalls,
          1,
          limits.maxProviderCalls
        )
      : 0
  const completedCalls = safeCounterSum(prior.completedCalls, 1)
  const inputTokens = safeCounterSum(prior.inputTokens, measured?.inputTokens ?? 0)
  const outputTokens = safeCounterSum(prior.outputTokens, measured?.outputTokens ?? 0)
  const cacheReadTokens = safeCounterSum(prior.cacheReadTokens, measured?.cacheReadTokens ?? 0)
  const totalTokens = safeCounterSum(
    prior.totalTokens,
    measured ? measured.inputTokens + measured.outputTokens : totalReservation
  )
  const freshTokens = safeCounterSum(
    prior.freshTokens,
    measured
      ? measured.inputTokens - measured.cacheReadTokens + measured.outputTokens
      : freshReservation
  )
  const unpricedCalls = safeCounterSum(prior.unpricedCalls, success.costUsd === undefined ? 1 : 0)
  const unmeteredCalls = safeCounterSum(prior.unmeteredCalls, measured ? 0 : 1)
  if (
    completedCalls === undefined ||
    inputTokens === undefined ||
    outputTokens === undefined ||
    cacheReadTokens === undefined ||
    totalTokens === undefined ||
    freshTokens === undefined ||
    unpricedCalls === undefined ||
    unmeteredCalls === undefined
  ) {
    return null
  }
  let knownCostUsd = prior.knownCostUsd
  if (success.costUsd !== undefined) {
    const priorCost = prior.knownCostUsd ?? 0
    const accumulatedCost = priorCost + success.costUsd
    if (!Number.isFinite(accumulatedCost) || accumulatedCost < 0) return null
    if (success.costUsd > 0 && accumulatedCost <= priorCost) return null
    knownCostUsd = accumulatedCost
  }
  const settled: OrchestrationRunState = {
    ...state,
    phaseOutputs: [
      ...state.phaseOutputs,
      {
        phase,
        text: success.text,
        agentToken: attribution.agent.token,
        ...(success.executionEvidence?.length
          ? { executionEvidence: success.executionEvidence }
          : {})
      }
    ],
    agents: state.agents?.map((agent) => {
      if (agent.token !== attribution.agent.token) return agent
      return { ...agent, reservationId: undefined, active: false }
    }),
    usage: {
      ...prior,
      completedCalls,
      activeCalls: 0,
      activeReservationIds: [],
      inputTokens,
      outputTokens,
      cacheReadTokens,
      totalTokens,
      freshTokens,
      knownCostUsd,
      unpricedCalls,
      unmeteredCalls,
      tokenCoverage: unmeteredCalls > 0 ? 'partial' : 'complete'
    },
    updatedAt: Date.now()
  }
  if (state.conversationId && onRecoveredUsage) {
    // Publier AVANT le checkpoint : si le process retombe ici, le même règlement sera rejoué avec
    // le même callId et la comptabilité le dédupliquera. Sauver d'abord créerait une perte durable.
    onRecoveredUsage({
      conversationId: state.conversationId,
      callId: `detached:${runId}:${attribution.agent.token}`,
      phase,
      provider: attribution.agent.provider,
      ...(success.costUsd === undefined ? {} : { costUsd: success.costUsd }),
      inputTokens: inputTokens - (prior.inputTokens ?? 0),
      outputTokens: outputTokens - (prior.outputTokens ?? 0),
      cacheReadTokens: cacheReadTokens - (prior.cacheReadTokens ?? 0)
    })
  }
  saveOrchestrationState(root, settled)
  return settled
}

function pauseBeforeLivenessProbe(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1_000)
    timer.unref?.()
  })
}

/**
 * Attend qu'un agent détaché se termine puis rend immédiatement la prochaine action. Sans cette
 * surveillance, une app rouverte pendant que le CLI vit encore reste bloquée jusqu'au redémarrage
 * suivant : elle s'est « rattachée » une fois, mais personne ne reprend la suite du workflow.
 */
export async function waitUntilRunCanResume(
  readAction: () => ResumeAction,
  pause: () => Promise<void> = pauseBeforeLivenessProbe,
  maxRattacherProbes = MAX_REATTACH_PROBES
): Promise<Exclude<ResumeAction, 'rattacher'>> {
  if (!Number.isSafeInteger(maxRattacherProbes) || maxRattacherProbes < 1) {
    throw new Error('nombre maximal de sondes invalide')
  }
  let probes = 0
  for (;;) {
    const action = readAction()
    if (action !== 'rattacher') return action
    // Expirer l'ATTENTE ne vaut jamais preuve de mort : on rend `ignorer`, donc aucun provider
    // n'est relancé. L'appel actif reste dans son checkpoint et le démarrage publie un échec durable.
    if (probes >= maxRattacherProbes) return 'ignorer'
    await pause()
    probes += 1
  }
}
