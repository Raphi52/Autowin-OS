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
 * Un depot IMBRIQUE dans le depot de travail ne fait pas basculer non plus. Mesure du 2026-09-28
 * (conv-770) : une consigne de reprise citait `git -C D:/AutoWinOS/.autowin-data/essai-garde stash`,
 * un depot jetable ; la conversation est partie travailler DEDANS, puis a rebascule au tour suivant.
 * Meme risque pour une copie de travail d'agent (`.autowin-data/autowin-os/worktrees/…`, `.git` fichier).
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

const normaliser = (chemin: string): string =>
  resolve(chemin)
    .replace(/[\\/]+$/, '')
    .toLowerCase()

function memeDossier(a: string, b: string): boolean {
  return normaliser(a) === normaliser(b)
}

/** `enfant` est STRICTEMENT sous `parent` — `D:\AutoWinOS2` n'est pas sous `D:\AutoWinOS`. */
function estDedans(enfant: string, parent: string): boolean {
  const e = normaliser(enfant)
  const p = normaliser(parent)
  return e.length > p.length && e.startsWith(p) && /[\\/]/.test(e.charAt(p.length))
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
  const depotActif = dossierActif.trim() ? racineDepot(dossierActif, existe) : undefined
  for (const brut of message.match(CHEMIN_ABSOLU) ?? []) {
    // La ponctuation de fin de phrase colle au chemin : « travaille dans D:\Foo. » -> `D:\Foo.`
    const chemin = brut.replace(/[.,;:!?)\]]+$/, '')
    if (!chemin || !existe(chemin)) continue
    const racine = racineDepot(chemin, existe)
    if (!racine) continue
    if (dossierActif.trim() && memeDossier(racine, dossierActif)) continue
    // Un depot IMBRIQUE dans le depot de travail (depot jetable, copie de travail d'un agent sous
    // .autowin-data) fait partie de CE depot : ce n'est pas l'autre projet que l'utilisateur aurait
    // oublie de ranger. Un dossier parent SANS depot (D:\GIT) continue, lui, de basculer vers ses projets.
    if (depotActif && estDedans(racine, depotActif)) continue
    return racine
  }
  return null
}
