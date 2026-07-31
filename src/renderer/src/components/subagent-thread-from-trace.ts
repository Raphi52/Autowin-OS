import type { HarnessTimeline, HarnessTimelineEvent } from './harness-timeline-model'
import type { ScopedLiveRun } from './chat-view-model'

/**
 * Reconstitue le fil des sous-agents à partir de la trace PERSISTÉE.
 *
 * Le fil ne vivait que dans la mémoire de la vue : rouvrir l'app, ou simplement remonter la vue,
 * et « Aucune orchestration dans cette conversation » s'affichait — alors que le message promet
 * l'inverse, et que le GRAPHE de la même conversation, lui, restait rempli. La cause est là : le
 * graphe lit la trace causale persistée, le fil ne lisait rien.
 *
 * On projette donc depuis la MÊME source que le graphe. Deux rendus, une vérité : ils ne peuvent
 * plus se contredire.
 */

/** Une étape telle que le fil l'affiche (sous-ensemble d'OrchestrationStep réellement utilisé). */
export interface ThreadStep {
  step: 'exec' | 'judge' | 'gate'
  provider?: string
  role?: string
  model?: string
  text?: string
  detail?: string
  tokens?: number
  costUsd?: number
  durationMs?: number
  status?: 'completed' | 'failed'
}

/** Événements qui comptent pour un fil de sous-agents ; le reste est de la plomberie de transport. */
function stepKindOf(event: HarnessTimelineEvent): ThreadStep['step'] | undefined {
  if (event.kind === 'gate') return 'gate'
  if (event.kind === 'verdict') return 'judge'
  if (event.kind === 'model-response' || event.kind === 'tool-result') return 'exec'
  return undefined
}

function toStep(event: HarnessTimelineEvent): ThreadStep {
  const kind = stepKindOf(event) ?? 'exec'
  return {
    step: kind,
    ...(event.provider ? { provider: event.provider } : {}),
    ...(event.execution?.phase ? { role: event.execution.phase } : {}),
    ...(event.model ? { model: event.model } : {}),
    ...(event.content ? { text: event.content } : {}),
    ...(event.detail ? { detail: event.detail } : {}),
    ...(typeof event.tokens === 'number' ? { tokens: event.tokens } : {}),
    ...(typeof event.costUsd === 'number' ? { costUsd: event.costUsd } : {}),
    ...(typeof event.durationMs === 'number' ? { durationMs: event.durationMs } : {}),
    status: event.status === 'failed' || event.status === 'error' ? 'failed' : 'completed'
  }
}

/** Libellé du run : la demande qui l'a déclenché, sinon un repli honnête. */
function taskOf(events: HarnessTimelineEvent[]): string {
  const request = events.find((event) => event.kind === 'message')
  const label = (request?.content || request?.label || '').replace(/\s+/g, ' ').trim()
  if (!label) return 'orchestration'
  return label.length > 120 ? `${label.slice(0, 117)}…` : label
}

/**
 * Statut du run tel qu'on l'affiche. Un tour dont AUCUNE étape n'a échoué et qui porte un gate est
 * vert ; un échec constaté le met au rouge. On ne prétend jamais « en cours » depuis une trace
 * relue : ce qui est persisté est, par construction, du passé.
 */
function statusOf(steps: ThreadStep[]): 'green' | 'red' {
  return steps.some((step) => step.status === 'failed') ? 'red' : 'green'
}

/**
 * Un run par TOUR d'orchestration, du plus ancien au plus récent. Les tours sans aucune étape de
 * sous-agent (une simple réponse de chat) sont écartés : ce fil parle d'orchestration.
 */
export function scopedRunsFromTimeline(
  timeline: HarnessTimeline,
  convId: string
): Array<ScopedLiveRun<ThreadStep>> {
  const runs: Array<ScopedLiveRun<ThreadStep>> = []
  for (const turn of timeline.turns) {
    const steps = turn.events.filter((event) => stepKindOf(event) !== undefined).map(toStep)
    if (steps.length === 0) continue
    runs.push({
      convId,
      runPath: turn.id,
      task: taskOf(turn.events),
      steps,
      status: statusOf(steps)
    })
  }
  return runs
}

/**
 * Fusionne le direct et le persisté. Le run VIVANT fait autorité sur son propre tour : lui seul
 * connaît la phase en cours et le texte qui s'écrit. Le persisté comble tout le reste — sans quoi
 * un run terminé disparaîtrait au premier remontage de la vue.
 */
export function mergeLiveAndPersisted<TStep>(
  live: Array<[string, ScopedLiveRun<TStep>]>,
  persisted: Array<ScopedLiveRun<TStep>>
): Array<[string, ScopedLiveRun<TStep>]> {
  const liveByRun = new Set(
    live.map(([, run]) => run.runPath).filter((path): path is string => Boolean(path))
  )
  const liveConvs = new Set(live.map(([, run]) => run.convId))
  const kept = persisted.filter(
    (run) =>
      !(run.runPath && liveByRun.has(run.runPath)) &&
      // Sans runPath des deux côtés, on ne peut pas apparier : le direct l'emporte pour éviter un doublon.
      !(!run.runPath && liveConvs.has(run.convId))
  )
  return [...kept.map((run): [string, ScopedLiveRun<TStep>] => [run.runPath ?? run.convId, run]), ...live]
}
