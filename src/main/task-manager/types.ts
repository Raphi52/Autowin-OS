import type { StructuredSchedule } from './schedule'
import type { ReasoningEffort } from '../roles'

export type TaskExecutionMode = 'windows' | 'active-only'

export type TaskDestination =
  | {
      kind: 'existing'
      conversationId: string
      /** Modèle explicite de la tâche; absent sur les tâches historiques. */
      provider?: string
      model?: string
      reasoningEffort?: ReasoningEffort
    }
  | {
      kind: 'new'
      title: string
      category: string
      provider: string
      /** Modèle explicite de la tâche; absent sur les tâches historiques. */
      model?: string
      reasoningEffort?: ReasoningEffort
      authorityMode?: 'plan' | 'ask' | 'auto'
      /** Conversation dédiée créée au premier déclenchement, puis réutilisée. */
      conversationId?: string
    }

export interface ScheduledTaskInput {
  title: string
  prompt: string
  enabled: boolean
  mode: TaskExecutionMode
  destination: TaskDestination
  schedule: StructuredSchedule
}

export interface ScheduledTask extends ScheduledTaskInput {
  id: string
  nextRunAt: number | null
  createdAt: number
  updatedAt: number
}

export type TaskOccurrenceStatus =
  'claimed' | 'running' | 'completed' | 'failed' | 'cancelled' | 'missed'

export interface TaskOccurrence {
  id: string
  taskId: string
  scheduledFor: number
  mode: TaskExecutionMode | 'legacy-unknown'
  status: TaskOccurrenceStatus
  claimedAt: number
  startedAt?: number
  finishedAt?: number
  conversationId?: string
  turnId?: string
  error?: string
}

export interface TaskAlert {
  id: string
  taskId: string
  occurrenceId: string
  kind: 'missed' | 'failed'
  message: string
  createdAt: number
  acknowledgedAt?: number
}

export interface TaskStoreSnapshot {
  schemaVersion: 1
  tasks: ScheduledTask[]
  occurrences: TaskOccurrence[]
  alerts: TaskAlert[]
}

export interface TaskManagerSnapshot extends TaskStoreSnapshot {
  scheduler: {
    running: boolean
    nextWakeAt: number | null
    relayAvailable: boolean
    relayError?: string
  }
}
