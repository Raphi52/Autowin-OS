/**
 * BROUILLONS QUI SURVIVENT AU RECHARGEMENT DE LA FENÊTRE.
 *
 * Mesure du 2026-09-01 (conv-65) : « de temps en temps ça m'enlève de la conversation dans laquelle
 * je suis en train d'écrire et ça m'efface le message ». Le texte en cours de frappe vivait
 * UNIQUEMENT dans une ref du renderer (`composerDraftsRef`) : un rechargement de fenêtre (mise à
 * jour appliquée, rechargement à chaud en dev, plantage du renderer) le perdait définitivement.
 *
 * Le journal des saisies (`journal-saisie.ts`) ne couvre PAS ce cas : il n'écrit qu'au moment où le
 * texte QUITTE le composer (envoi ou orientation). Un brouillon jamais envoyé n'y laisse rien.
 *
 * `localStorage` et non le store disque : c'est un état local de fenêtre, du même ordre que la
 * dernière conversation ouverte ou la largeur des panneaux. Les pièces jointes ne sont PAS retenues
 * (leur contenu ne se sérialise pas raisonnablement) — seul le TEXTE, qui est ce qui se perd.
 */
export const CLE_BROUILLONS = 'autowin.chat.brouillons'

/** Plafond de sécurité : un brouillon géant ne doit pas saturer le stockage local. */
const TAILLE_MAX = 200_000

interface StockageLocal {
  getItem(cle: string): string | null
  setItem(cle: string, valeur: string): void
}

function stockage(explicite?: StockageLocal): StockageLocal | undefined {
  if (explicite) return explicite
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/** Les brouillons retenus, indexés par conversation (ou par la clé « nouvelle conversation »). */
export function lireBrouillons(explicite?: StockageLocal): Record<string, string> {
  const store = stockage(explicite)
  if (!store) return {}
  let brut: string | null = null
  try {
    brut = store.getItem(CLE_BROUILLONS)
  } catch {
    return {}
  }
  if (!brut) return {}
  try {
    const lu = JSON.parse(brut) as unknown
    if (!lu || typeof lu !== 'object' || Array.isArray(lu)) return {}
    const sortie: Record<string, string> = {}
    for (const [cle, valeur] of Object.entries(lu as Record<string, unknown>)) {
      // Une entrée corrompue est IGNORÉE, elle n'invalide pas les autres brouillons : on récupère
      // tout ce qui est récupérable, jamais rien de moins.
      if (typeof valeur === 'string' && valeur !== '') sortie[cle] = valeur.slice(0, TAILLE_MAX)
    }
    return sortie
  } catch {
    return {}
  }
}

/**
 * Retient (ou oublie, si le texte est vide) le brouillon d'une conversation.
 *
 * Un échec d'écriture ne remonte JAMAIS : la persistance est un filet, elle ne doit pas casser une
 * frappe ni un envoi — même invariant que le journal des saisies.
 */
export function memoriserBrouillon(cle: string, texte: string, explicite?: StockageLocal): void {
  const store = stockage(explicite)
  if (!store || !cle) return
  const courant = lireBrouillons(store)
  if (texte.trim() === '') {
    if (!(cle in courant)) return
    delete courant[cle]
  } else {
    if (courant[cle] === texte) return
    courant[cle] = texte.slice(0, TAILLE_MAX)
  }
  try {
    store.setItem(CLE_BROUILLONS, JSON.stringify(courant))
  } catch {
    // Quota atteint ou stockage indisponible : le brouillon reste en mémoire, comme avant.
  }
}

/** Oublie les brouillons de conversations qui n'existent plus (suppression, purge). */
export function oublierBrouillons(cles: readonly string[], explicite?: StockageLocal): void {
  const store = stockage(explicite)
  if (!store || cles.length === 0) return
  const courant = lireBrouillons(store)
  let change = false
  for (const cle of cles) {
    if (cle in courant) {
      delete courant[cle]
      change = true
    }
  }
  if (!change) return
  try {
    store.setItem(CLE_BROUILLONS, JSON.stringify(courant))
  } catch {
    /* voir memoriserBrouillon */
  }
}

/**
 * Y a-t-il un texte EN ATTENTE pour cette conversation ? Sert d'arbitre au démarrage : une reprise
 * automatique ne doit pas emmener l'utilisateur ailleurs quand il avait un message à moitié écrit
 * (« ça m'enlève de la conversation dans laquelle je suis en train d'écrire », 2026-09-01).
 */
export function brouillonEnAttente(cle: string | undefined, explicite?: StockageLocal): boolean {
  if (!cle) return false
  const texte = lireBrouillons(explicite)[cle]
  return typeof texte === 'string' && texte.trim() !== ''
}
