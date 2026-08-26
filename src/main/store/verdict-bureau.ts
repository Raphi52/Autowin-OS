/**
 * UN BUREAU CONSERVE PORTE UN VERDICT LISIBLE, DERIVE D'UNE PREUVE.
 *
 * DEFAUT MESURE le 2026-08-25 : la liste des travaux non publies donnait un nom, une date et des
 * fichiers — mais aucun VERDICT. Pour savoir si un bureau valait quelque chose, il fallait ouvrir
 * son patch, un par un. C'est exactement ce qu'il a fallu faire a la main sur seize bureaux ce
 * jour-la ; ce module rend ce tri automatique.
 *
 * DERIVE, JAMAIS STOCKE. Un etat ecrit a cote du reel s'en desynchronise — c'est la meme famille de
 * defaut qu'un libelle qui ment. Un etat DERIVE ne peut pas mentir plus longtemps que la preuve qui
 * le porte. Les deux faits utilises sont deja calcules par `apercuTravauxNonPublies` : ce que le
 * bureau AJOUTE a la base, et s'il a seulement enregistre quelque chose.
 *
 * L'ORDRE DES TESTS EST LA REGLE ELLE-MEME. Les fichiers passent AVANT le commit : un bureau qui
 * porte du travail est « a reprendre » meme si rien n'a ete commite. Tester le commit d'abord
 * classerait « sans valeur » un bureau porteur — precisement la perte que tout ce chantier existe
 * pour empecher.
 */

/** Ce que l'app peut dire d'un bureau conserve, sans que personne n'ouvre son patch. */
export type VerdictBureau = 'a-reprendre' | 'trie' | 'sans-valeur' | 'inconnu'

/** Libelles montres tels quels : un verdict que l'utilisateur doit decoder n'en est pas un. */
export const LIBELLE_VERDICT: Record<VerdictBureau, string> = {
  'a-reprendre': 'À reprendre',
  trie: 'Trié',
  'sans-valeur': 'Sans valeur',
  inconnu: 'Lecture impossible'
}

export function verdictDeBureau(preuve: {
  /** Ce que le bureau ajoute a la base (`git diff --name-only base...branche`). */
  fichiers: readonly string[]
  /** Le bureau a-t-il seulement enregistre un commit ? */
  aUnCommit: boolean
  /**
   * `fichiers` est-il une CONSTATATION, ou l'echo d'une lecture qui a echoue ?
   *
   * DEFAUT DE CE MODULE, trouve le 2026-08-26 par un audit concurrent sur le module voisin.
   * `apercuTravauxNonPublies` enveloppe son `git diff` dans un catch muet qui laisse
   * `fichiers = []`. Un index verrouille par une session concurrente suffisait donc a faire lire
   * « rien a ajouter » — et, avec un commit existant, a AFFICHER « Trie » sur un bureau qui porte
   * peut-etre du travail. Un verdict rassurant FAUX est la pire des sorties : il invite a purger.
   */
  lectureEchouee?: boolean
}): VerdictBureau {
  // Le travail prime sur tout le reste : c'est la seule branche irreversible si on se trompe. Ce
  // qui a ete effectivement LU reste une constatation, meme si une autre lecture a echoue a cote.
  if (preuve.fichiers.length > 0) return 'a-reprendre'
  // « On n'a pas pu lire » n'est pas « il n'y a rien ». Le dire, plutot que de rassurer a tort.
  if (preuve.lectureEchouee) return 'inconnu'
  // Rien a ajouter, mais quelque chose a ete enregistre : son contenu est deja dans la base.
  if (preuve.aUnCommit) return 'trie'
  return 'sans-valeur'
}
