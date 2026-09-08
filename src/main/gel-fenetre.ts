import { journaliserGel } from './gel-main'
import type { Gel } from '../shared/gel-detector'

/**
 * LE SEUL GEL QUE PERSONNE NE VOYAIT — celui de la FENETRE.
 *
 * Mesure du 2026-09-08 (conv-353) : cliquer une grosse fiche du Brain figeait l'interface jusqu'a
 * devoir tuer l'application, et `gels.jsonl` n'en portait AUCUNE ligne. Deux angles morts se
 * cumulaient. Le battement de `gel-main` ne surveille que le process PRINCIPAL : il tournait
 * parfaitement pendant que la fenetre etait morte. Et le rapporteur cote interface n'emet qu'APRES
 * sa tache longue — donc jamais, si l'utilisateur tue l'application avant la fin.
 *
 * Electron, lui, le sait de l'exterieur : il emet `unresponsive` des que la fenetre ne repond plus.
 * On journalise donc DES L'ENTREE dans le gel, pas a sa sortie — c'est ce qui garantit une trace
 * meme quand l'application est tuee. Une seconde ligne, a `responsive`, donne la duree REELLE
 * quand la fenetre revient.
 */

/** Le minimum vital d'une fenetre pour cette surveillance — pour ne pas exiger un vrai Electron en test. */
export interface FenetreSurveillee {
  on(evenement: 'unresponsive' | 'responsive', ecouteur: () => void): unknown
  off?(evenement: 'unresponsive' | 'responsive', ecouteur: () => void): unknown
  /** Optionnel : le contenu de la fenetre, seul emetteur de la disparition de son processus. */
  webContents?: {
    on(evenement: 'render-process-gone', ecouteur: (...args: unknown[]) => void): unknown
    off?(evenement: 'render-process-gone', ecouteur: (...args: unknown[]) => void): unknown
  }
}

export const OPERATION_ENTREE_EN_GEL = 'renderer:fenetre-injoignable'
export const OPERATION_SORTIE_DE_GEL = 'renderer:fenetre-revenue'
/**
 * TROISIEME ANGLE MORT — la fenetre ne revient pas : son PROCESSUS DISPARAIT.
 *
 * Mesure du 2026-09-08 15:09 : 5,6 s d'interface injoignable, puis un processus d'affichage NEUF
 * 15 s plus tard. Vu de l'utilisateur c'est un gel ; vu du journal, il ne restait qu'une ligne
 * `fenetre-revenue` trompeuse, parce que rien n'ecoutait la mort du processus. Sans ce motif, un
 * manque de memoire et une boucle sans fin laissent exactement la meme trace.
 */
export const OPERATION_PROCESSUS_DISPARU = 'renderer:processus-disparu'

/**
 * Branche l'ecoute et rend la fonction qui la retire.
 *
 * `journaliser` et `maintenant` ne sont injectes que pour rendre le test deterministe : la
 * production garde le puits unique de `gel-main` et l'horloge reelle.
 */
export function surveillerFenetreInjoignable(
  fenetre: FenetreSurveillee,
  journaliser: (gel: Gel) => void = journaliserGel,
  maintenant: () => number = Date.now
): () => void {
  let debut: number | undefined

  const surInjoignable = (): void => {
    debut = maintenant()
    journaliser({
      ts: new Date(debut).toISOString(),
      // La duree n'est pas encore connue : Electron signale l'ENTREE dans le gel. Mentir ici
      // (inventer un seuil) polluerait les statistiques ; 0 dit exactement « pas encore mesuree ».
      blocageMs: 0,
      operation: OPERATION_ENTREE_EN_GEL,
      cause: 'boucle-tenue'
    })
  }

  const surRevenue = (): void => {
    // Sans entree connue, il n'y a pas de duree a rendre — et une ligne sans duree n'apprend rien.
    if (debut === undefined) return
    const fin = maintenant()
    journaliser({
      ts: new Date(fin).toISOString(),
      blocageMs: Math.max(0, fin - debut),
      operation: OPERATION_SORTIE_DE_GEL,
      cause: 'boucle-tenue'
    })
    debut = undefined
  }

  const surDisparition = (...args: unknown[]): void => {
    const details = args[1] as { reason?: string; exitCode?: number } | undefined
    const fin = maintenant()
    journaliser({
      ts: new Date(fin).toISOString(),
      // Si la fenetre etait deja injoignable, on connait la duree vecue avant la mort ; sinon 0,
      // parce qu'inventer une duree fausserait les statistiques.
      blocageMs: debut === undefined ? 0 : Math.max(0, fin - debut),
      operation: `${OPERATION_PROCESSUS_DISPARU}:${details?.reason ?? 'inconnu'}`,
      cause: 'boucle-tenue'
    })
    debut = undefined
  }

  fenetre.on('unresponsive', surInjoignable)
  fenetre.on('responsive', surRevenue)
  fenetre.webContents?.on('render-process-gone', surDisparition)
  return () => {
    fenetre.off?.('unresponsive', surInjoignable)
    fenetre.off?.('responsive', surRevenue)
    fenetre.webContents?.off?.('render-process-gone', surDisparition)
  }
}
