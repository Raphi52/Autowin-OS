import { readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Suppression de l'HISTORIQUE CLI laissé derrière une copie de travail effacée.
 *
 * POURQUOI. Le CLI Claude écrit ses conversations dans `<config>/projects/<cwd encodé>/`, hors de
 * tout ce qu'Autowin gère. `cleanupWorktree` supprime la copie de travail ; cet historique, lui,
 * survit pour toujours. Mesuré le 2026-09-12 sur le poste de dev : 80 dossiers d'historique pour
 * 11 copies vivantes, 87 Mo de déchet pur accumulés en 11 jours, dont AUCUN ne pouvait plus être
 * relu par qui que ce soit — le dossier qu'ils décrivent n'existe plus.
 *
 * L'ENCODAGE, vérifié sur le disque réel : le chemin absolu du répertoire courant, chaque caractère
 * non alphanumérique remplacé par un tiret. `D:\AutoWinOS` devient `D--AutoWinOS` (le deux-points
 * ET l'antislash donnent chacun un tiret).
 *
 * LE PIÈGE, et pourquoi `cheminsPreserves` existe : un run ne tourne pas seulement DANS la copie,
 * mais aussi dans ses sous-dossiers (`<copie>/agent__run-xxx/1`), qui produisent des dossiers
 * d'historique préfixés par celui de la copie. Il faut donc balayer le préfixe — et un balayage par
 * préfixe NU détruirait l'historique d'une copie voisine dont le nom commence pareil : effacer
 * `arena-a` emporterait `arena-a-r1`, observé côte à côte sur ce poste. Tout chemin encore présent
 * est donc passé en préservation et coupe le préfixe.
 *
 * Le PLAN est PUR (noms de dossiers -> noms à supprimer), comme `planWorkspaceGc` : la règle se
 * teste sans toucher au disque.
 */

/** Encodage du répertoire courant tel que le CLI nomme son dossier d'historique. */
export function encoderCheminCli(chemin: string): string {
  return chemin.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * Décide quels dossiers d'historique appartiennent à la copie effacée. PUR.
 *
 * On prend le dossier de la copie ET ses descendants (préfixe + tiret), sauf ceux qu'un chemin
 * encore vivant revendique.
 */
export function planHistoriqueCliASupprimer(
  cheminCopie: string,
  dossiersHistorique: readonly string[],
  cheminsPreserves: readonly string[] = []
): string[] {
  const cible = encoderCheminCli(cheminCopie)
  if (cible.length === 0) return []
  const preserves = [...new Set(cheminsPreserves.map(encoderCheminCli))].filter(
    (nom) => nom !== cible
  )
  const revendiquePar = (nom: string, base: string): boolean =>
    nom === base || nom.startsWith(`${base}-`)
  return dossiersHistorique.filter(
    (nom) => revendiquePar(nom, cible) && !preserves.some((p) => revendiquePar(nom, p))
  )
}

/**
 * Racines `projects` à balayer pour une copie donnée.
 *
 * Deux sources, et aucune n'est devinée au hasard : l'identité Claude par défaut (`~/.claude`), et
 * les comptes dédiés qu'Autowin range dans `<userData>/claude-accounts/<compte>/`. La racine
 * `userData` se DÉDUIT du chemin de la copie — elles vivent sous `<userData>/worktrees/` —, ce qui
 * évite de coupler le gestionnaire de copies au module des comptes.
 */
export function racinesHistoriqueCliPour(cheminCopie: string): string[] {
  const racines = [join(homedir(), '.claude', 'projects')]
  /*
   * La racine de donnees se deduit STRUCTURELLEMENT : une copie vit dans
   * `<userData>/<racine des copies>/<agent>`, donc deux remontees suffisent.
   *
   * DEFAUT VECU le 2026-09-12 : la premiere version cherchait un segment litteralement nomme
   * `worktrees` dans le chemin. Cela marchait en production et NULLE PART ailleurs — les tests
   * montent leur racine de copies dans un dossier temporaire, la deduction rendait alors la seule
   * identite par defaut, et la purge ne trouvait jamais rien. Un nom de dossier n'est pas un
   * contrat ; la position dans l'arborescence, si.
   */
  const userData = dirname(dirname(cheminCopie))
  const comptes = join(userData, 'claude-accounts')
  let noms: string[] = []
  try {
    noms = readdirSync(comptes)
  } catch {
    noms = []
  }
  for (const compte of noms) racines.push(join(comptes, compte, 'projects'))
  return racines
}

/**
 * Applique le plan au disque. Best-effort assumé, comme `collectRunWorkspaces` : l'échec d'une
 * suppression ne doit JAMAIS faire échouer la libération de la copie elle-même, qui a réussi.
 */
export function supprimerHistoriqueCli(
  cheminCopie: string,
  cheminsPreserves: readonly string[] = [],
  racines: readonly string[] = racinesHistoriqueCliPour(cheminCopie)
): string[] {
  const supprimes: string[] = []
  for (const racine of racines) {
    let noms: string[]
    try {
      noms = readdirSync(racine)
    } catch {
      continue // racine absente (compte jamais utilisé) : rien à faire
    }
    for (const nom of planHistoriqueCliASupprimer(cheminCopie, noms, cheminsPreserves)) {
      const cible = join(racine, nom)
      try {
        rmSync(cible, { recursive: true, force: true })
        supprimes.push(cible)
      } catch {
        /* verrouillé : la copie est partie quand même, on ne fait pas échouer pour ça */
      }
    }
  }
  return supprimes
}

/** Copies de travail encore présentes sous la même racine — elles revendiquent leur historique. */
export function copiesVivantes(cheminCopie: string): string[] {
  const parent = dirname(cheminCopie)
  try {
    return readdirSync(parent).map((nom) => join(parent, nom))
  } catch {
    return []
  }
}
