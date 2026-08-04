import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { TaskScheduler } from './task-scheduler'
import type { TaskStore } from './task-store'
import type { ScheduledTaskInput, TaskDestination, TaskManagerSnapshot } from './types'
import type { StructuredRecurrence, StructuredSchedule } from './schedule'

interface RegisterTaskManagerIpcOptions {
  ipc: IpcMain
  store: TaskStore
  scheduler: TaskScheduler
  assertTrusted(event: IpcMainInvokeEvent, scope: string): void
  onChanged(): void
}

export function registerTaskManagerIpc(options: RegisterTaskManagerIpcOptions): void {
  const { ipc, store, scheduler, assertTrusted, onChanged } = options

  ipc.handle('task-manager:snapshot', (event) => {
    assertTrusted(event, 'Task Manager')
    const state = scheduler.state()
    return {
      ...store.snapshot(),
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
    const patch = object(raw, 'mise à jour')
    const task = store.update(
      id,
      parseTaskInput({
        title: patch.title ?? current.title,
        prompt: patch.prompt ?? current.prompt,
        enabled: patch.enabled ?? current.enabled,
        mode: patch.mode ?? current.mode,
        destination: patch.destination ?? current.destination,
        schedule: patch.schedule ?? current.schedule
      })
    )
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

function parseTaskInput(raw: unknown): ScheduledTaskInput {
  const value = object(raw, 'tâche')
  return {
    title: requiredString(value.title, 'title'),
    prompt: requiredString(value.prompt, 'prompt'),
    enabled: boolean(value.enabled, 'enabled'),
    mode: mode(value.mode),
    destination: destination(value.destination),
    schedule: schedule(value.schedule)
  }
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

function reasoningEffort(
  value: unknown
): 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' {
  if (
    !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(
      String(value)
    )
  ) {
    throw new Error('Effort de raisonnement invalide')
  }
  return value as 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
}
