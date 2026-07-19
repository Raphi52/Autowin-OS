import {
  createChatTurn,
  flattenChatParts,
  reduceChatTurn,
  type ChatTurnEvent,
  type ChatTurnRuntime,
  type ChatTurnStatus,
  type PersistedChatPart
} from '../../shared/chat-turn'

// Store en mémoire pour les conversations catégorisées (candidat type Hermes/claude.exe/codex).
// Interface pensée pour être remplacée plus tard par un backend sqlite sans changer l'appelant.

/** Catégorie libre (ex. 'hermes' | 'claude' | 'codex', mais pas de contrainte figée). */
export type Category = string

export interface AttachmentMeta {
  name: string
  mimeType: string
  size: number
}

/** Un message échangé dans une conversation. */
export interface Msg {
  role: 'user' | 'assistant'
  content: string
  ts: number
  attachments?: AttachmentMeta[]
  turnId?: string
  status?: ChatTurnStatus
  parts?: PersistedChatPart[]
  runtime?: ChatTurnRuntime
  error?: string
}

/** Une conversation, regroupée par catégorie et rattachée à un provider. */
export interface Conversation {
  schemaVersion?: 2
  id: string
  title: string
  category: Category
  provider: string
  messages: Msg[]
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
      const messages = c.messages.map((message) => {
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
      const hydrated = {
        ...c,
        schemaVersion: 2 as const,
        messages
      }
      if (c.schemaVersion !== 2) migrated = true
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
  create(p: { title: string; category: Category; provider: string }): Conversation {
    const ts = this.now()
    const conversation: Conversation = {
      schemaVersion: 2,
      id: `conv-${this.nextId++}`,
      title: p.title,
      category: p.category,
      provider: p.provider,
      messages: [],
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
    conversation.messages.push({
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
    conversation.messages.push({
      role: 'user',
      content: user.content,
      ts,
      ...(user.attachments?.length ? { attachments: user.attachments } : {})
    })
    const turn = createChatTurn(assistant.turnId, assistant.runtime)
    conversation.messages.push({
      role: 'assistant',
      content: '',
      ts,
      turnId: turn.turnId,
      status: turn.status,
      parts: turn.parts,
      ...(turn.runtime ? { runtime: turn.runtime } : {})
    })
    conversation.schemaVersion = 2
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

  /** Supprime une conversation. Retourne true si elle existait. */
  remove(id: string): boolean {
    const existed = this.conversations.delete(id)
    if (existed) this.changed()
    return existed
  }
}
