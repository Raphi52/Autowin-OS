export type ConversationSearchSource = {
  id: string
  title: string
  provider: string
  updatedAt: number
  /**
   * Date du dernier message de L'UTILISATEUR, fournie par la projection IPC. Distincte
   * d'`updatedAt`, que bouge aussi ce qui ne vient pas de lui.
   */
  lastUserMessageAt?: number
  messages?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string; ts: number }>
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

/**
 * Plafond de la liste — 40 auparavant, et ce chiffre MENTAIT.
 *
 * Constaté par l'utilisateur le 2026-08-15 : « je vois que la catégorie Divers avec 40 éléments, on
 * dirait un mock-up, le compteur bouge jamais ». Il avait raison : « 40 » n'était pas un compte mais
 * LE PLAFOND, appliqué dès que la recherche est vide. Son installation compte 1 011 conversations —
 * la barre latérale n'en montrait que les 40 premières, et l'en-tête affichait donc éternellement 40.
 * Trente conversations de sonde, vérifiées présentes (`conv-1195`→`conv-1224`), étaient invisibles :
 * elles tombaient hors de cette fenêtre.
 *
 * Le plafond n'est pas supprimé — il protège le rendu d'une base sans limite — mais porté à une
 * valeur qui COUVRE l'usage réel observé, de sorte que le compteur redevienne un compte. Au-delà, la
 * recherche prend le relais : elle parcourt tout, elle, sans passer par cette fenêtre.
 */
export const PLAFOND_LISTE = 2_000

export function searchConversations<T extends ConversationSearchSource>(
  conversations: readonly T[],
  rawQuery: string,
  limit = PLAFOND_LISTE
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

/**
 * Date qui répond à « la dernière fois que J'AI parlé ici ».
 *
 * `lastUserMessageAt` du résumé IPC d'abord — la liste est une projection légère où `messages` est
 * souvent absent. Sinon on le derive de l'historique s'il est charge. En dernier recours
 * `updatedAt` : une conversation ou l'utilisateur n'a jamais ecrit (creee par un agent) doit rester
 * classable.
 */
export function recenceUtilisateur(conversation: ConversationSearchSource): number {
  if (typeof conversation.lastUserMessageAt === 'number') return conversation.lastUserMessageAt
  const messages = conversation.messages
  if (messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.role === 'user' && typeof message.ts === 'number') return message.ts
    }
  }
  return conversation.updatedAt
}

/**
 * Ordonne la liste de la barre latérale sur la RÉCENCE UTILISATEUR.
 *
 * Defaut vecu le 2026-08-18 : le tri portait sur `updatedAt` seul, que bouge n'importe quelle touche
 * non-utilisateur (rangement dans un dossier, attache d'un RUN.md, delta de streaming, fork). Ranger
 * une vieille conversation la propulsait en tete de « Plus recentes ». Rend une COPIE : le tableau
 * recu est celui d'un `useMemo`, le trier en place serait une mutation invisible.
 */
export function trierParRecenceUtilisateur<T extends ConversationSearchSource>(
  hits: readonly ConversationSearchHit<T>[],
  ordre: 'asc' | 'desc'
): ConversationSearchHit<T>[] {
  return [...hits].sort((gauche, droite) => {
    const delta = recenceUtilisateur(gauche.conversation) - recenceUtilisateur(droite.conversation)
    return ordre === 'asc' ? delta : -delta
  })
}
