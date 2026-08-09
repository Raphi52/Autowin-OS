import { AsyncLocalStorage } from 'node:async_hooks'
import { resolve } from 'node:path'
import { DEFAULT_WATCHDOG_GUARDS, WatchdogGuardBook, lineSignature } from './watchdog-guards'
import { lineFingerprint } from './watchdog-line'
import {
  beginAtEnd,
  compileMatcher,
  fileMatchesGenerationMarker,
  readNewLines,
  type FileTailState
} from './watchdog-file-source'
import { describeFileMatch } from './watchdog-prompt'
import { suppressionFor } from './watchdog-suppression'
import type {
  ScheduledTask,
  WatchdogAppEvent,
  WatchdogMutationClaims,
  WatchdogMutationClaimsSink,
  WatchdogSignal
} from './types'

/**
 * Le moteur de reveil : il OBSERVE, il FILTRE, il delegue. Il n'execute rien lui-meme.
 *
 * Le declenchement reel passe par `TaskScheduler.runWatchdog`, qui reutilise le meme claim d'occurrence
 * et le meme dispatch que les taches horaires. Il n'y a donc qu'UN chemin d'execution dans
 * l'application : ce moteur ajoute une facon d'y ENTRER, pas un second moteur a maintenir.
 */

export interface WatchdogDispatch {
  runWatchdog(
    taskId: string,
    signal: WatchdogSignal,
    onLateMutationClaims?: WatchdogMutationClaimsSink
  ): Promise<
    | boolean
    | {
        fired: boolean
        mutatedPaths?: readonly string[]
        mutatedLineFingerprints?: Record<string, readonly string[]>
        mutatedPathGenerationMarkers?: Record<string, string>
      }
  >
}

export interface WatchdogEngineClock {
  now(): number
  setTimer(callback: () => void, delayMs: number): unknown
  clearTimer(handle: unknown): void
}

/** Etat persistable d'une regle, pour qu'un redemarrage ne rejoue pas l'historique. */
export interface WatchdogRuleState {
  path?: string
  tail?: FileTailState
}

interface PendingSelfLineage {
  path: string
  byFingerprint: Map<
    string,
    Array<{
      rootSignature: string
      depth: number
      sequence: number
      generationMarker?: string
      remainingByTask: Map<string, number>
    }>
  >
  totalClaims: number
}

const systemClock: WatchdogEngineClock = {
  now: () => Date.now(),
  setTimer: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs)
    timer.unref?.()
    return timer
  },
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export const DEFAULT_WATCHDOG_POLL_MS = 3_000

/** Lignes de voisinage remises a l'agent autour de celle qui a matche. */
const NEIGHBOURHOOD = 4

export class WatchdogEngine {
  private timer: unknown
  private running = false
  private baselineReady = false
  private polling = false
  private readonly books = new Map<string, WatchdogGuardBook>()
  private readonly states = new Map<string, WatchdogRuleState>()
  private readonly complaints = new Map<string, string>()
  /** Dernier motif de NON-reveil, pour que « rien ne s'est passe » soit explicable. */
  private readonly suppressions = new Map<string, string>()
  private readonly rememberedMutationClaimEvents = new Set<string>()
  /** Partagé par SOURCE : deux règles du même fichier doivent hériter de la même causalité. */
  private readonly pendingSelfLineage = new Map<string, PendingSelfLineage>()
  private selfLineageSequence = 0
  private diagnosticsRefreshPending = false
  /** Profondeur attachée à la chaîne ASYNCHRONE du run, jamais à tout le processus. */
  private readonly causalDepth = new AsyncLocalStorage<number>()
  /**
   * Cause RACINE attachée à la même chaîne asynchrone que la profondeur.
   *
   * Deux dimensions, deux gardes : la profondeur borne la LONGUEUR d'une cascade, la racine borne sa
   * LARGEUR. Mesure de ce dépôt (2026-08-04, `AutoKaizenLimits`) : la garde en profondeur tenait
   * pendant que la cascade s'élargissait de 8 → 11 → 104 → 681 par niveau. Porter la racine sur le
   * même `AsyncLocalStorage` la rend juste sous réveils parallèles, ce qu'un compteur partagé n'est
   * pas.
   */
  private readonly causalRoot = new AsyncLocalStorage<string>()

  constructor(
    private readonly listTasks: () => ScheduledTask[],
    private readonly dispatch: WatchdogDispatch,
    private readonly clock: WatchdogEngineClock = systemClock,
    private readonly pollMs = DEFAULT_WATCHDOG_POLL_MS,
    private readonly onDiagnosticsChanged?: () => void
  ) {}

  /**
   * Au demarrage, chaque regle fichier se positionne A LA FIN de son fichier. C'est ici que se joue
   * « redemarrer ne reveille pas un agent sur trois mois de logs ».
   */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    for (const task of this.watchdogTasks()) {
      const source = task.watchdog?.source
      if (source?.kind !== 'file-match') continue
      if (!this.states.has(task.id)) {
        this.states.set(task.id, { path: source.path, tail: await beginAtEnd(source.path) })
      }
    }
    this.baselineReady = true
    this.schedule()
  }

  stop(): void {
    this.running = false
    if (this.timer !== undefined) this.clock.clearTimer(this.timer)
    this.timer = undefined
  }

  /** Reveils admis sur l'heure glissante, par tache — pour rendre le cout VISIBLE dans la vue. */
  admittedLastHour(taskId: string): number {
    return this.books.get(taskId)?.admittedLastHour() ?? 0
  }

  /** Pourquoi une regle n'a pas reveille d'agent alors qu'un signal est arrive. */
  lastSuppression(taskId: string): string | undefined {
    return this.suppressions.get(taskId)
  }

  /** Ce dont une regle se plaint (fichier absent, illisible) — une regle muette est un piege. */
  complaint(taskId: string): string | undefined {
    return this.complaints.get(taskId)
  }

  /**
   * Réinjecte une publication récupérée après redémarrage. Elle n'a plus sa closure de dispatch,
   * mais ses empreintes Git restent exactes : on lui donne une racine synthétique et une profondeur
   * causale de 1 afin qu'elle soit consommée comme production Autowin, jamais comme incident externe.
   */
  rememberRecoveredMutationClaims(claims: WatchdogMutationClaims): void {
    // Avant la baseline, ces lignes sont déjà dans l'historique que `start()` positionne à EOF.
    // Les conserver masquerait plus tard une vraie ligne externe identique.
    if (!this.baselineReady) return
    if (!this.acceptMutationClaimEvent(claims)) return
    const observedAt = this.clock.now()
    const signal: WatchdogSignal = {
      signature: `recovered-publication@${observedAt}`,
      rootSignature: `recovered-publication@${observedAt}`,
      context: 'Publication Git Autowin reprise après redémarrage.',
      depth: 0,
      source: 'file-match',
      observedAt
    }
    for (const [path, fingerprints] of Object.entries(claims.mutatedLineFingerprints ?? {})) {
      if (fingerprints.length === 0) continue
      const sourceKey = canonicalPath(path)
      const baselinedObserverIds = this.watchdogTasks().flatMap((task) => {
        const source = task.watchdog?.source
        const state = this.states.get(task.id)
        return source?.kind === 'file-match' &&
          canonicalPath(source.path) === sourceKey &&
          typeof state?.path === 'string' &&
          canonicalPath(state.path) === sourceKey
          ? [task.id]
          : []
      })
      if (baselinedObserverIds.length === 0) continue
      const generationMarker = Object.entries(claims.mutatedPathGenerationMarkers ?? {}).find(
        ([candidate]) => canonicalPath(candidate) === canonicalPath(path)
      )?.[1]
      this.rememberSelfLineage(path, fingerprints, signal, generationMarker, baselinedObserverIds)
    }
  }

  /**
   * Un incident applicatif deja emis reveille les regles qui l'ecoutent. Appele par le cablage de
   * l'app ; le moteur ne s'abonne a rien lui-meme, pour rester testable sans monter Electron.
   */
  async notifyAppEvent(event: WatchdogAppEvent, context: string): Promise<void> {
    for (const task of this.watchdogTasks()) {
      const source = task.watchdog?.source
      if (source?.kind !== 'app-event' || !source.events.includes(event)) continue
      const signature = `${event}:${lineSignature(context)}`
      const observedAt = this.clock.now()
      await this.fire(task, {
        signature,
        rootSignature: this.causalRoot.getStore() ?? `${signature}@${observedAt}`,
        context: `Source : événement interne Autowin « ${event} »\n${context}`,
        depth: this.causalDepth.getStore() ?? 0,
        source: 'app-event',
        observedAt
      })
    }
  }

  /** Un passage de surveillance. Public pour que les tests pilotent le temps au lieu de l'attendre. */
  async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      for (const task of this.watchdogTasks()) {
        const source = task.watchdog?.source
        if (source?.kind !== 'file-match') continue

        let state = this.states.get(task.id)
        if (!state || state.path !== source.path) {
          state = { path: source.path, tail: await beginAtEnd(source.path) }
          this.states.set(task.id, state)
          continue
        }
        const lineageCutoff = this.selfLineageSequence
        const reading = await readNewLines(source.path, state.tail ?? { position: 0, lastSize: 0 })
        this.states.set(task.id, { path: source.path, tail: reading.state })

        this.updateComplaint(task.id, reading.error)

        const matches = compileMatcher(source.pattern, source.caseSensitive)
        for (let index = 0; index < reading.lines.length; index += 1) {
          const line = reading.lines[index]
          // Consommer aussi une revendication qui ne matche pas CETTE règle : sinon elle resterait
          // en attente et pourrait absorber, bien plus tard, une ligne externe identique.
          const inherited = await this.consumeSelfLineage(task.id, source.path, line)
          if (!matches(line)) continue
          const signature = lineSignature(line)
          const observedAt = this.clock.now()
          await this.fire(task, {
            signature,
            rootSignature:
              inherited?.rootSignature ??
              this.causalRoot.getStore() ??
              `${signature}@${observedAt}`,
            context: describeFileMatch(
              source.path,
              line,
              reading.lines.slice(Math.max(0, index - NEIGHBOURHOOD), index + NEIGHBOURHOOD + 1)
            ),
            depth: inherited?.depth ?? this.causalDepth.getStore() ?? 0,
            source: 'file-match',
            observedAt
          })
        }
        const hasIncompleteLine = reading.state.position < reading.state.lastSize
        if (!reading.error && !hasIncompleteLine) {
          this.expireSelfLineage(task.id, source.path, lineageCutoff)
        }
      }
    } finally {
      this.polling = false
      this.schedule()
    }
  }

  private async fire(task: ScheduledTask, signal: WatchdogSignal): Promise<void> {
    // Avant toute garde de cadence : certains signaux ne meritent AUCUN agent, quel que soit le
    // budget. Reveiller quelqu'un sur un run que l'utilisateur vient d'annuler, sur un quota epuise
    // ou sur une API en panne, c'est depenser un agent pour une chose qu'aucun code ne repare — et,
    // pour la panne amont, le rappeler pour echouer pareil.
    const suppression = suppressionFor(signal.signature, signal.context)
    if (suppression) {
      this.suppressions.set(task.id, suppression)
      return
    }
    this.suppressions.delete(task.id)

    const guards = task.watchdog?.guards ?? DEFAULT_WATCHDOG_GUARDS
    let book = this.books.get(task.id)
    if (!book) {
      book = new WatchdogGuardBook(guards, () => this.clock.now())
      this.books.set(task.id, book)
    } else {
      book.updateGuards(guards)
    }

    const verdict = book.admit(signal.signature, signal.depth, signal.rootSignature)
    if (!verdict.admitted) return
    this.notifyDiagnosticsChanged()

    const rememberLate: WatchdogMutationClaimsSink = (claims) => {
      this.rememberDispatchClaims(task, signal, claims)
    }
    const dispatchResult = await this.causalDepth.run(signal.depth + 1, () =>
      this.causalRoot.run(signal.rootSignature, () =>
        this.dispatch.runWatchdog(task.id, signal, rememberLate)
      )
    )

    // On ne saute JAMAIS à la fin du fichier : une écriture externe concurrente serait perdue. Seules
    // les lignes revendiquées par les outils du tour héritent de sa causalité au prochain poll.
    if (typeof dispatchResult === 'object')
      this.rememberDispatchClaims(task, signal, dispatchResult)
  }

  private rememberDispatchClaims(
    task: ScheduledTask,
    signal: WatchdogSignal,
    claims: WatchdogMutationClaims
  ): void {
    const source = this.listTasks().find(({ id }) => id === task.id)?.watchdog?.source
    if (source?.kind !== 'file-match') return
    const matchingEntry = Object.entries(claims.mutatedLineFingerprints ?? {}).find(
      ([path]) => canonicalPath(path) === canonicalPath(source.path)
    )
    if (!matchingEntry?.[1].length) return
    if (!this.acceptMutationClaimEvent(claims)) return
    const generationMarker = Object.entries(claims.mutatedPathGenerationMarkers ?? {}).find(
      ([path]) => canonicalPath(path) === canonicalPath(source.path)
    )?.[1]
    this.rememberSelfLineage(source.path, matchingEntry[1], signal, generationMarker)
  }

  private acceptMutationClaimEvent(claims: WatchdogMutationClaims): boolean {
    const eventId = claims.eventId?.trim()
    if (!eventId) return true
    if (this.rememberedMutationClaimEvents.has(eventId)) return false
    this.rememberedMutationClaimEvents.add(eventId)
    return true
  }

  private watchdogTasks(): ScheduledTask[] {
    const tasks = this.listTasks().filter((task) => task.enabled && task.watchdog)
    const liveIds = new Set(tasks.map(({ id }) => id))
    const liveSources = new Map(tasks.map((task) => [task.id, task.watchdog?.source]))
    for (const id of this.books.keys()) if (!liveIds.has(id)) this.books.delete(id)
    for (const [id, state] of this.states) {
      const source = liveSources.get(id)
      if (source?.kind !== 'file-match' || state.path !== source.path) this.states.delete(id)
    }
    for (const [sourceKey, pending] of this.pendingSelfLineage) {
      const liveObservers = new Set(
        tasks.flatMap((task) => {
          const source = task.watchdog?.source
          return source?.kind === 'file-match' && canonicalPath(source.path) === sourceKey
            ? [task.id]
            : []
        })
      )
      if (liveObservers.size === 0) {
        this.pendingSelfLineage.delete(sourceKey)
        continue
      }
      for (const [fingerprint, queue] of pending.byFingerprint) {
        for (const claim of queue) {
          for (const [taskId, remaining] of claim.remainingByTask) {
            if (liveObservers.has(taskId)) continue
            claim.remainingByTask.delete(taskId)
            pending.totalClaims -= remaining
          }
        }
        const kept = queue.filter((claim) => claim.remainingByTask.size > 0)
        if (kept.length) pending.byFingerprint.set(fingerprint, kept)
        else pending.byFingerprint.delete(fingerprint)
      }
      if (pending.byFingerprint.size === 0) this.pendingSelfLineage.delete(sourceKey)
    }
    for (const id of this.complaints.keys()) {
      if (!liveIds.has(id) || liveSources.get(id)?.kind !== 'file-match') {
        this.complaints.delete(id)
        this.notifyDiagnosticsChanged()
      }
    }
    return tasks
  }

  private updateComplaint(taskId: string, complaint: string | undefined): void {
    const previous = this.complaints.get(taskId)
    if (complaint) this.complaints.set(taskId, complaint)
    else this.complaints.delete(taskId)
    if (previous !== complaint) this.notifyDiagnosticsChanged()
  }

  private rememberSelfLineage(
    path: string,
    fingerprints: readonly string[],
    signal: WatchdogSignal,
    generationMarker?: string,
    observerTaskIdsOverride?: readonly string[]
  ): void {
    const sourceKey = canonicalPath(path)
    const observerTaskIds =
      observerTaskIdsOverride ??
      this.listTasks().flatMap((task) => {
        const source = task.enabled ? task.watchdog?.source : undefined
        return source?.kind === 'file-match' && canonicalPath(source.path) === sourceKey
          ? [task.id]
          : []
      })
    if (observerTaskIds.length === 0) return
    // Une ligne physique doit pouvoir être consommée une fois par CHAQUE règle qui observe la
    // source. Le budget suit le lot réel et le fan-out : une frontière fixe transformerait la
    // première ligne omise en mutation externe et relancerait précisément la boucle interdite.
    let pending = this.pendingSelfLineage.get(sourceKey)
    if (!pending) {
      pending = { path, byFingerprint: new Map(), totalClaims: 0 }
      this.pendingSelfLineage.set(sourceKey, pending)
    }
    const sequence = ++this.selfLineageSequence
    for (const fingerprint of fingerprints) {
      const queue = pending.byFingerprint.get(fingerprint) ?? []
      const latest = queue.at(-1)
      if (
        latest?.rootSignature === signal.rootSignature &&
        latest.depth === signal.depth + 1 &&
        latest.sequence === sequence &&
        latest.generationMarker === generationMarker
      ) {
        for (const taskId of observerTaskIds) {
          latest.remainingByTask.set(taskId, (latest.remainingByTask.get(taskId) ?? 0) + 1)
        }
      } else {
        queue.push({
          rootSignature: signal.rootSignature,
          depth: signal.depth + 1,
          sequence,
          ...(generationMarker ? { generationMarker } : {}),
          remainingByTask: new Map(observerTaskIds.map((taskId) => [taskId, 1]))
        })
      }
      pending.totalClaims += observerTaskIds.length
      pending.byFingerprint.delete(fingerprint)
      pending.byFingerprint.set(fingerprint, queue)
    }
  }

  private async consumeSelfLineage(
    taskId: string,
    path: string,
    line: string
  ): Promise<{ rootSignature: string; depth: number } | undefined> {
    const sourceKey = canonicalPath(path)
    const pending = this.pendingSelfLineage.get(sourceKey)
    if (!pending) return undefined
    const fingerprint = lineFingerprint(line)
    const queue = pending.byFingerprint.get(fingerprint)
    let claim:
      | {
          rootSignature: string
          depth: number
          sequence: number
          generationMarker?: string
          remainingByTask: Map<string, number>
        }
      | undefined
    for (const candidate of queue ?? []) {
      if ((candidate.remainingByTask.get(taskId) ?? 0) <= 0) continue
      if (
        candidate.generationMarker &&
        !(await fileMatchesGenerationMarker(path, candidate.generationMarker))
      ) {
        continue
      }
      claim = candidate
      break
    }
    if (!claim) return undefined
    const lineage = { rootSignature: claim.rootSignature, depth: claim.depth }
    const remaining = (claim.remainingByTask.get(taskId) ?? 0) - 1
    if (remaining > 0) claim.remainingByTask.set(taskId, remaining)
    else claim.remainingByTask.delete(taskId)
    pending.totalClaims -= 1
    if (claim.remainingByTask.size === 0) queue?.splice(queue.indexOf(claim), 1)
    if (queue?.length === 0) pending.byFingerprint.delete(fingerprint)
    if (pending.byFingerprint.size === 0) this.pendingSelfLineage.delete(sourceKey)
    return lineage
  }

  /** Une revendication non matérialisée au premier passage lisible expire au lieu de devenir fantôme. */
  private expireSelfLineage(taskId: string, path: string, cutoff: number): void {
    const sourceKey = canonicalPath(path)
    const pending = this.pendingSelfLineage.get(sourceKey)
    if (!pending) return
    for (const [fingerprint, queue] of pending.byFingerprint) {
      for (const claim of queue) {
        if (claim.sequence > cutoff) continue
        const remaining = claim.remainingByTask.get(taskId) ?? 0
        if (!remaining) continue
        claim.remainingByTask.delete(taskId)
        pending.totalClaims -= remaining
      }
      const kept = queue.filter((claim) => claim.remainingByTask.size > 0)
      if (kept.length) pending.byFingerprint.set(fingerprint, kept)
      else pending.byFingerprint.delete(fingerprint)
    }
    if (pending.byFingerprint.size === 0) this.pendingSelfLineage.delete(sourceKey)
  }

  private notifyDiagnosticsChanged(): void {
    if (!this.onDiagnosticsChanged || this.diagnosticsRefreshPending) return
    this.diagnosticsRefreshPending = true
    queueMicrotask(() => {
      this.diagnosticsRefreshPending = false
      this.onDiagnosticsChanged?.()
    })
  }

  private schedule(): void {
    if (!this.running) return
    if (this.timer !== undefined) this.clock.clearTimer(this.timer)
    this.timer = this.clock.setTimer(() => void this.poll(), this.pollMs)
  }
}

function canonicalPath(path: string): string {
  const normalized = resolve(path).replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}
