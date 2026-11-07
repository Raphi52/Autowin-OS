import type { TaskStore } from './task-store'
import type { ScheduledTaskInput } from './types'

/**
 * LE MÉNAGE DU POSTE TRAVAILLE SUR « THIS COMPUTER ».
 *
 * Le ramasse-miettes et la curation ne sont le travail d'aucun projet. Sans dossier choisi, le réveil
 * d'une tâche range son fil dans le dossier d'Autowin (`chat-dispatch.ts`, règle posée pour la
 * maintenance, qui doit tourner sur le dépôt à jour). Ces fils partaient donc avec le projet Autowin
 * dans le village des collègues, alors qu'ils ne concernent que ce poste. Leurs procédures lancent
 * leurs scripts par le chemin du dépôt, que la skill injectée nomme (`skill-pipeline.ts`) : elles
 * n'ont pas besoin d'y être rangées.
 */

/** La tâche du semis, rangée sur le dossier personnel quand il est connu. */
export function surCetOrdinateur(
  semis: ScheduledTaskInput,
  dossierPersonnel: string | undefined
): ScheduledTaskInput {
  if (!dossierPersonnel || semis.destination.kind !== 'new') return semis
  return { ...semis, destination: { ...semis.destination, dossier: dossierPersonnel } }
}

/**
 * Range sur le dossier personnel les tâches déjà posées par ce semis (même titre) qui n'ont aucun
 * dossier choisi. Un dossier choisi dans le formulaire est une décision de l'utilisateur : il reste.
 */
export function rangerLesTachesPoseesSurCetOrdinateur(
  store: TaskStore,
  titre: string,
  dossierPersonnel: string | undefined
): void {
  if (!dossierPersonnel) return
  for (const tache of store.listTasks()) {
    const destination = tache.destination
    if (tache.title !== titre || destination.kind !== 'new' || destination.dossier) continue
    store.update(tache.id, { destination: { ...destination, dossier: dossierPersonnel } })
  }
}
