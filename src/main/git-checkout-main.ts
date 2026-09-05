import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export type GitCheckoutResult = { ok: true; branch: string } | { ok: false; reason: string }

/**
 * LA SEULE action git déclenchable depuis un bouton de l'interface, et elle est BORNÉE :
 * bascule sur une branche LOCALE qui existe déjà, et REFUSE net si l'arbre de travail porte des
 * modifications non enregistrées. Aucun stash, aucun `-f`, aucune création de branche : un
 * changement de branche qui « arrange » l'arbre au passage est exactement la façon de perdre du
 * travail sans s'en apercevoir. En cas de refus, on rend le motif — jamais un échec silencieux.
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
    const statut = await run('git', ['status', '--porcelain'], {
      cwd,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    })
    const sales = statut.stdout.split('\n').filter((l) => l.trim()).length
    if (sales > 0) {
      return {
        ok: false,
        reason: `Le dépôt a ${sales} fichier(s) modifié(s) non enregistré(s) : bascule refusée pour ne rien écraser.`
      }
    }
  } catch (error) {
    return { ok: false, reason: `Impossible de lire l'état du dépôt : ${String(error)}` }
  }
  try {
    await run('git', ['checkout', nom], { cwd, windowsHide: true })
    return { ok: true, branch: nom }
  } catch (error) {
    return { ok: false, reason: `git checkout a échoué : ${String(error)}` }
  }
}
