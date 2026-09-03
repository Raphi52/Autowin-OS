import { statSync } from 'node:fs'
import type { Attachment, SendResult } from '../providers/types'
import { guardAttachments } from '../ipc-guards'
import { recoverDetachedProviderResult } from './run-reattach'
import { survivableExitCode } from './stdout-journal'
import { listUnfinishedTurns, readTurnJournal, type TurnJournalEvent } from './turn-journal'

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
 */
export function listRecoverableChatProviderCalls(
  root: string,
  options: { now?: number; maxUncertifiedAgeMs?: number } = {}
): RecoverableChatProviderCall[] {
  const calls: RecoverableChatProviderCall[] = []
  const now = options.now ?? Date.now()
  const maxUncertifiedAgeMs = options.maxUncertifiedAgeMs ?? MAX_UNCERTIFIED_CHAT_RECOVERY_AGE_MS
  for (const turn of listUnfinishedTurns(root)) {
    const events = readTurnJournal(root, turn.conversationId, turn.turnId)
    let latest: RecoverableChatProviderCall | undefined
    let invalidProviderJournal = false
    let commands = new Map<string, string>()
    let settledActions = new Map<string, RecoveredChatActionResult>()
    for (const event of events) {
      if (event.kind === 'provider-journal') {
        const candidate = providerLink(event, turn)
        if (!candidate) {
          // Ne jamais retomber sur un essai plus ancien : un journal provider plus recent corrompu
          // rend toute la chaine de reprise ambigue, donc le tour entier est refuse.
          invalidProviderJournal = true
          break
        }
        latest = candidate
        // Une action n'est causée que par le dernier appel provider. Le provider-journal suivant
        // ouvre une nouvelle frontière et rend les acquittements précédents hors périmètre.
        commands = new Map()
        settledActions = new Map()
        continue
      }
      if (!latest) continue
      if (
        event.kind === 'command' &&
        nonEmptyString(event.actionId) &&
        nonEmptyString(event.name)
      ) {
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
            invalidProviderJournal = true
            break
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
    const uncertifiedAndStale =
      latest &&
      survivableExitCode(latest.journalPath) === undefined &&
      now - providerJournalActivityAt(latest.journalPath, latest.updatedAt) > maxUncertifiedAgeMs
    if (!invalidProviderJournal && latest && !uncertifiedAndStale)
      calls.push({
        ...latest,
        ...(settledActions.size > 0 ? { settledActions: [...settledActions.values()] } : {})
      })
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
