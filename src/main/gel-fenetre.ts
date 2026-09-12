import { journaliserGel } from './gel-main'
import {
  doitReanimer,
  OPERATION_REANIMATION,
  REGLAGES_REANIMATION_PAR_DEFAUT,
  type ReglagesReanimation
} from './gel-reanimation'
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
    /** Recharge le contenu : tue le processus d'affichage bloque et en repart un neuf. */
    reloadIgnoringCache?(): void
    /** Recharge apres la mort du processus d'affichage — sans ca, la fenetre reste vide. */
    reload?(): void
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
 * POURQUOI ON N'A PAS REANIME — le motif, pas le silence.
 *
 * `doitReanimer` rend deja `sous-le-seuil` ou `trop-recent`, mais `tenterReanimation` sortait sans
 * rien ecrire : un journal qui porte des entrees en gel et zero reanimation etait indecidable
 * entre « la regle a refuse » et « le minuteur n'a jamais tire ». Le motif est suffixe a
 * l'operation, comme le fait deja `processus-disparu:<raison>`.
 */
export const OPERATION_REANIMATION_REFUSEE = 'renderer:fenetre-reanimation-refusee'

/**
 * Branche l'ecoute et rend la fonction qui la retire.
 *
 * `journaliser` et `maintenant` ne sont injectes que pour rendre le test deterministe : la
 * production garde le puits unique de `gel-main` et l'horloge reelle.
 */
export function surveillerFenetreInjoignable(
  fenetre: FenetreSurveillee,
  journaliser: (gel: Gel) => void = journaliserGel,
  maintenant: () => number = Date.now,
  reglages: ReglagesReanimation = REGLAGES_REANIMATION_PAR_DEFAUT,
  planifier: (action: () => void, delaiMs: number) => unknown = setTimeout
): () => void {
  let debut: number | undefined
  let derniereReanimation: number | undefined
  // Un episode de gel = un seul minuteur. Sans ce temoin, chaque re-emission d'`unresponsive` en
  // armerait un de plus, et la fenetre serait rechargee autant de fois qu'Electron a crie.
  let minuteurArme = false

  // REANIMATION : le gel n'a plus besoin que l'utilisateur ferme l'application. Le processus
  // principal, lui, repond encore : passe le seuil, il recharge la fenetre, ce qui repart sur un
  // processus d'affichage neuf sans toucher aux runs en cours.
  const tenterReanimation = (): void => {
    if (debut === undefined) return
    const instant = maintenant()
    const verdict = doitReanimer(
      { gelDepuisMs: instant - debut, derniereReanimation, maintenant: instant },
      reglages
    )
    minuteurArme = false
    if (!verdict.reanimer) {
      journaliser({
        ts: new Date(instant).toISOString(),
        blocageMs: instant - debut,
        operation: `${OPERATION_REANIMATION_REFUSEE}:${verdict.motif}`,
        cause: 'boucle-tenue'
      })
      // Le gel COURT toujours : on redonne sa chance a la regle au moment ou elle pourra dire oui,
      // sinon un refus unique condamnerait l'episode entier a n'etre jamais reanime.
      const attente =
        verdict.motif === 'sous-le-seuil'
          ? reglages.seuilMs - (instant - debut)
          : reglages.delaiEntreDeuxMs - (instant - (derniereReanimation ?? instant))
      if (attente > 0) {
        minuteurArme = true
        planifier(tenterReanimation, attente)
      }
      return
    }
    derniereReanimation = instant
    journaliser({
      ts: new Date(instant).toISOString(),
      blocageMs: instant - debut,
      operation: OPERATION_REANIMATION,
      cause: 'boucle-tenue'
    })
    fenetre.webContents?.reloadIgnoringCache?.()
  }

  const surInjoignable = (): void => {
    /*
     * LE CHRONO PART A LA PREMIERE ALERTE, ET NE REPART PLUS.
     *
     * Electron RE-EMET `unresponsive` tant que la fenetre ne repond pas — mesure du 2026-09-08 :
     * 10:40:43, 10:41:01, 10:41:19, 10:41:36, soit 17 a 19 s d'intervalle, tous SOUS le seuil de
     * 20 s. Reposer `debut` a chaque cri remettait la duree de gel a zero : le seuil n'etait jamais
     * franchi, `doitReanimer` repondait eternellement `sous-le-seuil`, et `gels.jsonl` a fini avec
     * 14 entrees `fenetre-injoignable` pour ZERO `fenetre-reanimee`. C'est aussi ce qui a produit
     * la duree aberrante de 5 933 781 ms journalisee comme un gel unique.
     */
    const premiereAlerte = debut === undefined
    if (premiereAlerte) debut = maintenant()
    if (!minuteurArme) {
      minuteurArme = true
      planifier(tenterReanimation, reglages.seuilMs)
    }
    // Les cris suivants du MEME episode ne sont pas des entrees en gel : les journaliser une
    // seconde fois gonflerait le compte des gels sans qu'aucun gel de plus ait eu lieu.
    if (!premiereAlerte) return
    journaliser({
      ts: new Date(debut as number).toISOString(),
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
    minuteurArme = false
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
    minuteurArme = false
    /*
     * REMETTRE EN ROUTE. Mesure du 2026-09-08 17:13 : l'escalade a bien tue le processus d'affichage
     * (ligne `processus-disparu:crashed`) et la fenetre est restee MORTE — Electron ne recree pas
     * l'affichage tout seul. Tuer sans relancer laisse donc l'utilisateur devant une fenetre vide,
     * ce qui est PIRE que le gel. Le rechargement est le geste qui repart sur un processus neuf.
     */
    fenetre.webContents?.reload?.()
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
