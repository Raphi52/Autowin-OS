import type { HarnessTimeline, HarnessTimelineEvent } from './harness-timeline-model'
import type { ScopedLiveRun } from './chat-view-model'
import { extractHumanMessage } from './human-message'

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
  /** Délibération du sous-agent, tenue SÉPARÉE de la conclusion (payload `reasoning`). */
  thinking?: string
  detail?: string
  tokens?: number
  costUsd?: number
  durationMs?: number
  status?: 'completed' | 'failed'
}

export interface TurnRuntimeIdentity {
  provider: string
  model?: string
  reasoningEffort?: string
}

/** Événements qui comptent pour un fil de sous-agents ; le reste est de la plomberie de transport. */
function stepKindOf(event: HarnessTimelineEvent): ThreadStep['step'] | undefined {
  if (event.kind === 'gate') return 'gate'
  if (event.kind === 'verdict') return 'judge'
  if (event.kind === 'model-response' || event.kind === 'tool-result') return 'exec'
  return undefined
}

function knownProviderFamily(
  value: string | undefined
): 'codex' | 'claude' | 'gemini' | 'kimi' | undefined {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized === 'codex') return 'codex'
  if (normalized === 'claude') return 'claude'
  if (normalized === 'gemini') return 'gemini'
  if (normalized === 'kimi') return 'kimi'
  return undefined
}

function modelFamily(value: string | undefined): ReturnType<typeof knownProviderFamily> {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return undefined
  if (/^gemini(?:[-/.]|$)/.test(normalized)) return 'gemini'
  if (/^claude(?:[-/.]|$)/.test(normalized)) return 'claude'
  if (/^(?:gpt|codex|o[134])(?:[-/.]|$)/.test(normalized)) return 'codex'
  if (/^(?:kimi|moonshot)(?:[-/.]|$)/.test(normalized)) return 'kimi'
  return undefined
}

/**
 * Les anciennes traces pouvaient figer le nom du rôle avant le reroutage effectif (ex. provider
 * Codex + modèle Gemini). On ne remplace que ces couples impossibles, et seulement par le runtime
 * du même provider persisté sur le tour. Un vrai fan-out Gemini reste donc Gemini.
 */
function reliableHistoricalModel(
  event: HarnessTimelineEvent,
  turnRuntime: TurnRuntimeIdentity | undefined
): string | undefined {
  const provider = knownProviderFamily(event.provider)
  const declaredModel = modelFamily(event.model)
  if (!provider || !declaredModel || provider === declaredModel) return event.model
  const recordedModel = turnRuntime?.model
  if (turnRuntime?.provider === event.provider && recordedModel) return recordedModel
  return undefined
}

/**
 * Sépare délibération et conclusion.
 *
 * `stepPayloads` (main/activity/step-reasoning-payloads.ts) écrit DEUX charges distinctes ; c'est
 * `buildHarnessTimelineFromTrace` qui les CONCATÈNE dans `content` pour un affichage brut. Lire
 * `content` faisait donc passer un raisonnement exploratoire — hypothèses abandonnées comprises —
 * pour la réponse remise. On relit les charges d'origine ; sans elles (traces anciennes), `content`
 * reste la seule vérité disponible et n'est pas altéré.
 */
function splitDeliberation(event: HarnessTimelineEvent): { text?: string; thinking?: string } {
  const payloads = event.payloads
  if (!Array.isArray(payloads) || payloads.length === 0) return { text: event.content || undefined }
  const join = (kept: typeof payloads): string | undefined =>
    kept
      .map((payload) => payload.content)
      .filter((content) => Boolean(content))
      .join('\n\n') || undefined
  const thinking = join(payloads.filter((payload) => payload.kind === 'reasoning'))
  const text = join(payloads.filter((payload) => payload.kind !== 'reasoning'))
  return {
    ...(text ? { text } : {}),
    ...(thinking ? { thinking } : {})
  }
}

function toStep(event: HarnessTimelineEvent, turnRuntime?: TurnRuntimeIdentity): ThreadStep {
  const kind = stepKindOf(event) ?? 'exec'
  const model = reliableHistoricalModel(event, turnRuntime)
  const { text, thinking } = splitDeliberation(event)
  return {
    step: kind,
    ...(event.provider ? { provider: event.provider } : {}),
    ...(event.execution?.phase ? { role: event.execution.phase } : {}),
    ...(model ? { model } : {}),
    ...(text ? { text } : {}),
    ...(thinking ? { thinking } : {}),
    ...(event.detail ? { detail: event.detail } : {}),
    ...(typeof event.tokens === 'number' ? { tokens: event.tokens } : {}),
    ...(typeof event.costUsd === 'number' ? { costUsd: event.costUsd } : {}),
    ...(typeof event.durationMs === 'number' ? { durationMs: event.durationMs } : {}),
    status: event.status === 'failed' || event.status === 'error' ? 'failed' : 'completed'
  }
}

/**
 * Libellé du run : la demande qui l'a déclenché, sinon un repli honnête.
 *
 * Le contenu d'un tour est COMPOSÉ (`ÉTAT DE L'APP:\n{json}\n\nUTILISATEUR: …`). Le lire brut donnait
 * à chaque bloc le même titre illisible — le JSON d'état — et masquait la demande réelle. On réutilise
 * l'extracteur déjà éprouvé par l'Observatoire plutôt que d'en écrire un second.
 */
function taskOf(events: HarnessTimelineEvent[]): string {
  const request = events.find((event) => event.kind === 'message')
  const brut = request?.content || request?.label || ''
  const label = extractHumanMessage(brut, 120)
  if (!label) return 'orchestration'
  return label
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
  convId: string,
  runtimeByTurn?: ReadonlyMap<string, TurnRuntimeIdentity>
): Array<ScopedLiveRun<ThreadStep>> {
  const runs: Array<ScopedLiveRun<ThreadStep>> = []
  for (const turn of timeline.turns) {
    const turnRuntime = runtimeByTurn?.get(turn.id)
    const steps = turn.events
      .filter((event) => stepKindOf(event) !== undefined)
      .map((event) => toStep(event, turnRuntime))
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
  return [
    ...kept.map((run): [string, ScopedLiveRun<TStep>] => [run.runPath ?? run.convId, run]),
    ...live
  ]
}
