/**
 * Registre PARTAGE des conversations armees en mode auto du chat.
 * Demande utilisateur du 2026-09-24 : « les convers ainsi ouvertes [par le mode auto Tickets]
 * doivent etre en mode auto ». La vue Tickets n'a pas acces a l'etat React du chat : elle ecrit
 * dans le meme stockage ET previent la vue chat (si elle est montee) par un evenement, sinon
 * l'effet de persistance du chat reecrirait le stockage avec son ancien ensemble.
 */
export const CLE_MODE_AUTO_CONVS = 'autowin.chat.modeAuto.convs'
export const EVT_ARMER_MODE_AUTO = 'autowin:chat-auto-armer'

type Stockage = Pick<Storage, 'getItem' | 'setItem'>

export function lireConvsAuto(storage: Stockage): Set<string> {
  try {
    const lu = JSON.parse(storage.getItem(CLE_MODE_AUTO_CONVS) ?? '[]')
    if (Array.isArray(lu)) return new Set(lu.filter((x): x is string => typeof x === 'string'))
  } catch {
    /* reglage illisible : on repart a vide */
  }
  return new Set()
}

/** Arme le mode auto du chat sur UNE conversation nommee. Ne touche a aucune autre. */
export function armerModeAutoConversation(
  id: string,
  storage: Stockage,
  cible: Pick<EventTarget, 'dispatchEvent'> | null = typeof window !== 'undefined' ? window : null
): void {
  if (!id) return
  const convs = lireConvsAuto(storage)
  convs.add(id)
  try {
    storage.setItem(CLE_MODE_AUTO_CONVS, JSON.stringify([...convs]))
  } catch {
    /* quota : l'evenement suffit si le chat est monte */
  }
  cible?.dispatchEvent(new CustomEvent(EVT_ARMER_MODE_AUTO, { detail: id }))
}
