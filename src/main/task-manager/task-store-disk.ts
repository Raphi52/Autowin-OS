import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'
import type { TaskStoreSnapshot } from './types'
import type { TaskStore } from './task-store'

export function taskStorePath(): string {
  return join(ensureAutowinAppData(), 'scheduled-tasks.json')
}

function emptyTaskStoreSnapshot(): TaskStoreSnapshot {
  return { schemaVersion: 1, tasks: [], occurrences: [], alerts: [] }
}

function loadTaskStore(path = taskStorePath()): TaskStoreSnapshot {
  if (!existsSync(path)) return emptyTaskStoreSnapshot()
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Store Task Manager corrompu: ${path}`)
  }
  const snapshot = value as Partial<TaskStoreSnapshot>
  if (
    snapshot.schemaVersion !== 1 ||
    !Array.isArray(snapshot.tasks) ||
    !Array.isArray(snapshot.occurrences) ||
    !Array.isArray(snapshot.alerts)
  ) {
    throw new Error(`Store Task Manager incompatible: ${path}`)
  }
  return snapshot as TaskStoreSnapshot
}

function saveTaskStore(snapshot: TaskStoreSnapshot, path = taskStorePath()): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, JSON.stringify(snapshot, null, 2), 'utf8')
  renameSync(temporary, path)
}

export function persistTaskStore(store: TaskStore, path = taskStorePath()): () => void {
  store.hydrate(loadTaskStore(path))
  store.onChange = (snapshot) => saveTaskStore(snapshot, path)
  return () => saveTaskStore(store.snapshot(), path)
}
