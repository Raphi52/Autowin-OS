/**
 * LES PROJETS DU FILTRE DU BOARD (conv-1329, 2026-10-30) — calcul PUR.
 *
 * Demande : « filtre par projet dans le board en plus du filtre par personne ». Puis, sur la
 * première liste : « pk ya autowinos et autowin-os dans les projets, pourquoi ya des projets qui
 * contiennent un nom de conv ». Le nom d'un projet est le nom de son DOSSIER (`groupeDe`,
 * conversation-groups.ts) ; deux causes mesurées sur les Boards du 30/10 :
 *   - un même projet porte un nom par poste : `D:\AutoWinOS` ici, `D:\SOurcees\Autowin-OS` chez
 *     Arthur → regroupés quand leurs noms ne diffèrent que par la casse et la ponctuation ;
 *   - un fil qui travaille dans une copie du dépôt (`D:\AutoWinOS-git-conv-1317`) ou dans un dossier
 *     d'essai (`D:\tmp\super-conv-test-1284`) donne un projet au nom du fil → la copie rejoint le
 *     projet dont son nom commence, le dossier d'essai rejoint « Autres dossiers ».
 * Le Board garde le libellé du dossier sur chaque post-it (infobulle) : seul le FILTRE regroupe.
 */

export interface ProjetDuFiltre {
  /** Ce que le menu retient : le nom canonique, ou `CLE_AUTRES`. */
  cle: string
  /** Ce que le menu affiche : le nom le plus porté du groupe. */
  nom: string
}

/** Le groupe des dossiers nommés d'après un fil sans projet reconnu ; aucun nom de dossier ne s'écrit ainsi. */
export const CLE_AUTRES = '\u0000autres'

/** « AutoWinOS » et « Autowin-OS » → « autowinos » : casse, accents et ponctuation ne comptent pas. */
export function nomCanonique(nom: string): string {
  return nom
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** Le mot « conv » isolé dans un nom de dossier : un dossier fait pour un fil, pas un projet. */
const NOM_DE_FIL = /(^|[^a-z])conv([^a-z]|$)/i

/**
 * Le groupe de chaque libellé de projet. `projets` porte chaque projet de la carte avec son nombre
 * de demandes (le nom le plus porté nomme le groupe) ; un libellé peut y revenir plusieurs fois
 * (le même dossier sur deux postes).
 */
export function regrouperLesProjets(
  projets: readonly { libelle: string; demandes: number }[],
  nomDesAutres: string
): Map<string, ProjetDuFiltre> {
  const parLibelle = new Map<string, number>()
  for (const p of projets) parLibelle.set(p.libelle, (parLibelle.get(p.libelle) ?? 0) + p.demandes)

  // Les vrais projets d'abord : chaque nom canonique est nommé par son libellé le plus porté.
  const meilleur = new Map<string, { nom: string; demandes: number }>()
  for (const [libelle, demandes] of parLibelle) {
    if (NOM_DE_FIL.test(libelle)) continue
    const cle = nomCanonique(libelle) || libelle
    const actuel = meilleur.get(cle)
    if (!actuel || demandes > actuel.demandes) meilleur.set(cle, { nom: libelle, demandes })
  }

  const groupes = new Map<string, ProjetDuFiltre>()
  for (const libelle of parLibelle.keys()) {
    if (!NOM_DE_FIL.test(libelle)) {
      const cle = nomCanonique(libelle) || libelle
      groupes.set(libelle, { cle, nom: meilleur.get(cle)?.nom ?? libelle })
      continue
    }
    // Une copie de fil rejoint le projet le plus long dont son nom commence (« AutoWinOS-git-conv-1317 »
    // → AutoWinOS) ; trois lettres au moins, sinon un projet « zox » avalerait « zoxette-conv-3 ».
    const canon = nomCanonique(libelle)
    let parent: string | undefined
    for (const cle of meilleur.keys())
      if (cle.length >= 3 && canon.startsWith(cle) && (!parent || cle.length > parent.length))
        parent = cle
    groupes.set(
      libelle,
      parent
        ? { cle: parent, nom: meilleur.get(parent)!.nom }
        : { cle: CLE_AUTRES, nom: nomDesAutres }
    )
  }
  return groupes
}
