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
  authorityMode?: ConversationAuthorityMode
  /** RUN.md externes (Claude Code) attachés à cette conversation. */
  runPaths?: string[]
  createdAt: number
  updatedAt: number
}

/** Store en mémoire de conversations, avec horloge et générateur d'id injectables pour les tests. */
export class ConversationStore {
  private readonly conversations = new Map<string, Conversation>()
  private readonly now: () => number
  private nextId = 1
  /** Hook de persistance : appelé après CHAQUE mutation (create/append/rename/remove). */
  onChange?: (all: Conversation[], urgency: 'immediate' | 'checkpoint') => void

  constructor(now: () => number = () => Date.now()) {
    this.now = now
  }

  /** Recharge un état persisté (au démarrage). nextId repart au-delà des ids existants. */
  hydrate(saved: Conversation[]): boolean {
    this.conversations.clear()
    let max = 0
    let migrated = false
    for (const c of saved) {
      let previousMessageId: string | undefined
      const messages = c.messages.map((sourceMessage, index) => {
        let message = sourceMessage
        const messageId = message.messageId ?? `message-${c.id}-${index + 1}`
        const parentMessageId = message.parentMessageId ?? previousMessageId
        if (!message.messageId || message.parentMessageId !== parentMessageId) {
          migrated = true
          message = {
            ...message,
            messageId,
            ...(parentMessageId ? { parentMessageId } : {})
          }
        }
        previousMessageId = messageId
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
          return { ...message, status: 'interrupted' as const }
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

  private changed(urgency: 'immediate' | 'checkpoint' = 'immediate'): void {
    this.onChange?.(this.list(), urgency)
  }

  /** Crée une nouvelle conversation vide et la stocke. */
  create(p: {
    title: string
    category: Category
    provider: string
    authorityMode?: ConversationAuthorityMode
  }): Conversation {
    const ts = this.now()
    const id = `conv-${this.nextId++}`
    const conversation: Conversation = {
      schemaVersion: 3,
      id,
      title: p.title,
      category: p.category,
      provider: p.provider,
      messages: [],
      workspaceId: `workspace-${id}`,
      authorityMode: p.authorityMode ?? 'auto',
      createdAt: ts,
      updatedAt: ts
    }
    this.conversations.set(conversation.id, conversation)
    this.changed()
    return conversation
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
    conversation.messages.push({
      messageId: `message-${conversation.id}-${conversation.messages.length + 1}`,
      ...(previous?.messageId ? { parentMessageId: previous.messageId } : {}),
      role: m.role,
      content: m.content,
      ts,
      ...(m.attachments?.length ? { attachments: m.attachments } : {})
    })
    conversation.updatedAt = ts
    this.changed()
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
    const userMessageId = `message-${conversation.id}-${conversation.messages.length + 1}`
    conversation.messages.push({
      messageId: userMessageId,
      ...(previous?.messageId ? { parentMessageId: previous.messageId } : {}),
      role: 'user',
      content: user.content,
      ts,
      ...(user.attachments?.length ? { attachments: user.attachments } : {})
    })
    const turn = createChatTurn(assistant.turnId, assistant.runtime)
    conversation.messages.push({
      messageId: `message-${conversation.id}-${conversation.messages.length + 1}`,
      parentMessageId: userMessageId,
      role: 'assistant',
      content: '',
      ts,
      turnId: turn.turnId,
      status: turn.status,
      parts: turn.parts,
      ...(turn.runtime ? { runtime: turn.runtime } : {})
    })
    conversation.schemaVersion = 3
    conversation.updatedAt = ts
    this.changed('immediate')
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
    this.changed(terminal ? 'immediate' : 'checkpoint')
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
      this.changed()
    }
  }

  setAuthorityMode(id: string, authorityMode: ConversationAuthorityMode): Conversation {
    const conversation = this.conversations.get(id)
    if (!conversation) throw new Error(`Conversation inconnue: ${id}`)
    conversation.authorityMode = authorityMode
    conversation.updatedAt = this.now()
    this.changed()
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
      this.changed()
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
    forked.messages = source.messages.slice(0, cut + 1).map((message) => ({
      ...message,
      messageId: `msg-${this.nextId++}`,
      // Le journal d'un tour est rangé PAR CONVERSATION : celui d'un message copié n'existe pas
      // sous le fork. On note donc QUI le possède, pour que la loupe aille le lire au bon endroit
      // au lieu de chercher sous le fork et de retomber sur un run étranger.
      // Un fork de fork propage le propriétaire D'ORIGINE, pas l'intermédiaire.
      ...(message.turnId ? { turnConversationId: message.turnConversationId ?? source.id } : {})
    }))
    forked.forkedFrom = { conversationId: source.id, messageId: fromMessageId }
    forked.updatedAt = this.now()
    this.changed()
    return forked
  }

  /** Supprime une conversation. Retourne true si elle existait. */
  remove(id: string): boolean {
    const existed = this.conversations.delete(id)
    if (existed) this.changed()
    return existed
  }
}
