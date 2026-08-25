/**
 * LE MOTEUR QUI TOURNE EST-IL ENCORE CELUI DES SOURCES ?
 *
 * LE DEFAUT, mesure le 2026-08-25, deux fois dans la meme journee. En developpement,
 * `electron-vite dev` construit le processus PRINCIPAL une seule fois : une correction dans
 * `src/main/**` reste invisible dans l'application qui tourne jusqu'a un redemarrage manuel.
 * Mesure directe : un fichier de `src/main` touche, `out/main/index.js` JAMAIS reconstruit apres
 * 75 secondes d'attente. Le rechargement a chaud du RENDERER, lui, fonctionne -- d'ou le piege :
 * l'interface bouge, le moteur non, et rien ne le dit.
 *
 * CE QUE CA PRODUIT : on ecrit un correctif, la suite passe au vert, on l'annonce -- et l'ecran
 * continue d'executer l'ancien code. Deux fois ce jour-la, une conclusion fausse a ete tiree d'un
 * binaire perime (« le veilleur ne reconstruit pas », puis « le correctif n'est pas dans le
 * bundle ») avant que la mesure ne retablisse les faits.
 *
 * POURQUOI ON NE CORRIGE PAS EN REDEMARRANT TOUT SEUL. Le drapeau `--watch` ferait exactement cela,
 * et il a deja ete essaye : il tuait l'application PENDANT le travail. L'utilisateur l'a demande
 * retire (`conv-1267` : « pendant que je bosse le processus autowin OS se kill tout seul, fix ca »),
 * deux de ses runs ayant ete detruits. Un test l'interdit desormais (`dev-sans-watch.test.ts`).
 * On rend donc la peremption VISIBLE au lieu de la corriger dans le dos de l'utilisateur : voir,
 * c'est ce qui manquait ; redemarrer, c'est ce qui nuisait.
 *
 * LE DISCRIMINANT est l'INSTANT DE DEMARRAGE du processus, pas la date du bundle. Un processus ne
 * peut pas contenir un fichier ecrit APRES son propre demarrage -- c'est vrai que le bundle ait ete
 * reconstruit ou non, donc cette seule comparaison couvre les deux formes de peremption (le bundle
 * pas reconstruit, et le bundle reconstruit mais le processus pas relance).
 */

/** Ce qu'on sait de l'etat du moteur. `undefined` quand la question n'a pas de sens. */
export interface EtatDuMoteur {
  perime: boolean
  /** Le fichier source le plus recent, pour que l'avertissement NOMME au lieu de compter. */
  fichier?: string
  /** Depuis combien de temps, en millisecondes. */
  retardMs?: number
}

export interface SourceObservee {
  chemin: string
  modifieeMs: number
}

/**
 * Le moteur en cours d'execution est-il anterieur a ses sources ?
 *
 * NE REND JAMAIS `perime: true` SANS PREUVE. Aucune source observee, un instant de demarrage
 * inconnu, des dates aberrantes : on rend « non perime » plutot que d'agiter un avertissement que
 * rien n'etaye. Un avertissement qui se declenche a tort cesse d'etre lu -- et il vaut alors moins
 * que pas d'avertissement du tout.
 */
export function etatDuMoteur(
  demarrageMs: number | undefined,
  sources: readonly SourceObservee[],
  margeMs = 2_000
): EtatDuMoteur {
  if (!Number.isFinite(demarrageMs) || (demarrageMs ?? 0) <= 0) return { perime: false }
  const depart = demarrageMs as number

  let laPlusRecente: SourceObservee | undefined
  for (const source of sources) {
    if (!Number.isFinite(source.modifieeMs) || source.modifieeMs <= 0) continue
    if (!laPlusRecente || source.modifieeMs > laPlusRecente.modifieeMs) laPlusRecente = source
  }
  if (!laPlusRecente) return { perime: false }

  /*
   * LA MARGE existe pour une raison mesurable, pas par prudence decorative : entre l'ecriture d'un
   * fichier et le demarrage effectif du processus qui l'embarque, il s'ecoule un delai de build. Une
   * source ecrite JUSTE avant un demarrage est donc bien DANS le binaire, malgre une date
   * legerement anterieure. Sans cette marge, chaque relance signalerait une peremption imaginaire.
   */
  const retardMs = laPlusRecente.modifieeMs - depart
  if (retardMs <= margeMs) return { perime: false }

  return { perime: true, fichier: laPlusRecente.chemin, retardMs }
}

/** L'avertissement destine au pied de page : court, et il NOMME le fichier en cause. */
export function messageMoteurPerime(etat: EtatDuMoteur): string | undefined {
  if (!etat.perime || !etat.fichier) return undefined
  const minutes = Math.max(1, Math.round((etat.retardMs ?? 0) / 60_000))
  return `moteur périmé — ${etat.fichier} modifié il y a ${minutes} min, relance l’app pour l’exécuter`
}
