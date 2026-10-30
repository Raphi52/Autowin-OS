/*
 * CE QU'UNE PAGE INTERACTIVE SAUVEGARDE SURVIT AU REDEMARRAGE DE L'APP (conv-1304, 2026-10-30).
 *
 * Le cadre a une origine opaque : son `localStorage` est une imitation en memoire (amorce.js), et
 * le fil en gardait une copie le temps de la session (page-interactive.ts). Au redemarrage, un
 * simulateur repartait donc de ses valeurs de depart. Le fil recopie ici chaque sauvegarde.
 *
 * IndexedDB plutot qu'un fichier du processus principal : aucun nouveau canal entre l'interface et
 * le disque pour des donnees qui ne servent qu'a l'interface, et aucune lecture bloquante. Il garde
 * les pages dans l'origine de l'app : developpement et version installee ne partagent pas leurs
 * sauvegardes, comme le reste de leur stockage.
 *
 * Un echec n'empeche jamais la page de tourner : elle garde alors la copie de session.
 */
const BASE = 'autowin-pages-interactives'
const MAGASIN = 'stockages'
const INDEX_DATE = 'maj'

/** Au-dela, les pages sauvegardees depuis le plus longtemps sont oubliees. */
export const MAX_PAGES_DURABLES = 200

/** Une page n'attend pas sa sauvegarde plus longtemps : elle demarre sans, plutot que rester vide. */
export const DELAI_LECTURE_DURABLE_MS = 400

let ouverture: Promise<IDBDatabase | null> | null = null

export function stockageDurableDisponible(): boolean {
  return typeof indexedDB !== 'undefined'
}

function ouvrir(): Promise<IDBDatabase | null> {
  ouverture ??= new Promise((resoudre) => {
    if (!stockageDurableDisponible()) {
      resoudre(null)
      return
    }
    const demande = indexedDB.open(BASE, 1)
    demande.onupgradeneeded = (): void => {
      demande.result.createObjectStore(MAGASIN).createIndex(INDEX_DATE, 'maj')
    }
    demande.onsuccess = (): void => resoudre(demande.result)
    demande.onerror = (): void => {
      console.warn('[page-interactive] sauvegardes indisponibles :', demande.error)
      resoudre(null)
    }
  })
  return ouverture
}

export async function lireStockageDurable(
  cle: string
): Promise<Record<string, string> | undefined> {
  const base = await ouvrir()
  if (!base) return undefined
  return new Promise((resoudre) => {
    const demande = base.transaction(MAGASIN, 'readonly').objectStore(MAGASIN).get(cle)
    demande.onsuccess = (): void =>
      resoudre((demande.result as { donnees?: Record<string, string> } | undefined)?.donnees)
    demande.onerror = (): void => resoudre(undefined)
  })
}

/** Lecture bornee dans le temps : une base qui ne repond pas ne retient pas la page. */
export function lireStockageDurableBorne(
  cle: string,
  delaiMs = DELAI_LECTURE_DURABLE_MS
): Promise<Record<string, string> | undefined> {
  return Promise.race([
    lireStockageDurable(cle),
    new Promise<undefined>((resoudre) => {
      setTimeout(() => resoudre(undefined), delaiMs)
    })
  ])
}

export async function ecrireStockageDurable(
  cle: string,
  donnees: Record<string, string>
): Promise<void> {
  const base = await ouvrir()
  if (!base) return
  const magasin = base.transaction(MAGASIN, 'readwrite').objectStore(MAGASIN)
  // Une page qui vide son stockage ne laisse pas de ligne derriere elle.
  if (Object.keys(donnees).length === 0) {
    magasin.delete(cle)
    return
  }
  magasin.put({ donnees, maj: Date.now() }, cle)
  const compte = magasin.count()
  compte.onsuccess = (): void => {
    let enTrop = compte.result - MAX_PAGES_DURABLES
    if (enTrop <= 0) return
    const curseur = magasin.index(INDEX_DATE).openKeyCursor()
    curseur.onsuccess = (): void => {
      const courant = curseur.result
      if (!courant || enTrop <= 0) return
      magasin.delete(courant.primaryKey)
      enTrop -= 1
      courant.continue()
    }
  }
}
