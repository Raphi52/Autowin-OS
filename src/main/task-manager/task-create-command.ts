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
import { parseTaskInput, parseTaskUpdate } from './task-manager-ipc'

/** Ce que le bus fournit, câblé depuis index.ts. Les mêmes objets que l'écran. */
export interface TaskCreateDeps {
  create(input: ScheduledTaskInput): ScheduledTask
  /**
   * `task_update` / `task_delete` (conv-1370, lot 3, 2026-10-31) : les mêmes gestes que les boutons
   * de l'écran (`task-manager:update` / `task-manager:remove`). Optionnels pour ne pas casser les
   * câblages existants ; absents = refus nommé « indisponible ». À brancher dans index.ts :
   * `get: (id) => scheduledTasks.getTask(id)`, `update: (id, input) => scheduledTasks.update(id, input)`,
   * `remove: (id) => scheduledTasks.remove(id)`.
   */
  get?(id: string): ScheduledTask | undefined
  update?(id: string, input: ScheduledTaskInput): ScheduledTask
  remove?(id: string): boolean
  /** Les tâches telles que l'écran les liste (`store.listTasks`) : lue par `task_list`. */
  list(): ScheduledTask[]
  refresh(): Promise<void>
  onChanged(): void
}

/** Une ligne de `task_list` : de quoi reconnaître un doublon avant de créer, sans le prompt entier. */
export interface TaskListItem {
  id: string
  title: string
  kind: 'horaire' | 'surveillance'
  enabled: boolean
  mode: ScheduledTask['mode']
  /** Prochaine échéance en ISO ; `null` = aucune (tâche ponctuelle passée, désactivée, surveillance). */
  nextRunAt: string | null
  /** Conversation visée, quand elle est déjà connue. */
  conversationId?: string
}

export type TaskListResult =
  { ok: true; count: number; tasks: TaskListItem[] } | { ok: false; reason: string }

/**
 * Commande agent « task_list » — LECTURE SEULE du Task Manager, pour vérifier qu'une tâche n'existe
 * pas déjà avant `task_create`. Ni `create`, ni `refresh`, ni `onChanged` ne sont appelés ici.
 */
export function listTasksFromCommand(deps: TaskCreateDeps | undefined): TaskListResult {
  if (!deps) {
    return { ok: false, reason: 'Task Manager indisponible dans ce processus : aucune tâche lue.' }
  }
  const tasks = deps.list().map((task): TaskListItem => {
    const conversationId = task.destination.conversationId
    return {
      id: task.id,
      title: task.title,
      kind: task.watchdog ? 'surveillance' : 'horaire',
      enabled: task.enabled,
      mode: task.mode,
      nextRunAt: task.nextRunAt === null ? null : new Date(task.nextRunAt).toISOString(),
      ...(conversationId ? { conversationId } : {})
    }
  })
  return { ok: true, count: tasks.length, tasks }
}

const CHAMPS_MODIFIABLES = [
  'title',
  'prompt',
  'enabled',
  'mode',
  'destination',
  'action',
  'schedule',
  'watchdog'
] as const

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

/** Échec franc sur un identifiant inconnu : cite les identifiants existants les plus proches. */
function idInconnu(id: string, deps: TaskCreateDeps, geste: string): string {
  const proches = deps
    .list()
    .map((t) => ({ t, d: distance(id, t.id) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, 5)
    .map(({ t }) => `${t.id} (« ${t.title} »)`)
  const suite = proches.length
    ? ` Identifiants les plus proches : ${proches.join(', ')}.`
    : ' Aucune tâche n’existe (task_list pour vérifier).'
  return `Tâche inconnue : ${id}.${suite} Rien n’a été ${geste}.`
}

export type TaskUpdateResult =
  { ok: true; task: ScheduledTask; note: string } | { ok: false; reason: string }

/**
 * Commande agent « task_update » — modification PARTIELLE d'une tâche, par le chemin du bouton
 * « Enregistrer » de l'écran (`parseTaskUpdate` + `store.update`, puis réarmement du minuteur).
 * `patch` : objet ou texte JSON (le chemin `<cmd>` envoie du texte). Un champ inconnu est refusé,
 * jamais ignoré en silence (leçon Brain sur `tags`). `enabled: false` coupe sans supprimer.
 */
export async function updateTaskFromCommand(
  args: { id?: unknown; patch?: unknown } | undefined,
  deps: TaskCreateDeps | undefined
): Promise<TaskUpdateResult> {
  if (!deps?.get || !deps.update) {
    return { ok: false, reason: 'Task Manager indisponible dans ce processus : rien modifié.' }
  }
  const id = typeof args?.id === 'string' ? args.id.trim() : ''
  if (!id) return { ok: false, reason: 'id : identifiant de tâche requis (task_list). Rien modifié.' }
  let raw = args?.patch
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return { ok: false, reason: 'patch : objet JSON attendu (texte illisible). Rien modifié.' }
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'patch : objet JSON attendu. Rien modifié.' }
  }
  const inconnus = Object.keys(raw).filter(
    (k) => !(CHAMPS_MODIFIABLES as readonly string[]).includes(k)
  )
  if (inconnus.length) {
    return {
      ok: false,
      reason: `patch : champ(s) inconnu(s) ${inconnus.join(', ')}. Champs admis : ${CHAMPS_MODIFIABLES.join(', ')}. Rien modifié.`
    }
  }
  if (Object.keys(raw).length === 0) {
    return { ok: false, reason: 'patch vide : aucun champ à modifier. Rien modifié.' }
  }
  const current = deps.get(id)
  if (!current) return { ok: false, reason: idInconnu(id, deps, 'modifié') }
  let task: ScheduledTask
  try {
    task = deps.update(id, parseTaskUpdate(current, raw))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: `Modification refusée : ${message}. Rien modifié.` }
  }
  await deps.refresh()
  deps.onChanged()
  return {
    ok: true,
    task: deps.get(id) ?? task,
    note: `Tâche « ${task.title} » (${task.id}) modifiée : ${Object.keys(raw).join(', ')}.`
  }
}

export type TaskDeleteResult =
  { ok: true; id: string; title: string; note: string } | { ok: false; reason: string }

/**
 * Commande agent « task_delete » — supprime une tâche, comme le bouton « Supprimer » de l'écran
 * (`store.remove`, refus si elle tourne). Les tâches d'amorçage (gc, maintenance, curate, veille)
 * sont supprimables comme à l'écran : le semis est mémorisé (`markSeeded`, task-store.ts) et
 * ne réapparaît pas ; aucun refus spécial n'est donc justifié (vérifié 2026-10-31).
 */
export async function deleteTaskFromCommand(
  args: { id?: unknown } | undefined,
  deps: TaskCreateDeps | undefined
): Promise<TaskDeleteResult> {
  if (!deps?.get || !deps.remove) {
    return { ok: false, reason: 'Task Manager indisponible dans ce processus : rien supprimé.' }
  }
  const id = typeof args?.id === 'string' ? args.id.trim() : ''
  if (!id) return { ok: false, reason: 'id : identifiant de tâche requis (task_list). Rien supprimé.' }
  const current = deps.get(id)
  if (!current) return { ok: false, reason: idInconnu(id, deps, 'supprimé') }
  try {
    if (!deps.remove(id)) return { ok: false, reason: idInconnu(id, deps, 'supprimé') }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: `Suppression refusée : ${message}. Rien supprimé.` }
  }
  await deps.refresh()
  deps.onChanged()
  return {
    ok: true,
    id,
    title: current.title,
    note: `Tâche « ${current.title} » (${id}) supprimée. Pour couper sans supprimer : task_update avec patch {"enabled": false}.`
  }
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
