/**
 * TOURS AUTOMATIQUES D'AFFILÉE GARDÉS SUR LE POSTE (conv-38, 2026-10-02). Le compte du garde-fou ∞
 * vivait seulement dans un `useRef` du chat : un redémarrage de l'app le remettait à zéro, et un
 * fil dont les envois ne portent pas la mention « (Mode auto — … » repartait pour un plein quota de
 * tours. Mesure : ChatView.mode-auto-garde-chaine.test.tsx (seuil 1, redémarrage, ∞ rallumé → le
 * tour partait). Clé = id de la conversation ; retiré dès que l'utilisateur écrit dans le fil.
 */
export const CLE_TOURS_AUTO = 'autowin.chat.modeAuto.toursAuto'

type Stockage = Pick<Storage, 'getItem' | 'setItem'>

export function lireToursAuto(storage: Stockage): Map<string, number> {
  const tours = new Map<string, number>()
  try {
    const lu: unknown = JSON.parse(storage.getItem(CLE_TOURS_AUTO) ?? '{}')
    if (!lu || typeof lu !== 'object' || Array.isArray(lu)) return tours
    for (const [id, n] of Object.entries(lu)) {
      if (typeof n === 'number' && Number.isInteger(n) && n > 0) tours.set(id, n)
    }
  } catch {
    // Valeur illisible : on repart du compte lu dans le fil, comme avant ce module.
  }
  return tours
}

export function ecrireToursAuto(storage: Stockage, tours: ReadonlyMap<string, number>): void {
  storage.setItem(CLE_TOURS_AUTO, JSON.stringify(Object.fromEntries(tours)))
}
