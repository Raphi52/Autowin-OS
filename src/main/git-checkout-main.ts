import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export type GitCheckoutResult = { ok: true; branch: string } | { ok: false; reason: string }

/**
 * LA SEULE action git déclenchable depuis un bouton de l'interface, et elle est BORNÉE :
 * bascule sur une branche LOCALE qui existe déjà. Aucun stash, aucun `-f`, aucune création de
 * branche : un changement de branche qui « arrange » l'arbre au passage est exactement la façon de
 * perdre du travail sans s'en apercevoir. En cas de refus, on rend le motif — jamais un échec
 * silencieux.
 *
 * UN ARBRE SALE N'EST PLUS REFUSÉ D'EMBLÉE. Le refus systématique sur `status --porcelain` était
 * PLUS STRICT QUE GIT : git accepte de changer de branche avec des fichiers modifiés tant qu'ils
 * ne diffèrent pas entre les deux branches. Il bloquait donc des bascules parfaitement sûres, et
 * l'utilisateur n'avait aucun moyen d'avancer. Même politique que la mise à jour de `git-update.ts`
 * (« ni stashé ni refusé d'emblée ») : on TENTE, et si git refuse, c'est SON message qui remonte —
 * il nomme les fichiers réellement en cause. Le travail local reste INTACT dans les deux cas.
 */
export async function checkoutBranch(cwd: string, branch: string): Promise<GitCheckoutResult> {
  const run = promisify(execFile)
  const nom = branch.trim()
  // Le nom vient du renderer : il doit correspondre à une branche locale RÉELLE, sinon on sort.
  if (!nom || nom.startsWith('-')) return { ok: false, reason: 'Nom de branche invalide.' }
  try {
    const existe = await run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${nom}`], {
      cwd,
      windowsHide: true
    })
    if (!existe.stdout.trim())
      return { ok: false, reason: `Branche locale « ${nom} » introuvable.` }
  } catch {
    return { ok: false, reason: `Branche locale « ${nom} » introuvable.` }
  }
  try {
    await run('git', ['checkout', nom], { cwd, windowsHide: true })
    return { ok: true, branch: nom }
  } catch (error) {
    return { ok: false, reason: `git checkout a échoué : ${String(error)}` }
  }
}
