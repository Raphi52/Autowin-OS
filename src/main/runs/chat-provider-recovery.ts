import { statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { Attachment, SendResult } from '../providers/types'
import { guardAttachments } from '../ipc-guards'
import { recoverDetachedProviderResult } from './run-reattach'
import { survivableExitCode, survivableExitCodeAsync } from './stdout-journal'
import {
  isTurnFinished,
  listUnfinishedTurnsAsync,
  readTurnJournal,
  readTurnJournalByIdAsync,
  turnJournalPath,
  type TurnJournalEvent
} from './turn-journal'

/** Apres le plafond reel des appels directs (40 min), un journal muet sans recu est orphelin. */
const MAX_UNCERTIFIED_CHAT_RECOVERY_AGE_MS = 2 * 60 * 60_000

function providerJournalActivityAt(path: string, fallback: number): number {
  try {
    return Math.max(fallback, statSync(path).mtimeMs)
  } catch {
    return fallback
  }
}

export type RecoverableChatProviderExit =
  { kind: 'exit'; exitCode: number } | { kind: 'stale' } | { kind: 'aborted' }

/**
 * Attend un recu terminal tant que le journal progresse. La borne d'inactivite reste dans la boucle :
 * un appel recent au demarrage mais dont le producteur est mort ne peut donc pas bloquer le chat a vie.
 */
export async function waitForRecoverableChatProviderExit(
  journalPath: string,
  options: {
    signal: AbortSignal
    fallbackActivityAt?: number
    maxInactivityMs?: number
    pollMs?: number
    now?: () => number
    activityAt?: (path: string, fallback: number) => number
    readExitCode?: (path: string) => number | undefined
    wait?: (ms: number) => Promise<void>
  }
): Promise<RecoverableChatProviderExit> {
  const maxInactivityMs = options.maxInactivityMs ?? MAX_UNCERTIFIED_CHAT_RECOVERY_AGE_MS
  const pollMs = options.pollMs ?? 250
  const now = options.now ?? Date.now
  const activityAt = options.activityAt ?? providerJournalActivityAt
  const readExitCode = options.readExitCode ?? survivableExitCode
  const wait =
    options.wait ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms)
        timer.unref?.()
      }))

  while (!options.signal.aborted) {
    const exitCode = readExitCode(journalPath)
    if (exitCode !== undefined) return { kind: 'exit', exitCode }
    if (now() - activityAt(journalPath, options.fallbackActivityAt ?? now()) > maxInactivityMs)
      return { kind: 'stale' }
    await wait(pollMs)
  }
  return { kind: 'aborted' }
}

/** Lien durable écrit avant le spawn d'un provider de chat direct. */
export interface RecoverableChatProviderCall {
  conversationId: string
  turnId: string
  provider: string
  token: string
  journalPath: string
  iteration: number
  attempt: number
  streamId: string
  requestId: string
  /** Actions de CE résultat provider déjà acquittées avant un redémarrage ultérieur. */
  settledActions?: RecoveredChatActionResult[]
  /** Bornes du tour d'origine, a rejouer a l'identique apres un crash. */
  policy?: ChatExecutionPolicy
  updatedAt: number
}

export interface RecoveredChatActionResult {
  actionId: string
  name: string
  ok: boolean
  data?: unknown
  attachments?: Attachment[]
}

export interface ChatExecutionPolicy {
  readOnly: boolean
  maxIterations: number
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function chatExecutionPolicy(value: unknown): ChatExecutionPolicy | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.readOnly !== 'boolean' ||
    !Number.isSafeInteger(candidate.maxIterations) ||
    Number(candidate.maxIterations) < 1
  )
    return undefined
  return {
    readOnly: candidate.readOnly,
    maxIterations: Number(candidate.maxIterations)
  }
}

function providerLink(
  event: TurnJournalEvent,
  turn: { conversationId: string; turnId: string; updatedAt: number }
): RecoverableChatProviderCall | undefined {
  if (
    event.kind !== 'provider-journal' ||
    !nonEmptyString(event.provider) ||
    !nonEmptyString(event.token) ||
    !nonEmptyString(event.journalPath) ||
    !nonEmptyString(event.streamId) ||
    !nonEmptyString(event.requestId) ||
    !nonNegativeInteger(event.iteration) ||
    !nonNegativeInteger(event.attempt)
  ) {
    return undefined
  }
  const hasPersistedPolicy = Object.prototype.hasOwnProperty.call(event, 'policy')
  const policy = chatExecutionPolicy(event.policy)
  // Une policy absente appartient aux anciens chats directs. Une policy PRESENTE mais illisible
  // ne doit jamais tomber sur le pilote normal : on refuse cette reprise (fail-closed).
  if (hasPersistedPolicy && !policy) return undefined
  return {
    ...turn,
    provider: event.provider,
    token: event.token,
    journalPath: event.journalPath,
    iteration: event.iteration,
    attempt: event.attempt,
    streamId: event.streamId,
    requestId: event.requestId,
    ...(policy ? { policy } : {})
  }
}

/**
 * Ne considère que les tours sans clôture et prend leur DERNIER spawn : un premier essai peut avoir
 * échoué puis avoir été retenté. Rejouer l'ancien journal exécuterait une réponse obsolète.
 *
 * Analyse PURE d'un journal déjà lu : aucune E/S ici, pour que la question par tour (chargement,
 * synchrone) et l'inventaire complet (après `whenReady`, non bloquant) rendent le même verdict.
 */
function derniereReprisePossible(
  turn: { conversationId: string; turnId: string; updatedAt: number },
  events: readonly TurnJournalEvent[]
): RecoverableChatProviderCall | undefined {
  let latest: RecoverableChatProviderCall | undefined
  let commands = new Map<string, string>()
  let settledActions = new Map<string, RecoveredChatActionResult>()
  for (const event of events) {
    if (event.kind === 'provider-journal') {
      const candidate = providerLink(event, turn)
      // Ne jamais retomber sur un essai plus ancien : un journal provider plus recent corrompu
      // rend toute la chaine de reprise ambigue, donc le tour entier est refuse.
      if (!candidate) return undefined
      latest = candidate
      // Une action n'est causée que par le dernier appel provider. Le provider-journal suivant
      // ouvre une nouvelle frontière et rend les acquittements précédents hors périmètre.
      commands = new Map()
      settledActions = new Map()
      continue
    }
    if (!latest) continue
    if (event.kind === 'command' && nonEmptyString(event.actionId) && nonEmptyString(event.name)) {
      commands.set(event.actionId, event.name)
      continue
    }
    if (
      event.kind === 'result' &&
      nonEmptyString(event.actionId) &&
      nonEmptyString(event.name) &&
      typeof event.ok === 'boolean' &&
      commands.get(event.actionId) === event.name
    ) {
      let attachments: Attachment[] | undefined
      if (Object.prototype.hasOwnProperty.call(event, 'attachments')) {
        try {
          const guarded = guardAttachments(event.attachments)
          if (guarded.length > 0) attachments = guarded
        } catch {
          // Une piece jointe illisible rend l'acquittement incomplet. Refuser toute la chaine
          // evite de choisir arbitrairement entre la perdre et rejouer une action non idempotente.
          return undefined
        }
      }
      settledActions.set(event.actionId, {
        actionId: event.actionId,
        name: event.name,
        ok: event.ok,
        ...(Object.prototype.hasOwnProperty.call(event, 'data') ? { data: event.data } : {}),
        ...(attachments ? { attachments } : {})
      })
    }
  }
  if (!latest) return undefined
  return {
    ...latest,
    ...(settledActions.size > 0 ? { settledActions: [...settledActions.values()] } : {})
  }
}

interface OptionsReprise {
  now?: number
  maxUncertifiedAgeMs?: number
}

/**
 * CE tour est-il un appel de chat à reprendre ? Question posée au CHARGEMENT, pour les seuls
 * messages restés « en cours » : elle ne lit que le journal de ce tour, jamais l'arborescence.
 *
 * fix-ok: gels.jsonl 2026-09-26T09:30, 8951 ms pendant « corps du module terminé » dont `openSync`
 * 3438 ms — l'inventaire COMPLET des journaux tournait là en synchrone, alors que l'hydratation
 * n'a besoin de la réponse que pour les tours restés `streaming` (zéro à deux en pratique).
 */
export function recoverableChatProviderCallForTurn(
  root: string,
  conversationId: string,
  turnId: string,
  options: OptionsReprise = {}
): RecoverableChatProviderCall | undefined {
  let updatedAt: number
  let events: TurnJournalEvent[]
  try {
    // Chemin, date et contenu sous le MÊME garde : cette question est posée PENDANT l'hydratation,
    // où une exception ferait écarter tout le store des conversations comme illisible. Un journal
    // illisible ne prouve aucun appel vivant — l'inventaire async le lit aussi comme vide.
    updatedAt = statSync(turnJournalPath(root, conversationId, turnId)).mtimeMs
    events = readTurnJournal(root, conversationId, turnId)
  } catch {
    return undefined
  }
  if (events.length === 0 || isTurnFinished(events)) return undefined
  const call = derniereReprisePossible({ conversationId, turnId, updatedAt }, events)
  if (!call) return undefined
  const now = options.now ?? Date.now()
  const maxUncertifiedAgeMs = options.maxUncertifiedAgeMs ?? MAX_UNCERTIFIED_CHAT_RECOVERY_AGE_MS
  const uncertifiedAndStale =
    survivableExitCode(call.journalPath) === undefined &&
    now - providerJournalActivityAt(call.journalPath, call.updatedAt) > maxUncertifiedAgeMs
  return uncertifiedAndStale ? undefined : call
}

/**
 * Tous les appels de chat à reprendre, les plus récents d'abord — SANS E/S synchrone.
 *
 * Remplace l'inventaire synchrone lancé au chargement du module (voir le fix-ok ci-dessus) : il
 * est désormais attendu par la boucle de reprise, après `whenReady`, fenêtre déjà ouverte.
 */
export async function listRecoverableChatProviderCallsAsync(
  root: string,
  options: OptionsReprise = {}
): Promise<RecoverableChatProviderCall[]> {
  const calls: RecoverableChatProviderCall[] = []
  const now = options.now ?? Date.now()
  const maxUncertifiedAgeMs = options.maxUncertifiedAgeMs ?? MAX_UNCERTIFIED_CHAT_RECOVERY_AGE_MS
  for (const { conversationId, turnId, updatedAt } of await listUnfinishedTurnsAsync(root)) {
    const events = await readTurnJournalByIdAsync(root, conversationId, turnId)
    // Le compteur `events` de l'inventaire n'est PAS recopié : il fuyait dans l'appel sans que
    // personne le lise, et rendait l'objet différent de celui de la question par tour.
    const call = derniereReprisePossible({ conversationId, turnId, updatedAt }, events)
    if (!call) continue
    if ((await survivableExitCodeAsync(call.journalPath)) === undefined) {
      const activite = await stat(call.journalPath).then(
        (etat) => Math.max(call.updatedAt, etat.mtimeMs),
        () => call.updatedAt
      )
      if (now - activite > maxUncertifiedAgeMs) continue
    }
    calls.push(call)
  }
  return calls.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Texte de CE stream déjà rendu avant la mort du main, pour ne pas le dupliquer à la reprise. */
export function streamedPrefixForProviderCall(
  events: readonly TurnJournalEvent[],
  streamId: string
): string {
  let prefix = ''
  for (const event of events) {
    if (event.streamId !== streamId) continue
    if (event.kind === 'stream-reset') prefix = ''
    else if (event.kind === 'delta' && typeof event.text === 'string') prefix += event.text
  }
  return prefix
}

/**
 * Parse uniquement une sortie dont le relais a certifié `exit=0`. Aucune preuve terminale, sortie
 * rouge ou format incomplet => `undefined` : le contrôleur attend ou nomme l'échec, jamais il ne
 * fabrique un succès.
 */
export function recoverCompletedChatProviderCall(
  provider: string,
  journalPath: string
): SendResult | undefined {
  // Le chat pilote les actions avec des blocs `<cmd>` qui peuvent précéder le résultat terminal
  // Claude. Une orchestration, elle, ne veut que le livrable final : l'option reste donc locale à
  // cette reprise de chat.
  const recovered = recoverDetachedProviderResult(provider, journalPath, {
    includeAssistantText: true
  })
  if (!recovered) return undefined
  return {
    text: recovered.text,
    provider,
    systemInjected: true,
    ...(recovered.sessionId ? { sessionId: recovered.sessionId } : {}),
    ...(recovered.usage
      ? {
          usage: {
            ...recovered.usage,
            ...(recovered.costUsd === undefined ? {} : { costUsd: recovered.costUsd })
          }
        }
      : {}),
    ...(recovered.executionEvidence?.length
      ? { executionEvidence: recovered.executionEvidence }
      : {})
  }
}
