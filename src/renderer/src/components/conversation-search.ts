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
      const title = normalize(conversation.title)
      const messages = Array.isArray(conversation.messages) ? conversation.messages : []
      const matchingMessage = [...messages]
        .reverse()
        .find((message) => tokens.every((token) => normalize(message.content).includes(token)))
      const titleMatches = tokens.every((token) => title.includes(token))
      if (!titleMatches && !matchingMessage) return []
      return [
        {
          conversation,
          matchedIn: titleMatches ? ('title' as const) : ('message' as const),
          snippet: matchingMessage ? excerpt(matchingMessage.content, query) : undefined
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
