import { ensureAutowinAppData } from '../app/app-data'
import { creerIndexStore } from './json-index-store'

/**
 * LE COMPTE-RENDU D'UN TOUR EXECUTE SANS LE MODELE SURVIT AU REDEMARRAGE (2026-10-16).
 *
 * Un `/scout`, `/build`… lance par l'app rend la main AVANT tout appel au modele : son compte-rendu
 * est garde pour etre remis au tour suivant (`comptesRendusNonVus`, agent-pilot.ts — le trou de
 * session du 2026-08-14). Cette note ne vivait qu'en MEMOIRE, alors que la session du modele, elle,
 * est rehydratee depuis le disque (`chat-session-store.ts`). Un redemarrage entre les deux tours
 * rouvrait donc exactement le trou : le modele reprenait sa session sans savoir que le run avait eu
 * lieu. Le commentaire de la carte le disait lui-meme : « LIMITE ASSUMEE ».
 *
 * Fichier A PART plutot qu'un champ ajoute a `chat-sessions.json` : la forme de ce cache reste
 * intacte, et une note perdue ne coute qu'un trou, pas une session.
 *
 * FAIL-OPEN, comme tout cache : un fichier illisible vaut « aucune note », jamais une exception qui
 * casserait le tour de l'utilisateur.
 */
export interface CompteRenduNonVu {
  texte: string
  /** Horodatage du depot : un lecteur peut dire de quand date le tour manquant. */
  at: number
}

function estCompteRendu(valeur: unknown): valeur is CompteRenduNonVu {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return false
  const r = valeur as Record<string, unknown>
  return typeof r.texte === 'string' && !!r.texte && typeof r.at === 'number'
}

const store = creerIndexStore<CompteRenduNonVu>('comptes-rendus-non-vus.json', estCompteRendu)

export function compteRenduNonVuStorePath(base = ensureAutowinAppData()): string {
  return store.chemin(base)
}

/** La note ET son heure de dépôt : sans elle, une note d'un mois revenait comme un fait du jour. */
export function lireCompteRenduNonVu(
  conversationId: string,
  base = ensureAutowinAppData()
): CompteRenduNonVu | undefined {
  return store.lire(base)[conversationId]
}

export function deposerCompteRenduNonVu(
  conversationId: string,
  texte: string,
  base = ensureAutowinAppData(),
  at = Date.now()
): void {
  if (!conversationId || !texte.trim()) return
  const index = store.lire(base)
  index[conversationId] = { texte, at }
  store.ecrire(index, base)
}

export function oublierCompteRenduNonVu(
  conversationId: string,
  base = ensureAutowinAppData()
): void {
  store.oublier(conversationId, base)
}
