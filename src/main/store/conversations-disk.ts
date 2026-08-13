import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { flattenChatParts, reduceChatTurn, type ChatTurnEvent } from '../../shared/chat-turn'
import type { Conversation, ConversationChange, ConversationStore, Msg } from './conversations'
import { ensureAutowinAppData } from '../app-data'

/**
 * Persistance disque des conversations (sinon TOUT disparaît au restart).
 * Même pattern que role-store : le store reste PUR, le load/save vit ici.
 * Écriture atomique (tmp + rename) pour ne jamais corrompre le fichier
 * si l'app meurt en pleine écriture. Fichier : %APPDATA%\autowin-os\conversations.json.
 */
export function conversationsPath(): string {
  return join(ensureAutowinAppData(), 'conversations.json')
}

export class ConversationPersistenceError extends Error {
  constructor(
    message: string,
    readonly path: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'ConversationPersistenceError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean'
}

const ARTIFACT_KINDS = new Set([
  'image',
  'vector',
  'markdown',
  'text',
  'code',
  'diff',
  'structured-data',
  'table',
  'diagram',
  'pdf',
  'document',
  'presentation',
  'spreadsheet',
  'notebook',
  'audio',
  'video',
  'web',
  'archive',
  'model3d',
  'font',
  'executable',
  'binary'
])

function isChatArtifact(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.source)) return false
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.mimeType !== 'string' ||
    typeof value.kind !== 'string' ||
    !ARTIFACT_KINDS.has(value.kind) ||
    !Number.isFinite(value.size) ||
    !Number.isFinite(value.createdAt) ||
    typeof value.source.provider !== 'string'
  ) {
    return false
  }
  if (
    !isOptionalString(value.encoding) ||
    (value.encoding !== undefined && value.encoding !== 'utf8' && value.encoding !== 'base64') ||
    !isOptionalString(value.content) ||
    !isOptionalString(value.path) ||
    !isOptionalString(value.url)
  ) {
    return false
  }
  return (
    isOptionalString(value.source.model) &&
    isOptionalString(value.source.tool) &&
    isOptionalString(value.source.originalPath) &&
    isOptionalString(value.source.url)
  )
}

function isPersistedChatPart(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.kind === 'text')
    return typeof value.text === 'string' && isOptionalString(value.streamId)
  if (value.kind === 'action')
    return (
      typeof value.name === 'string' &&
      isOptionalString(value.actionId) &&
      isOptionalBoolean(value.ok) &&
      isOptionalBoolean(value.interrupted)
    )
  if (value.kind === 'artifact') return isChatArtifact(value.artifact)
  return false
}

function isAttachment(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (
    typeof value.name !== 'string' ||
    typeof value.mimeType !== 'string' ||
    !Number.isFinite(value.size) ||
    !isOptionalString(value.thumbnail) ||
    !isOptionalString(value.turnId) ||
    !isOptionalBoolean(value.originalUnavailable)
  ) {
    return false
  }
  return value.artifact === undefined || isChatArtifact(value.artifact)
}

function isChatTurnRuntime(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.provider === 'string' &&
    isOptionalString(value.model) &&
    isOptionalString(value.reasoningEffort) &&
    isOptionalString(value.sessionId)
  )
}

function isForkOrigin(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.conversationId === 'string' &&
    value.conversationId.length > 0 &&
    typeof value.messageId === 'string' &&
    value.messageId.length > 0
  )
}

function isAutoKaizenLink(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.incidentId === 'string' &&
    value.incidentId.length > 0 &&
    typeof value.sourceConversationId === 'string' &&
    value.sourceConversationId.length > 0 &&
    (value.role === 'analysis' || value.role === 'fix') &&
    typeof value.rootIncidentId === 'string' &&
    value.rootIncidentId.length > 0 &&
    isOptionalString(value.parentIncidentId) &&
    typeof value.depth === 'number' &&
    Number.isInteger(value.depth) &&
    value.depth >= 0
  )
}

function hasUniqueMessageIds(conversationId: string, messages: unknown[]): boolean {
  const seen = new Set<string>()
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index] as Record<string, unknown>
    const messageId =
      typeof message.messageId === 'string'
        ? message.messageId
        : `message-${conversationId}-${index + 1}`
    if (!messageId || seen.has(messageId)) return false
    seen.add(messageId)
  }
  return true
}

function isConversationMessage(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.role !== 'user' && value.role !== 'assistant') return false
  if (typeof value.content !== 'string' || !Number.isFinite(value.ts)) return false
  if (!isOptionalString(value.messageId) || !isOptionalString(value.parentMessageId)) return false
  if (!isOptionalString(value.turnId) || !isOptionalString(value.turnConversationId)) return false
  if (
    value.status !== undefined &&
    value.status !== 'streaming' &&
    value.status !== 'completed' &&
    value.status !== 'failed' &&
    value.status !== 'cancelled' &&
    value.status !== 'interrupted'
  ) {
    return false
  }
  if (!isOptionalString(value.error)) return false
  if (value.runtime !== undefined && !isChatTurnRuntime(value.runtime)) return false
  if (
    value.parts !== undefined &&
    (!Array.isArray(value.parts) || !value.parts.every(isPersistedChatPart))
  ) {
    return false
  }
  if (
    value.attachments !== undefined &&
    (!Array.isArray(value.attachments) || !value.attachments.every(isAttachment))
  ) {
    return false
  }
  return true
}

function isConversation(value: unknown): value is Conversation {
  if (!isRecord(value)) return false
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.title !== 'string' ||
    typeof value.category !== 'string' ||
    typeof value.provider !== 'string' ||
    !Array.isArray(value.messages) ||
    !value.messages.every(isConversationMessage) ||
    !Number.isFinite(value.createdAt) ||
    !Number.isFinite(value.updatedAt)
  ) {
    return false
  }
  if (!hasUniqueMessageIds(value.id, value.messages)) return false
  if (value.schemaVersion !== undefined && value.schemaVersion !== 2 && value.schemaVersion !== 3) {
    return false
  }
  if (value.forkedFrom !== undefined && !isForkOrigin(value.forkedFrom)) return false
  if (value.autoKaizen !== undefined && !isAutoKaizenLink(value.autoKaizen)) return false
  if (!isOptionalString(value.workspaceId) || !isOptionalString(value.projectPath)) return false
  if (
    value.runPaths !== undefined &&
    (!Array.isArray(value.runPaths) || value.runPaths.some((entry) => typeof entry !== 'string'))
  ) {
    return false
  }
  // Compatibilite de lecture uniquement : ConversationStore retire `authorityMode` a
  // l'hydratation. Ces valeurs ne constituent plus des modes pris en charge au runtime.
  return (
    value.authorityMode === undefined ||
    value.authorityMode === 'plan' ||
    value.authorityMode === 'ask' ||
    value.authorityMode === 'auto'
  )
}

function parseConversationArray(path: string): Conversation[] {
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(data)) {
    throw new Error('Conversation store must be an array of valid conversations.')
  }
  const ids = new Set<string>()
  for (const conversation of data) {
    if (!isConversation(conversation) || ids.has(conversation.id)) {
      throw new Error('Conversation store must be an array of valid conversations.')
    }
    ids.add(conversation.id)
  }
  return data
}

function loadConversationSnapshot(path: string): Conversation[] {
  if (!existsSync(path)) return []
  try {
    return parseConversationArray(path)
  } catch (primaryError) {
    const temporaryPath = `${path}.tmp`
    if (existsSync(temporaryPath)) {
      try {
        const recovered = parseConversationArray(temporaryPath)
        copyFileSync(path, `${path}.corrupt`)
        writeConversationSnapshot(recovered, path)
        return recovered
      } catch (recoveryError) {
        throw new ConversationPersistenceError(
          `Store conversations corrompu et récupération temporaire impossible: ${path}`,
          path,
          { cause: recoveryError }
        )
      }
    }
    throw new ConversationPersistenceError(`Store conversations corrompu: ${path}`, path, {
      cause: primaryError
    })
  }
}

export function conversationJournalPath(path = conversationsPath()): string {
  return `${path}.journal.jsonl`
}

type ConversationJournalRecord =
  | { schema: 'autowin.conversation-change/v1'; op: 'upsert'; conversation: Conversation }
  | { schema: 'autowin.conversation-change/v1'; op: 'delete'; id: string }
  | {
      schema: 'autowin.conversation-change/v1'
      op: 'append-messages'
      id: string
      messages: Msg[]
      updatedAt: number
      schemaVersion?: 2 | 3
    }
  | {
      schema: 'autowin.conversation-change/v1'
      op: 'turn-event'
      id: string
      turnId: string
      event: ChatTurnEvent
      updatedAt: number
    }

const JOURNAL_MAX_BYTES = 16 * 1024 * 1024

function applyConversationJournal(base: Conversation[], path: string): Conversation[] {
  const journal = conversationJournalPath(path)
  if (!existsSync(journal)) return base
  const byId = new Map(base.map((conversation) => [conversation.id, conversation]))
  const lines = readFileSync(journal, 'utf8').split(/\r?\n/)
  const lastContentIndex = lines.reduce((last, line, index) => (line ? index : last), -1)
  for (const [index, line] of lines.entries()) {
    if (!line) continue
    try {
      const record = JSON.parse(line) as Partial<ConversationJournalRecord>
      if (record.schema !== 'autowin.conversation-change/v1') throw new Error('schema invalide')
      if (record.op === 'upsert' && isConversation(record.conversation)) {
        byId.set(record.conversation.id, record.conversation)
      } else if (record.op === 'delete' && typeof record.id === 'string') {
        byId.delete(record.id)
      } else if (
        record.op === 'append-messages' &&
        typeof record.id === 'string' &&
        Array.isArray(record.messages) &&
        record.messages.every(isConversationMessage) &&
        typeof record.updatedAt === 'number'
      ) {
        const conversation = byId.get(record.id)
        if (!conversation) throw new Error('conversation du delta introuvable')
        conversation.messages.push(...record.messages)
        conversation.updatedAt = record.updatedAt
        if (record.schemaVersion) conversation.schemaVersion = record.schemaVersion
      } else if (
        record.op === 'turn-event' &&
        typeof record.id === 'string' &&
        typeof record.turnId === 'string' &&
        isRecord(record.event) &&
        typeof record.event.kind === 'string' &&
        typeof record.updatedAt === 'number'
      ) {
        const conversation = byId.get(record.id)
        const message = conversation?.messages.find(
          (candidate) => candidate.role === 'assistant' && candidate.turnId === record.turnId
        )
        if (!conversation || !message) throw new Error('tour du delta introuvable')
        const next = reduceChatTurn(
          {
            turnId: record.turnId,
            status: message.status ?? 'streaming',
            parts: message.parts ?? [],
            ...(message.runtime ? { runtime: message.runtime } : {}),
            ...(message.error ? { error: message.error } : {})
          },
          record.event as ChatTurnEvent
        )
        message.status = next.status
        message.parts = next.parts
        message.content = flattenChatParts(next.parts)
        message.runtime = next.runtime
        message.error = next.error
        conversation.updatedAt = record.updatedAt
      } else {
        throw new Error('opération de journal invalide')
      }
    } catch (error) {
      if (index === lastContentIndex && error instanceof SyntaxError) break
      throw new ConversationPersistenceError(
        `Journal conversations corrompu ligne ${index + 1}: ${journal}`,
        journal,
        { cause: error }
      )
    }
  }
  return [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt)
}

export function loadConversations(path = conversationsPath()): Conversation[] {
  return applyConversationJournal(loadConversationSnapshot(path), path)
}

function writeConversationSnapshot(all: Conversation[], path: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(all, null, 1), 'utf8')
    renameSync(tmp, path)
  } catch (error) {
    /*
      Le message porte la CAUSE, pas seulement le chemin.
      Constaté le 2026-08-13 : l'application est morte au démarrage sur « Écriture du store
      conversations impossible: <chemin> », et ce message ne disait pas POURQUOI. Il a fallu trois
      sondes pour découvrir que le chemin d'écriture fonctionnait parfaitement en isolation — l'échec
      était un accès concurrent (un second processus tenant le fichier, donc un renommage refusé).
      Un `cause` rangé dans l'objet mais absent du message ne sert qu'à celui qui lit le code.
    */
    const cause = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    throw new ConversationPersistenceError(
      `Écriture du store conversations impossible: ${path} — ${cause}`,
      path,
      { cause: error }
    )
  }
}

export function saveConversations(all: Conversation[], path = conversationsPath()): void {
  writeConversationSnapshot(all, path)
  // Un snapshot explicite devient la nouvelle base canonique ; rejouer l'ancien journal par-dessus
  // ressusciterait des mutations déjà compactées.
  rmSync(conversationJournalPath(path), { force: true })
}

function journalRecords(changes: readonly ConversationChange[]): ConversationJournalRecord[] {
  return changes.map(({ id, conversation, journal }) => {
    if (journal?.op === 'append-messages') {
      return { schema: 'autowin.conversation-change/v1', id, ...journal }
    }
    if (journal?.op === 'turn-event') {
      return { schema: 'autowin.conversation-change/v1', id, ...journal }
    }
    return conversation
      ? { schema: 'autowin.conversation-change/v1', op: 'upsert', conversation }
      : { schema: 'autowin.conversation-change/v1', op: 'delete', id }
  })
}

function appendConversationChanges(
  changes: readonly ConversationChange[],
  all: readonly Conversation[],
  path: string
): void {
  if (!changes.length) return
  try {
    mkdirSync(dirname(path), { recursive: true })
    const journal = conversationJournalPath(path)
    const payload = `${journalRecords(changes)
      .map((record) => JSON.stringify(record))
      .join('\n')}\n`
    const projected =
      (existsSync(journal) ? statSync(journal).size : 0) + Buffer.byteLength(payload)
    if (projected > JOURNAL_MAX_BYTES) saveConversations([...all], path)
    else appendFileSync(journal, payload, 'utf8')
  } catch (error) {
    throw new ConversationPersistenceError(
      `Écriture du journal conversations impossible: ${conversationJournalPath(path)}`,
      conversationJournalPath(path),
      { cause: error }
    )
  }
}

/** Branche un store sur le disque : recharge l'existant + sauve à chaque mutation. */
export function persistConversations(
  store: ConversationStore,
  path = conversationsPath(),
  /**
   * Tours dont le run VA reprendre au démarrage (checkpoint encore sur disque). Eux seuls échappent
   * à l'avis d'interruption : les annoncer interrompus alors qu'ils redémarrent serait faux.
   */
  options?: { resumableTurnIds?: ReadonlySet<string> }
): () => void {
  const journalPresentAtStartup = existsSync(conversationJournalPath(path))
  const migrated = store.hydrate(loadConversations(path), options)
  const pending: ConversationChange[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = (): void => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (!pending.length) return
    const changes = [...pending]
    // Effacement APRES succes uniquement : une erreur disque transitoire reste rejouable.
    appendConversationChanges(changes, store.list(), path)
    pending.splice(0, changes.length)
  }

  store.onChange = (change) => {
    pending.push(change)
    if (change.urgency === 'immediate') {
      flush()
      return
    }
    if (timer) return
    timer = setTimeout(flush, 120)
    ;(timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.()
  }

  // Le replay est amorti sur le démarrage : une fois hydraté, le journal devient un snapshot
  // canonique puis repart vide. Il ne grossit donc pas à travers les sessions et chaque delta de la
  // session courante reste limité à la seule conversation touchée.
  if (migrated || journalPresentAtStartup) saveConversations(store.list(), path)
  else if (!existsSync(path)) writeConversationSnapshot([], path)

  // Exposé pour un flush forcé (ex. before-quit) : évite de perdre le dernier
  // fragment de streaming resté dans la fenêtre de debounce de 120 ms.
  return flush
}
