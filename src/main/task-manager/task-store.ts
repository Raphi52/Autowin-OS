import { randomUUID } from 'node:crypto'
import { resolveFirstOccurrence } from './schedule'
import type {
  ScheduledTask,
  ScheduledTaskInput,
  TaskAlert,
  TaskOccurrence,
  TaskOccurrenceStatus,
  TaskStoreSnapshot
} from './types'

interface TaskStoreOptions {
  now?: () => number
  id?: () => string
}

type TaskPatch = Partial<Omit<ScheduledTaskInput, 'schedule'>> & {
  schedule?: ScheduledTaskInput['schedule']
}

export class TaskStore {
  private readonly tasks = new Map<string, ScheduledTask>()
  private readonly occurrences = new Map<string, TaskOccurrence>()
  private readonly alerts = new Map<string, TaskAlert>()
  private readonly now: () => number
  private readonly makeId: () => string
  onChange?: (snapshot: TaskStoreSnapshot) => void

  constructor(options: TaskStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.makeId = options.id ?? (() => randomUUID())
  }

  hydrate(snapshot: TaskStoreSnapshot): void {
    this.tasks.clear()
    this.occurrences.clear()
    this.alerts.clear()
    for (const task of snapshot.tasks) this.tasks.set(task.id, structuredClone(task))
    for (const occurrence of snapshot.occurrences) {
      this.occurrences.set(occurrence.id, structuredClone(occurrence))
    }
    for (const alert of snapshot.alerts) this.alerts.set(alert.id, structuredClone(alert))
  }

  snapshot(): TaskStoreSnapshot {
    return {
      schemaVersion: 1,
      tasks: this.listTasks(),
      occurrences: this.listOccurrences(),
      alerts: this.listAlerts()
    }
  }

  private changed(): void {
    this.onChange?.(this.snapshot())
  }

  listTasks(): ScheduledTask[] {
    return [...this.tasks.values()]
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map((task) => structuredClone(task))
  }

  getTask(id: string): ScheduledTask | undefined {
    const task = this.tasks.get(id)
    return task ? structuredClone(task) : undefined
  }

  listOccurrences(taskId?: string): TaskOccurrence[] {
    return [...this.occurrences.values()]
      .filter((occurrence) => !taskId || occurrence.taskId === taskId)
      .sort((left, right) => right.scheduledFor - left.scheduledFor)
      .map((occurrence) => structuredClone(occurrence))
  }

  getOccurrence(id: string): TaskOccurrence | undefined {
    const occurrence = this.occurrences.get(id)
    return occurrence ? structuredClone(occurrence) : undefined
  }

  listAlerts(unacknowledgedOnly = false): TaskAlert[] {
    return [...this.alerts.values()]
      .filter((alert) => !unacknowledgedOnly || alert.acknowledgedAt === undefined)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((alert) => structuredClone(alert))
  }

  create(input: ScheduledTaskInput): ScheduledTask {
    validateTaskInput(input)
    const timestamp = this.now()
    const task: ScheduledTask = {
      ...structuredClone(input),
      id: this.makeId(),
      nextRunAt: input.enabled ? resolveFirstOccurrence(input.schedule) : null,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    if (this.tasks.has(task.id)) throw new Error(`Identifiant de tâche dupliqué: ${task.id}`)
    this.tasks.set(task.id, task)
    this.changed()
    return structuredClone(task)
  }

  update(id: string, patch: TaskPatch): ScheduledTask {
    const current = this.tasks.get(id)
    if (!current) throw new Error(`Tâche inconnue: ${id}`)
    const input: ScheduledTaskInput = {
      title: patch.title ?? current.title,
      prompt: patch.prompt ?? current.prompt,
      enabled: patch.enabled ?? current.enabled,
      mode: patch.mode ?? current.mode,
      destination: structuredClone(patch.destination ?? current.destination),
      schedule: structuredClone(patch.schedule ?? current.schedule)
    }
    validateTaskInput(input)
    const task: ScheduledTask = {
      ...current,
      ...input,
      nextRunAt: input.enabled ? resolveFirstOccurrence(input.schedule) : null,
      updatedAt: this.now()
    }
    this.tasks.set(id, task)
    this.changed()
    return structuredClone(task)
  }

  remove(id: string): boolean {
    if (!this.tasks.delete(id)) return false
    for (const [occurrenceId, occurrence] of this.occurrences) {
      if (occurrence.taskId === id) this.occurrences.delete(occurrenceId)
    }
    for (const [alertId, alert] of this.alerts) {
      if (alert.taskId === id) this.alerts.delete(alertId)
    }
    this.changed()
    return true
  }

  setNextRunAt(taskId: string, nextRunAt: number | null): ScheduledTask {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Tâche inconnue: ${taskId}`)
    task.nextRunAt = nextRunAt
    task.updatedAt = this.now()
    this.changed()
    return structuredClone(task)
  }

  bindConversation(taskId: string, conversationId: string): ScheduledTask {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Tâche inconnue: ${taskId}`)
    if (task.destination.kind !== 'new') {
      throw new Error(`La tâche ${taskId} ne cible pas une conversation dédiée`)
    }
    task.destination.conversationId = conversationId
    task.updatedAt = this.now()
    this.changed()
    return structuredClone(task)
  }

  claim(
    taskId: string,
    occurrenceId: string,
    scheduledFor: number
  ): { claimed: boolean; occurrence: TaskOccurrence } {
    const existing = this.occurrences.get(occurrenceId)
    if (existing) return { claimed: false, occurrence: structuredClone(existing) }
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Tâche inconnue: ${taskId}`)
    if (!task.enabled) throw new Error(`Tâche désactivée: ${taskId}`)
    const occurrence: TaskOccurrence = {
      id: occurrenceId,
      taskId,
      scheduledFor,
      status: 'claimed',
      claimedAt: this.now()
    }
    this.occurrences.set(occurrenceId, occurrence)
    this.changed()
    return { claimed: true, occurrence: structuredClone(occurrence) }
  }

  markRunning(occurrenceId: string, conversationId?: string): TaskOccurrence {
    return this.updateOccurrence(occurrenceId, 'running', {
      startedAt: this.now(),
      ...(conversationId ? { conversationId } : {})
    })
  }

  finish(
    occurrenceId: string,
    status: Extract<TaskOccurrenceStatus, 'completed' | 'failed' | 'cancelled'>,
    details: { conversationId?: string; turnId?: string; error?: string } = {}
  ): TaskOccurrence {
    const occurrence = this.updateOccurrence(occurrenceId, status, {
      finishedAt: this.now(),
      ...details
    })
    if (status === 'failed') {
      this.createAlertOnce(occurrence, 'failed', details.error ?? 'Le prompt planifié a échoué.')
    }
    return occurrence
  }

  markMissed(
    taskId: string,
    occurrenceId: string,
    scheduledFor: number,
    reason: string
  ): TaskOccurrence {
    const existing = this.occurrences.get(occurrenceId)
    if (existing) return structuredClone(existing)
    if (!this.tasks.has(taskId)) throw new Error(`Tâche inconnue: ${taskId}`)
    const occurrence: TaskOccurrence = {
      id: occurrenceId,
      taskId,
      scheduledFor,
      status: 'missed',
      claimedAt: this.now(),
      finishedAt: this.now(),
      error: reason
    }
    this.occurrences.set(occurrenceId, occurrence)
    this.createAlertOnce(occurrence, 'missed', reason, false)
    this.changed()
    return structuredClone(occurrence)
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId)
    if (!alert) return false
    if (alert.acknowledgedAt === undefined) {
      alert.acknowledgedAt = this.now()
      this.changed()
    }
    return true
  }

  recoverInterrupted(reason: string): number {
    let recovered = 0
    for (const occurrence of this.occurrences.values()) {
      if (occurrence.status !== 'claimed' && occurrence.status !== 'running') continue
      occurrence.status = 'failed'
      occurrence.finishedAt = this.now()
      occurrence.error = reason
      this.createAlertOnce(occurrence, 'failed', reason, false)
      recovered += 1
    }
    if (recovered > 0) this.changed()
    return recovered
  }

  private updateOccurrence(
    occurrenceId: string,
    status: TaskOccurrenceStatus,
    patch: Partial<TaskOccurrence>
  ): TaskOccurrence {
    const occurrence = this.occurrences.get(occurrenceId)
    if (!occurrence) throw new Error(`Occurrence inconnue: ${occurrenceId}`)
    Object.assign(occurrence, patch, { status })
    this.changed()
    return structuredClone(occurrence)
  }

  private createAlertOnce(
    occurrence: TaskOccurrence,
    kind: TaskAlert['kind'],
    message: string,
    notify = true
  ): void {
    if ([...this.alerts.values()].some((alert) => alert.occurrenceId === occurrence.id)) return
    const alert: TaskAlert = {
      id: this.makeId(),
      taskId: occurrence.taskId,
      occurrenceId: occurrence.id,
      kind,
      message,
      createdAt: this.now(),
      acknowledgedAt: undefined
    }
    this.alerts.set(alert.id, alert)
    if (notify) this.changed()
  }
}

function validateTaskInput(input: ScheduledTaskInput): void {
  if (!input.title.trim()) throw new Error('Titre de tâche requis')
  if (!input.prompt.trim()) throw new Error('Prompt de tâche requis')
  if (!['windows', 'active-only'].includes(input.mode)) throw new Error('Mode de tâche invalide')
  if (input.destination.kind === 'existing' && !input.destination.conversationId.trim()) {
    throw new Error('Conversation cible requise')
  }
  if (input.destination.kind === 'new') {
    if (!input.destination.title.trim()) throw new Error('Titre de conversation requis')
    if (!input.destination.category.trim()) throw new Error('Catégorie de conversation requise')
    if (!input.destination.provider.trim()) throw new Error('Provider de conversation requis')
  }
  resolveFirstOccurrence(input.schedule)
}
