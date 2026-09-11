import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * LE DEPOT CITE PAR LA DEMANDE — pour aligner le dossier de travail sur ce dont l'utilisateur PARLE.
 *
 * LE DEFAUT QUE CECI CORRIGE : le dossier de travail d'un tour vient du RANGEMENT de la conversation
 * (`dossierDeTravailDuTour`). Quand l'utilisateur oublie de ranger la conversation et demande de
 * travailler sur un autre depot en le NOMMANT par son chemin, le tour partait quand meme dans le
 * depot d'Autowin : les lectures ne trouvaient rien, ou pire, les ecritures atterrissaient au mauvais
 * endroit. Ici on ne DEVINE pas : seul un chemin absolu ECRIT par l'utilisateur, qui existe sur ce
 * poste et qui est (ou est contenu dans) une racine `.git`, fait basculer. Une mention par nom de
 * projet ne suffit pas — ce serait une supposition, et basculer a tort est pire que ne pas basculer.
 *
 * Aucun redemarrage n'est requis : le dossier est resolu A CHAQUE tour depuis la conversation.
 */

/** `D:\x`, `D:/x`, ou un partage reseau `\\serveur\partage\x`. Les guillemets/backticks sont exclus. */
const CHEMIN_ABSOLU = /(?:[A-Za-z]:[\\/]|\\\\[^\\/\s"'`]+[\\/])[^\s"'`<>|]*/g

/** Remonte du chemin cite jusqu'a la racine `.git` qui le contient. `undefined` si aucune. */
function racineDepot(depart: string, existe: (chemin: string) => boolean): string | undefined {
  let curseur = resolve(depart)
  for (;;) {
    if (existe(join(curseur, '.git'))) return curseur
    const parent = dirname(curseur)
    if (parent === curseur) return undefined
    curseur = parent
  }
}

function memeDossier(a: string, b: string): boolean {
  const normaliser = (chemin: string): string =>
    resolve(chemin)
      .replace(/[\\/]+$/, '')
      .toLowerCase()
  return normaliser(a) === normaliser(b)
}

/**
 * Rend la racine du depot cite dans le message quand elle DIFFERE du dossier actif, sinon `null`.
 *
 * Le premier candidat gagne : un message qui cite deux depots differents est ambigu, et prendre le
 * premier reste le comportement le plus previsible (c'est celui que l'utilisateur a nomme d'abord).
 */
export function depotCiteDansLeMessage(
  message: string,
  dossierActif: string,
  existe: (chemin: string) => boolean = existsSync
): string | null {
  if (!message.trim()) return null
  for (const brut of message.match(CHEMIN_ABSOLU) ?? []) {
    // La ponctuation de fin de phrase colle au chemin : « travaille dans D:\Foo. » -> `D:\Foo.`
    const chemin = brut.replace(/[.,;:!?)\]]+$/, '')
    if (!chemin || !existe(chemin)) continue
    const racine = racineDepot(chemin, existe)
    if (!racine) continue
    if (dossierActif.trim() && memeDossier(racine, dossierActif)) continue
    return racine
  }
  return null
}
