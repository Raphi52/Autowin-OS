import { watchdogRegexProblem } from '../../../shared/watchdog-regex'

/**
 * Modèle de présentation de la section « Watchdog Agents ».
 *
 * Pur et sans React, pour que ce qui décide CE QUI EST MONTRÉ soit éprouvable sans monter de vue.
 * Le Task Manager redéclare déjà ses types côté renderer ; on suit la même convention plutôt que
 * d'introduire un partage de types pour cette seule section.
 */

export type WatchdogAppEvent =
  | 'orchestration-red'
  | 'workflow-gate-failed'
  | 'workflow-unverified'
  | 'workflow-proof-lost'
  | 'task-failed'
  | 'task-missed'

export type WatchdogSource =
  | { kind: 'file-match'; path: string; pattern: string; caseSensitive?: boolean }
  | { kind: 'app-event'; events: WatchdogAppEvent[] }

export interface WatchdogGuards {
  dedupWindowMs: number
  maxTriggersPerHour: number
  maxChainDepth: number
  /** Largeur maximale d'une cascade issue d'une même cause racine. */
  maxPerRoot: number
}

export interface WatchdogRule {
  source: WatchdogSource
  guards: WatchdogGuards
  /** Absent = analyse simple ; l'orchestration complète doit être choisie explicitement. */
  action?: 'chat' | 'orchestration'
}

export type WatchdogOutcome = 'benign' | 'report' | 'investigate' | 'repair'

export interface WatchdogTaskLike {
  id: string
  title: string
  enabled: boolean
  watchdog?: WatchdogRule
}

export interface WatchdogOccurrenceLike {
  id: string
  taskId: string
  scheduledFor: number
  status: string
  trigger?: 'schedule' | 'manual' | 'watchdog'
  outcome?: WatchdogOutcome
  watchdog?: { context: string; depth: number; source: string }
}

/**
 * Sépare les tâches HORAIRES des règles de réveil. Les mélanger dans une seule liste rendrait
 * illisible la question « qu'est-ce qui peut partir sans que je le déclenche ? », qui est justement
 * celle qu'on se pose devant des agents autonomes.
 */
export function splitByTrigger<T extends WatchdogTaskLike>(
  tasks: T[]
): { scheduled: T[]; watchdog: T[] } {
  return {
    scheduled: tasks.filter((task) => !task.watchdog),
    watchdog: tasks.filter((task) => Boolean(task.watchdog))
  }
}

export const APP_EVENT_LABEL: Record<WatchdogAppEvent, string> = {
  'orchestration-red': 'une orchestration se termine en rouge',
  'workflow-gate-failed': 'le gate refuse la preuve d’un workflow',
  'workflow-unverified': 'un workflow se dit réussi SANS preuve de validation',
  'workflow-proof-lost': 'une reprise perd des preuves de son journal',
  'task-failed': 'une tâche planifiée échoue',
  'task-missed': 'une tâche planifiée est manquée'
}

export function describeWatchdogSource(source: WatchdogSource): string {
  if (source.kind === 'app-event') {
    if (!source.events.length)
      return 'Aucun événement surveillé — cette règle ne se déclenchera jamais'
    return `Quand ${source.events.map((event) => APP_EVENT_LABEL[event]).join(', ou ')}`
  }
  const sensitivity = source.caseSensitive ? ' (casse respectée)' : ''
  return `Quand une ligne de ${source.path} correspond à « ${source.pattern} »${sensitivity}`
}

/**
 * Rend les bornes LISIBLES. Elles sont la contrepartie du pouvoir accordé à une règle : les cacher
 * dans un formulaire replié reviendrait à laisser croire qu'un agent en autorité `auto` est borné
 * sans jamais montrer par quoi.
 */
export function describeWatchdogGuards(guards: WatchdogGuards): string {
  const parts = [
    `${guards.maxTriggersPerHour} réveils/h max`,
    guards.dedupWindowMs > 0
      ? `même signal ignoré pendant ${Math.round(guards.dedupWindowMs / 1000)} s`
      : 'aucune fenêtre d’apaisement',
    guards.maxChainDepth === 0
      ? 'un réveil ne peut pas en déclencher un autre'
      : `chaîne autorisée jusqu’à ${guards.maxChainDepth}`,
    `${guards.maxPerRoot} réveils max par même cause`
  ]
  return parts.join(' · ')
}

export const OUTCOME_LABEL: Record<WatchdogOutcome, string> = {
  benign: 'Bénin',
  report: 'Rapport',
  investigate: 'Investigation',
  repair: 'Réparation'
}

/** Non renseignée ≠ bénin : ne pas savoir ce que l'agent a conclu doit se VOIR. */
export function describeOutcome(outcome: WatchdogOutcome | undefined): string {
  return outcome ? OUTCOME_LABEL[outcome] : 'Issue non renseignée'
}

export function outcomeTone(
  outcome: WatchdogOutcome | undefined
): 'neutral' | 'info' | 'act' | 'unknown' {
  if (!outcome) return 'unknown'
  if (outcome === 'benign') return 'neutral'
  if (outcome === 'report') return 'info'
  return 'act'
}

/** Historique des réveils d'une règle, du plus récent au plus ancien. */
export function watchdogHistory<T extends WatchdogOccurrenceLike>(
  occurrences: T[],
  taskId: string
): T[] {
  return occurrences
    .filter((occurrence) => occurrence.taskId === taskId && occurrence.trigger === 'watchdog')
    .sort((left, right) => right.scheduledFor - left.scheduledFor)
}

/**
 * Ce que la section annonce en tête. `pendingTriage` compte les réveils TERMINÉS dont on ignore la
 * conclusion : c'est le chiffre qui doit inquiéter, parce qu'un agent a travaillé et que personne ne
 * sait sur quoi il a conclu.
 */
export function watchdogSummary(
  tasks: WatchdogTaskLike[],
  occurrences: WatchdogOccurrenceLike[]
): { rules: number; active: number; triggers: number; pendingTriage: number } {
  const { watchdog } = splitByTrigger(tasks)
  const fired = occurrences.filter((occurrence) => occurrence.trigger === 'watchdog')
  return {
    rules: watchdog.length,
    active: watchdog.filter((task) => task.enabled).length,
    triggers: fired.length,
    pendingTriage: fired.filter(
      (occurrence) => occurrence.status === 'completed' && !occurrence.outcome
    ).length
  }
}

/** Valeurs de départ d'une règle : les bornes sûres, pas des cases vides à remplir. */
export const DEFAULT_DRAFT_GUARDS: WatchdogGuards = {
  dedupWindowMs: 60_000,
  maxTriggersPerHour: 12,
  maxChainDepth: 0,
  maxPerRoot: 20
}

export const DEFAULT_FILE_SOURCE: WatchdogSource = {
  kind: 'file-match',
  path: '',
  pattern: 'ERROR'
}

export type TriggerKind = 'schedule' | 'watchdog'

export function triggerKindOf(draft: { watchdog?: WatchdogRule }): TriggerKind {
  return draft.watchdog ? 'watchdog' : 'schedule'
}

/**
 * Ce qui part réellement à l'IPC. Une tâche ne peut pas porter les DEUX déclencheurs : le store
 * refuse l'ambiguïté (soit un horaire, soit un réveil). Le brouillon de l'interface, lui, garde les
 * deux sous la main pour que basculer d'un mode à l'autre ne détruise pas ce qui était saisi — c'est
 * ici, au moment d'envoyer, qu'on tranche.
 */
export function toTaskPayload<T extends { schedule: unknown; watchdog?: WatchdogRule }>(
  draft: T
): Omit<T, 'schedule' | 'watchdog'> & { schedule?: unknown; watchdog?: WatchdogRule } {
  const { schedule, watchdog, ...rest } = draft
  return watchdog ? { ...rest, watchdog } : { ...rest, schedule }
}

/**
 * Ce qui empêche d'enregistrer une règle, en clair. Rend `undefined` quand tout va bien.
 * Une règle sans chemin ni motif ne déclencherait JAMAIS, sans erreur — le pire mode de panne pour
 * une surveillance, et la raison pour laquelle c'est bloqué à la saisie plutôt qu'à l'exécution.
 */
export function watchdogDraftProblem(watchdog: WatchdogRule | undefined): string | undefined {
  if (!watchdog) return undefined
  if (watchdog.source.kind === 'file-match') {
    if (!watchdog.source.path.trim()) return 'Indique le fichier à surveiller.'
    if (!watchdog.source.pattern.trim())
      return 'Indique ce qui doit déclencher (texte ou expression).'
    const regexProblem = watchdogRegexProblem(watchdog.source.pattern)
    if (regexProblem) return `Expression de surveillance refusée : ${regexProblem}`
  }
  if (watchdog.guards.maxTriggersPerHour < 1) return 'Le plafond horaire doit valoir au moins 1.'
  if (watchdog.guards.maxPerRoot < 1)
    return 'La largeur maximale d’une cascade doit valoir au moins 1.'
  return undefined
}
