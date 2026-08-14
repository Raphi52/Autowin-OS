import {
  reduceChatTurn,
  type ChatTurnEvent,
  type ChatTurnStatus,
  type PersistedChatActionPart,
  type PersistedChatArtifactPart,
  type PersistedChatErrorPart,
  type PersistedChatPart,
  type PersistedChatTextPart
} from '../../../shared/chat-turn'
import { parseAskChoices } from './ask-choices'
import { parseScoutSuggestions, type SuggestionGroup } from './scout-suggestions'
import { parseScoutTable, type ScoutRow } from './scout-table'
import { extraireCandidatsAffiches, texteSansChargeJson, type CandidatAffiche } from './veille-candidats-message'
import type { PilotEventKind } from '../../../shared/pilot-events'
import {
  AUTHORITATIVE_ORCHESTRATION_CLOSURE_PREFIX,
  authoritativeOrchestrationClosureSpan,
  hasAuthoritativeDeliveredClosingBlock,
  isAuthoritativeOrchestrationClosureLine,
  isDeliveredOrchestrationOutcome,
  markdownCodeContinuationPrefixes,
  markdownCodeLineProtection,
  ORCHESTRATION_ALREADY_ISSUED_REFUSAL,
  reconcileClosedOrchestrationTextParts,
  removeAuthoritativeDeliveredClosingBlock,
  rewriteUnprotectedMarkdownLines,
  type OrchestrationOutcome
} from '../../../shared/orchestration-outcome'

export type ChatActionPart = PersistedChatActionPart
export type ChatArtifactPart = PersistedChatArtifactPart
export type ChatErrorPart = PersistedChatErrorPart
export type ChatTextPart = PersistedChatTextPart & {
  /** Contexte de fence calculé pour le rendu seulement — jamais persisté. */
  markdownContinuationPrefix?: string
}
export type ChatPart = PersistedChatPart
type ChatDisplayPart = ChatTextPart | ChatActionPart | ChatArtifactPart | ChatErrorPart
export type ChatActivityBlock = { kind: 'activity'; actions: ChatActionPart[] }
export type ChatSuggestionsBlock = { kind: 'suggestions'; groups: SuggestionGroup[] }
export type ChatScoutTableBlock = { kind: 'scout-table'; rows: ScoutRow[] }
export type ChatCandidatsPickBlock = { kind: 'candidats-pick'; candidats: CandidatAffiche[] }
export type ChatRenderBlock =
  | ChatTextPart
  | ChatArtifactPart
  | ChatErrorPart
  | ChatActivityBlock
  | ChatSuggestionsBlock
  | ChatScoutTableBlock
  | ChatCandidatsPickBlock

export interface HydratedAssistantMessage {
  role: 'assistant'
  turnId?: string
  /** Conversation qui possede le journal de ce tour (message copie par un fork). */
  turnConversationId?: string
  parts: ChatPart[]
  status: ChatTurnStatus
  done: boolean
  error?: string
  /**
   * Raisonnement LIVE du modèle pendant qu'il réfléchit — TRANSITOIRE : jamais persisté, jamais
   * mêlé à la réponse. Sert à montrer l'activité durant les secondes précédant le premier mot.
   */
  reasoning?: string
}

export interface StoredAssistantMessage {
  content: string
  turnId?: string
  turnConversationId?: string
  parts?: ChatPart[]
  status?: ChatTurnStatus
  error?: string
}

export type ConversationStateKey =
  'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled' | 'waiting' | 'empty'

export interface ConversationState {
  key: ConversationStateKey
  label: string
  detail: string
  glyph: string
}

export function deriveConversationState(input: {
  busy: boolean
  messageCount: number
  lastMessageRole?: 'user' | 'assistant'
  lastAssistantStatus?: ChatTurnStatus
}): ConversationState {
  if (input.busy || input.lastAssistantStatus === 'streaming') {
    return {
      key: 'running',
      label: 'En cours',
      detail: 'Réponse en cours de génération',
      glyph: ''
    }
  }
  if (input.lastMessageRole === 'user') {
    return {
      key: 'waiting',
      label: 'Sans réponse',
      detail: 'Le dernier message utilisateur est sans réponse',
      glyph: '·'
    }
  }
  if (input.lastAssistantStatus === 'failed') {
    return { key: 'failed', label: 'Erreur', detail: 'Le dernier tour a échoué', glyph: '!' }
  }
  if (input.lastAssistantStatus === 'interrupted') {
    return {
      key: 'interrupted',
      label: 'Interrompue',
      detail: 'Le dernier tour a été interrompu',
      glyph: 'Ⅱ'
    }
  }
  if (input.lastAssistantStatus === 'cancelled') {
    return {
      key: 'cancelled',
      label: 'Arrêtée',
      detail: 'Le dernier tour a été arrêté',
      glyph: '×'
    }
  }
  if (input.lastAssistantStatus === 'completed') {
    return { key: 'completed', label: 'À jour', detail: 'Le dernier tour est terminé', glyph: '✓' }
  }
  if (input.messageCount === 0) {
    return { key: 'empty', label: 'Vide', detail: 'Aucun message', glyph: '○' }
  }
  return {
    key: 'waiting',
    label: 'Sans réponse',
    detail: 'Le dernier message utilisateur est sans réponse',
    glyph: '·'
  }
}

export interface AssistantPilotEvent {
  turnId?: string
  /**
   * Vocabulaire partagé (`src/shared/pilot-events.ts`). C'était la TROISIÈME liste recopiée à la main
   * — le main en déclarait 12, celle-ci 11 (`prompt-call` manquant), celle de `ChatView` 10. Aucune
   * ne compilait contre les autres : la frontière IPC casse, et le réducteur ci-dessous ne réagit
   * qu'aux kinds qu'il reconnaît, donc un kind absent de la liste se traduisait par un silence.
   */
  kind: PilotEventKind
  streamId?: string
  actionId?: string
  iteration?: number
  text?: string
  name?: string
  args?: unknown
  ok?: boolean
  data?: unknown
  artifact?: PersistedChatArtifactPart['artifact']
}

/**
 * Réconcilie l'état DÉRIVÉ des actions d'un tour terminé : une action sans résultat n'est pas
 * « en cours », elle est INTERROMPUE (le tour est clos, son issue ne viendra jamais). Sans ça,
 * l'indicateur « N action en cours » restait collé indéfiniment — y compris après un redémarrage.
 */
export function settleUnresolvedActions(parts: ChatPart[]): ChatPart[] {
  let changed = false
  const settled = parts.map((part) => {
    if (part.kind !== 'action' || part.ok !== undefined || part.interrupted) return part
    changed = true
    return { ...part, interrupted: true }
  })
  return changed ? settled : parts
}

/**
 * Impose l'invariant « un tour `done` n'a plus rien en cours » sur un message VIVANT.
 *
 * `hydrateStoredAssistant` le faisait deja a la relecture disque, mais pas la session vivante : les
 * trois sites qui closent un tour (annule, echoue, termine) posaient `done = true` en laissant les
 * actions sans resultat. Consequences constatees le 2026-07-30 : l'indicateur « N action en cours »
 * restait colle, et le bouton « Reprendre » n'apparaissait qu'apres un REDEMARRAGE de l'app — alors
 * que c'est precisement le moment ou l'on veut relancer.
 *
 * Rend le message TEL QUEL quand rien ne change : `patchLast` ecrit dans un etat React, une nouvelle
 * reference a chaque passe declencherait des rendus inutiles.
 */
export function settleIfDone(message: HydratedAssistantMessage): HydratedAssistantMessage {
  if (!message.done) return message
  const parts = settleUnresolvedActions(message.parts)
  return parts === message.parts ? message : { ...message, parts }
}

function duplicateAuthoritativeClosureIndex(line: string): number | undefined {
  let searchFrom = AUTHORITATIVE_ORCHESTRATION_CLOSURE_PREFIX.length
  while (searchFrom < line.length) {
    const index = line.indexOf(AUTHORITATIVE_ORCHESTRATION_CLOSURE_PREFIX, searchFrom)
    if (index < 0) return undefined
    const before = line[index - 1]
    const suffix = line.slice(index + AUTHORITATIVE_ORCHESTRATION_CLOSURE_PREFIX.length)
    if (/\s/u.test(before) && (suffix === '' || /^\s*[.;]/u.test(suffix))) return index
    searchFrom = index + AUTHORITATIVE_ORCHESTRATION_CLOSURE_PREFIX.length
  }
  return undefined
}

function withoutPersistedAuthoritativeClosure(line: string): string | undefined {
  let reconciled = line
  let changed = false
  for (;;) {
    const closure = authoritativeOrchestrationClosureSpan(reconciled)
    if (!closure) break
    const leadingDecorationOnly = isAuthoritativeOrchestrationClosureLine(reconciled)
    const before = (leadingDecorationOnly ? '' : reconciled.slice(0, closure.start))
      .replace(/\s*[,;:|·/—-]\s*$/u, '')
      .trimEnd()
    const after = reconciled
      .slice(closure.end)
      .replace(/^\s*(?:(?:\*\*|__|~~|\*|_)\s*)+/u, '')
      .replace(/^\s*[,;:|·/—-]\s*/u, '')
      .trimStart()
    reconciled = [before, after].filter(Boolean).join(' ')
    changed = true
  }
  if (!changed) return line
  const useful = reconciled.trim()
  return useful && !/^(?:\*\*|__|~~|\*|_)$/u.test(useful) ? useful : undefined
}

function removePersistedAuthoritativeClosures(parts: ChatPart[]): ChatPart[] {
  let changed = false
  const textParts = parts.filter((part): part is ChatTextPart => part.kind === 'text')
  const protectedLines = markdownCodeLineProtection(textParts.map((part) => part.text))
  let textIndex = 0
  const reconciled = parts.flatMap((part): ChatPart[] => {
    if (part.kind !== 'text') return [part]
    const text = rewriteUnprotectedMarkdownLines(
      part.text,
      protectedLines[textIndex++],
      withoutPersistedAuthoritativeClosure
    )
    const withoutDeliveredFooter = removeAuthoritativeDeliveredClosingBlock(text)
    if (withoutDeliveredFooter === part.text) return [part]
    changed = true
    return withoutDeliveredFooter ? [{ ...part, text: withoutDeliveredFooter }] : []
  })
  return changed ? reconciled : parts
}

function reconcileStoredOrchestrationClosure(parts: ChatPart[]): ChatPart[] {
  let actionIndex = -1
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (
      part.kind === 'action' &&
      part.name === 'orchestrate' &&
      !(
        part.ok === false &&
        typeof part.data === 'string' &&
        part.data === ORCHESTRATION_ALREADY_ISSUED_REFUSAL
      )
    ) {
      actionIndex = index
      break
    }
  }
  const action = actionIndex >= 0 ? parts[actionIndex] : undefined
  if (action?.kind !== 'action') return parts
  if (action.ok !== true || !action.data || typeof action.data !== 'object') {
    return removePersistedAuthoritativeClosures(parts)
  }

  const outcome = action.data as OrchestrationOutcome
  if (!isDeliveredOrchestrationOutcome(outcome)) return removePersistedAuthoritativeClosures(parts)
  const textIndexes = parts.flatMap((part, index) => (part.kind === 'text' ? [index] : []))
  const mutableTextStart = textIndexes.findIndex((index) => index > actionIndex)
  const storedTexts = textIndexes.map((index) => (parts[index] as ChatTextPart).text)
  const authoritativeFooterAlreadyPersisted = storedTexts.some((text, index) => {
    const partIndex = textIndexes[index]
    return partIndex > actionIndex && hasAuthoritativeDeliveredClosingBlock(text)
  })
  const reconciledText = authoritativeFooterAlreadyPersisted
    ? storedTexts
    : reconcileClosedOrchestrationTextParts(
        storedTexts,
        outcome,
        mutableTextStart < 0 ? textIndexes.length : mutableTextStart
      )
  const textByIndex = new Map(
    textIndexes.map((index, position) => [index, reconciledText[position]])
  )
  const candidateParts = parts.map((part, index) => {
    if (part.kind !== 'text') return part
    const text = textByIndex.get(index) ?? part.text
    return text === part.text ? part : { ...part, text }
  })
  let changed = candidateParts.some((part, index) => part !== parts[index])
  // Le nouveau footer autoritaire EST la clôture. Ne lui ajoute pas l'ancienne phrase synthétique
  // après coup, notamment au rechargement d'un `/skill` sans orientation tardive.
  let closureSeen = authoritativeFooterAlreadyPersisted
  const protectedLines = markdownCodeLineProtection(
    candidateParts
      .filter((part): part is ChatTextPart => part.kind === 'text')
      .map((part) => part.text)
  )
  let textIndex = 0
  const reconciled = candidateParts.flatMap((part): ChatPart[] => {
    if (part.kind !== 'text') return [part]
    const uniqueText = rewriteUnprotectedMarkdownLines(
      part.text,
      protectedLines[textIndex++],
      (line) => {
        if (!isAuthoritativeOrchestrationClosureLine(line)) return line
        if (closureSeen) return undefined
        closureSeen = true
        const duplicate = duplicateAuthoritativeClosureIndex(line)
        if (duplicate === undefined) return line
        const beforeDuplicate = line.slice(0, duplicate).trimEnd()
        return beforeDuplicate || undefined
      }
    )
    if (uniqueText === part.text) return [part]
    changed = true
    return uniqueText ? [{ ...part, text: uniqueText }] : []
  })
  if (!closureSeen) {
    reconciled.push({
      kind: 'text',
      text: 'Clôture Autowin : gate validé, RUN fermé green ; publication terminée.'
    })
    changed = true
  }
  return changed ? reconciled : parts
}

export function hydrateStoredAssistant(message: StoredAssistantMessage): HydratedAssistantMessage {
  const status = message.status ?? (message.error ? 'failed' : 'completed')
  const done = status !== 'streaming'
  const parts =
    message.parts?.map((part) => ({ ...part })) ??
    (message.content ? [{ kind: 'text' as const, text: message.content }] : [])
  const terminalParts = done
    ? status === 'completed'
      ? reconcileStoredOrchestrationClosure(settleUnresolvedActions(parts))
      : removePersistedAuthoritativeClosures(settleUnresolvedActions(parts))
    : parts
  return {
    role: 'assistant',
    ...(message.turnId ? { turnId: message.turnId } : {}),
    // Transporte le proprietaire du journal : sans lui, la loupe d'un message copie chercherait
    // le tour sous le fork, ou il n'existe pas.
    ...(message.turnConversationId ? { turnConversationId: message.turnConversationId } : {}),
    // Tour déjà clos à la relecture (dont : app fermée en plein run) → plus rien « en cours ».
    parts: terminalParts,
    status,
    done,
    ...(message.error ? { error: message.error } : {})
  }
}

export function reduceAssistantPilotEvent(
  message: HydratedAssistantMessage,
  event: AssistantPilotEvent
): HydratedAssistantMessage {
  if (message.done && !message.turnId) return message
  if (message.turnId && event.turnId && message.turnId !== event.turnId) return message
  const turnId = message.turnId ?? event.turnId ?? 'pending'
  // Raisonnement live : accumulé HORS parts (transitoire, non persisté) et borné pour ne pas
  // gonfler indéfiniment sur un long raisonnement — on garde la fin, la plus informative.
  if (event.kind === 'reasoning' && event.text) {
    const merged = `${message.reasoning ?? ''}${event.text}`
    return { ...message, turnId, reasoning: merged.slice(-4_000) }
  }
  let turnEvent: ChatTurnEvent | undefined
  if (event.kind === 'delta' && event.text && event.streamId)
    turnEvent = { kind: 'delta', streamId: event.streamId, text: event.text }
  else if (event.kind === 'stream-reset' && event.streamId)
    turnEvent = { kind: 'stream-reset', streamId: event.streamId }
  else if (event.kind === 'think' && event.text)
    turnEvent = {
      kind: 'delta',
      streamId: `fallback:${event.iteration ?? 0}`,
      text: event.text
    }
  else if (event.kind === 'command' && event.name)
    turnEvent = {
      kind: 'command',
      actionId: event.actionId ?? `action:${message.parts.length}`,
      name: event.name,
      args: event.args
    }
  else if (event.kind === 'result' && event.name) {
    const matching = [...message.parts]
      .reverse()
      .find(
        (part) =>
          part.kind === 'action' &&
          part.name === event.name &&
          (event.actionId ? part.actionId === event.actionId : part.ok === undefined)
      )
    turnEvent = {
      kind: 'result',
      actionId:
        event.actionId ??
        (matching?.kind === 'action' ? matching.actionId : undefined) ??
        `action:${message.parts.length}`,
      name: event.name,
      ok: event.ok,
      data: event.data
    }
  } else if (event.kind === 'artifact' && event.artifact)
    turnEvent = { kind: 'artifact', artifact: event.artifact }
  else if (event.kind === 'done') turnEvent = { kind: 'done' }
  else if (event.kind === 'error')
    turnEvent = { kind: 'failed', error: event.text ?? 'Erreur inconnue' }
  else if (event.kind === 'cancellation') turnEvent = { kind: 'cancelled' }
  if (!turnEvent) return message

  const next = reduceChatTurn(
    {
      turnId,
      status: message.status,
      parts: message.parts,
      ...(message.error ? { error: message.error } : {})
    },
    turnEvent
  )
  const done = next.status !== 'streaming'
  return {
    role: 'assistant',
    turnId,
    // Le tour se clôt (done / erreur / annulation) → aucune action ne peut rester « en cours ».
    parts: done ? settleUnresolvedActions(next.parts) : next.parts,
    status: next.status,
    done,
    ...(next.error ? { error: next.error } : {})
  }
}

interface RuntimeSlot {
  slotId?: string
  provider: string
  modelId: string
  reasoningEffort: string
}

interface RuntimeTopology {
  orchestrator: RuntimeSlot
}

export interface RuntimeModel {
  id: string
  provider: string
  model: string
  label?: string
  reasoningEfforts?: string[]
  defaultReasoningEffort?: string
}

/** Une étape d'orchestration (sous-agent / juge / gate) — fil des sous-agents. */
export type OrchStep = {
  step: 'exec' | 'judge' | 'gate' | string
  provider?: string
  role?: string
  /** Modèle concret du tour — distingue les N membres d'un fan-out (rendu côte à côte). */
  model?: string
  text?: string
  detail?: string
  costUsd?: number
  /**
   * Tokens du tour, tels que remontés par le provider. Le main les envoie déjà dans
   * `OrchestrationStep` ; ils n'étaient simplement pas déclarés ici, donc invisibles à l'affichage —
   * or c'est la seule unité disponible quand le provider ne chiffre pas son coût.
   */
  tokens?: number
  /** Statut du sous-agent — un échec doit se voir (sinon un step raté passe pour réussi). */
  status?: 'completed' | 'failed'
  /** Cause de l'échec (message), affichée quand status==='failed'. */
  error?: string
  /** Raisonnement/thinking du sous-agent, conservé pour post-mortem (rendu repliable). */
  thinking?: string
  prompt?: {
    provider: string
    model?: string
    transport: string
    system?: string
    messages: Array<{ role: string; content: string }>
    options: Record<string, unknown>
    limitation: string
  }
  /** Preuves d'exécution du tour (diff fichiers, stdout/exit commandes) — rendues inline. */
  evidence?: EvidencePart[]
}

/** Preuve d'exécution telle qu'affichée dans le Chat (miroir renderer de ExecutionEvidence). */
export type EvidencePart = {
  type: string
  kind: string
  ok: boolean
  summary: string
  command?: string
  exitCode?: number
  stdout?: string
  diff?: string
  path?: string
}

/** Un groupe de rendu : soit un step seul, soit un run de membres d'un même fan-out (à comparer). */
export type StepGroup =
  { kind: 'single'; step: OrchStep } | { kind: 'fanout'; key: string; steps: OrchStep[] }

/**
 * Clé de membre de fan-out : un step porteur d'un `model`, rattaché à sa phase (ou au juge).
 * INVARIANT appelant (orchestrator.ts) : deux rounds de fan-out juge consécutifs sont TOUJOURS
 * séparés par un step `gate` (clé nulle) → la clé constante 'judge' ne fusionne jamais deux rounds.
 * Si cet invariant changeait, ajouter un désambiguateur de round à la clé juge.
 */
function fanoutMemberKey(s: OrchStep): string | null {
  if (!s.model) return null // les steps mono (sans model) et synthèse/gate ne groupent pas
  const phase = s.detail?.match(/phase (\w+)/)?.[1]
  if (phase) return `${s.role ?? ''}:${phase}`
  if (s.role === 'judge') return 'judge'
  return null
}

/**
 * Regroupe les membres CONSÉCUTIFS d'un même fan-out (≥2, même clé) pour un rendu côte à côte ;
 * tout le reste (mono, synthèse, gate) reste un step seul. Pur → testable. La synthèse (rôle
 * orchestrateur, clé nulle) sépare naturellement deux phases fan-outées successives.
 */
export function groupSubagentSteps(steps: OrchStep[]): StepGroup[] {
  const out: StepGroup[] = []
  let run: { key: string; steps: OrchStep[] } | null = null
  const flush = (): void => {
    if (!run) return
    if (run.steps.length >= 2) out.push({ kind: 'fanout', key: run.key, steps: run.steps })
    else out.push({ kind: 'single', step: run.steps[0] })
    run = null
  }
  for (const s of steps) {
    const key = fanoutMemberKey(s)
    if (key && run && run.key === key) {
      run.steps.push(s)
      continue
    }
    flush()
    if (key) run = { key, steps: [s] }
    else out.push({ kind: 'single', step: s })
  }
  flush()
  return out
}

/**
 * Détecte la commande composer `/btw <texte>` (« by the way » — orienter sans interrompre).
 * Insensible à la casse ; le corps peut être multi-ligne. `/btwfoo` (pas de frontière) n'est PAS
 * une commande. Pur → testable. `/btw` seul → isBtw avec body vide (traité en no-op côté UI).
 */
export function parseBtw(text: string): { isBtw: boolean; body: string } {
  const m = /^\s*\/btw\b[ \t]*([\s\S]*)$/i.exec(text)
  return m ? { isBtw: true, body: m[1] ?? '' } : { isBtw: false, body: '' }
}

/** Une commande slash proposée dans la palette du composer. */
export interface SlashCommand {
  name: string
  hint: string
  /** Texte inséré dans le composer à la sélection (l'utilisateur complète le corps ensuite). */
  insert: string
}

/**
 * Registre des commandes `/` RÉELLES d'Autowin (pas celles de Claude Code). Extensible : ajouter
 * une entrée ici la fait apparaître dans la palette + l'autocomplete. Le comportement de chaque
 * commande est branché côté composer (ex. `/btw` → parseBtw/submitBtw).
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'btw',
    hint: 'Au fait… — ajoute à la file d’attente (traité après le tour en cours)',
    insert: '/btw '
  },
  { name: 'scout', hint: 'Chercher et classer les meilleures pistes', insert: '/scout ' },
  { name: 'frame', hint: 'Cadrer précisément le besoin', insert: '/frame ' },
  {
    name: 'terrain',
    hint: 'Préparer le terrain et les preuves de vérification',
    insert: '/terrain '
  },
  { name: 'build', hint: 'Implémenter ou corriger avec preuve rouge → vert', insert: '/build ' },
  { name: 'clean', hint: 'Nettoyer les résidus avant validation', insert: '/clean ' },
  { name: 'judge', hint: 'Auditer le résultat avec un regard externe', insert: '/judge ' },
  {
    name: 'kaizen',
    hint: 'Rétrospective Autowin : traces, agents, Git, RAG, coûts et mémoire',
    insert: '/kaizen '
  },
  {
    // Hors pipeline, volontairement : `remake` RE-ENTRE dans la progression au lieu d'en être une
    // étape (`PipelinePhase` est une union fermée de 7, décrivant une marche linéaire).
    name: 'remake',
    hint: 'Ce que tu ferais autrement avec le recul — et le fait',
    insert: '/remake '
  }
]

/**
 * Palette « / » : renvoie les commandes à proposer pour l'input courant. Ouverte UNIQUEMENT quand
 * l'input est le TOKEN commande seul (`^/\w*$`, pas de corps) → filtré par préfixe (casse-insensible).
 * Un corps déjà tapé (`/btw x`) ou un texte normal → [] (palette fermée, le parse prend le relais).
 * Pur → testable.
 */
export function matchSlashCommands(input: string): SlashCommand[] {
  const m = /^\/(\w*)$/.exec(input)
  if (!m) return []
  const prefix = m[1].toLowerCase()
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(prefix))
}

/**
 * Volume de tokens en forme lisible d'un coup d'œil. « 795k » et « 1.0G » se comparent mentalement,
 * « 795000 » et « 1002340000 » non — et c'est un chiffre destiné à faire réagir sur une dérive.
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(1)}G tokens`
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tokens`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k tokens`
  return `${tokens} tokens`
}

/**
 * Récap coût PAR MODÈLE d'un run : somme `costUsd` + nombre d'appels par `model` (steps sans model
 * ignorés). Pur → testable. Sert à voir « Opus vs Codex vs Kimi » dans un run.
 *
 * Rend AUSSI le volume NON CHIFFRÉ, sans quoi le récap mentait. Mesuré le 2026-08-04 sur le journal
 * réel : codex ne remonte aucun `costUsd` — 1 280 appels, 532M de tokens — donc `costUsd ?? 0`
 * affichait « 0.0000 $ » à côté de « ×1280 ». Un zéro se lit « gratuit », et c'est sur ce chiffre qu'on
 * décide. On ne comble pas le trou avec un tarif inventé (un prix sans source tracée serait un faux
 * présenté comme mesuré) : on expose le volume que le montant ne couvre pas.
 *
 * Tri : par TOKENS décroissants, l'unité commune aux deux cas — un modèle qui a englouti 90M tokens
 * doit passer devant un montant connu de 2 centimes. À tokens égaux (ou absents), on retombe sur le
 * coût décroissant, ce qui préserve l'ordre historique.
 */
export function costByModel(steps: OrchStep[]): Array<{
  model: string
  costUsd: number
  count: number
  /** Tokens des appels de ce modèle dont le provider n'a PAS chiffré le coût. */
  uncostedTokens: number
  /** Nombre de ces appels — un provider muet sur tout doit rester visible. */
  uncostedCalls: number
}> {
  const map = new Map<
    string,
    {
      costUsd: number
      count: number
      uncostedTokens: number
      uncostedCalls: number
      tokens: number
    }
  >()
  for (const s of steps) {
    if (!s.model) continue
    const e = map.get(s.model) ?? {
      costUsd: 0,
      count: 0,
      uncostedTokens: 0,
      uncostedCalls: 0,
      tokens: 0
    }
    e.costUsd += s.costUsd ?? 0
    e.count += 1
    e.tokens += s.tokens ?? 0
    if (!Number.isFinite(s.costUsd)) {
      e.uncostedCalls += 1
      e.uncostedTokens += s.tokens ?? 0
    }
    map.set(s.model, e)
  }
  // `tokens` sert au TRI mais ne fait pas partie du contrat rendu : on trie sur les entrées de la map,
  // puis on projette. Évite d'exposer un champ que personne n'affiche.
  return [...map.entries()]
    .sort(([, a], [, b]) => b.tokens - a.tokens || b.costUsd - a.costUsd)
    .map(([model, v]) => ({
      model,
      costUsd: v.costUsd,
      count: v.count,
      uncostedTokens: v.uncostedTokens,
      uncostedCalls: v.uncostedCalls
    }))
}

/** Icône + libellé par type d'étape d'orchestration (affichage temps réel). */
export const STEP_META: Record<string, { icon: string; label: string }> = {
  exec: { icon: '🤖', label: 'sous-agent' },
  judge: { icon: '⚖️', label: 'juge' },
  gate: { icon: '🚦', label: 'gate' }
}

export interface OrchestratorModelOption {
  provider: string
  model: string
  label: string
  reasoningEfforts: string[]
  defaultReasoningEffort?: string
  reasoningEffort?: string
}

export interface OrchestratorModelGroup {
  /** Clé stable de la catégorie éditeur (anthropic, openai, google…). */
  key: string
  /** Libellé d'en-tête affiché (Anthropic, ChatGPT, Google…). */
  label: string
  options: OrchestratorModelOption[]
}

/**
 * Catégorie ÉDITEUR déduite de l'id du modèle. Ordre voulu :
 * Anthropic, puis ChatGPT, puis les autres éditeurs (alpha), puis routes auto, puis divers.
 */
export function modelVendor(model: string): { key: string; label: string; rank: number } {
  const id = model.toLowerCase()
  // Les routes auto/* forment LEUR PROPRE catégorie (jamais mélangées à un éditeur),
  // testées AVANT la marque pour que `auto/claude-opus` n'atterrisse pas dans Anthropic.
  const isAuto = id.startsWith('auto') || id.startsWith('custom:') || id.includes('/auto')
  if (isAuto) return { key: 'auto', label: 'Sélection automatique', rank: 8 }
  if (id.includes('claude')) return { key: 'anthropic', label: 'Anthropic', rank: 0 }
  if (/gpt|codex|\bo\d/.test(id)) return { key: 'openai', label: 'ChatGPT', rank: 1 }
  if (id.includes('gemini') || id.includes('gemma'))
    return { key: 'google', label: 'Google', rank: 2 }
  if (id.includes('kimi')) return { key: 'moonshot', label: 'Kimi (Moonshot)', rank: 2 }
  if (id.includes('mimo') || id.includes('xiaomi'))
    return { key: 'xiaomi', label: 'Xiaomi', rank: 2 }
  if (id.includes('glm') || id.includes('zai') || id.includes('z-ai'))
    return { key: 'zai', label: 'Z.ai', rank: 2 }
  if (id.includes('llama')) return { key: 'meta', label: 'Meta (Llama)', rank: 2 }
  if (id.includes('qwen')) return { key: 'qwen', label: 'Qwen', rank: 2 }
  if (id.includes('grok')) return { key: 'xai', label: 'xAI (Grok)', rank: 2 }
  if (id.includes('deepseek')) return { key: 'deepseek', label: 'DeepSeek', rank: 2 }
  if (id.includes('mistral')) return { key: 'mistral', label: 'Mistral', rank: 2 }
  return { key: 'other', label: 'Autres', rank: 9 }
}

/**
 * Clé de tri d'un modèle CONCRET dans sa catégorie éditeur : famille puis version,
 * du plus capable/récent au plus ancien. Ex. Opus 4.8 avant Opus 4.5 avant Sonnet.
 */
export function modelRecencyKey(model: string): [number, number] {
  const id = model.toLowerCase()
  const family = id.includes('fable')
    ? 5
    : id.includes('opus')
      ? 4
      : id.includes('sonnet')
        ? 3
        : id.includes('haiku')
          ? 2
          : 0
  const version = /(\d+)[._-](\d+)/.exec(id)
  const versionScore = version
    ? Number(version[1]) * 100 + Number(version[2])
    : /(\d+)/.test(id)
      ? Number(/(\d+)/.exec(id)![1]) * 100
      : 0
  return [family, versionScore]
}

/** Seuils de coût-équivalent par tour (dérivés de 78k tours réels : p33/p66). */
export const COST_EQ_LOW = 18_000
export const COST_EQ_HIGH = 47_000

/** Coût-équivalent tokens d'un tour (output ×5, input ×1). */
export function turnCostEq(usage: { inputTokens?: number; outputTokens?: number } | null): number {
  if (!usage) return 0
  return (usage.inputTokens ?? 0) + 5 * (usage.outputTokens ?? 0)
}

/** Palier de coût du DERNIER tour (pastille live) — vert/orange/rouge selon les seuils réels. */
export function costEqTier(costEq: number): { dotClass: string; label: string } {
  const k = Math.round(costEq / 1000)
  if (costEq < COST_EQ_LOW) return { dotClass: 'st-ok', label: `Dernier tour léger (~${k}k)` }
  if (costEq < COST_EQ_HIGH) return { dotClass: 'st-warn', label: `Dernier tour moyen (~${k}k)` }
  return { dotClass: 'st-err', label: `Dernier tour lourd (~${k}k)` }
}

/**
 * Palier de prix d'un modèle (pastille coût du Chat), déduit de l'id.
 * vert = pas cher · orange = moyen · rouge = cher · gris = inconnu (auto/*, non classé).
 * Heuristique par famille — un coût $/token LIVE pourra l'affiner plus tard.
 */
export function modelCostTier(model: string): {
  tier: 'low' | 'mid' | 'high' | 'unknown'
  dotClass: string
  label: string
} {
  const id = model.toLowerCase()
  const isAuto = id.startsWith('auto') || id.startsWith('custom:') || id.includes('/auto')
  if (isAuto)
    return { tier: 'unknown', dotClass: 'st-neutral', label: 'Coût variable (route auto)' }
  if (/opus|gpt-5\.\d+-pro|grok-\d+-reasoning/.test(id))
    return { tier: 'high', dotClass: 'st-err', label: 'Modèle cher' }
  if (/haiku|flash|mini|nano|lite|small|8b|7b|scout/.test(id))
    return { tier: 'low', dotClass: 'st-ok', label: 'Modèle pas cher' }
  if (/sonnet|gpt-5|gemini-\d|glm|mimo|qwen|deepseek|llama|kimi|fable/.test(id))
    return { tier: 'mid', dotClass: 'st-warn', label: 'Coût moyen' }
  return { tier: 'unknown', dotClass: 'st-neutral', label: 'Coût inconnu' }
}

/**
 * Sous-tri des routes auto/* du bucket « Sélection automatique » (le regroupement par
 * éditeur est fait en amont par modelVendor). Ordre : Chat → Raisonnement → Code → reste,
 * tier « best » avant « pro ». Retourne [sous-rang, 0] ; libellé puis index tranchent les égalités.
 */
export function orchestratorOptionRank(model: string): [number, number] {
  const id = model.toLowerCase()
  const dimension = id.includes('chat') ? 0 : id.includes('reason') ? 1 : id.includes('cod') ? 2 : 3
  const tier = id.includes('best') ? 0 : id.includes('pro') ? 1 : 2
  return [dimension * 10 + tier, 0]
}

export function buildOrchestratorModelGroups(
  models: RuntimeModel[],
  current?: { provider: string; model?: string }
): {
  groups: OrchestratorModelGroup[]
  currentMissing?: OrchestratorModelOption
} {
  // Regroupement par ÉDITEUR (pas par le provider technique).
  const byVendor = new Map<
    string,
    { label: string; rank: number; options: OrchestratorModelOption[] }
  >()
  for (const item of models) {
    // Bruit masqué : les variantes « Sans raisonnement » (no-think/*) n'encombrent plus le menu.
    if (/(^|\/)no-think\//i.test(item.model)) continue
    const option = {
      provider: item.provider,
      model: item.model,
      label: item.label?.trim() || item.model,
      reasoningEfforts: item.reasoningEfforts ?? ['none'],
      defaultReasoningEffort: item.defaultReasoningEffort
    }
    const vendor = modelVendor(item.model)
    const bucket = byVendor.get(vendor.key) ?? {
      label: vendor.label,
      rank: vendor.rank,
      options: []
    }
    if (!bucket.options.some((entry) => entry.model === option.model)) bucket.options.push(option)
    byVendor.set(vendor.key, bucket)
  }
  // Éditeurs : plus récent/capable d'abord (Opus 4.8 → 4.7 …). Auto : sous-tri Chat/Code conservé.
  const sortOptions = (
    key: string,
    options: OrchestratorModelOption[]
  ): OrchestratorModelOption[] =>
    options
      .map((option, index) => ({ option, index }))
      .sort((a, b) => {
        if (key === 'auto') {
          const ra = orchestratorOptionRank(a.option.model)
          const rb = orchestratorOptionRank(b.option.model)
          return (
            ra[0] - rb[0] ||
            ra[1] - rb[1] ||
            a.option.label.localeCompare(b.option.label, 'fr', { numeric: true }) ||
            a.index - b.index
          )
        }
        const ka = modelRecencyKey(a.option.model)
        const kb = modelRecencyKey(b.option.model)
        return (
          kb[0] - ka[0] || // famille décroissante (Opus > Sonnet > Haiku)
          kb[1] - ka[1] || // version décroissante (4.8 > 4.7)
          a.option.label.localeCompare(b.option.label, 'fr', { numeric: true }) ||
          a.index - b.index
        )
      })
      .map(({ option }) => option)
  const groups = [...byVendor.entries()]
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      rank: bucket.rank,
      options: sortOptions(key, bucket.options)
    }))
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, 'fr'))
    .map(({ key, label, options }) => ({ key, label, options }))
  const currentModel = current?.model
  const currentExists =
    currentModel !== undefined &&
    models.some(
      (item) =>
        item.provider === current?.provider &&
        (item.model === currentModel || item.id === currentModel)
    )
  return {
    groups,
    ...(!currentExists && current && currentModel
      ? {
          currentMissing: {
            provider: current.provider,
            model: currentModel,
            label: `${current.provider} · ${currentModel} (indisponible)`,
            reasoningEfforts: []
          }
        }
      : {})
  }
}

interface RuntimeRoleBinding {
  provider: string
  model?: string
  reasoningEffort?: string
}

export interface ChatRuntimeIdentity {
  provider: string
  model: string
  modelLabel: string
  reasoningEffort: string
}

/** Phase en cours d'exécution (avant que l'étape ne soit enregistrée) — avancement live. */
export interface LiveRunPhase {
  step: string
  provider?: string
  role?: string
  model?: string
  reasoningEffort?: string
  /** A4 — phase pipeline (scout/frame/…) pour un libellé live précis. */
  phase?: string
}

/** Libellé lisible d'une phase de pipeline (A4) — sinon retombe sur le libellé d'étape. */
export function phaseLabel(p: { step: string; phase?: string }): string {
  const PHASE_FR: Record<string, string> = {
    scout: 'scout',
    frame: 'cadrage',
    terrain: 'terrain',
    build: 'build',
    clean: 'nettoyage',
    judge: 'juge'
  }
  if (p.phase && PHASE_FR[p.phase]) return `sous-agent · ${PHASE_FR[p.phase]}`
  return STEP_META[p.step]?.label ?? p.step
}

export interface ScopedLiveRun<TStep = unknown> {
  convId: string
  runPath?: string
  task: string
  steps: TStep[]
  status: 'running' | 'green' | 'red'
  /** Phase active (sous-agent/juge/gate) tant qu'elle n'a pas produit son étape. */
  phase?: LiveRunPhase
  /** Texte streamé de la phase en cours (réinitialisé à chaque nouvelle phase/étape). */
  liveText?: string
}

export type ScopedLiveRunEvent<TStep = unknown> =
  | { type: 'start'; convId: string; runPath?: string; task: string }
  | { type: 'phase'; convId: string; runPath?: string; phase: LiveRunPhase }
  | { type: 'delta'; convId: string; runPath?: string; delta: string }
  | { type: 'step'; convId: string; runPath?: string; step: TStep }
  | { type: 'end'; convId: string; runPath?: string; status: 'green' | 'red' }
  | { type: 'clear'; convId: string; runPath?: string }

export interface RunRequestIdentity {
  id: number
  scope: 'conv' | 'tous'
  convId: string | null
}

export const CHAT_PANE_LIMITS = {
  conversations: { min: 224, max: 480 },
  workflows: { min: 280, max: 760 }
} as const

export function resolveChatRuntimeIdentity(
  topology: RuntimeTopology,
  models: RuntimeModel[],
  role?: RuntimeRoleBinding
): ChatRuntimeIdentity {
  const slot = topology.orchestrator
  if (role) {
    const imported = role.model
      ? models.find(
          (model) =>
            model.provider === role.provider &&
            (model.id === role.model || model.model === role.model)
        )
      : undefined
    return {
      provider: role.provider,
      model: imported?.model ?? role.model ?? 'default',
      modelLabel: imported?.label?.trim() || role.model || `${role.provider} · modèle par défaut`,
      reasoningEffort: role.reasoningEffort ?? 'auto'
    }
  }
  const imported = models.find(
    (model) => model.id === slot.modelId && model.provider === slot.provider
  )
  return {
    provider: slot.provider,
    model: imported?.model ?? slot.modelId,
    modelLabel: imported?.label?.trim() || imported?.model || slot.modelId,
    reasoningEffort: slot.reasoningEffort
  }
}

export function stripAssistantThinking(text: string): string {
  let sanitized = text

  // Complete blocks, including multiline reasoning.
  sanitized = sanitized.replace(/<think(?:\s[^>]*)?>[\s\S]*?<\/think\s*>/gi, '')
  // A remaining closing tag is orphaned: everything before it is hidden reasoning.
  while (/<\/think\s*>/i.test(sanitized)) {
    sanitized = sanitized.replace(/^[\s\S]*?<\/think\s*>/i, '')
  }
  // An opening tag without its closing tag is a reasoning block still streaming.
  sanitized = sanitized.replace(/<think(?:\s[^>]*)?>[\s\S]*$/gi, '')
  // Do not flash a tag while either boundary itself is arriving token by token.
  sanitized = sanitized.replace(/<t(?:h(?:i(?:n(?:k(?:\s[^>]*)?)?)?)?)?$/i, '')
  sanitized = sanitized.replace(/^[\s\S]*?<\/(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/i, '')

  return sanitized
}

export function coalesceAssistantParts(parts: ChatPart[]): ChatDisplayPart[] {
  const compact: ChatDisplayPart[] = []
  const textParts = parts.filter((part): part is PersistedChatTextPart => part.kind === 'text')
  const continuationPrefixes = markdownCodeContinuationPrefixes(textParts.map((part) => part.text))
  let textIndex = 0
  let pendingText: Array<{ text: string; continuationPrefix?: string }> = []
  const flushText = (): void => {
    // Même séparateur que `markdownCodeLineProtection` / `reconcileClosedOrchestrationTextParts` :
    // hydratation et affichage doivent projeter exactement le même flux Markdown.
    const text = stripAssistantThinking(pendingText.map((part) => part.text).join('\n'))
    // La décision de vacuité peut ignorer les espaces, mais la source rendue ne le peut pas : une
    // indentation de quatre espaces est un bloc de code CommonMark et les espaces finaux peuvent
    // appartenir à une preuve. `trim()` changeait donc la sémantique entre hydratation et écran.
    if (text.trim()) {
      const continuationPrefix = pendingText[0]?.continuationPrefix
      compact.push({
        kind: 'text',
        text,
        ...(continuationPrefix ? { markdownContinuationPrefix: continuationPrefix } : {})
      })
    }
    pendingText = []
  }
  for (const part of parts) {
    if (part.kind !== 'text') {
      flushText()
      compact.push(part)
      continue
    }
    pendingText.push({
      text: part.text,
      continuationPrefix: continuationPrefixes[textIndex++]
    })
  }
  flushText()
  return compact
}

export function groupAssistantActivity(parts: ChatPart[]): ChatRenderBlock[] {
  const blocks: ChatRenderBlock[] = []
  for (const part of coalesceAssistantParts(parts)) {
    if (part.kind === 'text') {
      // Retour scout : tableau markdown rankée → vrai tableau à pastilles (Ledger dense).
      const scoutRows = parseScoutTable(part.text)
      if (scoutRows) {
        blocks.push({ kind: 'scout-table', rows: scoutRows })
        continue
      }
      // Scout de veille : charge utile JSON de candidats → panneau de sélection natif (cases +
      // « Enchaîner (frame) sur la sélection ») — les contrôles ne peuvent pas vivre dans le HTML
      // du modèle, le sanitizeur les refuse par conception (14/08).
      const candidatsAffiches = extraireCandidatsAffiches(part.text)
      if (candidatsAffiches) {
        // Le pavé JSON est retiré du texte affiché : la machine l'a déjà consommé, et le panneau
        // montre tout (dépliable). Le texte restant (synthèse) garde sa place au-dessus.
        const synthese = texteSansChargeJson(part.text)
        if (synthese) blocks.push({ ...part, text: synthese })
        blocks.push({ kind: 'candidats-pick', candidats: candidatsAffiches })
        continue
      }
      // Retour scout (suggestions groupées en markdown) → vrai array de chips cliquables.
      const suggestions = parseScoutSuggestions(part.text)
      if (suggestions) blocks.push({ kind: 'suggestions', groups: suggestions })
      else blocks.push(part)
      continue
    }
    // Question posee par le modele avec des reponses DECLAREES : elle devient une grille de chips,
    // par le meme chemin que les suggestions scout. Le clic renvoie le label comme prompt.
    const askChoices = parseAskChoices(part)
    if (askChoices) {
      blocks.push({ kind: 'suggestions', groups: askChoices })
      continue
    }
    if (part.kind === 'artifact' || part.kind === 'error') {
      blocks.push(part)
      continue
    }
    const previous = blocks.at(-1)
    if (previous?.kind === 'activity') previous.actions.push(part)
    else blocks.push({ kind: 'activity', actions: [part] })
  }
  return blocks
}

export function isChatNearBottom(
  metrics: Pick<HTMLElement, 'scrollTop' | 'clientHeight' | 'scrollHeight'>,
  threshold = 72
): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= threshold
}

type ScrollableChat = Pick<HTMLElement, 'scrollTop' | 'clientHeight' | 'scrollHeight'> & {
  scrollTo(options: ScrollToOptions): void
}

/**
 * Descend jusqu'au DERNIER message, pas seulement vers le bas connu au moment du clic.
 *
 * Un unique `scrollTo(scrollHeight)` vise une cible périmée : le markdown, les images et les cartes
 * d'activité finissent de se rendre PENDANT l'animation, donc le bas réel s'éloigne et la descente
 * atterrit court. On re-cible donc à chaque frame où la hauteur bouge, et on garantit l'arrivée par
 * un dernier saut sec. Si le lecteur remonte de lui-même entre deux frames, on lui rend la main.
 */
export function scrollChatToBottom(
  element: ScrollableChat,
  schedule: (callback: () => void) => void = requestAnimationFrame,
  maxFrames = 40
): void {
  let frames = 0
  let lastHeight = -1
  let lastTop = Number.NEGATIVE_INFINITY
  const step = (): void => {
    // Le fil a été démonté (changement de conversation, fermeture) : plus rien à faire piloter.
    if ('isConnected' in element && element.isConnected === false) return
    if (element.scrollTop < lastTop - 4) return
    const height = element.scrollHeight
    const isLastFrame = frames >= maxFrames - 1
    if (height !== lastHeight || (isLastFrame && !isChatNearBottom(element))) {
      element.scrollTo({ top: height, behavior: isLastFrame ? 'auto' : 'smooth' })
    }
    lastHeight = height
    lastTop = element.scrollTop
    frames += 1
    if (!isLastFrame) schedule(step)
  }
  step()
}

export function clampConversationPaneWidth(width: number): number {
  return Math.round(
    Math.min(
      CHAT_PANE_LIMITS.conversations.max,
      Math.max(CHAT_PANE_LIMITS.conversations.min, width)
    )
  )
}

export function createLiveRunDeltaBatcher<T>(
  apply: (batch: T[]) => void,
  schedule: (flush: () => void) => number,
  cancelScheduled: (handle: number) => void
): {
  enqueue: (event: T) => void
  flush: () => void
  cancel: () => void
} {
  let pending: T[] = []
  let scheduled: number | null = null
  let cancelled = false
  let generation = 0

  const applyPending = (): void => {
    if (cancelled || pending.length === 0) return
    const batch = pending
    pending = []
    apply(batch)
  }
  const flush = (): void => {
    if (scheduled !== null) cancelScheduled(scheduled)
    scheduled = null
    generation += 1
    applyPending()
  }

  return {
    enqueue(event) {
      if (cancelled) return
      pending.push(event)
      if (scheduled === null) {
        const scheduledGeneration = ++generation
        scheduled = schedule(() => {
          if (scheduledGeneration !== generation) return
          scheduled = null
          applyPending()
        })
      }
    },
    flush,
    cancel() {
      cancelled = true
      pending = []
      generation += 1
      if (scheduled !== null) cancelScheduled(scheduled)
      scheduled = null
    }
  }
}

export function reduceScopedLiveRuns<TStep>(
  current: Record<string, ScopedLiveRun<TStep>>,
  event: ScopedLiveRunEvent<TStep>
): Record<string, ScopedLiveRun<TStep>> {
  if (event.type === 'start') {
    return {
      ...current,
      [event.convId]: {
        convId: event.convId,
        runPath: event.runPath,
        task: event.task,
        steps: [],
        status: 'running'
      }
    }
  }

  const existing = current[event.convId]
  if (!existing || (event.runPath && existing.runPath && event.runPath !== existing.runPath)) {
    return current
  }
  if (event.type === 'phase') {
    // Nouvelle phase → on repart d'un texte streamé vierge.
    return { ...current, [event.convId]: { ...existing, phase: event.phase, liveText: '' } }
  }
  if (event.type === 'delta') {
    return {
      ...current,
      [event.convId]: { ...existing, liveText: (existing.liveText ?? '') + event.delta }
    }
  }
  if (event.type === 'step') {
    // L'étape est enregistrée → la phase active et son texte streamé sont terminés.
    return {
      ...current,
      [event.convId]: {
        ...existing,
        steps: [...existing.steps, event.step],
        phase: undefined,
        liveText: undefined
      }
    }
  }
  if (event.type === 'end') {
    return {
      ...current,
      [event.convId]: { ...existing, status: event.status, phase: undefined, liveText: undefined }
    }
  }
  /**
   * `clear` n'efface QUE ce qui tourne encore.
   *
   * Un run TERMINÉ porte le fil de ses sous-agents, et ce fil est la preuve de ce qui a été fait : rien
   * d'autre ne le tient côté UI — `RunSummary` (`main/dashboards/runs.ts`) n'a pas de steps. Le chat
   * planifiait un `clear` 4 s après la fin, en croyant que le run « rejoignait la liste » : il
   * disparaissait. Le site de dispatch a été supprimé, et cette garde rend l'invariant STRUCTUREL plutôt
   * que dépendant de la promesse de ne plus appeler la fonction.
   * Un nouveau run dans la même conversation remplace l'entrée par `start` — la mémoire ne grossit pas.
   */
  const existant = current[event.convId]
  if (existant && existant.status !== 'running') return current
  const next = { ...current }
  delete next[event.convId]
  return next
}

export function isRunRequestCurrent(
  requested: RunRequestIdentity,
  current: RunRequestIdentity
): boolean {
  return (
    requested.id === current.id &&
    requested.scope === current.scope &&
    requested.convId === current.convId
  )
}
