import { watchdogRegexProblem } from '../../../shared/watchdog-regex'
import { langueCourante } from '../langue'
import { traduireTaskManager, type CleTaskManager } from '../textes-ecrans/task-manager'
import type { ValeursDeTexte } from '../textes'

/**
 * Modèle de présentation de la section « Watchdog Agents ».
 *
 * Pur et sans React, pour que ce qui décide CE QUI EST MONTRÉ soit éprouvable sans monter de vue.
 * Le Task Manager redéclare déjà ses types côté renderer ; on suit la même convention plutôt que
 * d'introduire un partage de types pour cette seule section.
 *
 * Les phrases suivent la langue de l'interface (traduction anglaise, conv-1170) : lues au moment de
 * l'appel, pendant le rendu de WatchdogAgentsSection ou de TaskManagerView, qui suivent la langue.
 */

const texte = (cle: CleTaskManager, valeurs?: ValeursDeTexte): string =>
  traduireTaskManager(cle, langueCourante(), valeurs)

export type WatchdogAppEvent =
  | 'orchestration-red'
  | 'workflow-gate-failed'
  | 'workflow-unverified'
  | 'workflow-proof-lost'
  | 'task-failed'
  | 'task-missed'
  | 'chat-turn-done'

export type WatchdogSource =
  | { kind: 'file-match'; path: string; pattern: string; caseSensitive?: boolean }
  /** `conversationId` : fil surveillé, posé par `task_create` avec `chat-turn-done` (conv-1069). */
  | { kind: 'app-event'; events: WatchdogAppEvent[]; conversationId?: string }
  | {
      kind: 'outlook-mail'
      /** Absent = Outlook ET Teams (ancienne règle unique). */
      channel?: 'outlook' | 'teams'
      /** Interlocuteurs déjà vus ; `enabled: false` = la règle ne leur répond pas. */
      senders?: Record<string, { name: string; enabled: boolean }>
      /** Personne jamais vue : absent = on lui répond ; `ignore` = ajoutée décochée. */
      newSenders?: 'reply' | 'ignore'
    }

export interface WatchdogGuards {
  dedupWindowMs: number
  maxTriggersPerHour: number
  maxTriggersPerDay?: number
  maxKnownCostUsdPerDay?: number
  maxUnpricedCallsPerDay?: number
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

const APP_EVENT_LABEL: Record<WatchdogAppEvent, CleTaskManager> = {
  'orchestration-red': 'surveillance.evenement.orchestrationRouge',
  'workflow-gate-failed': 'surveillance.evenement.gateRefuse',
  'workflow-unverified': 'surveillance.evenement.sansPreuve',
  'workflow-proof-lost': 'surveillance.evenement.preuvesPerdues',
  'task-failed': 'surveillance.evenement.tacheEchoue',
  'task-missed': 'surveillance.evenement.tacheManquee',
  'chat-turn-done': 'surveillance.evenement.tourTermine'
}

export function describeWatchdogSource(source: WatchdogSource): string {
  if (source.kind === 'outlook-mail') {
    const muted = Object.values(source.senders ?? {}).filter((sender) => !sender.enabled).length
    const suffixe = muted ? texte('surveillance.source.ignores', { n: muted }) : ''
    if (source.channel === 'outlook') return texte('surveillance.source.outlook', { suffixe })
    if (source.channel === 'teams') return texte('surveillance.source.teams', { suffixe })
  }
  if (source.kind === 'outlook-mail') return texte('surveillance.source.outlookEtTeams')
  if (source.kind === 'app-event') {
    if (!source.events.length) return texte('surveillance.source.aucunEvenement')
    // fix-ok: conv-1069 — `chat-turn-done` sans libellé s'affichait « Quand  » (rouge : watchdog-section-model.test.ts).
    const fil = source.conversationId
    const libelle = (event: WatchdogAppEvent): string =>
      event === 'chat-turn-done' && fil
        ? texte('surveillance.source.tourDuFil', { fil })
        : texte(APP_EVENT_LABEL[event])
    const quand = texte('surveillance.source.quand', {
      evenements: source.events.map(libelle).join(texte('surveillance.source.ou'))
    })
    // Le filtre vaut pour TOUS les événements de la règle : le taire laisserait croire à une règle large.
    return fil && source.events.some((event) => event !== 'chat-turn-done')
      ? texte('surveillance.source.filSeulement', { quand, fil })
      : quand
  }
  return texte(
    source.caseSensitive ? 'surveillance.source.fichierCasse' : 'surveillance.source.fichier',
    { chemin: source.path, motif: source.pattern }
  )
}

/**
 * Rend les bornes LISIBLES. Elles sont la contrepartie du pouvoir accordé à une règle : les cacher
 * dans un formulaire replié reviendrait à laisser croire qu'un agent autonome est borné sans
 * jamais montrer par quoi.
 */
export function describeWatchdogGuards(guards: WatchdogGuards): string {
  const parts = [
    texte('surveillance.bornes.parHeure', { n: guards.maxTriggersPerHour }),
    ...(guards.maxTriggersPerDay === undefined
      ? []
      : [texte('surveillance.bornes.parJour', { n: guards.maxTriggersPerDay })]),
    ...(guards.maxKnownCostUsdPerDay === undefined
      ? []
      : [
          texte('surveillance.bornes.budget', {
            montant: guards.maxKnownCostUsdPerDay.toFixed(2)
          })
        ]),
    ...(guards.maxUnpricedCallsPerDay === undefined
      ? []
      : [texte('surveillance.bornes.nonChiffres', { n: guards.maxUnpricedCallsPerDay })]),
    guards.dedupWindowMs > 0
      ? texte('surveillance.bornes.apaisement', {
          secondes: Math.round(guards.dedupWindowMs / 1000)
        })
      : texte('surveillance.bornes.sansApaisement'),
    guards.maxChainDepth === 0
      ? texte('surveillance.bornes.sansChaine')
      : texte('surveillance.bornes.chaine', { n: guards.maxChainDepth }),
    texte('surveillance.bornes.parCause', { n: guards.maxPerRoot })
  ]
  return parts.join(' · ')
}

// Accesseurs : le libellé est relu à chaque accès, donc dans la langue du moment (conv-1170).
export const OUTCOME_LABEL: Record<WatchdogOutcome, string> = {
  get benign() {
    return texte('surveillance.issue.benin')
  },
  get report() {
    return texte('surveillance.issue.rapport')
  },
  get investigate() {
    return texte('surveillance.issue.investigation')
  },
  get repair() {
    return texte('surveillance.issue.reparation')
  }
}

/** Non renseignée ≠ bénin : ne pas savoir ce que l'agent a conclu doit se VOIR. */
export function describeOutcome(outcome: WatchdogOutcome | undefined): string {
  return outcome ? OUTCOME_LABEL[outcome] : texte('surveillance.issue.nonRenseignee')
}

export function outcomeTone(
  outcome: WatchdogOutcome | undefined
): 'neutral' | 'info' | 'act' | 'unknown' {
  if (!outcome) return 'unknown'
  if (outcome === 'benign') return 'neutral'
  if (outcome === 'report') return 'info'
  return 'act'
}

const OCCURRENCE_STATUS_LABEL: Readonly<Record<string, CleTaskManager | undefined>> = {
  claimed: 'surveillance.statut.enAttente',
  running: 'surveillance.statut.enCours',
  completed: 'surveillance.statut.termine',
  failed: 'surveillance.statut.echec',
  cancelled: 'surveillance.statut.annule',
  missed: 'surveillance.statut.manque'
}

/** Le statut d'exécution reste distinct du tri rendu par l'agent. */
export function describeOccurrenceStatus(status: string): string {
  return texte(OCCURRENCE_STATUS_LABEL[status] ?? 'surveillance.statut.inconnu')
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
 * Ce que la section annonce en tête. Toute occurrence sans `outcome` reste sans issue, y compris un
 * échec ou une annulation : le statut explique comment l'exécution s'est arrêtée, pas ce que l'agent
 * a conclu.
 */
export function watchdogSummary(
  tasks: WatchdogTaskLike[],
  occurrences: WatchdogOccurrenceLike[]
): {
  rules: number
  active: number
  triggers: number
  pendingTriage: number
  failures: number
  cancellations: number
} {
  const { watchdog } = splitByTrigger(tasks)
  const fired = occurrences.filter((occurrence) => occurrence.trigger === 'watchdog')
  return {
    rules: watchdog.length,
    active: watchdog.filter((task) => task.enabled).length,
    triggers: fired.length,
    pendingTriage: fired.filter((occurrence) => !occurrence.outcome).length,
    failures: fired.filter((occurrence) => occurrence.status === 'failed').length,
    cancellations: fired.filter((occurrence) => occurrence.status === 'cancelled').length
  }
}

/** Valeurs de départ d'une règle : les bornes sûres, pas des cases vides à remplir. */
export const DEFAULT_DRAFT_GUARDS: WatchdogGuards = {
  dedupWindowMs: 60_000,
  maxTriggersPerHour: 12,
  maxTriggersPerDay: 48,
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
    if (!watchdog.source.path.trim()) return texte('surveillance.probleme.fichier')
    if (!watchdog.source.pattern.trim()) return texte('surveillance.probleme.motif')
    const regexProblem = watchdogRegexProblem(watchdog.source.pattern)
    // `regexProblem` vient de shared/watchdog-regex.ts, hors de ce lot : il reste en français.
    if (regexProblem) return texte('surveillance.probleme.expression', { raison: regexProblem })
  }
  if (watchdog.guards.maxTriggersPerHour < 1) return texte('surveillance.probleme.plafondHoraire')
  if (watchdog.guards.maxTriggersPerDay !== undefined && watchdog.guards.maxTriggersPerDay < 1)
    return texte('surveillance.probleme.plafondQuotidien')
  if (
    watchdog.guards.maxKnownCostUsdPerDay !== undefined &&
    watchdog.guards.maxKnownCostUsdPerDay <= 0
  )
    return texte('surveillance.probleme.budget')
  if (
    watchdog.guards.maxUnpricedCallsPerDay !== undefined &&
    watchdog.guards.maxUnpricedCallsPerDay < 1
  )
    return texte('surveillance.probleme.nonChiffres')
  if (watchdog.guards.maxPerRoot < 1) return texte('surveillance.probleme.cascade')
  return undefined
}
