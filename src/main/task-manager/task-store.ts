import { randomUUID } from 'node:crypto'
import {
  occurrenceIdFor,
  resolveFirstOccurrence,
  resolveFirstOccurrenceAtOrAfter,
  resolveNextOccurrence,
  type StructuredSchedule
} from './schedule'
import type {
  ScheduledTask,
  ScheduledTaskInput,
  TaskAlert,
  TaskOccurrence,
  TaskOccurrenceStatus,
  TaskStoreSnapshot,
  WatchdogAppEvent,
  WatchdogOutcome,
  WatchdogSignal
} from './types'
import { DEFAULT_WATCHDOG_GUARDS } from './watchdog-guards'

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
  /** Identifiants des semis deja poses, persistes avec le reste du store. */
  private readonly seeds = new Set<string>()
  private readonly now: () => number
  private readonly makeId: () => string
  private readonly listeners = new Set<(snapshot: TaskStoreSnapshot) => void>()
  onChange?: (snapshot: TaskStoreSnapshot) => void

  constructor(options: TaskStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.makeId = options.id ?? (() => randomUUID())
  }

  hydrate(snapshot: TaskStoreSnapshot): void {
    this.seeds.clear()
    for (const seed of snapshot.seeds ?? []) this.seeds.add(seed)
    this.tasks.clear()
    this.occurrences.clear()
    this.alerts.clear()
    for (const task of snapshot.tasks) {
      const hydrated = structuredClone(task)
      if (hydrated.destination.kind === 'new') {
        // Compatibilite legacy uniquement : les anciens snapshots portaient ce champ,
        // qui n'existe plus dans les types ni dans le comportement runtime.
        delete (hydrated.destination as typeof hydrated.destination & Record<string, unknown>)
          .authorityMode
      }
      const watchdog = hydrated.watchdog as unknown
      if (watchdog && typeof watchdog === 'object' && !Array.isArray(watchdog)) {
        const persistedWatchdog = watchdog as Record<string, unknown>
        const source = persistedWatchdog.source
        if (source && typeof source === 'object' && !Array.isArray(source)) {
          const persistedSource = source as Record<string, unknown>
          if (persistedSource.kind === 'app-event') {
            if (
              !Array.isArray(persistedSource.events) &&
              typeof persistedSource.event === 'string'
            ) {
              persistedSource.events = [persistedSource.event as WatchdogAppEvent]
            }
            delete persistedSource.event
          }
          if (persistedSource.kind === 'app-event' || persistedSource.kind === 'file-match') {
            const guards = persistedWatchdog.guards
            persistedWatchdog.guards = {
              ...DEFAULT_WATCHDOG_GUARDS,
              ...(guards && typeof guards === 'object' && !Array.isArray(guards) ? guards : {})
            }
          }
        }
      }
      this.tasks.set(hydrated.id, hydrated)
    }
    for (const occurrence of snapshot.occurrences) {
      const hydrated = structuredClone(occurrence)
      if (hydrated.mode !== 'windows' && hydrated.mode !== 'active-only') {
        hydrated.mode = 'legacy-unknown'
      }
      this.occurrences.set(hydrated.id, hydrated)
    }
    for (const alert of snapshot.alerts) this.alerts.set(alert.id, structuredClone(alert))
  }

  snapshot(): TaskStoreSnapshot {
    return {
      schemaVersion: 1,
      tasks: this.listTasks(),
      occurrences: this.listOccurrences(),
      alerts: this.listAlerts(),
      seeds: [...this.seeds]
    }
  }

  /** Un semis deja pose ne se repose pas — c'est ce qui rend une tache livree vraiment supprimable. */
  hasSeed(seedId: string): boolean {
    return this.seeds.has(seedId)
  }

  markSeeded(seedId: string): void {
    if (this.seeds.has(seedId)) return
    this.seeds.add(seedId)
    this.changed()
  }

  private changed(): void {
    const snapshot = this.snapshot()
    this.onChange?.(snapshot)
    for (const listener of this.listeners) listener(snapshot)
  }

  subscribe(listener: (snapshot: TaskStoreSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
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
    const nextRunAt =
      input.enabled && input.schedule ? requireUpcomingOccurrence(input.schedule, timestamp) : null
    const task: ScheduledTask = {
      ...structuredClone(input),
      id: this.makeId(),
      nextRunAt,
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
    const replacesTrigger = hasOwn(patch, 'schedule') || hasOwn(patch, 'watchdog')
    const input: ScheduledTaskInput = {
      title: patch.title ?? current.title,
      prompt: patch.prompt ?? current.prompt,
      // `action` reportee comme les autres champs. Elle manquait ici alors que la couche IPC la
      // transmettait : une mise a jour de titre suffisait donc a retransformer une veille en tache de
      // chat, silencieusement. Constate en verifiant le fichier sur disque apres un appel — l'API
      // rendait `action: undefined` alors qu'elle venait d'etre demandee.
      ...((patch.action ?? current.action) ? { action: patch.action ?? current.action } : {}),
      enabled: patch.enabled ?? current.enabled,
      mode: patch.mode ?? current.mode,
      destination: structuredClone(patch.destination ?? current.destination),
      schedule: structuredClone(replacesTrigger ? patch.schedule : current.schedule),
      watchdog: structuredClone(replacesTrigger ? patch.watchdog : current.watchdog)
    }
    validateTaskInput(input)
    const timestamp = this.now()
    const scheduleChanged =
      replacesTrigger && JSON.stringify(input.schedule) !== JSON.stringify(current.schedule)
    const plannedNextRunAt =
      !input.enabled || !input.schedule
        ? null
        : !current.enabled || scheduleChanged
          ? requireUpcomingOccurrence(input.schedule, timestamp)
          : undefined
    this.reconcilePastDueBeforeUpdate(current, timestamp)
    const nextRunAt = plannedNextRunAt === undefined ? current.nextRunAt : plannedNextRunAt
    const task: ScheduledTask = {
      ...current,
      ...input,
      nextRunAt,
      updatedAt: timestamp
    }
    this.tasks.set(id, task)
    this.changed()
    return structuredClone(task)
  }

  remove(id: string): boolean {
    const activeOccurrence = [...this.occurrences.values()].find(
      (occurrence) =>
        occurrence.taskId === id &&
        (occurrence.status === 'claimed' || occurrence.status === 'running')
    )
    if (activeOccurrence) {
      throw new Error(`La tâche ${id} est en cours et ne peut pas être supprimée.`)
    }
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
    scheduledFor: number,
    /** Renseigne l'origine : un réveil événementiel porte le signal qui l'a causé. */
    origin: { trigger?: TaskOccurrence['trigger']; watchdog?: WatchdogSignal } = {}
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
      mode: task.mode,
      status: 'claimed',
      claimedAt: this.now(),
      ...(origin.trigger ? { trigger: origin.trigger } : {}),
      ...(origin.watchdog ? { watchdog: structuredClone(origin.watchdog) } : {})
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

  /**
   * Reconcile un snapshot cumulatif arrive apres la reponse du dispatcher. Les compteurs ne peuvent
   * que monter : une publication ancienne ou rejouee apres crash ne retranche jamais une depense.
   */
  reconcileUsage(
    occurrenceId: string,
    usage: {
      conversationId?: string
      turnId?: string
      knownCostUsd?: number
      totalTokens?: number
      unpricedCalls?: number
      requestedModel?: string
      resolvedModel?: string
    }
  ): TaskOccurrence {
    const occurrence = this.occurrences.get(occurrenceId)
    if (!occurrence) throw new Error(`Occurrence inconnue: ${occurrenceId}`)
    const maximum = (
      current: number | undefined,
      incoming: number | undefined
    ): number | undefined =>
      incoming === undefined || !Number.isFinite(incoming)
        ? current
        : Math.max(current ?? 0, Math.max(0, incoming))
    const nextKnownCostUsd = maximum(occurrence.knownCostUsd, usage.knownCostUsd)
    const nextTotalTokens = maximum(occurrence.totalTokens, usage.totalTokens)
    const nextUnpricedCalls = maximum(occurrence.unpricedCalls, usage.unpricedCalls)
    const changed =
      nextKnownCostUsd !== occurrence.knownCostUsd ||
      nextTotalTokens !== occurrence.totalTokens ||
      nextUnpricedCalls !== occurrence.unpricedCalls ||
      (usage.conversationId !== undefined && usage.conversationId !== occurrence.conversationId) ||
      (usage.turnId !== undefined && usage.turnId !== occurrence.turnId) ||
      (usage.requestedModel !== undefined && usage.requestedModel !== occurrence.requestedModel) ||
      (usage.resolvedModel !== undefined && usage.resolvedModel !== occurrence.resolvedModel)
    if (!changed) return structuredClone(occurrence)
    if (nextKnownCostUsd !== undefined) occurrence.knownCostUsd = nextKnownCostUsd
    if (nextTotalTokens !== undefined) occurrence.totalTokens = nextTotalTokens
    if (nextUnpricedCalls !== undefined) occurrence.unpricedCalls = nextUnpricedCalls
    if (usage.conversationId !== undefined) occurrence.conversationId = usage.conversationId
    if (usage.turnId !== undefined) occurrence.turnId = usage.turnId
    if (usage.requestedModel !== undefined) occurrence.requestedModel = usage.requestedModel
    if (usage.resolvedModel !== undefined) occurrence.resolvedModel = usage.resolvedModel
    this.changed()
    return structuredClone(occurrence)
  }

  /** Retrouve l'occurrence apres redemarrage grace a la correlation posee avant le spawn. */
  reconcileUsageForTurn(
    conversationId: string,
    turnId: string,
    usage: Parameters<TaskStore['reconcileUsage']>[1]
  ): TaskOccurrence | undefined {
    const occurrence = [...this.occurrences.values()].find(
      (candidate) => candidate.conversationId === conversationId && candidate.turnId === turnId
    )
    return occurrence ? this.reconcileUsage(occurrence.id, usage) : undefined
  }

  finish(
    occurrenceId: string,
    status: Extract<TaskOccurrenceStatus, 'completed' | 'failed' | 'cancelled'>,
    details: {
      conversationId?: string
      turnId?: string
      error?: string
      knownCostUsd?: number
      totalTokens?: number
      unpricedCalls?: number
      requestedModel?: string
      resolvedModel?: string
      /** Le tri rendu par un agent réveillé. Absent = l'agent n'a pas conclu, on ne le devine pas. */
      outcome?: WatchdogOutcome
    } = {}
  ): TaskOccurrence {
    const existing = this.occurrences.get(occurrenceId)
    if (!existing) throw new Error(`Occurrence inconnue: ${occurrenceId}`)
    const monotoneDetails = {
      ...details,
      ...(details.knownCostUsd === undefined && existing.knownCostUsd === undefined
        ? {}
        : { knownCostUsd: Math.max(existing.knownCostUsd ?? 0, details.knownCostUsd ?? 0) }),
      ...(details.totalTokens === undefined && existing.totalTokens === undefined
        ? {}
        : { totalTokens: Math.max(existing.totalTokens ?? 0, details.totalTokens ?? 0) }),
      ...(details.unpricedCalls === undefined && existing.unpricedCalls === undefined
        ? {}
        : { unpricedCalls: Math.max(existing.unpricedCalls ?? 0, details.unpricedCalls ?? 0) })
    }
    const occurrence = this.updateOccurrence(occurrenceId, status, {
      finishedAt: this.now(),
      ...monotoneDetails
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
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Tâche inconnue: ${taskId}`)
    const occurrence: TaskOccurrence = {
      id: occurrenceId,
      taskId,
      scheduledFor,
      mode: task.mode,
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

  /**
   * Condense toutes les échéances déjà dépassées en une seule occurrence durable et avance la
   * tâche directement à la première échéance strictement future. Le démarrage reste ainsi borné
   * même après plusieurs milliers de minutes hors ligne.
   */
  markMissedThrough(taskId: string, cutoff: number, reason: string): TaskOccurrence | null {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error(`Tâche inconnue: ${taskId}`)
    const occurrence = this.reconcilePastDueRange(task, cutoff, reason)
    if (!occurrence) return null
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

  private reconcilePastDueBeforeUpdate(task: ScheduledTask, timestamp: number): void {
    this.reconcilePastDueRange(
      task,
      timestamp,
      'Échéance dépassée avant la mise à jour de la tâche.'
    )
  }

  private reconcilePastDueRange(
    task: ScheduledTask,
    cutoff: number,
    reason: string
  ): TaskOccurrence | null {
    if (!task.schedule) {
      task.nextRunAt = null
      return null
    }
    if (!task.enabled || task.nextRunAt === null || task.nextRunAt > cutoff) return null

    const range = missedOccurrenceRange(task.schedule, task.nextRunAt, cutoff)
    const occurrenceId = occurrenceIdFor(task.id, range.first)
    const summary =
      range.count === 1
        ? reason
        : `${range.count} échéances manquées entre ${new Date(range.first).toISOString()} et ${new Date(range.last).toISOString()}. ${reason}`
    let occurrence = this.occurrences.get(occurrenceId)
    if (!occurrence) {
      occurrence = {
        id: occurrenceId,
        taskId: task.id,
        scheduledFor: range.first,
        mode: task.mode,
        status: 'missed',
        claimedAt: cutoff,
        finishedAt: cutoff,
        error: summary,
        missedCount: range.count,
        lastMissedFor: range.last
      }
      this.occurrences.set(occurrenceId, occurrence)
      this.createAlertOnce(occurrence, 'missed', summary, false)
    }
    task.nextRunAt = range.next
    task.updatedAt = cutoff
    return occurrence
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

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function requireUpcomingOccurrence(schedule: StructuredSchedule, threshold: number): number {
  const nextRunAt = resolveFirstOccurrenceAtOrAfter(schedule, threshold)
  if (nextRunAt === null) {
    throw new Error('La planification ne contient aucune échéance future.')
  }
  return nextRunAt
}

function missedOccurrenceRange(
  schedule: StructuredSchedule,
  first: number,
  cutoff: number
): { first: number; last: number; count: number; next: number | null } {
  const next = resolveFirstOccurrenceAtOrAfter(schedule, cutoff + 1)
  const fixedStep =
    schedule.recurrence.unit === 'minute'
      ? schedule.recurrence.interval * 60_000
      : schedule.recurrence.unit === 'hour'
        ? schedule.recurrence.interval * 3_600_000
        : null
  if (fixedStep !== null && next !== null) {
    const count = Math.max(1, Math.round((next - first) / fixedStep))
    return { first, last: next - fixedStep, count, next }
  }

  let count = 1
  let last = first
  let cursor = resolveNextOccurrence(schedule, first)
  while (cursor !== null && cursor <= cutoff) {
    count += 1
    last = cursor
    cursor = resolveNextOccurrence(schedule, cursor)
  }
  return { first, last, count, next: cursor }
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
  if (Boolean(input.schedule) === Boolean(input.watchdog)) {
    throw new Error('Une tâche requiert soit un horaire, soit un réveil événementiel')
  }
  if (input.schedule) resolveFirstOccurrence(input.schedule)
}
