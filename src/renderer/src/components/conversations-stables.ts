/**
 * LISTE DES CONVERSATIONS STABLE D'UN RAFRAÎCHISSEMENT À L'AUTRE (gel `renderer:vue-chat-liste`,
 * diagnostic /gel conv-1115, 2026-10-23).
 *
 * L'IPC rend TOUJOURS des objets neufs : poser la liste rechargée telle quelle faisait redessiner
 * les ~1 000 lignes mémorisées (`LigneConversation`, mémorisée sur l'objet `c`) pour un seul fil
 * modifié. Ici, chaque fil dont le CONTENU n'a pas bougé reprend l'objet déjà affiché : seules les
 * lignes réellement modifiées changent de props. Si rien n'a bougé du tout, la liste précédente
 * elle-même est rendue, et React n'a rien à faire.
 *
 * L'ORDRE et l'APPARTENANCE viennent toujours de la liste chargée (un fil supprimé disparaît, un
 * fil nouveau apparaît, un tri qui change se voit) : seule l'IDENTITÉ des objets est réutilisée, et
 * seulement à contenu égal. Les mises à jour locales de la vue (`setConvs((c) => c.map(...))`)
 * copient l'objet modifié au lieu de le muter, ce qui rend la réutilisation sûre.
 */

/**
 * Égalité de CONTENU entre deux valeurs issues de l'IPC (clone structuré : objets simples,
 * tableaux, primitives). Pas de cycle possible dans ces données.
 */
export function memeContenu(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const autre = b as unknown[]
    if (a.length !== autre.length) return false
    for (let i = 0; i < a.length; i++) if (!memeContenu(a[i], autre[i])) return false
    return true
  }
  const gauche = a as Record<string, unknown>
  const droite = b as Record<string, unknown>
  const cles = Object.keys(gauche)
  if (cles.length !== Object.keys(droite).length) return false
  for (const cle of cles) {
    if (!Object.prototype.hasOwnProperty.call(droite, cle)) return false
    if (!memeContenu(gauche[cle], droite[cle])) return false
  }
  return true
}

/**
 * La liste `chargees`, où chaque fil au contenu inchangé est remplacé par l'objet de `affichees`.
 * Rend `affichees` elle-même quand rien n'a changé (même longueur, même ordre, mêmes contenus).
 */
export function reutiliserConversationsInchangees<T extends { id: string }>(
  affichees: readonly T[],
  chargees: T[]
): T[] {
  const parId = new Map<string, T>()
  for (const conversation of affichees) parId.set(conversation.id, conversation)
  let toutesReprises = chargees.length === affichees.length
  const stables = chargees.map((fraiche, rang) => {
    const ancienne = parId.get(fraiche.id)
    const reprise = ancienne !== undefined && memeContenu(ancienne, fraiche) ? ancienne : fraiche
    if (reprise !== affichees[rang]) toutesReprises = false
    return reprise
  })
  return toutesReprises ? (affichees as T[]) : stables
}
