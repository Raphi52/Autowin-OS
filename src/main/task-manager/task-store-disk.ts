import { join } from 'node:path'
import { ensureAutowinAppData } from '../app/app-data'
import {
  attendreFichier,
  deposerFichier,
  relireFichier,
  viderFichiersEnAttente
} from '../gel/ecriture-hors-fil'
import type { TaskStoreSnapshot } from './types'
import type { TaskStore } from './task-store'

export function taskStorePath(): string {
  return join(ensureAutowinAppData(), 'scheduled-tasks.json')
}

function emptyTaskStoreSnapshot(): TaskStoreSnapshot {
  return { schemaVersion: 1, tasks: [], occurrences: [], alerts: [] }
}

function loadTaskStore(path = taskStorePath()): TaskStoreSnapshot {
  const texte = relireFichier(path)
  if (texte === undefined) return emptyTaskStoreSnapshot()
  const value: unknown = JSON.parse(texte)
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

/**
 * Hors du fil principal : `renameSync` ici a figé la fenêtre 23,4 s en 7 jours, 16 s d'un
 * coup. La revendication d'une occurrence n'en reste pas moins durable avant son exécution :
 * `attendrePersistance` la fait attendre par le planificateur.
 */
function saveTaskStore(snapshot: TaskStoreSnapshot, path = taskStorePath()): void {
  deposerFichier(path, JSON.stringify(snapshot, null, 2))
}

export function persistTaskStore(store: TaskStore, path = taskStorePath()): () => void {
  store.hydrate(loadTaskStore(path))
  store.onChange = (snapshot) => saveTaskStore(snapshot, path)
  store.attendrePersistance = () => attendreFichier(path)
  return () => {
    saveTaskStore(store.snapshot(), path)
    viderFichiersEnAttente()
  }
}
