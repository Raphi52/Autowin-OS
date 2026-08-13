import type { DispatchResult, TaskDispatcher } from '../task-manager/task-scheduler'
import type { ScheduledTask, TaskOccurrence } from '../task-manager/types'

/**
 * Les deux puits de rappel du dispatcheur, tels que son contrat les declare.
 *
 * Ils ne sont pas exportes par `task-scheduler` : plutot que d'elargir sa surface publique pour un
 * simple enrobage, on les redéclare depuis les PARAMETRES du contrat. Si leur forme change, la
 * signature de `TaskDispatcher['run']` change avec, et le compilateur le dira ici.
 */
type PuitsClaims = Parameters<TaskDispatcher['run']>[2]
type PuitsUsage = Parameters<TaskDispatcher['run']>[3]
import type { ResultatPasse } from './passe'

/**
 * Une passe de veille devient une TÂCHE PLANIFIÉE, visible dans Planification comme les autres.
 *
 * Le planificateur n'est pas touché : il appelle un `TaskDispatcher`, et celui-ci est injecté. On
 * l'enrobe donc — si la tâche porte `action: 'veille'`, on exécute la passe ; sinon on délègue au
 * dispatcheur de chat existant, à l'identique. Toute tâche existante est donc inchangée, puisque
 * l'absence d'`action` vaut `chat`.
 *
 * Pourquoi ne pas simplement planifier un PROMPT qui demande la veille : ça tournerait comme un tour de
 * chat et l'agent répondrait dans une conversation, mais l'onglet resterait vide — le stock ne serait
 * pas écrit. L'utilisateur veut les deux : voir l'agent dans Planification ET remplir l'onglet.
 */

export interface DispatchVeilleDeps {
  /** Le dispatcheur historique. Il reçoit TOUT ce qui n'est pas une veille, sans altération. */
  suivant: TaskDispatcher
  /** La passe. Injectée pour que ce module soit testable sans réseau ni disque réel. */
  executerPasse: () => Promise<ResultatPasse>
}

/**
 * Le résultat d'une passe, résumé en une ligne lisible dans l'historique d'occurrences.
 *
 * Les échecs de source y figurent, et ce n'est pas décoratif : une passe qui rend zéro candidat parce
 * qu'aucune page n'a répondu doit se lire autrement qu'une passe qui n'a rien trouvé de neuf.
 */
export function resumerPasse(resultat: ResultatPasse): string {
  const morceaux = [
    `${resultat.retenus} retenu${resultat.retenus === 1 ? '' : 's'}`,
    `${resultat.refuses.length} refusé${resultat.refuses.length === 1 ? '' : 's'}`
  ]
  if (resultat.echecs.length > 0) {
    morceaux.push(
      `${resultat.echecs.length} source${resultat.echecs.length === 1 ? '' : 's'} muette${
        resultat.echecs.length === 1 ? '' : 's'
      }`
    )
  }
  return `Veille : ${morceaux.join(', ')}.`
}

export function dispatcherAvecVeille(deps: DispatchVeilleDeps): TaskDispatcher {
  return {
    async run(
      task: ScheduledTask,
      occurrence: TaskOccurrence,
      onLateMutationClaims?: PuitsClaims,
      onLateUsageSettlement?: PuitsUsage
    ): Promise<DispatchResult> {
      if (task.action !== 'veille') {
        return deps.suivant.run(task, occurrence, onLateMutationClaims, onLateUsageSettlement)
      }
      try {
        const resultat = await deps.executerPasse()
        // Une passe où AUCUNE source n'a répondu est un ÉCHEC, pas un succès à zéro candidat. Sans
        // cette distinction, une veille définitivement muette s'afficherait verte indéfiniment.
        const rienLu =
          resultat.echecs.length > 0 && resultat.retenus === 0 && resultat.refuses.length === 0
        return rienLu
          ? { status: 'failed', error: resumerPasse(resultat) }
          : { status: 'completed', error: undefined, outcome: undefined }
      } catch (erreur) {
        return {
          status: 'failed',
          error: erreur instanceof Error ? erreur.message : String(erreur)
        }
      }
    }
  }
}
