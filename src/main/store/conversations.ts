import { randomUUID } from 'node:crypto'
import {
  createChatTurn,
  flattenChatParts,
  reduceChatTurn,
  type ChatTurnEvent,
  type ChatTurnRuntime,
  type ChatTurnStatus,
  type PersistedChatPart
} from '../../shared/chat-turn'
import type { ConversationAuthorityMode } from '../conversation-capabilities'
import { hasInterruptionNotice, interruptionNotice } from '../runs/run-interruption'
import type { ChatArtifact } from '../../shared/artifacts'
import type { AutoKaizenConversationLink } from '../auto-kaizen-supervisor'

// Store en mémoire pour les conversations catégorisées (candidat type claude/codex).
// Interface pensée pour être remplacée plus tard par un backend sqlite sans changer l'appelant.

/** Catégorie libre (ex. 'claude' | 'codex', mais pas de contrainte figée). */
export type Category = string

export interface AttachmentMeta {
  name: string
  mimeType: string
  size: number
  /** Miniature downscalée (data URL) d'une image — persistée pour l'aperçu dans le fil. */
  thumbnail?: string
  artifact?: ChatArtifact
  turnId?: string
  /** L’original n’a pas pu être conservé ; ne pas présenter la miniature comme sa source. */
  originalUnavailable?: boolean
}

/** Un message échangé dans une conversation. */
export interface Msg {
  messageId?: string
  parentMessageId?: string
  role: 'user' | 'assistant'
  content: string
  ts: number
  attachments?: AttachmentMeta[]
  turnId?: string
  /**
   * Conversation qui POSSÈDE le journal de ce tour, quand ce n'est pas celle qui porte le message
   * (message copié par un fork). Absent = le tour appartient à la conversation courante.
   */
  turnConversationId?: string
  status?: ChatTurnStatus
  parts?: PersistedChatPart[]
  runtime?: ChatTurnRuntime
  error?: string
}

/** D'où vient une conversation créée par un fork — trace d'origine, sans lien vivant. */
export interface ForkOrigin {
  conversationId: string
  messageId: string
}

/** Titre d'un fork : lisible dans la liste, et jamais empilé à l'infini sur des forks de forks. */
export function forkTitle(sourceTitle: string): string {
  const base = sourceTitle.replace(/\s*\(fork(?: \d+)?\)\s*$/i, '').trim()
  return `${base || 'Conversation'} (fork)`
}

/** Une conversation, regroupée par catégorie et rattachée à un provider. */
export interface Conversation {
  schemaVersion?: 2 | 3
  id: string
  title: string
  category: Category
  provider: string
  messages: Msg[]
  workspaceId?: string
  /** Renseigné si la conversation est née d'un fork. Purement informatif. */
  forkedFrom?: ForkOrigin
  /** Filiation durable d'une analyse/correction Auto-Kaizen avec la conversation source. */
  autoKaizen?: AutoKaizenConversationLink
  authorityMode?: ConversationAuthorityMode
  /**
   * Le dossier de travail auquel cette conversation appartient — ce qui la GROUPE dans la liste.
   *
   * Distinct de `category`, qui porte le PROVIDER (`'claude' | 'codex' | ...`) et que consomment le
   * dispatch task-manager et les commandes : le détourner pour y ranger un dossier casserait ces
   * chemins sans erreur visible. Distinct aussi de `workspaceId`, synthétique et 1:1 avec la
   * conversation, donc incapable de regrouper quoi que ce soit.
   *
   * OPTIONNEL, et il le reste : un `conversations.json` écrit par une version antérieure doit
   * continuer à se relire. Absent → la conversation vit dans « Divers ».
   */
  projectPath?: string
  /** RUN.md externes (Claude Code) attachés à cette conversation. */
  runPaths?: string[]
  createdAt: number
  updatedAt: number
}

export type ConversationSummary = Omit<Conversation, 'messages'> & {
  messageCount: number
  lastMessageRole?: Msg['role']
  lastAssistantStatus?: ChatTurnStatus
}

export interface ConversationChange {
  id: string
  conversation?: Conversation
  urgency: 'immediate' | 'checkpoint'
  journal?:
    | { op: 'append-messages'; messages: Msg[]; updatedAt: number; schemaVersion?: 2 | 3 }
    | { op: 'turn-event'; turnId: string; event: ChatTurnEvent; updatedAt: number }
}

/** Store en mémoire de conversations, avec horloge et générateur d'id injectables pour les tests. */
export class ConversationStore {
  private readonly conversations = new Map<string, Conversation>()
  private readonly now: () => number
  private nextId = 1
  /** Hook de persistance : porte uniquement la conversation mutée, jamais le corpus complet. */
  onChange?: (change: ConversationChange) => void

  constructor(now: () => number = () => Date.now()) {
    this.now = now
  }

  /**
   * Recharge un état persisté (au démarrage). nextId repart au-delà des ids existants.
   *
   * C'est AUSSI le point où la conversation sort d'une attente sans issue : un tour laissé
   * `streaming` sur disque appartient forcément à un run mort avec l'app — le process qui aurait
   * pu le clore n'existe plus. Il est donc clos ici, ses actions en vol réglées, et l'utilisateur
   * PRÉVENU. Sans cet avis, le fil restait muet et l'attente pouvait durer indéfiniment.
   *
   * `resumableTurnIds` est le discriminant : un tour dont le checkpoint de run survit va réellement
   * reprendre au démarrage — l'annoncer interrompu serait faux. Absent = plus rien ne reprend.
   */
  hydrate(saved: Conversation[], options?: { resumableTurnIds?: ReadonlySet<string> }): boolean {
    const resumable = options?.resumableTurnIds
    this.conversations.clear()
    let max = 0
    let migrated = false
    const usedMessageIds = new Set<string>()
    for (const c of saved) {
      let previousMessageId: string | undefined
      const seenMessageIds = new Set<string>()
      const messageIdRemap = new Map<string, string>()
      const messages = c.messages.map((sourceMessage, index) => {
        let message = sourceMessage
        const persistedMessageId = message.messageId ?? `message-${c.id}-${index + 1}`
        let messageId = persistedMessageId
        if (usedMessageIds.has(messageId)) {
          migrated = true
          do {
            messageId = `message-${randomUUID()}`
          } while (usedMessageIds.has(messageId))
        }
        // Les premiers forks v3 regeneraient les IDs locaux mais laissaient parfois un parent venu
        // de la conversation source. Ce parent orphelin est une forme legacy migrable, pas une raison
        // de rendre tout le store illisible : on retablit alors la chaine locale deterministe.
        const mappedParentMessageId = message.parentMessageId
          ? (messageIdRemap.get(message.parentMessageId) ?? message.parentMessageId)
          : undefined
        const parentMessageId =
          mappedParentMessageId && seenMessageIds.has(mappedParentMessageId)
            ? mappedParentMessageId
            : previousMessageId
        if (
          !message.messageId ||
          message.messageId !== messageId ||
          message.parentMessageId !== parentMessageId
        ) {
          migrated = true
          message = { ...message, messageId, parentMessageId }
          if (!parentMessageId) delete message.parentMessageId
        }
        messageIdRemap.set(persistedMessageId, messageId)
        previousMessageId = messageId
        seenMessageIds.add(messageId)
        usedMessageIds.add(messageId)
        if (message.role !== 'assistant') return message
        if (!message.parts) {
          migrated = true
          return {
            ...message,
            status: 'completed' as const,
            parts: message.content ? [{ kind: 'text' as const, text: message.content }] : []
          }
        }
        if (message.status === 'streaming') {
          migrated = true
          const interrupted: Msg = {
            ...message,
            status: 'interrupted' as const,
            // Une action sans résultat n'est pas « en cours » : le tour est clos, son issue ne
            // viendra jamais. C'est ce que lisent le fil ET le graphe d'exécution.
            parts: (message.parts ?? []).map((part) =>
              part.kind === 'action' && part.ok === undefined && !part.interrupted
                ? { ...part, interrupted: true }
                : part
            )
          }
          const runId = message.turnId
          if (!runId || resumable?.has(runId)) return interrupted
          if (hasInterruptionNotice(interrupted.content, runId)) return interrupted
          const notice = interruptionNotice(runId)
          const parts: PersistedChatPart[] = [
            ...(interrupted.parts ?? []),
            { kind: 'text', text: notice }
          ]
          return { ...interrupted, parts, content: flattenChatParts(parts) }
        }
        return { ...message, status: message.status ?? ('completed' as const) }
      })
      // Les anciens champs de branche (`rootBranchId`, `activeBranchId`, `branches`, `branchId`)
      // sont ABANDONNÉS ici : forker crée désormais une conversation à part. On ne les recopie pas,
      // et une conversation ancienne qui en portait affiche simplement tous ses messages à la suite.
      const legacy = c as Conversation & Record<string, unknown>
      const hadBranches = legacy.rootBranchId !== undefined || legacy.branches !== undefined
      const rest: Record<string, unknown> = { ...legacy }
      delete rest.rootBranchId
      delete rest.activeBranchId
      delete rest.branches
      const hydrated: Conversation = {
        ...(rest as unknown as Conversation),
        schemaVersion: 3 as const,
        workspaceId: c.workspaceId ?? `workspace-${c.id}`,
        authorityMode: c.authorityMode ?? 'auto',
        messages
      }
      if (c.schemaVersion !== 3 || !c.workspaceId || !c.authorityMode || hadBranches) {
        migrated = true
      }
      this.conversations.set(c.id, hydrated)
      const n = Number(c.id.replace(/^conv-/, ''))
      if (Number.isFinite(n) && n > max) max = n
    }
    this.nextId = max + 1
    return migrated
  }

  private changed(
    id: string,
    urgency: 'immediate' | 'checkpoint' = 'immediate',
    journal?: ConversationChange['journal']
  ): void {
    this.onChange?.({
      id,
      conversation: this.conversations.get(id),
      urgency,
      ...(journal ? { journal } : {})
    })
  }

  /** Crée une nouvelle conversation vide et la stocke. */
  create(p: {
    title: string
    category: Category
    provider: string
    authorityMode?: ConversationAuthorityMode
    autoKaizen?: AutoKaizenConversationLink
  }): Conversation {
    const ts = this.now()
    const id = this.nextUniqueConversationId()
    const conversation: Conversation = {
      schemaVersion: 3,
      id,
      title: p.title,
      category: p.category,
      provider: p.provider,
      messages: [],
      workspaceId: `workspace-${id}`,
      authorityMode: p.authorityMode ?? 'auto',
      ...(p.autoKaizen ? { autoKaizen: p.autoKaizen } : {}),
      createdAt: ts,
      updatedAt: ts
    }
    this.conversations.set(conversation.id, conversation)
    this.changed(conversation.id)
    return conversation
  }

  /** Alloue un id de conversation sans collision, même après épuisement du compteur sûr. */
  private nextUniqueConversationId(): string {
    while (Number.isSafeInteger(this.nextId)) {
      const candidate = `conv-${this.nextId++}`
      if (!this.conversations.has(candidate)) return candidate
    }
    let candidate: string
    do {
      candidate = `conv-${randomUUID()}`
    } while (this.conversations.has(candidate))
    return candidate
  }

  private hasMessageId(candidate: string): boolean {
    return [...this.conversations.values()].some((conversation) =>
      conversation.messages.some(({ messageId }) => messageId === candidate)
    )
  }

  private nextUniqueMessageId(conversation: Conversation): string {
    let ordinal = conversation.messages.length + 1
    while (Number.isSafeInteger(ordinal)) {
      const deterministic = `message-${conversation.id}-${ordinal++}`
      if (!this.hasMessageId(deterministic)) return deterministic
    }
    let candidate: string
    do {
      candidate = `message-${randomUUID()}`
    } while (this.hasMessageId(candidate))
    return candidate
  }

  /** Ajoute un message à une conversation existante et met à jour updatedAt. Jette si l'id est inconnu. */
  append(
    id: string,
    m: { role: 'user' | 'assistant'; content: string; attachments?: AttachmentMeta[] }
  ): Conversation {
    const conversation = this.conversations.get(id)
    if (!conversation) {
      throw new Error(`Conversation inconnue: ${id}`)
    }
    const ts = this.now()
    const previous = conversation.messages.at(-1)
    const message: Msg = {
      messageId: this.nextUniqueMessageId(conversation),
      ...(previous?.messageId ? { parentMessageId: previous.messageId } : {}),
      role: m.role,
      content: m.content,
      ts,
      ...(m.attachments?.length ? { attachments: m.attachments } : {})
    }
    conversation.messages.push(message)
    conversation.updatedAt = ts
    this.changed(id, 'immediate', {
      op: 'append-messages',
      messages: [structuredClone(message)],
      updatedAt: ts
    })
    return conversation
  }

  /** Persiste atomiquement le message utilisateur et le brouillon assistant avant le transport. */
  beginTurn(
    id: string,
    user: { content: string; attachments?: AttachmentMeta[] },
    assistant: { turnId: string; runtime?: ChatTurnRuntime }
  ): Conversation {
    const conversation = this.conversations.get(id)
    if (!conversation) throw new Error(`Conversation inconnue: ${id}`)
    const ts = this.now()
    const previous = conversation.messages.at(-1)
    const userMessageId = this.nextUniqueMessageId(conversation)
    const userMessage: Msg = {
      messageId: userMessageId,
      ...(previous?.messageId ? { parentMessageId: previous.messageId } : {}),
      role: 'user',
      content: user.content,
      ts,
      ...(user.attachments?.length ? { attachments: user.attachments } : {})
    }
    conversation.messages.push(userMessage)
    const turn = createChatTurn(assistant.turnId, assistant.runtime)
    const assistantMessage: Msg = {
      messageId: this.nextUniqueMessageId(conversation),
      parentMessageId: userMessageId,
      role: 'assistant',
      content: '',
      ts,
      turnId: turn.turnId,
      status: turn.status,
      parts: turn.parts,
      ...(turn.runtime ? { runtime: turn.runtime } : {})
    }
    conversation.messages.push(assistantMessage)
    conversation.schemaVersion = 3
    conversation.updatedAt = ts
    this.changed(id, 'immediate', {
      op: 'append-messages',
      messages: [structuredClone(userMessage), structuredClone(assistantMessage)],
      updatedAt: ts,
      schemaVersion: 3
    })
    return conversation
  }

  /** Applique un événement au tour structuré ; les deltas demandent un checkpoint regroupé. */
  applyTurnEvent(id: string, turnId: string, event: ChatTurnEvent): Conversation {
    const conversation = this.conversations.get(id)
    if (!conversation) throw new Error(`Conversation inconnue: ${id}`)
    const message = [...conversation.messages]
      .reverse()
      .find((candidate) => candidate.role === 'assistant' && candidate.turnId === turnId)
    if (!message) throw new Error(`Tour assistant inconnu: ${turnId}`)
    const current = {
      turnId,
      status: message.status ?? ('streaming' as const),
      parts: message.parts ?? [],
      ...(message.runtime ? { runtime: message.runtime } : {}),
      ...(message.error ? { error: message.error } : {})
    }
    const next = reduceChatTurn(current, event)
    message.status = next.status
    message.parts = next.parts
    message.content = flattenChatParts(next.parts)
    message.runtime = next.runtime
    message.error = next.error
    conversation.updatedAt = this.now()
    const terminal = ['done', 'failed', 'cancelled', 'interrupted'].includes(event.kind)
    this.changed(id, terminal ? 'immediate' : 'checkpoint', {
      op: 'turn-event',
      turnId,
      event: structuredClone(event),
      updatedAt: conversation.updatedAt
    })
    return conversation
  }

  /** Récupère une conversation par id, ou undefined si absente. */
  get(id: string): Conversation | undefined {
    return this.conversations.get(id)
  }

  /** Liste toutes les conversations, triées par updatedAt décroissant. */
  list(): Conversation[] {
    return [...this.conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** Projection légère destinée aux listes IPC : les historiques se chargent séparément. */
  listSummaries(): ConversationSummary[] {
    return this.list().map(({ messages, ...summary }) => ({
      ...summary,
      messageCount: messages.length,
      lastMessageRole: messages.at(-1)?.role,
      lastAssistantStatus: [...messages].reverse().find((message) => message.role === 'assistant')
        ?.status
    }))
  }

  /** Liste les conversations d'une catégorie donnée, triées par updatedAt décroissant. */
  byCategory(cat: Category): Conversation[] {
    return this.list().filter((c) => c.category === cat)
  }

  /** Liste les catégories distinctes présentes dans le store. */
  categories(): Category[] {
    return [...new Set([...this.conversations.values()].map((c) => c.category))]
  }

  /** Renomme une conversation existante. Ne fait rien si l'id est inconnu. */
  rename(id: string, title: string): void {
    const conversation = this.conversations.get(id)
    if (conversation) {
      conversation.title = title
      this.changed(id)
    }
  }

  /**
   * Range la conversation dans un dossier de travail — c'est ce qui la groupe dans la liste.
   *
   * `null` la SORT de son groupe (retour à « Divers ») : sans ce chemin, un rangement serait
   * définitif et la seule façon d'en sortir serait de supprimer la conversation. Le champ est effacé
   * plutôt que mis à la chaîne vide, pour qu'un `conversations.json` relu n'en garde aucune trace.
   *
   * Ne touche PAS `updatedAt` : déplacer une conversation n'est pas y travailler, et la liste est
   * triée par `updatedAt` — un rangement la ferait remonter en tête comme si elle venait de servir.
   */
  setProjectPath(id: string, projectPath: string | null): Conversation | undefined {
    const conversation = this.conversations.get(id)
    if (!conversation) return undefined
    const propre = projectPath?.trim()
    if (propre) conversation.projectPath = propre
    else delete conversation.projectPath
    this.changed(id)
    return conversation
  }

  setAuthorityMode(id: string, authorityMode: ConversationAuthorityMode): Conversation {
    const conversation = this.conversations.get(id)
    if (!conversation) throw new Error(`Conversation inconnue: ${id}`)
    conversation.authorityMode = authorityMode
    conversation.updatedAt = this.now()
    this.changed(id)
    return conversation
  }

  /** Attache un RUN.md externe à une conversation (idempotent). Jette si l'id est inconnu. */
  attachRun(id: string, runPath: string): Conversation {
    const conversation = this.conversations.get(id)
    if (!conversation) {
      throw new Error(`Conversation inconnue: ${id}`)
    }
    conversation.runPaths ??= []
    if (!conversation.runPaths.includes(runPath)) {
      conversation.runPaths.push(runPath)
      conversation.updatedAt = this.now()
      this.changed(id)
    }
    return conversation
  }

  /** Détache un RUN.md externe sans supprimer le fichier qui appartient à son outil d'origine. */
  detachRun(id: string, runPath: string): Conversation {
    const conversation = this.conversations.get(id)
    if (!conversation) {
      throw new Error(`Conversation inconnue: ${id}`)
    }
    const nextRunPaths = (conversation.runPaths ?? []).filter((path) => path !== runPath)
    if (nextRunPaths.length !== (conversation.runPaths?.length ?? 0)) {
      conversation.runPaths = nextRunPaths
      conversation.updatedAt = this.now()
      this.changed(id)
    }
    return conversation
  }

  /** Messages d'une conversation, dans l'ordre. Jette si l'id est inconnu. */
  messagesOf(id: string): Msg[] {
    const c = this.conversations.get(id)
    if (!c) throw new Error(`Conversation inconnue: ${id}`)
    return c.messages
  }

  /**
   * Forke depuis un message : crée une CONVERSATION À PART, copie de l'historique jusqu'à ce
   * message inclus. C'est le geste attendu (même comportement que Claude) — l'ancienne version
   * empilait des branches À L'INTÉRIEUR d'une conversation, ce qui obligeait à une barre d'onglets
   * pour naviguer entre des histoires invisibles depuis la liste des conversations.
   *
   * L'originale n'est pas touchée : forker n'enlève rien à ce qui existait.
   */
  fork(id: string, fromMessageId: string): Conversation {
    const source = this.conversations.get(id)
    if (!source) throw new Error(`Conversation inconnue: ${id}`)
    if (!fromMessageId) throw new Error('fromMessageId requis') // sinon matche un message legacy sans id
    const cut = source.messages.findIndex((m) => m.messageId === fromMessageId)
    if (cut < 0) throw new Error(`Message inconnu: ${fromMessageId}`)

    const forked = this.create({
      title: forkTitle(source.title),
      category: source.category,
      provider: source.provider,
      authorityMode: source.authorityMode
    })
    // Copie jusqu'au point de fork INCLUS. Les identifiants de message sont régénérés : deux
    // conversations ne doivent jamais partager un messageId (le fork suivant viserait les deux).
    const copiedMessages = source.messages.slice(0, cut + 1)
    const messageIds = new Map<string, string>()
    const allocatedIds = new Set<string>()
    const generatedIds = copiedMessages.map((message) => {
      const generatedId = this.nextUniqueForkMessageId(allocatedIds)
      allocatedIds.add(generatedId)
      if (message.messageId) messageIds.set(message.messageId, generatedId)
      return generatedId
    })
    forked.messages = copiedMessages.map((message, index) => ({
      ...message,
      messageId: generatedIds[index],
      parentMessageId: message.parentMessageId
        ? messageIds.get(message.parentMessageId)
        : undefined,
      // Le journal d'un tour est rangé PAR CONVERSATION : celui d'un message copié n'existe pas
      // sous le fork. On note donc QUI le possède, pour que la loupe aille le lire au bon endroit
      // au lieu de chercher sous le fork et de retomber sur un run étranger.
      // Un fork de fork propage le propriétaire D'ORIGINE, pas l'intermédiaire.
      ...(message.turnId ? { turnConversationId: message.turnConversationId ?? source.id } : {})
    }))
    forked.forkedFrom = { conversationId: source.id, messageId: fromMessageId }
    forked.updatedAt = this.now()
    this.changed(forked.id)
    return forked
  }

  private nextUniqueForkMessageId(allocatedIds: ReadonlySet<string>): string {
    let candidate: string
    do {
      candidate = `msg-${randomUUID()}`
    } while (allocatedIds.has(candidate) || this.hasMessageId(candidate))
    return candidate
  }

  /** Supprime une conversation. Retourne true si elle existait. */
  remove(id: string): boolean {
    const existed = this.conversations.delete(id)
    if (existed) this.changed(id)
    return existed
  }
}
