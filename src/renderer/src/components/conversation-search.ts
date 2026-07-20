export type ConversationSearchSource = {
  id: string
  title: string
  category: string
  provider: string
  updatedAt: number
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string; ts: number }>
}

export type ConversationSearchHit<T extends ConversationSearchSource = ConversationSearchSource> = {
  conversation: T
  snippet?: string
  matchedIn: 'title' | 'message' | 'all'
}

const normalize = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')

/**
 * Cache de normalisation par conversation (cl\u00e9 id, invalid\u00e9 quand updatedAt change).
 * \u00c9vite de renormaliser titre + TOUT le contenu de TOUTES les conversations \u00e0 CHAQUE
 * frappe : le co\u00fbt par frappe retombe \u00e0 O(conversations) au lieu de O(caract\u00e8res stock\u00e9s).
 */
type NormalizedConversation = { updatedAt: number; title: string; contents: string[] }
// Clé = l'OBJET conversation (WeakMap) : deux objets distincts ne collisionnent jamais
// (même en cas d'id réutilisé), et la garde updatedAt couvre une mutation en place.
const normalizationCache = new WeakMap<ConversationSearchSource, NormalizedConversation>()

function normalizedFor(conversation: ConversationSearchSource): NormalizedConversation {
  const cached = normalizationCache.get(conversation)
  if (cached && cached.updatedAt === conversation.updatedAt) return cached
  const messages = Array.isArray(conversation.messages) ? conversation.messages : []
  const entry: NormalizedConversation = {
    updatedAt: conversation.updatedAt,
    title: normalize(conversation.title),
    contents: messages.map((message) => normalize(message.content))
  }
  normalizationCache.set(conversation, entry)
  return entry
}

function excerpt(content: unknown, query: string, cap = 96): string {
  const compact = String(content ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (compact.length <= cap) return compact
  const firstToken = normalize(query).split(/\s+/).find(Boolean) ?? ''
  const matchAt = normalize(compact).indexOf(firstToken)
  const start = Math.max(0, Math.min(matchAt - 24, compact.length - cap))
  return `${start > 0 ? '…' : ''}${compact.slice(start, start + cap).trim()}${start + cap < compact.length ? '…' : ''}`
}

export function searchConversations<T extends ConversationSearchSource>(
  conversations: readonly T[],
  rawQuery: string,
  limit = 40
): ConversationSearchHit<T>[] {
  const query = normalize(rawQuery.trim())
  if (!query) {
    return conversations.slice(0, limit).map((conversation) => ({
      conversation,
      matchedIn: 'all' as const
    }))
  }

  const tokens = query.split(/\s+/).filter(Boolean)
  return conversations
    .flatMap((conversation) => {
      const norm = normalizedFor(conversation)
      const messages = Array.isArray(conversation.messages) ? conversation.messages : []
      let matchingIdx = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        if (tokens.every((token) => norm.contents[i]?.includes(token))) {
          matchingIdx = i
          break
        }
      }
      const titleMatches = tokens.every((token) => norm.title.includes(token))
      if (!titleMatches && matchingIdx < 0) return []
      return [
        {
          conversation,
          matchedIn: titleMatches ? ('title' as const) : ('message' as const),
          snippet: matchingIdx >= 0 ? excerpt(messages[matchingIdx].content, query) : undefined
        }
      ]
    })
    .sort(
      (a, b) =>
        Number(b.matchedIn === 'title') - Number(a.matchedIn === 'title') ||
        b.conversation.updatedAt - a.conversation.updatedAt
    )
    .slice(0, limit)
}
