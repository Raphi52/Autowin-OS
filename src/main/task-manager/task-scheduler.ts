import { occurrenceIdFor, resolveNextOccurrence } from './schedule'
import type { TaskStore } from './task-store'
import type {
  ScheduledTask,
  TaskOccurrence,
  WatchdogMutationClaimsSink,
  WatchdogOutcome,
  WatchdogSignal
} from './types'

export interface SchedulerClock {
  now(): number
  setTimer(callback: () => void, delayMs: number): unknown
  clearTimer(handle: unknown): void
}

export interface DispatchResult {
  status: 'completed' | 'failed' | 'cancelled'
  conversationId?: string
  turnId?: string
  error?: string
  knownCostUsd?: number
  totalTokens?: number
  unpricedCalls?: number
  /** Le tri conclu par un agent réveillé, quand il a pu être lu dans sa réponse. */
  outcome?: WatchdogOutcome
  /** Fichiers réellement attribués à ce tour par les preuves d'exécution. */
  mutatedPaths?: readonly string[]
  /** Empreintes des lignes écrites par le tour, indexées par chemin absolu. */
  mutatedLineFingerprints?: Record<string, readonly string[]>
  mutatedPathGenerationMarkers?: Record<string, string>
}

export interface TaskDispatcher {
  run(
    task: ScheduledTask,
    occurrence: TaskOccurrence,
    onLateMutationClaims?: WatchdogMutationClaimsSink
  ): Promise<DispatchResult>
}

export interface RelayState {
  available: boolean
  scheduledFor: number | null
  wakeToRun: boolean
  startWhenAvailable: boolean
  multipleInstances: 'IgnoreNew'
  error?: string
}

export interface WindowsRelay {
  arm(scheduledFor: number | null, occurrenceId: string | null): Promise<RelayState>
}

const systemClock: SchedulerClock = {
  now: () => Date.now(),
  setTimer: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs)
    timer.unref?.()
    return timer
  },
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export const WINDOWS_RELAY_GRACE_MS = 5 * 60_000

export class TaskScheduler {
  private timer: unknown
  private running = false
  private processing = false
  private relayState: RelayState = {
    available: false,
    scheduledFor: null,
    wakeToRun: true,
    startWhenAvailable: false,
    multipleInstances: 'IgnoreNew'
  }
  private lastRelayKey: string | undefined

  constructor(
    private readonly store: TaskStore,
    private readonly dispatcher: TaskDispatcher,
    private readonly relay: WindowsRelay,
    private readonly clock: SchedulerClock = systemClock
  ) {}

  state(): { running: boolean; nextWakeAt: number | null; relay: RelayState } {
    const enabled = this.store.listTasks().filter((task) => task.enabled && task.nextRunAt !== null)
    return {
      running: this.running,
      nextWakeAt:
        enabled.length === 0 ? null : Math.min(...enabled.map((task) => task.nextRunAt as number)),
      relay: structuredClone(this.relayState)
    }
  }

  async start(requestedOccurrenceId?: string): Promise<void> {
    if (this.running) return
    this.running = true
    this.store.recoverInterrupted('Autowin a été interrompu avant la fin du prompt planifié.')
    if (requestedOccurrenceId) await this.runOccurrence(requestedOccurrenceId)
    await this.markStartupMisses()
    await this.plan()
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.timer !== undefined) this.clock.clearTimer(this.timer)
    this.timer = undefined
    await this.syncRelay(null, null)
  }

  async processLiveDue(): Promise<void> {
    if (!this.running || this.processing) return
    this.processing = true
    try {
      const now = this.clock.now()
      for (const listedTask of this.store.listTasks()) {
        if (listedTask.mode !== 'active-only') continue
        let task = this.store.getTask(listedTask.id)
        while (task?.enabled && task.nextRunAt !== null && task.nextRunAt <= now) {
          const scheduledFor = task.nextRunAt
          const occurrenceId = occurrenceIdFor(task.id, scheduledFor)
          const claim = this.store.claim(task.id, occurrenceId, scheduledFor)
          this.advanceTask(task, scheduledFor)
          if (claim.claimed) await this.execute(task, claim.occurrence)
          task = this.store.getTask(task.id)
        }
      }
    } finally {
      this.processing = false
      await this.plan()
    }
  }

  async runOccurrence(occurrenceId: string): Promise<boolean> {
    const parsed = parseOccurrenceId(occurrenceId)
    if (!parsed) return false
    const task = this.store.getTask(parsed.taskId)
    if (
      !task?.enabled ||
      task.mode !== 'windows' ||
      task.nextRunAt !== parsed.scheduledFor ||
      parsed.scheduledFor > this.clock.now()
    ) {
      return false
    }
    if (this.clock.now() - parsed.scheduledFor > WINDOWS_RELAY_GRACE_MS) {
      this.store.markMissed(
        task.id,
        occurrenceId,
        parsed.scheduledFor,
        'Le relais Windows a démarré trop tard ; le prompt n’a pas été rattrapé.'
      )
      this.advanceTask(task, parsed.scheduledFor)
      if (this.running) await this.plan()
      return false
    }
    const claim = this.store.claim(task.id, occurrenceId, parsed.scheduledFor)
    if (!claim.claimed) return false
    this.advanceTask(task, parsed.scheduledFor)
    await this.execute(task, claim.occurrence)
    if (this.running) await this.plan()
    return true
  }

  async runNow(taskId: string): Promise<boolean> {
    const task = this.store.getTask(taskId)
    if (!task?.enabled) return false
    const scheduledFor = this.clock.now()
    const occurrenceId = `${task.id}@manual-${scheduledFor}`
    const claim = this.store.claim(task.id, occurrenceId, scheduledFor)
    if (!claim.claimed) return false
    await this.execute(task, claim.occurrence)
    if (this.running) await this.plan()
    return true
  }

  /**
   * Entree EVENEMENTIELLE. Volontairement batie sur le meme claim et le meme dispatch que les
   * echeances horaires : un reveil ajoute une facon d'ENTRER dans l'execution, pas un second moteur.
   * Une occurrence de reveil ne touche jamais `nextRunAt` — il n'y a pas d'echeance a avancer.
   */
  async runWatchdog(
    taskId: string,
    signal: WatchdogSignal,
    onLateMutationClaims?: WatchdogMutationClaimsSink
  ): Promise<{
    fired: boolean
    mutatedPaths?: readonly string[]
    mutatedLineFingerprints?: Record<string, readonly string[]>
    mutatedPathGenerationMarkers?: Record<string, string>
  }> {
    const task = this.store.getTask(taskId)
    if (!task?.enabled || !task.watchdog) return { fired: false }
    const observedAt = signal.observedAt || this.clock.now()
    const occurrenceId = `${task.id}@watchdog-${observedAt}-${occurrenceSalt(signal.signature)}`
    const claim = this.store.claim(task.id, occurrenceId, observedAt, {
      trigger: 'watchdog',
      watchdog: signal
    })
    if (!claim.claimed) return { fired: false }
    const result = await this.execute(task, claim.occurrence, onLateMutationClaims)
    return {
      fired: true,
      ...(result.mutatedPaths ? { mutatedPaths: result.mutatedPaths } : {}),
      ...(result.mutatedLineFingerprints
        ? { mutatedLineFingerprints: result.mutatedLineFingerprints }
        : {}),
      ...(result.mutatedPathGenerationMarkers
        ? { mutatedPathGenerationMarkers: result.mutatedPathGenerationMarkers }
        : {})
    }
  }

  async refresh(): Promise<void> {
    if (!this.running) return
    await this.plan()
  }

  private async execute(
    task: ScheduledTask,
    occurrence: TaskOccurrence,
    onLateMutationClaims?: WatchdogMutationClaimsSink
  ): Promise<DispatchResult> {
    this.store.markRunning(occurrence.id)
    try {
      const result = await this.dispatcher.run(task, occurrence, onLateMutationClaims)
      this.store.finish(occurrence.id, result.status, {
        conversationId: result.conversationId,
        turnId: result.turnId,
        error: result.error,
        knownCostUsd: result.knownCostUsd,
        totalTokens: result.totalTokens,
        unpricedCalls: result.unpricedCalls,
        outcome: result.outcome
      })
      return result
    } catch (error) {
      const failed: DispatchResult = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      }
      this.store.finish(occurrence.id, 'failed', {
        error: failed.error
      })
      return failed
    }
  }

  private advanceTask(task: ScheduledTask, scheduledFor: number): void {
    if (!task.schedule) {
      this.store.setNextRunAt(task.id, null)
      return
    }
    const next = resolveNextOccurrence(task.schedule, scheduledFor)
    this.store.setNextRunAt(task.id, task.enabled ? next : null)
  }

  private async markStartupMisses(): Promise<void> {
    const now = this.clock.now()
    for (const listedTask of this.store.listTasks()) {
      if (!listedTask.enabled || listedTask.nextRunAt === null || listedTask.nextRunAt > now)
        continue
      this.store.markMissedThrough(
        listedTask.id,
        now,
        listedTask.mode === 'active-only'
          ? 'Autowin n’était pas actif à l’échéance.'
          : 'Le relais Windows n’a pas exécuté cette échéance.'
      )
    }
  }

  private async plan(): Promise<void> {
    if (!this.running) return
    if (this.timer !== undefined) this.clock.clearTimer(this.timer)
    this.timer = undefined
    const tasks = this.store
      .listTasks()
      .filter((task) => task.enabled && task.nextRunAt !== null)
      .sort((left, right) => (left.nextRunAt as number) - (right.nextRunAt as number))
    const next = tasks.find((task) => task.mode === 'active-only')
    if (next?.nextRunAt !== null && next?.nextRunAt !== undefined) {
      const delay = Math.max(0, Math.min(2_147_000_000, next.nextRunAt - this.clock.now()))
      this.timer = this.clock.setTimer(() => void this.processLiveDue(), delay)
    }
    const nextWindows = tasks.find((task) => task.mode === 'windows')
    await this.syncRelay(
      nextWindows?.nextRunAt ?? null,
      nextWindows?.nextRunAt === null || nextWindows?.nextRunAt === undefined
        ? null
        : occurrenceIdFor(nextWindows.id, nextWindows.nextRunAt)
    )
  }

  private async syncRelay(scheduledFor: number | null, occurrenceId: string | null): Promise<void> {
    const key = `${scheduledFor ?? 'none'}:${occurrenceId ?? 'none'}`
    if (this.lastRelayKey === key) return
    this.lastRelayKey = key
    try {
      this.relayState = await this.relay.arm(scheduledFor, occurrenceId)
    } catch (error) {
      this.lastRelayKey = undefined
      this.relayState = {
        available: false,
        scheduledFor,
        wakeToRun: true,
        startWhenAvailable: false,
        multipleInstances: 'IgnoreNew',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

function parseOccurrenceId(
  occurrenceId: string
): { taskId: string; scheduledFor: number } | undefined {
  const separator = occurrenceId.lastIndexOf('@')
  if (separator <= 0) return undefined
  const taskId = occurrenceId.slice(0, separator)
  const scheduledFor = Number(occurrenceId.slice(separator + 1))
  if (!taskId || !Number.isSafeInteger(scheduledFor) || scheduledFor < 0) return undefined
  return { taskId, scheduledFor }
}

/**
 * Deux signaux DIFFERENTS observes a la meme milliseconde doivent produire deux occurrences
 * distinctes : sans ce discriminant, le second serait avale par le claim du premier et l'incident
 * disparaitrait en silence.
 */
function occurrenceSalt(signature: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < signature.length; i += 1) {
    hash ^= signature.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}
