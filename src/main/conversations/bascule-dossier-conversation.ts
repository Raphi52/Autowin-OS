import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

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
 * Un rangement peut ne pas piloter le dossier pour plusieurs raisons, dont deux sont des DEFAUTS
 * silencieux : un libelle pris pour un chemin, et un dossier disparu. Dans ces deux cas le modele
 * travaillait dans le depot d'Autowin sans que rien ne le dise. Ce diagnostic nomme le motif pour
 * que le fil puisse l'AFFICHER, au lieu du silence.
 *
 * Regle posee par l'utilisateur : le dossier range sur la conversation et le dossier de travail ne
 * doivent JAMAIS differer — toute divergence est un defaut, pas un cas a rattraper.
 */
/**
 * La condition d'entree COMMUNE aux deux fonctions publiques : un rangement ne designe un dossier
 * utilisable que s'il est renseigne, absolu, et present sur ce poste. Rend le chemin resolu, ou
 * `null` quand l'une des trois conditions manque. Factorise pour que les deux reponses (le motif
 * affiche a l'utilisateur, et le dossier du tour) ne puissent pas diverger.
 */
function dossierRangeUtilisable(
  projectPath: string | undefined | null,
  dossierExiste: (chemin: string) => boolean
): string | null {
  const range = projectPath?.trim()
  if (!range) return null
  if (!isAbsolute(range)) return null
  const cible = resolve(range)
  return dossierExiste(cible) ? cible : null
}

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
  const cible = dossierRangeUtilisable(projectPath, dossierExiste)
  if (!cible) return 'dossier-absent'
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
  return dossierRangeUtilisable(projectPath, dossierExiste) ?? repli
}
