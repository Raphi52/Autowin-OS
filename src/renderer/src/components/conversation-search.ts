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
type NormalizedConversation = {
  updatedAt: number
  title: string
  /** Identifiant normalisé : « 1455 » doit retrouver `conv-1455`, dont le titre ne porte pas le numéro. */
  id: string
  contents: string[]
}
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
    id: normalize(conversation.id),
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

/**
 * Extraits par CONTENU, calcules par le processus principal.
 *
 * La liste laterale est une projection LEGERE : `messages` y est absent, donc une recherche purement
 * locale ne voyait que le titre -- c'est-a-dire, en pratique, le debut du premier prompt. Cette
 * carte (id -> extrait) apporte ce que le renderer ne peut pas savoir : quelles conversations
 * CONTIENNENT le terme, meme dix messages plus loin.
 */
export type CorrespondancesContenu = ReadonlyMap<string, string>

export function searchConversations<T extends ConversationSearchSource>(
  conversations: readonly T[],
  rawQuery: string,
  limit = PLAFOND_LISTE,
  correspondancesContenu?: CorrespondancesContenu
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
      // L'IDENTIFIANT est une clé de recherche à part entière : l'utilisateur désigne
      // couramment une conversation par son numéro (« 1455 »), qui n'apparaît nulle part
      // dans son titre ni dans ses messages. Sans cela, la chercher rendait ZÉRO résultat
      // et la conversation paraissait disparue alors qu'elle est bien en base.
      const idMatches = tokens.every((token) => norm.id.includes(token))
      const titleMatches = idMatches || tokens.every((token) => norm.title.includes(token))
      // Le CONTENU vu par le processus principal : c'est lui qui rattrape les conversations dont le
      // titre ignore le terme. Sans lui, la liste ne repondait qu'au debut du premier prompt.
      const extraitDistant = correspondancesContenu?.get(conversation.id)
      if (!titleMatches && matchingIdx < 0 && extraitDistant === undefined) return []
      return [
        {
          conversation,
          matchedIn: titleMatches ? ('title' as const) : ('message' as const),
          snippet:
            matchingIdx >= 0 ? excerpt(messages[matchingIdx].content, query) : extraitDistant
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

/** Combien de conversations la catégorie « Récentes » affiche au plus. */
export const RECENTES_AFFICHEES = 20

/**
 * Les N conversations où l'utilisateur a parlé le plus récemment, TOUTES PROVENANCES CONFONDUES.
 *
 * Mesuré le 2026-08-18 : les 3 conversations les plus récentes étaient au rang 172 sur 182 lignes.
 * `ordonnerGroupes` classe par NATURE (dossier → divers → auto-kaizen) AVANT la date — c'est
 * délibéré, ça protège l'arborescence et empêche « Auto-kaizen » de remonter — donc une conversation
 * sans dossier tombe derrière tout le contenu des dossiers, quelle que soit sa date. Cette section
 * répond à « où ai-je parlé en dernier » sans toucher à ce rang.
 *
 * Toujours en ordre RÉCENT, indépendamment du bouton de tri : elle s'appelle « Récentes ».
 * Rend une COPIE — l'entrée vient d'un `useMemo`, la trier en place serait une mutation invisible.
 */
export function conversationsRecentes<T extends ConversationSearchSource>(
  conversations: readonly T[],
  limite = RECENTES_AFFICHEES
): T[] {
  return [...conversations]
    .sort((gauche, droite) => recenceUtilisateur(droite) - recenceUtilisateur(gauche))
    .slice(0, Math.max(0, limite))
}

/**
 * La catégorie « Récentes » ne se montre que si elle SERT.
 *
 * Elle répond à UN défaut précis, mesuré le 2026-08-18 : la conversation la plus récente enterrée au
 * rang 172 sur 182 parce que les groupes se classent par nature avant la date. Quand elle est déjà la
 * première ligne, la catégorie ne ferait que réafficher ce qui est sous les yeux — sur une liste de 3
 * conversations, elle doublait la liste entière (défaut révélé par le test d'une session concurrente,
 * `ChatView.date-sort.test.tsx` : 6 titres au lieu de 3).
 *
 * On compare des IDENTITÉS, pas des dates : deux conversations peuvent partager une date.
 */
export function doitAfficherRecentes(
  plusRecenteId: string | undefined,
  premiereDeLaListeId: string | undefined,
  ordre: 'asc' | 'desc' = 'desc'
): boolean {
  if (!plusRecenteId) return false
  // En ordre « plus anciennes », la plus récente n'est par construction JAMAIS la première ligne : la
  // règle ci-dessous serait toujours vraie et la catégorie doublerait la liste en permanence. Or
  // demander l'ordre inverse, c'est précisément ne pas chercher sa dernière conversation.
  if (ordre === 'asc') return false
  return plusRecenteId !== premiereDeLaListeId
}

/**
 * Decoupe un texte en segments alternant hors-terme / terme, pour SURLIGNER ce qui a ete cherche.
 *
 * Compare sur la forme repliee (minuscules, sans accents) mais rend les segments du texte
 * D'ORIGINE : « À jour » se surligne quand on tape « a jour ». Les positions se correspondent parce
 * que la normalisation NFD ne retire que des diacritiques combinants, jamais de lettre.
 */
export function segmentsSurlignes(
  texte: string,
  rawQuery: string
): Array<{ texte: string; marque: boolean }> {
  const source = String(texte ?? '')
  const replie = normalize(source)
  const phrase = normalize(rawQuery).trim()
  /*
   * La PHRASE ENTIERE d'abord, les mots seulement si elle n'apparait pas.
   *
   * Surligner mot a mot d'emblee fait marquer le « a » de « graphe » quand on cherche « a jour » :
   * un mot de une ou deux lettres est present a peu pres partout, et le surlignage devient un bruit
   * qui cache la vraie correspondance. Quand la suite exacte est la, c'est ELLE que l'utilisateur
   * reconnait.
   */
  const tokens =
    phrase.length > 0 && replie.includes(phrase)
      ? [phrase]
      : [...new Set(phrase.split(/\s+/).filter(Boolean))]
  if (source.length === 0 || tokens.length === 0) return [{ texte: source, marque: false }]
  // Un masque par caractere : deux termes qui se chevauchent ne produisent alors qu'UNE marque,
  // au lieu de segments imbriques impossibles a rendre.
  const marques = new Array<boolean>(source.length).fill(false)
  let trouve = false
  for (const token of tokens) {
    let position = replie.indexOf(token)
    while (position >= 0) {
      trouve = true
      for (let i = position; i < position + token.length && i < marques.length; i += 1) {
        marques[i] = true
      }
      position = replie.indexOf(token, position + token.length)
    }
  }
  if (!trouve) return [{ texte: source, marque: false }]
  const segments: Array<{ texte: string; marque: boolean }> = []
  let debut = 0
  for (let i = 1; i <= source.length; i += 1) {
    if (i === source.length || marques[i] !== marques[debut]) {
      segments.push({ texte: source.slice(debut, i), marque: marques[debut] })
      debut = i
    }
  }
  return segments
}
