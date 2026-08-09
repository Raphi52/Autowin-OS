import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { TaskScheduler } from './task-scheduler'
import type { TaskStore } from './task-store'
import type {
  ScheduledTaskInput,
  TaskDestination,
  TaskManagerSnapshot,
  WatchdogAppEvent,
  WatchdogGuards,
  WatchdogRule
} from './types'
import type { StructuredRecurrence, StructuredSchedule } from './schedule'
import { watchdogRegexProblem } from '../../shared/watchdog-regex'
import { isReasoningEffort, type ReasoningEffort } from '../roles'

interface RegisterTaskManagerIpcOptions {
  ipc: IpcMain
  store: TaskStore
  scheduler: TaskScheduler
  watchdogDiagnostics(taskId: string): { admittedLastHour: number; complaint?: string }
  assertTrusted(event: IpcMainInvokeEvent, scope: string): void
  onChanged(): void
}

export function registerTaskManagerIpc(options: RegisterTaskManagerIpcOptions): void {
  const { ipc, store, scheduler, watchdogDiagnostics, assertTrusted, onChanged } = options

  ipc.handle('task-manager:snapshot', (event) => {
    assertTrusted(event, 'Task Manager')
    const state = scheduler.state()
    const tasks = store.listTasks()
    return {
      ...store.snapshot(),
      watchdogs: Object.fromEntries(
        tasks
          .filter((task) => Boolean(task.watchdog))
          .map((task) => [task.id, watchdogDiagnostics(task.id)])
      ),
      scheduler: {
        running: state.running,
        nextWakeAt: state.nextWakeAt,
        relayAvailable: state.relay.available,
        ...(state.relay.error ? { relayError: state.relay.error } : {})
      }
    } satisfies TaskManagerSnapshot
  })

  ipc.handle('task-manager:create', async (event, raw: unknown) => {
    assertTrusted(event, 'Task Manager')
    const task = store.create(parseTaskInput(raw))
    await scheduler.refresh()
    onChanged()
    return task
  })

  ipc.handle('task-manager:update', async (event, rawId: unknown, raw: unknown) => {
    assertTrusted(event, 'Task Manager')
    const id = requiredString(rawId, 'id')
    const current = store.getTask(id)
    if (!current) throw new Error(`Tâche inconnue: ${id}`)
    const task = store.update(id, parseTaskUpdate(current, raw))
    await scheduler.refresh()
    onChanged()
    return task
  })

  ipc.handle('task-manager:remove', async (event, rawId: unknown) => {
    assertTrusted(event, 'Task Manager')
    const removed = store.remove(requiredString(rawId, 'id'))
    await scheduler.refresh()
    onChanged()
    return removed
  })

  ipc.handle('task-manager:acknowledge', (event, rawId: unknown) => {
    assertTrusted(event, 'Task Manager')
    const acknowledged = store.acknowledgeAlert(requiredString(rawId, 'alertId'))
    if (acknowledged) onChanged()
    return acknowledged
  })

  ipc.handle('task-manager:run-now', async (event, rawId: unknown) => {
    assertTrusted(event, 'Task Manager')
    const started = await scheduler.runNow(requiredString(rawId, 'id'))
    onChanged()
    return { started }
  })
}

export function parseTaskUpdate(current: ScheduledTaskInput, raw: unknown): ScheduledTaskInput {
  const patch = object(raw, 'mise à jour')
  const replacesTrigger = hasOwn(patch, 'schedule') || hasOwn(patch, 'watchdog')
  return parseTaskInput({
    title: patch.title ?? current.title,
    prompt: patch.prompt ?? current.prompt,
    enabled: patch.enabled ?? current.enabled,
    mode: patch.mode ?? current.mode,
    destination: patch.destination ?? current.destination,
    schedule: replacesTrigger ? patch.schedule : current.schedule,
    watchdog: replacesTrigger ? patch.watchdog : current.watchdog
  })
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function parseTaskInput(raw: unknown): ScheduledTaskInput {
  const value = object(raw, 'tâche')
  return {
    title: requiredString(value.title, 'title'),
    prompt: requiredString(value.prompt, 'prompt'),
    enabled: boolean(value.enabled, 'enabled'),
    mode: mode(value.mode),
    destination: destination(value.destination),
    ...(value.schedule === undefined ? {} : { schedule: schedule(value.schedule) }),
    ...(value.watchdog === undefined ? {} : { watchdog: watchdog(value.watchdog) })
  }
}

const WATCHDOG_APP_EVENTS: readonly WatchdogAppEvent[] = [
  'orchestration-red',
  'task-failed',
  'task-missed'
]

/** Bornes des gardes. Ce sont des valeurs qui arrivent du renderer : on les CONTRAINT, on ne les
 *  croit pas. Un plafond a 0 desarmerait la regle, un plafond immense annulerait l'anti-rafale. */
function guards(raw: unknown): WatchdogGuards {
  const value = object(raw, 'watchdog.guards')
  const clamp = (input: unknown, min: number, max: number, fallback: number): number => {
    const parsed = typeof input === 'number' && Number.isFinite(input) ? input : fallback
    return Math.min(max, Math.max(min, Math.round(parsed)))
  }
  return {
    dedupWindowMs: clamp(value.dedupWindowMs, 0, 24 * 3_600_000, 60_000),
    maxTriggersPerHour: clamp(value.maxTriggersPerHour, 1, 240, 12),
    // La profondeur reste la garde la plus sensible : une chaine longue est une boucle qui ecrit.
    maxChainDepth: clamp(value.maxChainDepth, 0, 3, 0),
    // Largeur de cascade : bornee comme le reste. Un plafond a 0 desarmerait la regle entierement.
    maxPerRoot: clamp(value.maxPerRoot, 1, 500, 20)
  }
}

function watchdog(raw: unknown): WatchdogRule {
  const value = object(raw, 'watchdog')
  const source = object(value.source, 'watchdog.source')
  if (source.kind === 'file-match') {
    const pattern = requiredString(source.pattern, 'watchdog.source.pattern')
    const regexProblem = watchdogRegexProblem(pattern)
    if (regexProblem) throw new Error(regexProblem)
    return {
      source: {
        kind: 'file-match',
        path: requiredString(source.path, 'watchdog.source.path'),
        pattern,
        ...(source.caseSensitive === true ? { caseSensitive: true } : {})
      },
      guards: guards(value.guards),
      ...(value.action === undefined ? {} : { action: watchdogAction(value.action) })
    }
  }
  if (source.kind === 'app-event') {
    const raw = Array.isArray(source.events) ? source.events : []
    // Une règle sans AUCUN événement ne se déclencherait jamais, en silence : on la refuse à
    // l'entrée plutôt que de laisser croire qu'elle surveille quelque chose.
    const events = WATCHDOG_APP_EVENTS.filter((candidate) => raw.includes(candidate))
    if (!events.length) throw new Error('Choisis au moins un événement interne à surveiller')
    return {
      source: { kind: 'app-event', events },
      guards: guards(value.guards),
      ...(value.action === undefined ? {} : { action: watchdogAction(value.action) })
    }
  }
  throw new Error('Source de réveil invalide')
}

function watchdogAction(raw: unknown): 'chat' | 'orchestration' {
  if (raw === 'chat' || raw === 'orchestration') return raw
  throw new Error(`Action watchdog inconnue: ${String(raw)}`)
}

function destination(raw: unknown): TaskDestination {
  const value = object(raw, 'destination')
  if (value.kind === 'existing') {
    return {
      kind: 'existing',
      conversationId: requiredString(value.conversationId, 'conversationId'),
      ...(typeof value.provider === 'string' && value.provider.trim()
        ? { provider: value.provider.trim() }
        : {}),
      ...(typeof value.model === 'string' && value.model.trim()
        ? { model: value.model.trim() }
        : {}),
      ...(value.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: reasoningEffort(value.reasoningEffort) })
    }
  }
  if (value.kind === 'new') {
    const authorityMode =
      value.authorityMode === undefined ? undefined : authority(value.authorityMode)
    return {
      kind: 'new',
      title: requiredString(value.title, 'destination.title'),
      category: requiredString(value.category, 'destination.category'),
      provider: requiredString(value.provider, 'destination.provider'),
      ...(typeof value.model === 'string' && value.model.trim()
        ? { model: value.model.trim() }
        : {}),
      ...(value.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: reasoningEffort(value.reasoningEffort) }),
      ...(authorityMode ? { authorityMode } : {}),
      ...(typeof value.conversationId === 'string' && value.conversationId.trim()
        ? { conversationId: value.conversationId.trim() }
        : {})
    }
  }
  throw new Error('Destination Task Manager invalide')
}

function schedule(raw: unknown): StructuredSchedule {
  const value = object(raw, 'schedule')
  const recurrenceValue = object(value.recurrence, 'recurrence')
  const unit = recurrenceValue.unit
  if (!['none', 'minute', 'hour', 'day', 'week', 'month'].includes(String(unit))) {
    throw new Error('Unité de récurrence invalide')
  }
  const recurrence: StructuredRecurrence = {
    unit: unit as StructuredRecurrence['unit'],
    interval: integer(recurrenceValue.interval, 'recurrence.interval'),
    ...(Array.isArray(recurrenceValue.weekDays)
      ? {
          weekDays: recurrenceValue.weekDays.map((day, index) =>
            integer(day, `recurrence.weekDays[${index}]`)
          )
        }
      : {})
  }
  return {
    startDate: requiredString(value.startDate, 'startDate'),
    time: requiredString(value.time, 'time'),
    timeZone: requiredString(value.timeZone, 'timeZone'),
    recurrence,
    ...(typeof value.endDate === 'string' && value.endDate.trim()
      ? { endDate: value.endDate.trim() }
      : {})
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: objet attendu`)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}: texte requis`)
  return value.trim()
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}: booléen attendu`)
  return value
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value)) throw new Error(`${label}: entier attendu`)
  return value as number
}

function mode(value: unknown): ScheduledTaskInput['mode'] {
  if (value !== 'windows' && value !== 'active-only') throw new Error('Mode de tâche invalide')
  return value
}

function authority(value: unknown): 'plan' | 'ask' | 'auto' {
  if (value !== 'plan' && value !== 'ask' && value !== 'auto') {
    throw new Error('Mode d’autorité invalide')
  }
  return value
}

function reasoningEffort(value: unknown): ReasoningEffort {
  if (!isReasoningEffort(value)) {
    throw new Error('Effort de raisonnement invalide')
  }
  return value
}
