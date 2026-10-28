import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TaskManagerSection } from '../tabs'
import type { ConversationSummary as StoreConversationSummary } from '../../../main/store/conversations'
import { ViewTopBar } from './ViewTopBar'
import { WatchdogAgentsSection } from './WatchdogAgentsSection'
import { WatchdogRuleFields } from './WatchdogRuleFields'
import {
  DEFAULT_DRAFT_GUARDS,
  DEFAULT_FILE_SOURCE,
  describeWatchdogSource,
  splitByTrigger,
  toTaskPayload,
  triggerKindOf,
  watchdogDraftProblem,
  type WatchdogOccurrenceLike,
  type WatchdogRule,
  type WatchdogTaskLike
} from './watchdog-section-model'
import { scheduleDraftProblem } from './task-schedule-draft'
import type { RuntimeModel } from './chat-view-model'
import { compareModelsByName, displayedModelName } from './model-name-order'
import {
  AGENT_STUDIO_DEFAULT_MODEL_LABEL,
  AGENT_STUDIO_DEFAULT_PROVIDER,
  usesAgentStudioDefault
} from '../../../shared/task-provider'
import { MODELE_PROMPT_TACHE } from '../../../shared/modele-prompt-tache'
import './ViewPage.css'
import './TaskManagerView.css'
import { Spinner } from './Spinner'
import { formaterDate, formaterNombre, langueCourante } from '../langue'
import type { ValeursDeTexte } from '../textes'
import {
  traduireTaskManager,
  useTextesTaskManager,
  type CleTaskManager
} from '../textes-ecrans/task-manager'

/**
 * Hors composant, le texte dans la langue courante (traduction anglaise, conv-1170) : ces fonctions
 * sont appelées pendant le rendu de la vue, qui suit la langue par `useTextesTaskManager`.
 */
const texte = (cle: CleTaskManager, valeurs?: ValeursDeTexte): string =>
  traduireTaskManager(cle, langueCourante(), valeurs)

type ExecutionMode = 'windows' | 'active-only'
type RecurrenceUnit = 'none' | 'minute' | 'hour' | 'day' | 'week' | 'month'

interface TaskSchedule {
  startDate: string
  time: string
  timeZone: string
  recurrence: { unit: RecurrenceUnit; interval: number; weekDays?: number[] }
  endDate?: string
}

type TaskDestination =
  | {
      kind: 'existing'
      conversationId: string
      provider?: string
      model?: string
      reasoningEffort?: string
    }
  | {
      kind: 'new'
      title: string
      category: string
      provider: string
      model?: string
      reasoningEffort?: string
      conversationId?: string
    }

interface TaskDraft {
  title: string
  prompt: string
  enabled: boolean
  mode: ExecutionMode | 'legacy-unknown'
  destination: TaskDestination
  schedule: TaskSchedule
  /**
   * Présent = la tâche est réveillée par un événement. Le brouillon garde l'horaire sous la main
   * même en mode réveil : basculer d'un mode à l'autre ne doit pas détruire ce qui était saisi.
   * C'est `toTaskPayload` qui tranche au moment d'envoyer.
   */
  watchdog?: WatchdogRule
}

interface ScheduledTask extends Omit<TaskDraft, 'schedule'> {
  id: string
  schedule?: TaskSchedule
  nextRunAt: number | null
  createdAt: number
  updatedAt: number
  /** Présent = tâche réveillée par un événement plutôt que par l'horloge. */
  watchdog?: WatchdogRule
}

interface TaskOccurrence {
  id: string
  taskId: string
  scheduledFor: number
  mode: ExecutionMode
  status: string
  startedAt?: number
  finishedAt?: number
  conversationId?: string
  turnId?: string
  error?: string
  knownCostUsd?: number
  totalTokens?: number
  unpricedCalls?: number
  requestedModel?: string
  resolvedModel?: string
  /** Nombre d'échéances représentées par cette occurrence agrégée (absent = une seule). */
  missedCount?: number
  trigger?: 'schedule' | 'manual' | 'watchdog'
  outcome?: 'benign' | 'report' | 'investigate' | 'repair'
  watchdog?: { context: string; depth: number; source: string }
}

interface TaskAlert {
  id: string
  taskId: string
  occurrenceId: string
  kind: 'missed' | 'failed'
  message: string
  createdAt: number
  acknowledgedAt?: number
}

interface Snapshot {
  tasks: ScheduledTask[]
  occurrences: TaskOccurrence[]
  alerts: TaskAlert[]
  watchdogs?: Record<
    string,
    {
      admittedLastHour: number
      knownCostUsdLastHour?: number
      totalTokensLastHour?: number
      unpricedCallsLastHour?: number
      complaint?: string
      mailLog?: Array<{
        at: number
        channel: 'outlook' | 'teams'
        outcome: string
        from?: string
        subject?: string
        detail?: string
      }>
      mailReadError?: { channel: 'outlook' | 'teams'; since: number; erreur: string }
      teamsSignIn?:
        | { state: 'connected' }
        | { state: 'code'; userCode: string; verificationUri: string; expiresAt: number }
        | { state: 'disconnected'; erreur?: string }
        | { state: 'unconfigured' }
    }
  >
  scheduler: {
    running: boolean
    nextWakeAt: number | null
    relayAvailable: boolean
    relayError?: string
  }
}

/**
 * Le contrat vit dans le magasin (`main/store/conversations`), pas ici : une interface locale
 * redeclaree divergeait en silence du vrai type. On n'expose que les champs consommes par cet
 * ecran, via un `Pick` sur le type importe — retirer l'un d'eux du contrat casse desormais la
 * compilation de ce fichier.
 */
type ConversationSummary = Pick<StoreConversationSummary, 'id' | 'title' | 'provider'>

const WEEK_DAYS: { value: number; label: CleTaskManager }[] = [
  { value: 1, label: 'vue.jour.lundi' },
  { value: 2, label: 'vue.jour.mardi' },
  { value: 3, label: 'vue.jour.mercredi' },
  { value: 4, label: 'vue.jour.jeudi' },
  { value: 5, label: 'vue.jour.vendredi' },
  { value: 6, label: 'vue.jour.samedi' },
  { value: 7, label: 'vue.jour.dimanche' }
]

const EFFORT_LABELS: Readonly<Record<string, CleTaskManager | undefined>> = {
  none: 'vue.effort.none',
  minimal: 'vue.effort.minimal',
  low: 'vue.effort.low',
  medium: 'vue.effort.medium',
  high: 'vue.effort.high',
  xhigh: 'vue.effort.xhigh',
  max: 'vue.effort.max',
  ultra: 'vue.effort.ultra'
}

function localInputParts(date = new Date(Date.now() + 5 * 60_000)): {
  date: string
  time: string
} {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` }
}

function defaultDraft(
  conversations: ConversationSummary[],
  selectedModel?: RuntimeModel
): TaskDraft {
  const now = localInputParts()
  return {
    title: '',
    prompt: '',
    enabled: true,
    mode: 'active-only',
    destination: conversations[0]
      ? {
          kind: 'existing',
          conversationId: conversations[0].id,
          ...(selectedModel
            ? {
                provider: selectedModel.provider,
                model: selectedModel.model,
                reasoningEffort: selectedModel.defaultReasoningEffort
              }
            : {})
        }
      : {
          kind: 'new',
          title: texte('vue.titreParDefaut'),
          category: selectedModel?.provider ?? '',
          provider: selectedModel?.provider ?? '',
          ...(selectedModel
            ? {
                model: selectedModel.model,
                reasoningEffort: selectedModel.defaultReasoningEffort
              }
            : {})
        },
    schedule: {
      startDate: now.date,
      time: now.time,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
      recurrence: { unit: 'none', interval: 1 }
    }
  }
}

function formatDateTime(value: number | null | undefined): string {
  if (!value) return texte('vue.aucuneEcheance')
  return formaterDate(value, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Decision de la surveillance mails, en mots : ce qui a ete fait du message, et pourquoi. */
// fix-ok: le detail d'une regle n'affichait que les reveils de l'heure, le cout et `complaint` (vide pour une regle mails) — test « explique pourquoi un mail n'a rien déclenché » rouge avant cet ajout (2026-09-26).
const MAIL_OUTCOMES: Readonly<Record<string, CleTaskManager | undefined>> = {
  fired: 'vue.mail.lance',
  'sender-off': 'vue.mail.interlocuteurCoupe',
  'in-flight': 'vue.mail.agentEnCours',
  dedup: 'vue.mail.dejaTraite',
  rate: 'vue.mail.plafondHeure',
  'daily-rate': 'vue.mail.plafondJour',
  'cost-budget': 'vue.mail.budget',
  'unpriced-budget': 'vue.mail.nonChiffres',
  depth: 'vue.mail.chaine',
  'root-width': 'vue.mail.memeCause'
}

// `detail` vient du moteur de surveillance (processus principal) : il garde la langue du moteur.
function mailOutcomeLabel(outcome: string, detail?: string): string {
  if (outcome === 'baseline')
    return texte('vue.mail.ignore', { raison: detail ?? texte('vue.mail.dejaLa') })
  if (outcome === 'error')
    return detail ? texte('vue.mail.echecDetail', { detail }) : texte('vue.mail.echec')
  const cle = MAIL_OUTCOMES[outcome]
  return cle ? texte(cle) : texte('vue.mail.ignoreCode', { code: outcome })
}

function recurrenceLabel(schedule: TaskSchedule): string {
  const { unit, interval, weekDays } = schedule.recurrence
  const n = interval
  if (unit === 'none') return texte('vue.repetition.uneFois')
  if (unit === 'minute')
    return texte(interval === 1 ? 'vue.repetition.chaqueMinute' : 'vue.repetition.toutesMinutes', {
      n
    })
  if (unit === 'hour')
    return texte(interval === 1 ? 'vue.repetition.chaqueHeure' : 'vue.repetition.toutesHeures', {
      n
    })
  if (unit === 'day')
    return texte(interval === 1 ? 'vue.repetition.chaqueJour' : 'vue.repetition.tousJours', { n })
  if (unit === 'month')
    return texte(interval === 1 ? 'vue.repetition.chaqueMois' : 'vue.repetition.tousMois', { n })
  const days = (weekDays ?? [])
    .map((day) => {
      const cle = WEEK_DAYS[day - 1]?.label
      return cle ? texte(cle) : undefined
    })
    .join(' · ')
  const semaine = texte(
    interval === 1 ? 'vue.repetition.chaqueSemaine' : 'vue.repetition.toutesSemaines',
    { n }
  )
  return `${semaine} · ${days}`
}

function modeLabel(mode: ExecutionMode | 'legacy-unknown'): string {
  if (mode === 'legacy-unknown') return texte('vue.mode.nonArchive')
  return texte(mode === 'windows' ? 'vue.mode.windows' : 'vue.mode.actif')
}

const TRIGGER_LABELS: Readonly<Record<string, CleTaskManager | undefined>> = {
  schedule: 'vue.declencheur.horaire',
  manual: 'vue.declencheur.manuel',
  watchdog: 'vue.declencheur.reveil'
}

const OUTCOME_LABELS: Readonly<Record<string, CleTaskManager | undefined>> = {
  benign: 'surveillance.issue.benin',
  report: 'vue.issue.aSignaler',
  investigate: 'vue.issue.aInvestiguer',
  repair: 'surveillance.issue.reparation'
}

/** Durée réellement mesurée : sans les deux bornes, on n'affiche rien plutôt qu'un chiffre inventé. */
function durationLabel(startedAt?: number, finishedAt?: number): string | null {
  if (!startedAt || !finishedAt || finishedAt < startedAt) return null
  const seconds = Math.round((finishedAt - startedAt) / 1000)
  if (seconds < 60) return texte('vue.duree.s', { s: seconds })
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60)
    return rest
      ? texte('vue.duree.minS', { min: minutes, s: rest })
      : texte('vue.duree.min', { min: minutes })
  const hours = Math.floor(minutes / 60)
  return minutes % 60
    ? texte('vue.duree.hMin', { h: hours, min: minutes % 60 })
    : texte('vue.duree.h', { h: hours })
}

function usageMeta(usage: {
  knownCostUsd?: number
  totalTokens?: number
  unpricedCalls?: number
}): string[] {
  const meta: string[] = []
  if (typeof usage.knownCostUsd === 'number') {
    meta.push(
      texte('vue.usage.connus', {
        montant: formaterNombre(usage.knownCostUsd, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 4
        })
      })
    )
  }
  if (typeof usage.totalTokens === 'number') {
    // « tokens » : le même mot dans les deux langues, seul le nombre suit la langue.
    meta.push(`${formaterNombre(usage.totalTokens)} tokens`)
  }
  if (usage.unpricedCalls) {
    meta.push(
      texte(usage.unpricedCalls > 1 ? 'vue.usage.appels' : 'vue.usage.appel', {
        n: usage.unpricedCalls
      })
    )
  }
  return meta
}

/** Les métadonnées DÉJÀ stockées, dans l'ordre de lecture. Une valeur absente est omise, pas devinée. */
function occurrenceMeta(occurrence: TaskOccurrence): string[] {
  const meta: string[] = []
  if (occurrence.error) meta.push(occurrence.error)
  const issue = occurrence.outcome ? OUTCOME_LABELS[occurrence.outcome] : undefined
  if (issue) meta.push(texte(issue))
  const declencheur = occurrence.trigger ? TRIGGER_LABELS[occurrence.trigger] : undefined
  if (declencheur) meta.push(texte(declencheur))
  const duration = durationLabel(occurrence.startedAt, occurrence.finishedAt)
  if (duration) meta.push(duration)
  if (occurrence.requestedModel)
    meta.push(texte('vue.meta.modeleDemande', { modele: occurrence.requestedModel }))
  if (occurrence.resolvedModel)
    meta.push(texte('vue.meta.modeleExecute', { modele: occurrence.resolvedModel }))
  meta.push(
    ...usageMeta({
      knownCostUsd: occurrence.knownCostUsd,
      totalTokens: occurrence.totalTokens,
      unpricedCalls: occurrence.unpricedCalls
    })
  )
  if (occurrence.missedCount && occurrence.missedCount > 1)
    meta.push(texte('vue.meta.echeancesAgregees', { n: occurrence.missedCount }))
  const context = occurrence.watchdog?.context?.trim()
  if (context) meta.push(texte('vue.meta.signal', { contexte: context.slice(0, 160) }))
  return meta
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : texte('vue.erreur.operation')
}

function hasLoadedModel(destination: TaskDestination, models: RuntimeModel[]): boolean {
  if (usesAgentStudioDefault(destination.provider)) return models.length > 0
  return models.some(
    (candidate) =>
      candidate.provider === destination.provider && candidate.model === destination.model
  )
}

function followAgentStudioDefault(destination: TaskDestination): TaskDestination {
  if (destination.kind === 'existing') {
    return {
      kind: 'existing',
      conversationId: destination.conversationId,
      provider: AGENT_STUDIO_DEFAULT_PROVIDER
    }
  }
  return {
    kind: 'new',
    title: destination.title,
    category: destination.category,
    provider: AGENT_STUDIO_DEFAULT_PROVIDER,
    ...(destination.conversationId ? { conversationId: destination.conversationId } : {})
  }
}

function modelDisplayKey(model: RuntimeModel): string {
  return `${model.provider}\u0000${displayedModelName(model)}`
}

function uniqueModelsForPicker(models: RuntimeModel[]): RuntimeModel[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    const key = modelDisplayKey(model)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function TaskManagerView({
  active,
  onOpenConversation,
  section,
  onSectionChange
}: {
  active: boolean
  /** Remonte la preuve à l'application : elle seule sait naviguer vers le Chat. */
  onOpenConversation?: (target: { conversationId: string; turnId?: string }) => void
  /**
   * Section affichée. OPTIONNELLE, contrairement à `AgentStudioView` qui l'exige : la vue garde un
   * état interne quand personne ne la pilote, ce qui laisse un simple `<TaskManagerView active />`
   * fonctionner (plusieurs appelants et tests le montent ainsi). Fournie, elle prend la main — c'est
   * ce qui permet le deep-link « va sur le watchdog » depuis un agent.
   */
  section?: TaskManagerSection
  onSectionChange?: (section: TaskManagerSection) => void
}): React.JSX.Element {
  const { t } = useTextesTaskManager()
  // DÉFAUT = planification, pas watchdog : c'est le contenu historique de l'onglet et ce que sa propre
  // description annonce (« Planifie de vrais prompts Chat »). Basculer le défaut aurait changé en
  // silence ce que l'utilisateur voit en ouvrant Task Manager — le découpage doit ajouter un écran,
  // pas déplacer celui qu'on connaît.
  const [sectionInterne, setSectionInterne] = useState<TaskManagerSection>(
    section ?? 'planification'
  )
  const sectionActive = section ?? sectionInterne
  const changerSection = (suivante: TaskManagerSection): void => {
    setSectionInterne(suivante)
    onSectionChange?.(suivante)
  }
  const [snapshot, setSnapshot] = useState<Snapshot>({
    tasks: [],
    occurrences: [],
    alerts: [],
    scheduler: { running: false, nextWakeAt: null, relayAvailable: false }
  })
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [models, setModels] = useState<RuntimeModel[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [draft, setDraft] = useState<TaskDraft>()
  const [editingId, setEditingId] = useState<string>()
  // Changer d'onglet (clic ou lien profond du parent) ferme l'editeur : un brouillon ne suit pas.
  // Ajuste pendant le rendu (motif React) plutot qu'un setState synchrone dans un effet.
  const [sectionVue, setSectionVue] = useState(sectionActive)
  if (sectionVue !== sectionActive) {
    setSectionVue(sectionActive)
    setDraft(undefined)
    setEditingId(undefined)
  }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [loadErrors, setLoadErrors] = useState<
    Partial<Record<'task-manager' | 'conversations' | 'roles', string>>
  >({})
  const [catalogActive, setCatalogActive] = useState(active)
  const [catalogReady, setCatalogReady] = useState(false)
  const loadGenerationRef = useRef(0)
  const snapshotRequestRef = useRef(0)
  const conversationsRequestRef = useRef(0)
  const modelsRequestRef = useRef(0)
  const modelCatalogReady = active && catalogReady && !loading
  /** Toutes les pannes de chargement, pas seulement la première : trois scopes peuvent tomber ensemble. */
  const failedScopes = (['task-manager', 'conversations', 'roles'] as const).filter(
    (scope) => loadErrors[scope] !== undefined
  )
  const loadErrorTitleOf = (scope: 'task-manager' | 'conversations' | 'roles'): string =>
    t(
      scope === 'roles'
        ? 'vue.chargement.modeles'
        : scope === 'conversations'
          ? 'vue.chargement.conversations'
          : 'vue.chargement.taches'
    )

  if (catalogActive !== active) {
    setCatalogActive(active)
    setCatalogReady(false)
  }

  const applySnapshot = useCallback((nextSnapshot: Snapshot): void => {
    setSnapshot(nextSnapshot)
    setSelectedId((current) =>
      current && nextSnapshot.tasks.some(({ id }) => id === current)
        ? current
        : nextSnapshot.tasks[0]?.id
    )
  }, [])

  const clearLoadError = useCallback((scope: 'task-manager' | 'conversations' | 'roles'): void => {
    setLoadErrors((current) => {
      if (current[scope] === undefined) return current
      const next = { ...current }
      delete next[scope]
      return next
    })
  }, [])

  const recordLoadError = useCallback(
    (scope: 'task-manager' | 'conversations' | 'roles', failure: unknown): void => {
      setLoadErrors((current) => ({ ...current, [scope]: errorText(failure) }))
    },
    []
  )

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    const generation = loadGenerationRef.current
    const request = ++snapshotRequestRef.current
    try {
      const rawSnapshot = await window.api.taskManagerSnapshot()
      if (generation !== loadGenerationRef.current || request !== snapshotRequestRef.current) return
      applySnapshot(rawSnapshot as unknown as Snapshot)
      clearLoadError('task-manager')
    } catch (failure) {
      if (generation !== loadGenerationRef.current || request !== snapshotRequestRef.current) return
      recordLoadError('task-manager', failure)
    }
  }, [applySnapshot, clearLoadError, recordLoadError])

  const refreshConversations = useCallback(async (): Promise<void> => {
    const generation = loadGenerationRef.current
    const request = ++conversationsRequestRef.current
    try {
      const rawConversations = await window.api.conversations()
      if (generation !== loadGenerationRef.current || request !== conversationsRequestRef.current)
        return
      setConversations(rawConversations as ConversationSummary[])
      clearLoadError('conversations')
    } catch (failure) {
      if (generation !== loadGenerationRef.current || request !== conversationsRequestRef.current)
        return
      recordLoadError('conversations', failure)
    }
  }, [clearLoadError, recordLoadError])

  const refreshModels = useCallback(async (): Promise<void> => {
    const generation = loadGenerationRef.current
    const request = ++modelsRequestRef.current
    setCatalogReady(false)
    try {
      const rawModels = await window.api.models()
      if (generation !== loadGenerationRef.current || request !== modelsRequestRef.current) return
      setModels(rawModels as RuntimeModel[])
      setCatalogReady(true)
      clearLoadError('roles')
    } catch (failure) {
      if (generation !== loadGenerationRef.current || request !== modelsRequestRef.current) return
      setCatalogReady(false)
      recordLoadError('roles', failure)
    }
  }, [clearLoadError, recordLoadError])

  const load = useCallback(async (): Promise<void> => {
    const generation = ++loadGenerationRef.current
    setLoading(true)
    setCatalogReady(false)
    setError(undefined)
    setLoadErrors({})
    setModels([])
    try {
      await Promise.all([refreshSnapshot(), refreshConversations(), refreshModels()])
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false)
    }
  }, [refreshConversations, refreshModels, refreshSnapshot])

  useEffect(() => {
    if (!active) return
    let disposed = false
    void Promise.resolve().then(() => {
      if (!disposed) void load()
    })
    const off = window.api.onAppEvent((event) => {
      if (event.type !== 'refresh') return
      if (event.scope === 'task-manager') void refreshSnapshot()
      else if (event.scope === 'roles') void refreshModels()
      else if (event.scope === 'conversations') void refreshConversations()
    })
    return () => {
      disposed = true
      loadGenerationRef.current += 1
      off()
    }
  }, [active, load, refreshConversations, refreshModels, refreshSnapshot])

  const selected = snapshot.tasks.find(({ id }) => id === selectedId)
  const selectableModels = useMemo(
    () => uniqueModelsForPicker(models).sort(compareModelsByName),
    [models]
  )
  const occurrences = useMemo(
    () => snapshot.occurrences.filter(({ taskId }) => taskId === selectedId),
    [selectedId, snapshot.occurrences]
  )
  const taskIsRunning = occurrences.some(
    ({ status }) => status === 'claimed' || status === 'running'
  )
  /** Les tâches qui TOURNENT en ce moment : une exécution invisible se lit comme une tâche inerte. */
  const runningTaskIds = new Set(
    snapshot.occurrences
      .filter(({ status }) => status === 'claimed' || status === 'running')
      .map(({ taskId }) => taskId)
  )
  const openAlerts = snapshot.alerts.filter(({ acknowledgedAt }) => !acknowledgedAt)
  /**
   * Le compteur d'en-tête et le panneau parlent du MÊME ensemble : les alertes ouvertes de toutes
   * les tâches. Filtrer le panneau sur la tâche sélectionnée laissait un compteur à 3 en face d'un
   * panneau vide, sans aucun chemin pour atteindre les alertes des autres tâches.
   */
  const visibleAlerts = [
    ...openAlerts,
    ...snapshot.alerts.filter(
      ({ taskId, acknowledgedAt }) => acknowledgedAt && taskId === selectedId
    )
  ].sort((left, right) => right.createdAt - left.createdAt)
  const draftDestination = draft?.destination
  const draftModelId = draftDestination
    ? usesAgentStudioDefault(draftDestination.provider)
      ? AGENT_STUDIO_DEFAULT_PROVIDER
      : (() => {
          const loaded = models.find(
            (candidate) =>
              candidate.provider === draftDestination.provider &&
              candidate.model === draftDestination.model
          )
          if (!loaded) return ''
          return (
            selectableModels.find(
              (candidate) => modelDisplayKey(candidate) === modelDisplayKey(loaded)
            )?.id ?? ''
          )
        })()
    : ''
  const draftModel = selectableModels.find((candidate) => candidate.id === draftModelId)
  const draftEfforts = draftModel?.reasoningEfforts?.length
    ? draftModel.reasoningEfforts
    : draftModel
      ? [draftModel.defaultReasoningEffort ?? 'none']
      : []
  const draftEffort =
    draftDestination?.reasoningEffort ?? draftModel?.defaultReasoningEffort ?? draftEfforts[0] ?? ''

  const openCreate = (): void => {
    setEditingId(undefined)
    setDraft(defaultDraft(conversations, selectableModels[0]))
  }

  const openEdit = (task: ScheduledTask): void => {
    setEditingId(task.id)
    setDraft({
      ...structuredClone(task),
      schedule: structuredClone(task.schedule ?? defaultDraft(conversations).schedule)
    })
  }

  /**
   * Après un échec, la correction se fait sur le prompt QUI A ÉCHOUÉ, avec l'erreur sous les yeux :
   * rouvrir un éditeur vide obligerait à retrouver de mémoire ce qui a été envoyé.
   */
  const openFixAfterFailure = (task: ScheduledTask, occurrence: TaskOccurrence): void => {
    openEdit(task)
    setError(
      t('vue.erreur.dernierEchec', {
        erreur: occurrence.error ?? t('vue.erreur.nonEnregistree')
      })
    )
  }

  const closeEditor = (): void => {
    setDraft(undefined)
    setEditingId(undefined)
    setError(undefined)
  }

  const save = async (): Promise<void> => {
    if (!draft || !draft.title.trim() || !draft.prompt.trim()) {
      setError(t('vue.erreur.titrePrompt'))
      return
    }
    if (!modelCatalogReady || !hasLoadedModel(draft.destination, models)) {
      setError(t('vue.erreur.modele'))
      return
    }
    const watchdogProblem = watchdogDraftProblem(draft.watchdog)
    if (watchdogProblem) {
      setError(watchdogProblem)
      return
    }
    const scheduleProblem = draft.watchdog ? undefined : scheduleDraftProblem(draft.schedule)
    if (scheduleProblem) {
      setError(scheduleProblem)
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      const payload = toTaskPayload(draft)
      if (editingId) await window.api.taskManagerUpdate(editingId, payload)
      else await window.api.taskManagerCreate(payload)
      const mayCreateConversation = draft.destination.kind === 'new'
      closeEditor()
      await refreshSnapshot()
      if (mayCreateConversation) await refreshConversations()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setSaving(false)
    }
  }

  const updateTask = async (task: ScheduledTask, patch: Partial<TaskDraft>): Promise<void> => {
    setSaving(true)
    try {
      await window.api.taskManagerUpdate(task.id, { ...task, ...patch })
      await refreshSnapshot()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setSaving(false)
    }
  }

  // Interrupteur par personne du détail (piste n°9) : une seule personne part, relue au clic côté
  // main — l'enregistrement du formulaire renvoyait la liste entière de son ouverture.
  // fix-ok: mesuré le 2026-09-26 (TaskManagerView.test.tsx, rouge « interrupteur de Bob absent du détail » et « Connecter Teams » absent) : le détail d'une règle mails n'avait ni interrupteur par personne ni état de connexion Teams.
  const setSender = async (task: ScheduledTask, key: string, enabled: boolean): Promise<void> => {
    setSaving(true)
    setError(undefined)
    try {
      await window.api.taskManagerSetSender(task.id, key, enabled)
      await refreshSnapshot()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setSaving(false)
    }
  }

  // « Connecter Teams » (piste n°2) : le code revient dans le détail de la règle Teams.
  const connectTeams = async (): Promise<void> => {
    setSaving(true)
    setError(undefined)
    try {
      const result = await window.api.taskManagerTeamsConnect()
      if (!result.ok) setError(t('vue.erreur.teams', { erreur: result.erreur }))
      await refreshSnapshot()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setSaving(false)
    }
  }

  const removeTask = async (task: ScheduledTask): Promise<void> => {
    if (!window.confirm(t('vue.confirmer.supprimer', { titre: task.title }))) return
    setSaving(true)
    setError(undefined)
    try {
      await window.api.taskManagerRemove(task.id)
      if (editingId === task.id) closeEditor()
      await refreshSnapshot()
    } catch (failure) {
      setError(errorText(failure))
      await refreshSnapshot()
    } finally {
      setSaving(false)
    }
  }

  const runNow = async (task: ScheduledTask): Promise<void> => {
    setSaving(true)
    setError(undefined)
    try {
      const result = await window.api.taskManagerRunNow(task.id)
      if (!result.started) setError(t('vue.erreur.demarrage'))
      await refreshSnapshot()
      // Une destination « nouvelle conversation » pas encore matérialisée peut en créer une.
      if (task.destination.kind === 'new' && !task.destination.conversationId)
        await refreshConversations()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setSaving(false)
    }
  }

  const acknowledge = async (alertId: string): Promise<void> => {
    await window.api.taskManagerAcknowledge(alertId)
    await refreshSnapshot()
  }

  const setSchedule = (patch: Partial<TaskSchedule>): void => {
    setDraft((current) =>
      current ? { ...current, schedule: { ...current.schedule, ...patch } } : current
    )
  }

  const setRecurrence = (patch: Partial<TaskSchedule['recurrence']>): void => {
    setDraft((current) =>
      current
        ? {
            ...current,
            schedule: {
              ...current.schedule,
              recurrence: { ...current.schedule.recurrence, ...patch }
            }
          }
        : current
    )
  }

  // Détail + éditeur, partagés par les onglets Planification et Watchdog (même état, deux rendus).
  const scheduledTasks = splitByTrigger(snapshot.tasks).scheduled
  const renderDetail = (selected: (typeof snapshot.tasks)[number] | undefined): React.JSX.Element => (
    <main className="task-manager-detail">
      {draft ? (
        <div className="task-manager-editor">
          <div className="task-manager-panel-title">
            <span>{editingId ? t('vue.editeur.modifier') : t('vue.editeur.nouvelle')}</span>
            <button type="button" onClick={closeEditor}>
              {t('vue.editeur.annuler')}
            </button>
          </div>
          <div className="task-manager-form-grid">
            <label className="task-manager-field is-wide">
              <span>{t('vue.editeur.titre')}</span>
              <input
                name="title"
                value={draft.title}
                placeholder={t('vue.editeur.titreExemple')}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, title: event.target.value } : current
                  )
                }
              />
            </label>
            {/* Un bouton DANS un <label> en deviendrait la cible (premier élément étiquetable) :
                l'en-tête porte donc un label `htmlFor` et le bouton à côté (conv-983, 2026-10-16). */}
            <div className="task-manager-field is-wide">
              <span className="task-manager-field-head">
                <label htmlFor="task-manager-prompt">{t('vue.prompt')}</label>
                <button
                  type="button"
                  className="task-manager-template"
                  disabled={draft.prompt.trim() !== ''}
                  title={
                    draft.prompt.trim() === ''
                      ? t('vue.editeur.modeleRemplir')
                      : t('vue.editeur.modeleDejaRempli')
                  }
                  onClick={() =>
                    setDraft((current) =>
                      current && current.prompt.trim() === ''
                        ? { ...current, prompt: MODELE_PROMPT_TACHE }
                        : current
                    )
                  }
                >
                  {t('vue.editeur.partirDuModele')}
                </button>
              </span>
              <textarea
                id="task-manager-prompt"
                name="prompt"
                value={draft.prompt}
                rows={8}
                placeholder={MODELE_PROMPT_TACHE}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, prompt: event.target.value } : current
                  )
                }
                // Le modèle de prompt est une consigne pour l'agent (shared/modele-prompt-tache.ts) :
                // il reste en français, comme le prompt qu'il aide à écrire.
              />
            </div>
            <label className="task-manager-field">
              <span>{t('vue.editeur.mode')}</span>
              <select
                value={draft.mode}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, mode: event.target.value as ExecutionMode }
                      : current
                  )
                }
              >
                <option value="active-only">{t('vue.mode.actif')}</option>
                <option value="windows">{t('vue.editeur.modeWindows')}</option>
              </select>
            </label>
            <label className="task-manager-field">
              <span>{t('vue.destination')}</span>
              <select
                value={draft.destination.kind}
                onChange={(event) => {
                  const kind = event.target.value
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          destination:
                            kind === 'existing' && conversations[0]
                              ? {
                                  kind: 'existing',
                                  conversationId: conversations[0].id,
                                  ...(selectableModels[0]
                                    ? {
                                        provider: selectableModels[0].provider,
                                        model: selectableModels[0].model,
                                        reasoningEffort:
                                          selectableModels[0].defaultReasoningEffort
                                      }
                                    : {})
                                }
                              : {
                                  kind: 'new',
                                  title: current.title || t('vue.titreParDefaut'),
                                  category: selectableModels[0]?.provider ?? '',
                                  provider: selectableModels[0]?.provider ?? '',
                                  ...(selectableModels[0]
                                    ? {
                                        model: selectableModels[0].model,
                                        reasoningEffort:
                                          selectableModels[0].defaultReasoningEffort
                                      }
                                    : {})
                                }
                        }
                      : current
                  )
                }}
              >
                <option value="existing">{t('vue.editeur.destinationExistante')}</option>
                <option
                  value="new"
                  disabled={!modelCatalogReady || selectableModels.length === 0}
                >
                  {t('vue.editeur.destinationNouvelle')}
                </option>
              </select>
            </label>
            {draft.destination.kind === 'existing' ? (
              <label className="task-manager-field is-wide">
                <span>{t('vue.editeur.conversationCiblee')}</span>
                <select
                  value={draft.destination.conversationId}
                  onChange={(event) =>
                    setDraft((current) =>
                      current?.destination.kind === 'existing'
                        ? {
                            ...current,
                            destination: {
                              ...current.destination,
                              conversationId: event.target.value
                            }
                          }
                        : current
                    )
                  }
                >
                  {conversations.map((conversation) => (
                    <option key={conversation.id} value={conversation.id}>
                      {conversation.title} · {conversation.provider}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="task-manager-field">
                <span>{t('vue.editeur.nomConversation')}</span>
                <input
                  value={draft.destination.title}
                  onChange={(event) => {
                    const title = event.target.value
                    setDraft((current) =>
                      current?.destination.kind === 'new'
                        ? {
                            ...current,
                            destination: { ...current.destination, title }
                          }
                        : current
                    )
                  }}
                />
              </label>
            )}
            <label className="task-manager-field">
              <span>{t('vue.editeur.modele')}</span>
              <select
                value={draftModelId}
                disabled={!modelCatalogReady || selectableModels.length === 0}
                onChange={(event) => {
                  if (event.target.value === AGENT_STUDIO_DEFAULT_PROVIDER) {
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            destination: followAgentStudioDefault(current.destination)
                          }
                        : current
                    )
                    return
                  }
                  const selectedModel = selectableModels.find(
                    (candidate) => candidate.id === event.target.value
                  )
                  if (!selectedModel) return
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          destination:
                            current.destination.kind === 'new'
                              ? {
                                  ...current.destination,
                                  provider: selectedModel.provider,
                                  category: selectedModel.provider,
                                  model: selectedModel.model,
                                  reasoningEffort: selectedModel.defaultReasoningEffort
                                }
                              : {
                                  ...current.destination,
                                  provider: selectedModel.provider,
                                  model: selectedModel.model,
                                  reasoningEffort: selectedModel.defaultReasoningEffort
                                }
                        }
                      : current
                  )
                }}
              >
                <option value={AGENT_STUDIO_DEFAULT_PROVIDER}>
                  {AGENT_STUDIO_DEFAULT_MODEL_LABEL}
                </option>
                {!draftModelId && draft.destination.model && (
                  <option value="" disabled>
                    {t('vue.editeur.modeleIndisponible', { modele: draft.destination.model })}
                  </option>
                )}
                {!draftModelId && !draft.destination.model && selectableModels.length > 0 && (
                  <option value="" disabled>
                    {t('vue.editeur.choisirModele')}
                  </option>
                )}
                {selectableModels.length === 0 && !draft.destination.model && (
                  <option value="">{t('vue.editeur.aucunModele')}</option>
                )}
                {selectableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label ?? model.model} · {model.provider}
                  </option>
                ))}
              </select>
            </label>
            <label className="task-manager-field">
              <span>{t('vue.editeur.effort')}</span>
              <select
                value={draftEffort}
                disabled={!draftModel || draftEfforts.length <= 1}
                onChange={(event) => {
                  const reasoningEffort = event.target.value
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          destination: {
                            ...current.destination,
                            reasoningEffort
                          }
                        }
                      : current
                  )
                }}
              >
                {draftEfforts.map((effort) => (
                  <option key={effort} value={effort}>
                    {EFFORT_LABELS[effort] ? t(EFFORT_LABELS[effort]) : effort}
                  </option>
                ))}
              </select>
            </label>
            <label className="task-manager-field task-manager-field-wide">
              <span>{t('vue.editeur.declencheur')}</span>
              <select
                value={triggerKindOf(draft)}
                data-testid="trigger-kind"
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          watchdog:
                            event.target.value === 'watchdog'
                              ? (current.watchdog ?? {
                                  source: { ...DEFAULT_FILE_SOURCE },
                                  guards: { ...DEFAULT_DRAFT_GUARDS }
                                })
                              : undefined
                        }
                      : current
                  )
                }
              >
                <option value="schedule">{t('vue.editeur.declencheurHeure')}</option>
                <option value="watchdog">{t('vue.editeur.declencheurEvenement')}</option>
              </select>
            </label>
            {draft.watchdog && (
              <WatchdogRuleFields
                rule={draft.watchdog}
                onChange={(rule) =>
                  setDraft((current) => (current ? { ...current, watchdog: rule } : current))
                }
              />
            )}
            {!draft.watchdog && (
              <>
                <label className="task-manager-field">
                  <span>{t('vue.editeur.dateDepart')}</span>
                  <input
                    type="date"
                    value={draft.schedule.startDate}
                    onChange={(event) => setSchedule({ startDate: event.target.value })}
                  />
                </label>
                <label className="task-manager-field">
                  <span>{t('vue.editeur.heure')}</span>
                  <input
                    type="time"
                    value={draft.schedule.time}
                    onChange={(event) => setSchedule({ time: event.target.value })}
                  />
                </label>
                <label className="task-manager-field">
                  <span>{t('vue.repetition')}</span>
                  <select
                    value={draft.schedule.recurrence.unit}
                    onChange={(event) =>
                      setRecurrence({
                        unit: event.target.value as RecurrenceUnit,
                        ...(event.target.value === 'week' &&
                        !draft.schedule.recurrence.weekDays?.length
                          ? { weekDays: [new Date().getDay() || 7] }
                          : {})
                      })
                    }
                  >
                    <option value="none">{t('vue.editeur.unite.aucune')}</option>
                    <option value="minute">{t('vue.editeur.unite.minute')}</option>
                    <option value="hour">{t('vue.editeur.unite.heure')}</option>
                    <option value="day">{t('vue.editeur.unite.jour')}</option>
                    <option value="week">{t('vue.editeur.unite.semaine')}</option>
                    <option value="month">{t('vue.editeur.unite.mois')}</option>
                  </select>
                </label>
                {draft.schedule.recurrence.unit !== 'none' && (
                  <label className="task-manager-field">
                    <span>{t('vue.editeur.intervalle')}</span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={draft.schedule.recurrence.interval}
                      onChange={(event) =>
                        setRecurrence({ interval: Math.max(1, Number(event.target.value)) })
                      }
                    />
                  </label>
                )}
                {draft.schedule.recurrence.unit === 'week' && (
                  <fieldset className="task-manager-weekdays">
                    <legend>{t('vue.editeur.jours')}</legend>
                    {WEEK_DAYS.map((day) => {
                      const selected = draft.schedule.recurrence.weekDays?.includes(day.value)
                      return (
                        <label key={day.value} className={selected ? 'is-selected' : ''}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => {
                              const current = draft.schedule.recurrence.weekDays ?? []
                              setRecurrence({
                                weekDays: selected
                                  ? current.filter((value) => value !== day.value)
                                  : [...current, day.value].sort()
                              })
                            }}
                          />
                          {t(day.label)}
                        </label>
                      )
                    })}
                  </fieldset>
                )}
                <label className="task-manager-field">
                  <span>{t('vue.editeur.dateFin')}</span>
                  <input
                    type="date"
                    value={draft.schedule.endDate ?? ''}
                    onChange={(event) =>
                      setSchedule({ endDate: event.target.value || undefined })
                    }
                  />
                </label>
              </>
            )}
            <label className="task-manager-switch">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, enabled: event.target.checked } : current
                  )
                }
              />
              <span>{t('vue.editeur.activer')}</span>
            </label>
          </div>
          <div className="task-manager-form-actions">
            <span>
              {draft.mode === 'windows' ? t('vue.editeur.noteWindows') : t('vue.editeur.noteActif')}
            </span>
            <button
              type="button"
              className="task-manager-primary"
              disabled={
                saving || !modelCatalogReady || !hasLoadedModel(draft.destination, models)
              }
              onClick={() => void save()}
            >
              {saving
                ? t('vue.editeur.enregistrement')
                : editingId
                  ? t('vue.editeur.enregistrer')
                  : t('vue.editeur.creer')}
            </button>
          </div>
        </div>
      ) : selected ? (
        <>
          <div className="task-manager-detail-head">
            <div>
              <span className={`task-manager-mode mode-${selected.mode}`}>
                {modeLabel(selected.mode)}
              </span>
              <h2>{selected.title}</h2>
              <p>
                {selected.schedule
                  ? `${recurrenceLabel(selected.schedule)} · ${selected.schedule.timeZone}`
                  : selected.watchdog
                    ? describeWatchdogSource(selected.watchdog.source)
                    : t('vue.detail.declencheurInvalide')}
              </p>
            </div>
            <div className="task-manager-detail-actions">
              <button type="button" onClick={() => openEdit(selected)}>
                {t('vue.detail.modifier')}
              </button>
              <button
                type="button"
                disabled={saving || !selected.enabled}
                onClick={() => void runNow(selected)}
              >
                {t('vue.detail.lancer')}
              </button>
              <button
                type="button"
                onClick={() => void updateTask(selected, { enabled: !selected.enabled })}
              >
                {selected.enabled ? t('vue.detail.desactiver') : t('vue.detail.activer')}
              </button>
              <button
                type="button"
                className="is-danger"
                disabled={saving || taskIsRunning}
                title={taskIsRunning ? t('vue.detail.suppressionImpossible') : undefined}
                onClick={() => void removeTask(selected)}
              >
                {t('vue.detail.supprimer')}
              </button>
            </div>
          </div>
          <div className="task-manager-prompt">
            <span>{t('vue.prompt')}</span>
            <p>{selected.prompt}</p>
          </div>
          <dl className="task-manager-facts">
            <div>
              <dt>{t('vue.detail.prochaineEcheance')}</dt>
              <dd>{formatDateTime(selected.nextRunAt)}</dd>
            </div>
            <div>
              <dt>{t('vue.destination')}</dt>
              <dd>
                {selected.destination.kind === 'existing'
                  ? (conversations.find(
                      ({ id }) => id === selected.destination.conversationId
                    )?.title ?? selected.destination.conversationId)
                  : selected.destination.conversationId
                    ? t('vue.detail.conversationDediee', { titre: selected.destination.title })
                    : t('vue.detail.nouvelleConversation', { titre: selected.destination.title })}
              </dd>
            </div>
            <div>
              <dt>{t('vue.repetition')}</dt>
              <dd>
                {selected.schedule
                  ? recurrenceLabel(selected.schedule)
                  : selected.watchdog
                    ? describeWatchdogSource(selected.watchdog.source)
                    : t('vue.detail.inconnu')}
              </dd>
            </div>
            <div>
              <dt>{t('vue.detail.etat')}</dt>
              <dd>{selected.enabled ? t('vue.detail.active') : t('vue.detail.desactivee')}</dd>
            </div>
            {selected.watchdog && (
              <>
                <div>
                  <dt>{t('vue.detail.activite')}</dt>
                  <dd>
                    {t('vue.detail.reveilsHeure', {
                      n: snapshot.watchdogs?.[selected.id]?.admittedLastHour ?? 0
                    })}
                  </dd>
                </div>
                {(() => {
                  const diagnostic = snapshot.watchdogs?.[selected.id]
                  if (!diagnostic) return null
                  const recentUsage = usageMeta({
                    knownCostUsd: diagnostic.knownCostUsdLastHour,
                    totalTokens: diagnostic.totalTokensLastHour,
                    unpricedCalls: diagnostic.unpricedCallsLastHour
                  })
                  return recentUsage.length ? (
                    <div>
                      <dt>{t('vue.detail.coutHeure')}</dt>
                      <dd>{recentUsage.join(' · ')}</dd>
                    </div>
                  ) : null
                })()}
                {snapshot.watchdogs?.[selected.id]?.complaint && (
                  <div>
                    <dt>{t('vue.detail.diagnostic')}</dt>
                    <dd>{snapshot.watchdogs[selected.id].complaint}</dd>
                  </div>
                )}
                {(() => {
                  const failure = snapshot.watchdogs?.[selected.id]?.mailReadError
                  if (!failure) return null
                  // Teams, Outlook : des noms de produits, les mêmes dans les deux langues.
                  const canal = failure.channel === 'teams' ? 'Teams' : 'Outlook'
                  return (
                    <div>
                      <dt>{t('vue.detail.lecture', { canal })}</dt>
                      <dd>
                        {t('vue.detail.lectureImpossible', {
                          canal,
                          depuis: formatDateTime(failure.since),
                          erreur: failure.erreur
                        })}
                      </dd>
                    </div>
                  )
                })()}
                {(() => {
                  const log = snapshot.watchdogs?.[selected.id]?.mailLog
                  if (!log?.length) return null
                  return (
                    <div className="task-manager-mail-log-card">
                      <dt>{t('vue.detail.derniersMessages')}</dt>
                      <dd>
                        <ul className="task-manager-mail-log">
                          {log.map((entry, index) => (
                            <li key={`${entry.at}-${index}`}>
                              {formatDateTime(entry.at)} ·{' '}
                              {entry.from || entry.subject
                                ? t('vue.detail.mailEntete', {
                                    entete: `${entry.from ?? ''}${entry.subject ? ` — ${entry.subject}` : ''}`
                                  })
                                : ''}
                              {mailOutcomeLabel(entry.outcome, entry.detail)}
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  )
                })()}
                {(() => {
                  const signIn = snapshot.watchdogs?.[selected.id]?.teamsSignIn
                  if (!signIn) return null
                  return (
                    <div className="task-manager-mail-log-card" data-testid="watchdog-teams-signin">
                      <dt>{t('vue.teams.connexion')}</dt>
                      <dd>
                        {signIn.state === 'connected' ? (
                          t('vue.teams.connecte')
                        ) : signIn.state === 'code' ? (
                          <>
                            {t('vue.teams.ouvre')} <strong>{signIn.verificationUri}</strong>{' '}
                            {t('vue.teams.saisis')}{' '}
                            <strong className="task-manager-teams-code">{signIn.userCode}</strong>{' '}
                            {t('vue.teams.avant', { date: formatDateTime(signIn.expiresAt) })}
                          </>
                        ) : signIn.state === 'unconfigured' ? (
                          t('vue.teams.nonConfigure')
                        ) : (
                          <>
                            {signIn.erreur
                              ? t('vue.teams.nonConnecteErreur', { erreur: signIn.erreur })
                              : t('vue.teams.nonConnecte')}{' '}
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void connectTeams()}
                            >
                              {t('vue.teams.connecter')}
                            </button>
                          </>
                        )}
                      </dd>
                    </div>
                  )
                })()}
                {(() => {
                  const source = selected.watchdog?.source
                  if (source?.kind !== 'outlook-mail') return null
                  const senders = Object.entries(source.senders ?? {}).sort(([, a], [, b]) =>
                    a.name.localeCompare(b.name)
                  )
                  return (
                    <div className="task-manager-mail-log-card">
                      <dt>{t('regle.interlocuteurs')}</dt>
                      <dd>
                        {senders.length === 0 ? (
                          t('vue.detail.aucunePersonne')
                        ) : (
                          <div className="task-manager-mail-senders">
                            {senders.map(([key, sender]) => (
                              <label
                                key={key}
                                className="task-manager-switch"
                                data-testid="watchdog-detail-sender"
                              >
                                <input
                                  type="checkbox"
                                  checked={sender.enabled}
                                  disabled={saving}
                                  onChange={(event) =>
                                    void setSender(selected, key, event.target.checked)
                                  }
                                />
                                <span>
                                  {sender.name}
                                  {!key.startsWith('teams:') &&
                                    sender.name.toLowerCase() !== key && <small> — {key}</small>}
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </dd>
                    </div>
                  )
                })()}
              </>
            )}
          </dl>
          <section className="task-manager-history">
            <div className="task-manager-panel-title">
              <span>{t('vue.historique')}</span>
              <small>{occurrences.length}</small>
            </div>
            {occurrences.length === 0 ? (
              <p className="task-manager-muted">{t('vue.historique.vide')}</p>
            ) : (
              occurrences.map((occurrence) => (
                <div className="task-manager-occurrence" key={occurrence.id}>
                  {/* Le code brut du statut (running, failed…) : une valeur technique, non traduite. */}
                  <span className={`status-${occurrence.status}`}>{occurrence.status}</span>
                  <strong>
                    {formatDateTime(occurrence.scheduledFor)} · {modeLabel(occurrence.mode)}
                  </strong>
                  <small data-testid="task-manager-occurrence-meta">
                    {occurrenceMeta(occurrence).join(' · ') || t('vue.historique.tourChat')}
                  </small>
                  {occurrence.status === 'failed' && (
                    <span className="task-manager-occurrence-actions">
                      <button
                        type="button"
                        className="task-manager-occurrence-open"
                        data-testid="task-manager-occurrence-replay"
                        disabled={saving}
                        onClick={() => void runNow(selected)}
                      >
                        {t('vue.historique.rejouer')}
                      </button>
                      <button
                        type="button"
                        className="task-manager-occurrence-open"
                        data-testid="task-manager-occurrence-replay-fixed"
                        onClick={() => openFixAfterFailure(selected, occurrence)}
                      >
                        {t('vue.historique.rejouerCorrige')}
                      </button>
                    </span>
                  )}
                  {occurrence.conversationId && (
                    <button
                      className="task-manager-occurrence-open"
                      data-testid="task-manager-occurrence-open"
                      onClick={() =>
                        onOpenConversation?.({
                          conversationId: occurrence.conversationId!,
                          ...(occurrence.turnId ? { turnId: occurrence.turnId } : {})
                        })
                      }
                      title={t('vue.historique.conversation', { id: occurrence.conversationId })}
                      type="button"
                    >
                      {t('vue.historique.ouvrir')}
                    </button>
                  )}
                </div>
              ))
            )}
          </section>
        </>
      ) : loading ? (
        <div className="task-manager-empty is-detail" data-testid="task-manager-loading">
          <Spinner />
          <strong>{t('vue.chargement')}</strong>
        </div>
      ) : (
        <div className="task-manager-empty is-detail">
          <span aria-hidden="true">◷</span>
          <strong>{t('vue.vide.selection')}</strong>
          <p>{t('vue.vide.selectionDetail')}</p>
        </div>
      )}
    </main>
  )

  return (
    <section className="view-page task-manager-view" data-testid="task-manager-view">
      <ViewTopBar
        eyebrow={t('vue.entete.surtitre')}
        // « Task Manager », « Watchdog » : noms de l'écran et de la fonction, les mêmes en anglais.
        title="Task Manager"
        description={t('vue.entete.description')}
        ariaLabel={t('vue.entete.sections')}
        active={sectionActive}
        onSelect={changerSection}
        tabs={[
          { id: 'watchdog', label: 'Watchdog' },
          { id: 'planification', label: t('vue.planification') }
        ]}
        actions={
          <div className="task-manager-head-actions">
            <span
              className={`task-manager-health ${snapshot.scheduler.running ? 'is-ok' : 'is-error'}`}
            >
              {snapshot.scheduler.running ? t('vue.scheduler.actif') : t('vue.scheduler.arrete')}
            </span>
            <span
              className={`task-manager-health ${
                snapshot.scheduler.relayAvailable ? 'is-ok' : 'is-warn'
              }`}
              title={snapshot.scheduler.relayError}
            >
              {snapshot.scheduler.relayAvailable ? t('vue.relais.pret') : t('vue.relais.aVerifier')}
            </span>
            <button
              type="button"
              className="task-manager-primary"
              disabled={loading}
              onClick={openCreate}
            >
              {t('vue.nouvelleTache')}
            </button>
          </div>
        }
      />

      {sectionActive === 'watchdog' && (
        <div className="task-manager-watchdog-split">
        <aside className="task-manager-watchdog-aside">
        <WatchdogAgentsSection
          tasks={snapshot.tasks satisfies WatchdogTaskLike[]}
          occurrences={snapshot.occurrences satisfies WatchdogOccurrenceLike[]}
          formatDateTime={formatDateTime}
          onCreate={() => {
            setEditingId(undefined)
            setSelectedId(undefined)
            setDraft({
              ...defaultDraft(conversations, selectableModels[0]),
              watchdog: { source: { ...DEFAULT_FILE_SOURCE }, guards: { ...DEFAULT_DRAFT_GUARDS } }
            })
          }}
          // Chaque onglet gère ses propres règles : le détail et l'éditeur d'une règle de réveil
          // s'ouvrent ici, sans basculer vers Planification (qui ne liste plus ces règles).
          onSelect={(id) => setSelectedId(id)}
          onConfigure={(id) => {
            const task = snapshot.tasks.find((candidate) => candidate.id === id)
            if (!task) return
            setSelectedId(id)
            openEdit(task)
          }}
        />
        </aside>
        {(draft || selected?.watchdog) && (
          <div className="task-manager-layout is-single" data-testid="task-manager-watchdog-detail">
            {renderDetail(selected?.watchdog ? selected : undefined)}
          </div>
        )}
        </div>
      )}

      <div className="task-manager-stats">
        <span>
          <strong>{snapshot.tasks.length}</strong> {t('vue.stats.taches')}
        </span>
        <span>
          <strong>{snapshot.tasks.filter(({ enabled }) => enabled).length}</strong>{' '}
          {t('vue.stats.actives')}
        </span>
        {runningTaskIds.size > 0 && (
          <span className="task-manager-running" data-testid="task-manager-running-count">
            <strong>{runningTaskIds.size}</strong> {t('vue.stats.enCours')}
          </span>
        )}
        <span className={openAlerts.length ? 'has-alerts' : ''}>
          <strong>{openAlerts.length}</strong> {t('vue.stats.alertes')}
        </span>
        <span className="task-manager-next">
          {t('vue.stats.prochainReveil')} ·{' '}
          <strong>{formatDateTime(snapshot.scheduler.nextWakeAt)}</strong>
        </span>
      </div>

      {failedScopes.map((scope) => (
        <div
          key={scope}
          className="task-manager-error"
          role="alert"
          data-testid="task-manager-load-error"
        >
          <strong>{loadErrorTitleOf(scope)}</strong>
          <span>{loadErrors[scope]}</span>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              if (scope === 'task-manager') void refreshSnapshot()
              else if (scope === 'conversations') void refreshConversations()
              else void refreshModels()
            }}
          >
            {t('vue.reessayer')}
          </button>
        </div>
      ))}

      {error && (
        <div className="task-manager-error" role="alert">
          <strong>{t('vue.actionImpossible')}</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setError(undefined)}>
            {t('vue.fermer')}
          </button>
        </div>
      )}

      {sectionActive === 'planification' && (
        <div className="task-manager-layout">
          <aside className="task-manager-list" aria-label={t('vue.liste.aria')}>
            <div className="task-manager-panel-title">
              <span>{t('vue.planification')}</span>
              <button type="button" onClick={() => void load()} disabled={loading}>
                {loading ? '…' : t('vue.liste.actualiser')}
              </button>
            </div>
            {loading ? (
              <div className="task-manager-empty" data-testid="task-manager-loading">
                <Spinner />
                <strong>{t('vue.chargement')}</strong>
              </div>
            ) : scheduledTasks.length === 0 ? (
              <div className="task-manager-empty">
                <span aria-hidden="true">◷</span>
                <strong>{t('vue.liste.vide')}</strong>
                <p>{t('vue.liste.videDetail')}</p>
                <button type="button" disabled={loading} onClick={openCreate}>
                  {t('vue.liste.creerPremiere')}
                </button>
              </div>
            ) : (
              scheduledTasks.map((task) => (
                <button
                  type="button"
                  key={task.id}
                  className={`task-manager-row${selectedId === task.id ? ' is-selected' : ''}${
                    task.enabled ? '' : ' is-disabled'
                  }`}
                  onClick={() => setSelectedId(task.id)}
                >
                  <span className={`task-manager-dot mode-${task.mode}`} />
                  <span className="task-manager-row-main">
                    <strong>{task.title}</strong>
                    <small>{formatDateTime(task.nextRunAt)}</small>
                  </span>
                  <span className="task-manager-row-meta">
                    {runningTaskIds.has(task.id) && (
                      <em className="task-manager-running" data-testid="task-manager-row-running">
                        {t('vue.liste.enCours')}
                      </em>
                    )}
                    {/* ON/OFF, WIN/APP : des pastilles techniques, les mêmes dans les deux langues. */}
                    <b>{task.enabled ? 'ON' : 'OFF'}</b>
                    <small>{task.mode === 'windows' ? 'WIN' : 'APP'}</small>
                  </span>
                </button>
              ))
            )}
          </aside>

          {renderDetail(selected?.watchdog ? undefined : selected)}

          <aside className="task-manager-alerts" aria-label={t('vue.alertes.aria')}>
            <div className="task-manager-panel-title">
              <span>{t('vue.alertes')}</span>
              <b>{openAlerts.length}</b>
            </div>
            {visibleAlerts.length === 0 ? (
              <div className="task-manager-alert-empty">
                <span>✓</span>
                <p>{t('vue.alertes.vide')}</p>
              </div>
            ) : (
              visibleAlerts.map((alert) => (
                <article
                  key={alert.id}
                  className={`task-manager-alert${alert.acknowledgedAt ? ' is-acknowledged' : ''}`}
                >
                  <header>
                    <strong>
                      {alert.kind === 'missed'
                        ? t('vue.alertes.manquee')
                        : t('vue.alertes.echouee')}
                    </strong>
                    <time>{formatDateTime(alert.createdAt)}</time>
                  </header>
                  <button
                    type="button"
                    className="task-manager-alert-task"
                    data-testid="task-manager-alert-select"
                    onClick={() => setSelectedId(alert.taskId)}
                  >
                    {snapshot.tasks.find(({ id }) => id === alert.taskId)?.title ??
                      t('vue.alertes.tacheSupprimee')}
                  </button>
                  <p>{alert.message}</p>
                  {!alert.acknowledgedAt && (
                    <button type="button" onClick={() => void acknowledge(alert.id)}>
                      {t('vue.alertes.acquitter')}
                    </button>
                  )}
                </article>
              ))
            )}
            {snapshot.scheduler.relayError && (
              <article className="task-manager-alert">
                <header>
                  <strong>{t('vue.alertes.relaisIndisponible')}</strong>
                </header>
                <p>{snapshot.scheduler.relayError}</p>
              </article>
            )}
          </aside>
        </div>
      )}
    </section>
  )
}
