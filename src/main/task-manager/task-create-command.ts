/**
 * Commande agent « task_create » — créer une tâche programmée ou une règle de surveillance.
 *
 * Demande de l'utilisateur (conv-114, 2026-10-09) : « l'agent doit pouvoir les créer mais il ne doit
 * rien pouvoir créer que je ne peux pas supprimer manuellement dans le task manager ».
 *
 * D'où le seul chemin admis : EXACTEMENT celui du bouton « Créer » de l'écran (`task-manager:create`,
 * task-manager-ipc.ts) — même validation (`parseTaskInput`), même stockage (`store.create`), puis
 * réarmement du minuteur (`refresh`, sinon la tâche n'est jamais planifiée : note Brain du
 * 2026-09-29) et rafraîchissement de l'écran. Tout ce qui est dans ce stockage est listé par l'écran,
 * avec son bouton « Supprimer ». La voie détournée (Planificateur Windows) est fermée par
 * `refusTacheWindows` (src/shared/garde-tache-windows.ts).
 */
import type { ScheduledTask, ScheduledTaskInput } from './types'
import { parseTaskInput } from './task-manager-ipc'

/** Ce que le bus fournit, câblé depuis index.ts. Les mêmes objets que l'écran. */
export interface TaskCreateDeps {
  create(input: ScheduledTaskInput): ScheduledTask
  refresh(): Promise<void>
  onChanged(): void
}

export type TaskCreateResult =
  { ok: true; task: ScheduledTask; note: string } | { ok: false; reason: string }

/**
 * `task` : l'objet tâche, tel que l'écran l'envoie. Les arguments d'outil sont exposés aux modèles
 * comme du TEXTE (`schemaEntree`, skill-node-mcp.ts) : une chaîne JSON est donc lue, un objet passe
 * tel quel. Aucune autre transformation — la validation est celle de l'écran.
 */
export async function createTaskFromCommand(
  args: { task?: unknown } | undefined,
  deps: TaskCreateDeps | undefined
): Promise<TaskCreateResult> {
  if (!deps) {
    return {
      ok: false,
      reason: 'Task Manager indisponible dans ce processus : aucune tâche créée.'
    }
  }
  let raw = args?.task
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return {
        ok: false,
        reason: 'task : objet JSON attendu (texte illisible). Aucune tâche créée.'
      }
    }
  }
  let task: ScheduledTask
  try {
    task = deps.create(parseTaskInput(raw))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: `Tâche refusée : ${message}. Aucune tâche créée.` }
  }
  await deps.refresh()
  deps.onChanged()
  return {
    ok: true,
    task,
    note: `Tâche « ${task.title} » (${task.id}) visible dans l'écran Task Manager, où l'utilisateur peut la désactiver ou la supprimer.`
  }
}
