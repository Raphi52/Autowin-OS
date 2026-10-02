/**
 * ARRÊTS DE LA CHAÎNE ∞ GARDÉS SUR DISQUE (conv-38, 2026-10-02). L'arrêt posé par le garde-fou
 * (quota hebdomadaire Claude ou tours automatiques d'affilée) vivait seulement dans l'état React du
 * chat : un redémarrage de l'app l'effaçait, et le fil ne disait plus pourquoi ∞ s'était éteint.
 * Seuls CES arrêts sont gardés : les autres pauses du mode auto restent volatiles (conv-891).
 * Clé = id de la conversation ; retiré par ×, par un message de l'utilisateur ou par le rallumage de ∞.
 * fix-ok: cause mesurée — test de remontage rouge (aucun arrêt affiché après redémarrage) car l'arrêt n'était qu'en état React ; ce module neuf, écrit en étapes vérifiées, le garde dans localStorage.
 */
export const CLE_ARRETS_CHAINE_AUTO = 'autowin.chat.modeAuto.arretsChaine'

type Stockage = Pick<Storage, 'getItem' | 'setItem'>

export function lireArretsChaine(storage: Stockage): Record<string, string> {
  try {
    const lu: unknown = JSON.parse(storage.getItem(CLE_ARRETS_CHAINE_AUTO) ?? '{}')
    if (!lu || typeof lu !== 'object' || Array.isArray(lu)) return {}
    const propres: Record<string, string> = {}
    for (const [id, message] of Object.entries(lu)) {
      if (typeof message === 'string' && message) propres[id] = message
    }
    return propres
  } catch {
    return {}
  }
}

export function noterArretChaine(storage: Stockage, id: string, message: string): void {
  if (!id || !message) return
  storage.setItem(
    CLE_ARRETS_CHAINE_AUTO,
    JSON.stringify({ ...lireArretsChaine(storage), [id]: message })
  )
}

export function oublierArretChaine(storage: Stockage, id: string): void {
  const courant = lireArretsChaine(storage)
  if (!(id in courant)) return
  delete courant[id]
  storage.setItem(CLE_ARRETS_CHAINE_AUTO, JSON.stringify(courant))
}
