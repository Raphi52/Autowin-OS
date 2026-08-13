import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'
import { cleDedup, type CandidatVeille } from './candidats'

/**
 * Le stock des candidats de veille, sur le disque LOCAL.
 *
 * Même patron que `task-manager/task-store-disk.ts` : un JSON dans la racine de données de
 * l'application, écrit dans un fichier temporaire puis renommé — donc une coupure au mauvais moment ne
 * laisse jamais un fichier à moitié écrit.
 *
 * Pourquoi PAS le Brain partagé, qui aurait pu paraître le bon endroit pour de la connaissance : il vit
 * sur un partage réseau (`//ged2/...`), et sa latence a déjà été mesurée coûteuse dans ce dépôt — le
 * serveur Brain met ~30-40 s à répondre au démarrage à cause de ce partage. Un stock que la vue Tickets
 * relit à chaque ouverture n'a rien à faire derrière SMB.
 *
 * Une passe de veille AJOUTE ; elle n'écrase jamais. Un candidat écarté à la main doit rester écarté au
 * tour suivant, sinon la liste se repeuple de ce qu'on vient de refuser.
 */

export interface EchecSource {
  concurrent: string
  url: string
  /** Ce qui a échoué, en clair. Une source muette doit se VOIR, pas disparaître. */
  detail: string
  vuLe: string
}

export interface StockVeille {
  candidats: CandidatVeille[]
  /**
   * Les sources qui n'ont pas répondu à la DERNIÈRE passe.
   *
   * Remplacées à chaque passe et non accumulées : ce qui intéresse est « quelles sources sont muettes
   * maintenant », pas l'historique de leurs pannes. Une source qui redevient lisible sort d'elle-même.
   */
  echecs: EchecSource[]
  dernierePasse?: string
}

const STOCK_VIDE: StockVeille = { candidats: [], echecs: [] }

export function cheminStockVeille(): string {
  return join(ensureAutowinAppData(), 'veille-candidats.json')
}

/** Relit le stock. Un fichier absent ou illisible rend un stock VIDE, jamais une exception. */
export function lireStockVeille(chemin = cheminStockVeille()): StockVeille {
  if (!existsSync(chemin)) return { ...STOCK_VIDE }
  try {
    const valeur: unknown = JSON.parse(readFileSync(chemin, 'utf8'))
    if (!valeur || typeof valeur !== 'object') return { ...STOCK_VIDE }
    const brut = valeur as Partial<StockVeille>
    return {
      candidats: Array.isArray(brut.candidats) ? brut.candidats : [],
      echecs: Array.isArray(brut.echecs) ? brut.echecs : [],
      ...(brut.dernierePasse ? { dernierePasse: brut.dernierePasse } : {})
    }
  } catch {
    // Un JSON corrompu ne doit pas empêcher l'onglet de s'ouvrir : on repart d'un stock vide, et la
    // prochaine passe le remplit. Effacer silencieusement serait pire — le fichier reste sur le disque.
    return { ...STOCK_VIDE }
  }
}

/** Écrit le stock de façon atomique : fichier temporaire puis renommage. */
export function ecrireStockVeille(stock: StockVeille, chemin = cheminStockVeille()): void {
  mkdirSync(dirname(chemin), { recursive: true })
  const temporaire = `${chemin}.tmp`
  writeFileSync(temporaire, JSON.stringify(stock, null, 2), 'utf8')
  renameSync(temporaire, chemin)
}

/** Les clés déjà connues, pour que la déduplication porte sur TOUT l'historique. */
export function clesConnues(stock: StockVeille): Set<string> {
  return new Set(stock.candidats.map((candidat) => cleDedup(candidat)))
}

/**
 * Verse le résultat d'une passe dans le stock : ajout des nouveaux, remplacement des échecs.
 *
 * Les candidats existants sont conservés TELS QUELS, statut compris. C'est ce qui fait qu'un candidat
 * marqué « écarté » ou « prompté » ne redevient pas « nouveau » à la passe suivante.
 */
export function fusionnerPasse(
  stock: StockVeille,
  passe: { retenus: readonly CandidatVeille[]; echecs: readonly EchecSource[]; maintenant: string }
): StockVeille {
  const connues = clesConnues(stock)
  const ajouts = passe.retenus.filter((candidat) => !connues.has(cleDedup(candidat)))
  return {
    candidats: [...stock.candidats, ...ajouts],
    echecs: [...passe.echecs],
    dernierePasse: passe.maintenant
  }
}
