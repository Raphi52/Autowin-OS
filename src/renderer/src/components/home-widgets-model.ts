/**
 * Ce que les widgets d'accueil LISENT dans le snapshot du Task Manager, en fonctions pures.
 *
 * L'accueil ne produit aucune donnée : les heures de départ et les remontées d'agents existent déjà
 * (`task-manager:snapshot`). Ce fichier ne fait que les trier et les résumer pour une lecture d'un
 * coup d'oeil, hors React pour que le tri soit testable sans monter d'interface.
 */

export interface RoutineDeparture {
  id: string
  title: string
  /** Instant du prochain départ, en ms epoch. */
  at: number
  /** `true` quand la tâche est désactivée : elle reste visible, mais elle ne partira pas. */
  suspended: boolean
  /** Délai lisible, déjà calculé pour que le rendu n'ait plus d'arithmétique à faire. */
  relative: string
}

interface TaskLike {
  id: string
  title: string
  enabled: boolean
  nextRunAt: number | null
  /** Présent = tâche réveillée par ÉVÉNEMENT, donc sans heure de départ. */
  watchdog?: unknown
}

/**
 * Les prochains départs, du plus proche au plus lointain.
 *
 * Une tâche réveillée par événement est ÉCARTÉE : elle n'a pas d'heure, et l'afficher dans une liste
 * d'horaires annoncerait un départ qui n'arrivera pas. Une tâche désactivée est GARDÉE mais marquée :
 * « pourquoi ma routine n'est pas partie » est justement la question que ce widget doit résoudre, et
 * la masquer supprimerait la réponse.
 */
export function nextDepartures(
  tasks: readonly TaskLike[],
  now: number,
  limit = 12
): RoutineDeparture[] {
  return tasks
    .filter((task) => task.watchdog === undefined && typeof task.nextRunAt === 'number')
    .map((task) => ({
      id: task.id,
      title: task.title,
      at: task.nextRunAt as number,
      suspended: !task.enabled,
      relative: relativeDelay((task.nextRunAt as number) - now)
    }))
    .sort((a, b) => a.at - b.at)
    .slice(0, limit)
}

export function relativeDelay(deltaMs: number): string {
  if (deltaMs < 0) return 'en retard'
  const minutes = Math.round(deltaMs / 60000)
  if (minutes < 1) return 'imminent'
  if (minutes < 60) return `dans ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rest = minutes % 60
    return rest === 0 ? `dans ${hours} h` : `dans ${hours} h ${rest} min`
  }
  const days = Math.round(hours / 24)
  return days === 1 ? 'demain' : `dans ${days} jours`
}

export interface AgentNotice {
  id: string
  /** Le titre de la tâche quand il est connu, son identifiant sinon. */
  origin: string
  kind: 'missed' | 'failed'
  message: string
  createdAt: number
  acknowledged: boolean
}

interface AlertLike {
  id: string
  taskId: string
  kind: 'missed' | 'failed'
  message: string
  createdAt: number
  acknowledgedAt?: number
}

/**
 * Les remontées d'agents : non acquittées d'abord, puis les plus récentes.
 *
 * L'ordre est délibéré. Trier par date seule enterrerait une alerte jamais lue sous une pile
 * d'alertes déjà vues — l'inverse exact de ce que le widget promet.
 */
export function agentNotices(
  alerts: readonly AlertLike[],
  tasks: readonly { id: string; title: string }[],
  limit = 30
): AgentNotice[] {
  const titles = new Map(tasks.map((task) => [task.id, task.title]))
  return [...alerts]
    .map((alert) => ({
      id: alert.id,
      origin: titles.get(alert.taskId) ?? alert.taskId,
      kind: alert.kind,
      message: alert.message,
      createdAt: alert.createdAt,
      acknowledged: typeof alert.acknowledgedAt === 'number'
    }))
    .sort((a, b) => {
      if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1
      return b.createdAt - a.createdAt
    })
    .slice(0, limit)
}

export function unacknowledgedCount(notices: readonly AgentNotice[]): number {
  return notices.filter((notice) => !notice.acknowledged).length
}
