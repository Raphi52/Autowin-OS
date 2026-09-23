import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  planifierActionGit,
  type DemandeActionGit,
  type ResultatActionGit
} from '../shared/git-action'

/**
 * L'EXÉCUTION des deux gestes du graphe. La liste blanche, elle, vit dans `src/shared/git-action.ts`
 * parce que l'INTERFACE doit afficher AVANT de lancer la commande exacte qui partira — et une
 * deuxième construction, côté renderer, finirait par diverger de celle-ci. Le renderer PLANIFIE pour
 * l'annoncer, le processus principal REPLANIFIE pour l'exécuter : même fonction, un seul texte.
 */

/** Une commande git déjà validée, exécutée dans un dépôt. Injectable pour les tests. */
export type LanceurGit = (cwd: string, argv: string[]) => Promise<{ ok: boolean; sortie: string }>

export { planifierActionGit }
export type { DemandeActionGit, ResultatActionGit }

const lanceurReel: LanceurGit = async (cwd, argv) => {
  const run = promisify(execFile)
  try {
    const { stdout, stderr } = await run('git', argv, { cwd, windowsHide: true })
    return { ok: true, sortie: `${stdout}${stderr}`.trim() }
  } catch (error) {
    const sortie = error as { stdout?: string; stderr?: string; message?: string }
    return {
      ok: false,
      sortie:
        `${sortie.stdout ?? ''}${sortie.stderr ?? ''}`.trim() || String(sortie.message ?? error)
    }
  }
}

/**
 * Exécute le plan, et S'ARRÊTE au premier échec.
 *
 * Le cas qui compte : le changement de branche est refusé parce que l'arbre est sale. Enchaîner la
 * fusion la ferait atterrir sur la MAUVAISE branche — un dégât silencieux, celui qu'on ne voit qu'au
 * `git log` du lendemain. On rend le message de git tel quel : c'est lui qui nomme les fichiers en
 * cause, et le reformuler ne ferait que perdre l'information.
 */
export async function executerActionGit(
  cwd: string,
  demande: DemandeActionGit,
  lancer: LanceurGit = lanceurReel
): Promise<ResultatActionGit> {
  if (!cwd?.trim()) return { ok: false, raison: 'Dépôt non précisé.' }
  const plan = planifierActionGit(demande)
  if ('refus' in plan) return { ok: false, raison: plan.refus }

  const sorties: string[] = []
  for (const argv of plan.argv) {
    const resultat = await lancer(cwd, argv)
    if (!resultat.ok)
      return { ok: false, raison: `git ${argv.join(' ')} a échoué : ${resultat.sortie}` }
    sorties.push(resultat.sortie)
  }
  return { ok: true, commande: plan.libelle, sortie: sorties.filter(Boolean).join('\n') }
}
