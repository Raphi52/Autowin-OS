// Store en mémoire pour les conversations catégorisées (candidat type Hermes/claude.exe/codex).
// Interface pensée pour être remplacée plus tard par un backend sqlite sans changer l'appelant.

/** Catégorie libre (ex. 'hermes' | 'claude' | 'codex', mais pas de contrainte figée). */
export type Category = string

/** Un message échangé dans une conversation. */
export interface Msg {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

/** Une conversation, regroupée par catégorie et rattachée à un provider. */
export interface Conversation {
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
  onChange?: (all: Conversation[]) => void

  constructor(now: () => number = () => Date.now()) {
    this.now = now
  }

  /** Recharge un état persisté (au démarrage). nextId repart au-delà des ids existants. */
  hydrate(saved: Conversation[]): void {
    this.conversations.clear()
    let max = 0
    for (const c of saved) {
      this.conversations.set(c.id, c)
      const n = Number(c.id.replace(/^conv-/, ''))
      if (Number.isFinite(n) && n > max) max = n
    }
    this.nextId = max + 1
  }

  private changed(): void {
    this.onChange?.(this.list())
  }

  /** Crée une nouvelle conversation vide et la stocke. */
  create(p: { title: string; category: Category; provider: string }): Conversation {
    const ts = this.now()
    const conversation: Conversation = {
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
  append(id: string, m: { role: 'user' | 'assistant'; content: string }): Conversation {
    const conversation = this.conversations.get(id)
    if (!conversation) {
      throw new Error(`Conversation inconnue: ${id}`)
    }
    const ts = this.now()
    conversation.messages.push({ role: m.role, content: m.content, ts })
    conversation.updatedAt = ts
    this.changed()
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
