import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

/**
 * Le dossier de travail d'Autowin est GLOBAL et fige au demarrage (`os.ts`, `executionWorkspace`).
 * Le dossier de classement d'une conversation (`projectPath`) ne le pilotait pas : lancer une tache
 * depuis une conversation rangee dans « RIGApplication » faisait travailler le modele dans le depot
 * d'Autowin — il annoncait meme ce mauvais dossier. Defaut signale le 2026-09-05.
 *
 * Cette fonction est la REGLE, separee de son effet (ecrire la preference, redemarrer) pour qu'elle
 * soit verifiable sans lancer de processus.
 *
 * Rend le dossier vers lequel BASCULER, ou `null` quand il n'y a rien a faire.
 */
export function basculeDeDossierRequise(
  projectPath: string | undefined | null,
  workspaceActif: string,
  dossierExiste: (chemin: string) => boolean = existsSync
): string | null {
  const range = projectPath?.trim()
  if (!range) return null
  // Un `projectPath` peut n'etre qu'un LIBELLE de rangement (« Clients/Amitel »), pas un dossier.
  // Basculer dessus ferait travailler le modele dans un dossier inexistant : on s'abstient.
  if (!isAbsolute(range)) return null
  const cible = resolve(range)
  if (!dossierExiste(cible)) return null
  // Windows ne distingue pas la casse : sans ce repli, `C:\Rig` et `c:\rig` declencheraient un
  // redemarrage en boucle, chaque demarrage retrouvant le meme « ecart ».
  if (memeDossier(cible, workspaceActif)) return null
  return cible
}

function memeDossier(a: string, b: string): boolean {
  const normaliser = (chemin: string): string =>
    resolve(chemin)
      .replace(/[\\/]+$/, '')
      .toLowerCase()
  return normaliser(a) === normaliser(b)
}
