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

/**
 * POURQUOI un rangement ne pilote PAS le dossier de travail (regle du 2026-09-08).
 *
 * `basculeDeDossierRequise` rend `null` pour SIX raisons differentes, dont deux sont des DEFAUTS
 * silencieux : un libelle pris pour un chemin, et un dossier disparu. Dans ces deux cas le modele
 * travaillait dans le depot d'Autowin sans que rien ne le dise. Ce diagnostic nomme le motif pour
 * que le fil puisse l'AFFICHER, au lieu du silence.
 *
 * Regle posee par l'utilisateur : le dossier range sur la conversation et le dossier de travail ne
 * doivent JAMAIS differer — toute divergence est un defaut, pas un cas a rattraper.
 */
export type MotifDossierConversation =
  'bascule-requise' | 'deja-aligne' | 'non-range' | 'libelle-non-absolu' | 'dossier-absent'

export function diagnostiqueDossierConversation(
  projectPath: string | undefined | null,
  workspaceActif: string,
  dossierExiste: (chemin: string) => boolean = existsSync
): MotifDossierConversation {
  const range = projectPath?.trim()
  if (!range) return 'non-range'
  if (!isAbsolute(range)) return 'libelle-non-absolu'
  const cible = resolve(range)
  if (!dossierExiste(cible)) return 'dossier-absent'
  if (memeDossier(cible, workspaceActif)) return 'deja-aligne'
  return 'bascule-requise'
}

/** Les DEUX motifs qui font travailler le modele ailleurs que la ou l'utilisateur croit. */
export function avertissementDossierConversation(
  motif: MotifDossierConversation,
  projectPath: string | undefined | null,
  workspaceActif: string
): string | null {
  const range = projectPath?.trim() ?? ''
  if (motif === 'libelle-non-absolu') {
    return `⚠️ Le dossier de cette conversation (« ${range} ») n'est pas un chemin de dossier, juste un libellé de rangement : il ne pilote donc pas le dossier de travail. Je travaille dans ${workspaceActif}, et c'est son AGENTS.md qui est lu. Mets le chemin complet du projet pour y basculer.`
  }
  if (motif === 'dossier-absent') {
    return `⚠️ Le dossier de cette conversation (${range}) est introuvable sur ce poste : il ne pilote donc pas le dossier de travail. Je travaille dans ${workspaceActif}, et c'est son AGENTS.md qui est lu.`
  }
  return null
}

/**
 * LE DOSSIER DE TRAVAIL DU TOUR — resolu a CHAQUE tour depuis la conversation courante.
 *
 * Le dossier de travail etait GLOBAL et fige au demarrage (`os.ts`, `executionWorkspace`) : deux
 * conversations rangees dans deux projets differents travaillaient dans le MEME dossier, et le seul
 * moyen d'aligner etait un redemarrage de l'app (qui coupe le tour en cours). Cette fonction rend le
 * dossier a utiliser POUR CE TOUR : le rangement de la conversation quand il designe un dossier reel,
 * sinon le repli global. Elle ne mute rien — la valeur est PASSEE en argument, jamais posee dans
 * `process.env` : plusieurs tours tournent en parallele et se voleraient le dossier.
 */
export function dossierDeTravailDuTour(
  projectPath: string | undefined | null,
  repli: string,
  dossierExiste: (chemin: string) => boolean = existsSync
): string {
  const range = projectPath?.trim()
  if (!range) return repli
  if (!isAbsolute(range)) return repli
  const cible = resolve(range)
  return dossierExiste(cible) ? cible : repli
}
