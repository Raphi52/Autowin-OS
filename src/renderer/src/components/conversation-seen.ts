/**
 * VISITE des conversations — socle PUR de la pastille « fini mais pas encore vu ».
 *
 * Une conversation est NON VUE tant que sa derniere mise a jour est posterieure a la derniere
 * visite enregistree. Le marqueur est local a la vue : il dit ce que CET utilisateur a ouvert,
 * il n'appartient pas au store d'execution.
 */
export type ConversationsVues = Record<string, number>

export const CLE_CONVERSATIONS_VUES = 'autowin.conversations.vues'

export function estNonVue(
  conversation: { id: string; updatedAt?: number },
  vues: ConversationsVues
): boolean {
  const maj = conversation.updatedAt ?? 0
  return maj > (vues[conversation.id] ?? 0)
}

export function marquerVue(
  vues: ConversationsVues,
  id: string,
  updatedAt?: number
): ConversationsVues {
  const maj = updatedAt ?? Date.now()
  if ((vues[id] ?? 0) >= maj) return vues
  return { ...vues, [id]: maj }
}

/** Lecture tolerante : un stockage absent ou corrompu ne doit pas casser la liste. */
export function lireConversationsVues(storage?: Pick<Storage, 'getItem'>): ConversationsVues {
  try {
    const brut = storage?.getItem(CLE_CONVERSATIONS_VUES)
    if (!brut) return {}
    const parse: unknown = JSON.parse(brut)
    if (!parse || typeof parse !== 'object' || Array.isArray(parse)) return {}
    const sortie: ConversationsVues = {}
    for (const [id, valeur] of Object.entries(parse as Record<string, unknown>)) {
      if (typeof valeur === 'number' && Number.isFinite(valeur)) sortie[id] = valeur
    }
    return sortie
  } catch {
    return {}
  }
}

export function ecrireConversationsVues(
  vues: ConversationsVues,
  storage?: Pick<Storage, 'setItem'>
): void {
  try {
    storage?.setItem(CLE_CONVERSATIONS_VUES, JSON.stringify(vues))
  } catch {
    /* un quota plein ne doit pas empecher d'afficher la liste */
  }
}
