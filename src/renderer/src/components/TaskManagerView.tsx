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
import './ViewPage.css'
import './TaskManagerView.css'

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
type ConversationSummary = Pick<StoreConversationSummary, 'id' | 'title' | 'category' | 'provider'>

const WEEK_DAYS = [
  { value: 1, label: 'L' },
  { value: 2, label: 'M' },
  { value: 3, label: 'M' },
  { value: 4, label: 'J' },
  { value: 5, label: 'V' },
  { value: 6, label: 'S' },
  { value: 7, label: 'D' }
]

const EFFORT_LABELS: Record<string, string> = {
  none: 'Aucun',
  minimal: 'Minimal',
  low: 'Léger',
  medium: 'Moyen',
  high: 'Élevé',
  xhigh: 'Très élevé',
  max: 'Max',
  ultra: 'Ultra'
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
          title: 'Tâche planifiée',
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
  if (!value) return 'Aucune échéance'
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(value)
}

function recurrenceLabel(schedule: TaskSchedule): string {
  const { unit, interval, weekDays } = schedule.recurrence
  if (unit === 'none') return 'Une fois'
  if (unit === 'minute') return interval === 1 ? 'Chaque minute' : `Toutes les ${interval} minutes`
  if (unit === 'hour') return interval === 1 ? 'Chaque heure' : `Toutes les ${interval} heures`
  if (unit === 'day') return interval === 1 ? 'Chaque jour' : `Tous les ${interval} jours`
  if (unit === 'month') return interval === 1 ? 'Chaque mois' : `Tous les ${interval} mois`
  const days = (weekDays ?? []).map((day) => WEEK_DAYS[day - 1]?.label).join(' · ')
  return `${interval === 1 ? 'Chaque semaine' : `Toutes les ${interval} semaines`} · ${days}`
}

function modeLabel(mode: ExecutionMode | 'legacy-unknown'): string {
  if (mode === 'legacy-unknown') return 'Mode non archivé'
  return mode === 'windows' ? 'Autonome Windows' : 'Autowin actif uniquement'
}

const TRIGGER_LABELS: Record<string, string> = {
  schedule: 'Horaire',
  manual: 'Manuel',
  watchdog: 'Réveil'
}

const OUTCOME_LABELS: Record<string, string> = {
  benign: 'Bénin',
  report: 'À signaler',
  investigate: 'À investiguer',
  repair: 'Réparation'
}

/** Durée réellement mesurée : sans les deux bornes, on n'affiche rien plutôt qu'un chiffre inventé. */
function durationLabel(startedAt?: number, finishedAt?: number): string | null {
  if (!startedAt || !finishedAt || finishedAt < startedAt) return null
  const seconds = Math.round((finishedAt - startedAt) / 1000)
  if (seconds < 60) return `Durée ${seconds} s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `Durée ${minutes} min${rest ? ` ${rest} s` : ''}`
  const hours = Math.floor(minutes / 60)
  return `Durée ${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`
}

function usageMeta(usage: {
  knownCostUsd?: number
  totalTokens?: number
  unpricedCalls?: number
}): string[] {
  const meta: string[] = []
  if (typeof usage.knownCostUsd === 'number') {
    meta.push(
      `${usage.knownCostUsd.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $ connus`
    )
  }
  if (typeof usage.totalTokens === 'number') {
    meta.push(`${usage.totalTokens.toLocaleString('fr-FR')} tokens`)
  }
  if (usage.unpricedCalls) {
    meta.push(
      `${usage.unpricedCalls} appel${usage.unpricedCalls > 1 ? 's' : ''} non chiffré${usage.unpricedCalls > 1 ? 's' : ''}`
    )
  }
  return meta
}

/** Les métadonnées DÉJÀ stockées, dans l'ordre de lecture. Une valeur absente est omise, pas devinée. */
function occurrenceMeta(occurrence: TaskOccurrence): string[] {
  const meta: string[] = []
  if (occurrence.error) meta.push(occurrence.error)
  if (occurrence.outcome && OUTCOME_LABELS[occurrence.outcome])
    meta.push(OUTCOME_LABELS[occurrence.outcome])
  if (occurrence.trigger && TRIGGER_LABELS[occurrence.trigger])
    meta.push(TRIGGER_LABELS[occurrence.trigger])
  const duration = durationLabel(occurrence.startedAt, occurrence.finishedAt)
  if (duration) meta.push(duration)
  if (occurrence.requestedModel) meta.push(`Modèle demandé : ${occurrence.requestedModel}`)
  if (occurrence.resolvedModel) meta.push(`Modèle exécuté : ${occurrence.resolvedModel}`)
  meta.push(
    ...usageMeta({
      knownCostUsd: occurrence.knownCostUsd,
      totalTokens: occurrence.totalTokens,
      unpricedCalls: occurrence.unpricedCalls
    })
  )
  if (occurrence.missedCount && occurrence.missedCount > 1)
    meta.push(`${occurrence.missedCount} échéances agrégées`)
  const context = occurrence.watchdog?.context?.trim()
  if (context) meta.push(`Signal : ${context.slice(0, 160)}`)
  return meta
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Opération impossible.'
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
    scope === 'roles'
      ? 'Chargement des modèles impossible'
      : scope === 'conversations'
        ? 'Chargement des conversations impossible'
        : 'Chargement des tâches impossible'

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
      `Dernier échec : ${occurrence.error ?? 'erreur non enregistrée'} — corrige le prompt puis enregistre.`
    )
  }

  const closeEditor = (): void => {
    setDraft(undefined)
    setEditingId(undefined)
    setError(undefined)
  }

  const save = async (): Promise<void> => {
    if (!draft || !draft.title.trim() || !draft.prompt.trim()) {
      setError('Le titre et le prompt sont obligatoires.')
      return
    }
    if (!modelCatalogReady || !hasLoadedModel(draft.destination, models)) {
      setError('Choisis un modèle chargé dans Agent Studio pour cette tâche.')
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

  const removeTask = async (task: ScheduledTask): Promise<void> => {
    if (!window.confirm(`Supprimer définitivement « ${task.title} » ?`)) return
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
      if (!result.started) setError('La tâche n’a pas pu démarrer.')
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

  return (
    <section className="view-page task-manager-view" data-testid="task-manager-view">
      <ViewTopBar
        eyebrow="AUTOMATISATION"
        title="Task Manager"
        description="Planifie de vrais prompts Chat, visibles et traçables comme tes envois manuels."
        ariaLabel="Sections Task Manager"
        active={sectionActive}
        onSelect={changerSection}
        tabs={[
          { id: 'watchdog', label: 'Watchdog' },
          { id: 'planification', label: 'Planification' }
        ]}
        actions={
          <div className="task-manager-head-actions">
            <span
              className={`task-manager-health ${snapshot.scheduler.running ? 'is-ok' : 'is-error'}`}
            >
              {snapshot.scheduler.running ? 'Scheduler actif' : 'Scheduler arrêté'}
            </span>
            <span
              className={`task-manager-health ${
                snapshot.scheduler.relayAvailable ? 'is-ok' : 'is-warn'
              }`}
              title={snapshot.scheduler.relayError}
            >
              {snapshot.scheduler.relayAvailable ? 'Relais Windows prêt' : 'Relais à vérifier'}
            </span>
            <button
              type="button"
              className="task-manager-primary"
              disabled={loading}
              onClick={openCreate}
            >
              + Nouvelle tâche
            </button>
          </div>
        }
      />

      {sectionActive === 'watchdog' && (
        <WatchdogAgentsSection
          tasks={snapshot.tasks satisfies WatchdogTaskLike[]}
          occurrences={snapshot.occurrences satisfies WatchdogOccurrenceLike[]}
          formatDateTime={formatDateTime}
          onCreate={openCreate}
          // LE LIEN PRÉSERVÉ. Le détail d'une tâche vit côté planification : sélectionner sans
          // basculer aurait ouvert un détail invisible, et le geste le plus utile de la vue serait
          // devenu un clic sans effet. On sélectionne ET on change de section.
          onSelect={(id) => {
            setSelectedId(id)
            changerSection('planification')
          }}
        />
      )}

      <div className="task-manager-stats">
        <span>
          <strong>{snapshot.tasks.length}</strong> tâches
        </span>
        <span>
          <strong>{snapshot.tasks.filter(({ enabled }) => enabled).length}</strong> actives
        </span>
        {runningTaskIds.size > 0 && (
          <span className="task-manager-running" data-testid="task-manager-running-count">
            <strong>{runningTaskIds.size}</strong> en cours
          </span>
        )}
        <span className={openAlerts.length ? 'has-alerts' : ''}>
          <strong>{openAlerts.length}</strong> alertes
        </span>
        <span className="task-manager-next">
          Prochain réveil · <strong>{formatDateTime(snapshot.scheduler.nextWakeAt)}</strong>
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
            Réessayer
          </button>
        </div>
      ))}

      {error && (
        <div className="task-manager-error" role="alert">
          <strong>Action impossible</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setError(undefined)}>
            Fermer
          </button>
        </div>
      )}

      {sectionActive === 'planification' && (
        <div className="task-manager-layout">
          <aside className="task-manager-list" aria-label="Tâches planifiées">
            <div className="task-manager-panel-title">
              <span>Planification</span>
              <button type="button" onClick={() => void load()} disabled={loading}>
                {loading ? '…' : 'Actualiser'}
              </button>
            </div>
            {loading ? (
              <div className="task-manager-empty" data-testid="task-manager-loading">
                <span aria-hidden="true">◷</span>
                <strong>Chargement des tâches…</strong>
              </div>
            ) : snapshot.tasks.length === 0 ? (
              <div className="task-manager-empty">
                <span aria-hidden="true">◷</span>
                <strong>Aucune tâche</strong>
                <p>Crée un prompt, choisis son horaire et sa conversation.</p>
                <button type="button" disabled={loading} onClick={openCreate}>
                  Créer la première
                </button>
              </div>
            ) : (
              snapshot.tasks.map((task) => (
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
                        En cours
                      </em>
                    )}
                    <b>{task.enabled ? 'ON' : 'OFF'}</b>
                    <small>{task.mode === 'windows' ? 'WIN' : 'APP'}</small>
                  </span>
                </button>
              ))
            )}
          </aside>

          <main className="task-manager-detail">
            {draft ? (
              <div className="task-manager-editor">
                <div className="task-manager-panel-title">
                  <span>{editingId ? 'Modifier la tâche' : 'Nouvelle tâche'}</span>
                  <button type="button" onClick={closeEditor}>
                    Annuler
                  </button>
                </div>
                <div className="task-manager-form-grid">
                  <label className="task-manager-field is-wide">
                    <span>Titre</span>
                    <input
                      name="title"
                      value={draft.title}
                      placeholder="Ex. Veille concurrentielle"
                      onChange={(event) =>
                        setDraft((current) =>
                          current ? { ...current, title: event.target.value } : current
                        )
                      }
                    />
                  </label>
                  <label className="task-manager-field is-wide">
                    <span>Prompt envoyé</span>
                    <textarea
                      name="prompt"
                      value={draft.prompt}
                      rows={5}
                      placeholder="Décris exactement ce que le modèle doit faire…"
                      onChange={(event) =>
                        setDraft((current) =>
                          current ? { ...current, prompt: event.target.value } : current
                        )
                      }
                    />
                  </label>
                  <label className="task-manager-field">
                    <span>Mode d’exécution</span>
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
                      <option value="active-only">Autowin actif uniquement</option>
                      <option value="windows">Autonome Windows · réveille le PC</option>
                    </select>
                  </label>
                  <label className="task-manager-field">
                    <span>Destination</span>
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
                                        title: current.title || 'Tâche planifiée',
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
                      <option value="existing">Conversation existante</option>
                      <option
                        value="new"
                        disabled={!modelCatalogReady || selectableModels.length === 0}
                      >
                        Nouvelle conversation dédiée
                      </option>
                    </select>
                  </label>
                  {draft.destination.kind === 'existing' ? (
                    <label className="task-manager-field is-wide">
                      <span>Conversation ciblée</span>
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
                      <span>Nom de la conversation</span>
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
                    <span>Modèle</span>
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
                          {draft.destination.model} · indisponible
                        </option>
                      )}
                      {!draftModelId && !draft.destination.model && selectableModels.length > 0 && (
                        <option value="" disabled>
                          Choisir un modèle
                        </option>
                      )}
                      {selectableModels.length === 0 && !draft.destination.model && (
                        <option value="">Aucun modèle chargé dans Agent Studio</option>
                      )}
                      {selectableModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label ?? model.model} · {model.provider}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="task-manager-field">
                    <span>Effort</span>
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
                          {EFFORT_LABELS[effort] ?? effort}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="task-manager-field task-manager-field-wide">
                    <span>Déclencheur</span>
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
                      <option value="schedule">À une heure (planifié)</option>
                      <option value="watchdog">Sur événement (Watchdog Agent)</option>
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
                        <span>Date de départ</span>
                        <input
                          type="date"
                          value={draft.schedule.startDate}
                          onChange={(event) => setSchedule({ startDate: event.target.value })}
                        />
                      </label>
                      <label className="task-manager-field">
                        <span>Heure</span>
                        <input
                          type="time"
                          value={draft.schedule.time}
                          onChange={(event) => setSchedule({ time: event.target.value })}
                        />
                      </label>
                      <label className="task-manager-field">
                        <span>Répétition</span>
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
                          <option value="none">Aucune</option>
                          <option value="minute">Minute(s)</option>
                          <option value="hour">Heure(s)</option>
                          <option value="day">Jour(s)</option>
                          <option value="week">Semaine(s)</option>
                          <option value="month">Mois</option>
                        </select>
                      </label>
                      {draft.schedule.recurrence.unit !== 'none' && (
                        <label className="task-manager-field">
                          <span>Intervalle</span>
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
                          <legend>Jours</legend>
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
                                {day.label}
                              </label>
                            )
                          })}
                        </fieldset>
                      )}
                      <label className="task-manager-field">
                        <span>Date de fin · optionnelle</span>
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
                    <span>Activer dès l’enregistrement</span>
                  </label>
                </div>
                <div className="task-manager-form-actions">
                  <span>
                    {draft.mode === 'windows'
                      ? 'Windows réveillera le PC. Aucun rattrapage tardif.'
                      : 'S’exécute tant que le processus Autowin reste actif, même dans le tray.'}
                  </span>
                  <button
                    type="button"
                    className="task-manager-primary"
                    disabled={
                      saving || !modelCatalogReady || !hasLoadedModel(draft.destination, models)
                    }
                    onClick={() => void save()}
                  >
                    {saving ? 'Enregistrement…' : editingId ? 'Enregistrer' : 'Créer la tâche'}
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
                          : 'Déclencheur invalide'}
                    </p>
                  </div>
                  <div className="task-manager-detail-actions">
                    <button type="button" onClick={() => openEdit(selected)}>
                      Modifier
                    </button>
                    <button
                      type="button"
                      disabled={saving || !selected.enabled}
                      onClick={() => void runNow(selected)}
                    >
                      Lancer maintenant
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateTask(selected, { enabled: !selected.enabled })}
                    >
                      {selected.enabled ? 'Désactiver' : 'Activer'}
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      disabled={saving || taskIsRunning}
                      title={
                        taskIsRunning
                          ? 'Cette tâche est en cours et ne peut pas être supprimée.'
                          : undefined
                      }
                      onClick={() => void removeTask(selected)}
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
                <div className="task-manager-prompt">
                  <span>Prompt envoyé</span>
                  <p>{selected.prompt}</p>
                </div>
                <dl className="task-manager-facts">
                  <div>
                    <dt>Prochaine échéance</dt>
                    <dd>{formatDateTime(selected.nextRunAt)}</dd>
                  </div>
                  <div>
                    <dt>Destination</dt>
                    <dd>
                      {selected.destination.kind === 'existing'
                        ? (conversations.find(
                            ({ id }) => id === selected.destination.conversationId
                          )?.title ?? selected.destination.conversationId)
                        : selected.destination.conversationId
                          ? `Conversation dédiée · ${selected.destination.title}`
                          : `Nouvelle conversation · ${selected.destination.title}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Répétition</dt>
                    <dd>
                      {selected.schedule
                        ? recurrenceLabel(selected.schedule)
                        : selected.watchdog
                          ? describeWatchdogSource(selected.watchdog.source)
                          : 'Inconnu'}
                    </dd>
                  </div>
                  <div>
                    <dt>État</dt>
                    <dd>{selected.enabled ? 'Active' : 'Désactivée'}</dd>
                  </div>
                  {selected.watchdog && (
                    <>
                      <div>
                        <dt>Activité watchdog</dt>
                        <dd>
                          {snapshot.watchdogs?.[selected.id]?.admittedLastHour ?? 0} réveils sur la
                          dernière heure
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
                            <dt>Coût dernière heure</dt>
                            <dd>{recentUsage.join(' · ')}</dd>
                          </div>
                        ) : null
                      })()}
                      {snapshot.watchdogs?.[selected.id]?.complaint && (
                        <div>
                          <dt>Diagnostic</dt>
                          <dd>{snapshot.watchdogs[selected.id].complaint}</dd>
                        </div>
                      )}
                    </>
                  )}
                </dl>
                <section className="task-manager-history">
                  <div className="task-manager-panel-title">
                    <span>Historique des occurrences</span>
                    <small>{occurrences.length}</small>
                  </div>
                  {occurrences.length === 0 ? (
                    <p className="task-manager-muted">Aucune exécution pour le moment.</p>
                  ) : (
                    occurrences.map((occurrence) => (
                      <div className="task-manager-occurrence" key={occurrence.id}>
                        <span className={`status-${occurrence.status}`}>{occurrence.status}</span>
                        <strong>
                          {formatDateTime(occurrence.scheduledFor)} · {modeLabel(occurrence.mode)}
                        </strong>
                        <small data-testid="task-manager-occurrence-meta">
                          {occurrenceMeta(occurrence).join(' · ') || 'Tour Chat'}
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
                              Rejouer
                            </button>
                            <button
                              type="button"
                              className="task-manager-occurrence-open"
                              data-testid="task-manager-occurrence-replay-fixed"
                              onClick={() => openFixAfterFailure(selected, occurrence)}
                            >
                              Rejouer avec prompt corrigé
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
                            title={`Conversation ${occurrence.conversationId}`}
                            type="button"
                          >
                            Ouvrir la conversation
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </section>
              </>
            ) : loading ? (
              <div className="task-manager-empty is-detail" data-testid="task-manager-loading">
                <span aria-hidden="true">◷</span>
                <strong>Chargement des tâches…</strong>
              </div>
            ) : (
              <div className="task-manager-empty is-detail">
                <span aria-hidden="true">◷</span>
                <strong>Sélectionne ou crée une tâche</strong>
                <p>Les prompts planifiés apparaîtront ici avec leur historique complet.</p>
              </div>
            )}
          </main>

          <aside className="task-manager-alerts" aria-label="Alertes Task Manager">
            <div className="task-manager-panel-title">
              <span>Alertes</span>
              <b>{openAlerts.length}</b>
            </div>
            {visibleAlerts.length === 0 ? (
              <div className="task-manager-alert-empty">
                <span>✓</span>
                <p>Aucune alerte ouverte.</p>
              </div>
            ) : (
              visibleAlerts.map((alert) => (
                <article
                  key={alert.id}
                  className={`task-manager-alert${alert.acknowledgedAt ? ' is-acknowledged' : ''}`}
                >
                  <header>
                    <strong>
                      {alert.kind === 'missed' ? 'Échéance manquée' : 'Exécution échouée'}
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
                      'Tâche supprimée'}
                  </button>
                  <p>{alert.message}</p>
                  {!alert.acknowledgedAt && (
                    <button type="button" onClick={() => void acknowledge(alert.id)}>
                      Acquitter
                    </button>
                  )}
                </article>
              ))
            )}
            {snapshot.scheduler.relayError && (
              <article className="task-manager-alert">
                <header>
                  <strong>Relais Windows indisponible</strong>
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
