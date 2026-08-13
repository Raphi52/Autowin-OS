import { statSync } from 'node:fs'
import type { Attachment, SendResult } from '../providers/types'
import { guardAttachments } from '../ipc-guards'
import { recoverDetachedProviderResult } from './run-reattach'
import { survivableExitCode } from './stdout-journal'
import { listUnfinishedTurns, readTurnJournal, type TurnJournalEvent } from './turn-journal'

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
export function listRecoverableChatProviderCalls(root: string): RecoverableChatProviderCall[] {
  const calls: RecoverableChatProviderCall[] = []
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
    if (!invalidProviderJournal && latest)
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

/**
 * L'issue d'un appel provider detache, telle qu'un redemarrage peut la constater.
 *
 * Trois issues SEULEMENT, et l'absence de quatrieme est le fond du sujet : il n'existe pas d'issue
 * « probablement fini ». Une sortie non certifiee ne devient jamais un succes — elle devient `stale`,
 * et l'appelant clot le tour en `interrupted` plutot que d'inventer une reponse.
 */
export type RecoverableChatProviderExit =
  { kind: 'exited'; exitCode: number } | { kind: 'aborted' } | { kind: 'stale' }

/** Intervalle entre deux lectures de la preuve de sortie. Court : on attend un fichier, pas un reseau. */
const SONDE_MS = 2_000

/**
 * Silence tolere avant de declarer un appel perime.
 *
 * Genereux a dessein : un tour de chat peut reflechir plusieurs minutes sans ecrire une ligne, et
 * declarer perime un appel encore vivant ferait perdre son travail. Dix minutes sans AUCUNE ecriture ni
 * preuve de sortie signifient en pratique que le processus est mort sans laisser sa preuve.
 */
const PEREMPTION_MS = 10 * 60 * 1_000

/**
 * Attend la preuve de sortie CERTIFIEE d'un appel provider detache.
 *
 * Ecrite pour completer une fusion qui appelait cette fonction sans qu'elle existe nulle part — ni dans
 * l'arbre, ni dans l'historique, ni sur origin/main.
 *
 * Le contrat vient de son site d'appel (`index.ts`, reprise au demarrage) : `aborted` quand le signal
 * tombe, `stale` quand plus rien ne bouge, et sinon le code de sortie ECRIT par le relais. On ne lit
 * jamais le code d'un processus qu'on observe : on lit le fichier qu'il a laisse.
 */
export async function waitForRecoverableChatProviderExit(
  journalPath: string,
  options: {
    signal?: AbortSignal
    /** Derniere activite connue quand le journal n'a pas encore de date : evite une peremption immediate. */
    fallbackActivityAt?: number
    sondeMs?: number
    peremptionMs?: number
  } = {}
): Promise<RecoverableChatProviderExit> {
  const sonde = options.sondeMs ?? SONDE_MS
  const peremption = options.peremptionMs ?? PEREMPTION_MS
  const derniereActivite = (): number => {
    // La date du journal, ou celle fournie par l'appelant : un journal pas encore cree ne doit pas
    // compter comme un silence de dix minutes.
    try {
      return statSync(journalPath).mtimeMs
    } catch {
      return options.fallbackActivityAt ?? Date.now()
    }
  }

  for (;;) {
    if (options.signal?.aborted) return { kind: 'aborted' }
    const code = survivableExitCode(journalPath)
    // La preuve d'abord : un appel qui a fini ET dont le journal ne bouge plus doit rendre son code,
    // pas `stale`.
    if (typeof code === 'number') return { kind: 'exited', exitCode: code }
    if (Date.now() - derniereActivite() > peremption) return { kind: 'stale' }
    await new Promise<void>((resolve) => {
      const minuteur = setTimeout(resolve, sonde)
      minuteur.unref?.()
      options.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(minuteur)
          resolve()
        },
        { once: true }
      )
    })
  }
}
