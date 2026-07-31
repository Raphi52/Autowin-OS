import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ModuleHeader } from './ModuleHeader'
import type { RuntimeModel } from './chat-view-model'
import './TaskManagerView.css'

type ExecutionMode = 'windows' | 'active-only'
type RecurrenceUnit = 'none' | 'day' | 'week' | 'month'

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
      authorityMode?: 'plan' | 'ask' | 'auto'
      conversationId?: string
    }

interface TaskDraft {
  title: string
  prompt: string
  enabled: boolean
  mode: ExecutionMode
  destination: TaskDestination
  schedule: TaskSchedule
}

interface ScheduledTask extends TaskDraft {
  id: string
  nextRunAt: number | null
  createdAt: number
  updatedAt: number
}

interface TaskOccurrence {
  id: string
  taskId: string
  scheduledFor: number
  status: string
  conversationId?: string
  error?: string
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
  scheduler: {
    running: boolean
    nextWakeAt: number | null
    relayAvailable: boolean
    relayError?: string
  }
}

interface ConversationSummary {
  id: string
  title: string
  category: string
  provider: string
}

const WEEK_DAYS = [
  { value: 1, label: 'L' },
  { value: 2, label: 'M' },
  { value: 3, label: 'M' },
  { value: 4, label: 'J' },
  { value: 5, label: 'V' },
  { value: 6, label: 'S' },
  { value: 7, label: 'D' }
]

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

function defaultDraft(conversations: ConversationSummary[], selectedModel?: RuntimeModel): TaskDraft {
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
            : {}),
          authorityMode: 'auto'
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
  if (unit === 'day') return interval === 1 ? 'Chaque jour' : `Tous les ${interval} jours`
  if (unit === 'month') return interval === 1 ? 'Chaque mois' : `Tous les ${interval} mois`
  const days = (weekDays ?? []).map((day) => WEEK_DAYS[day - 1]?.label).join(' · ')
  return `${interval === 1 ? 'Chaque semaine' : `Toutes les ${interval} semaines`} · ${days}`
}

function modeLabel(mode: ExecutionMode): string {
  return mode === 'windows' ? 'Autonome Windows' : 'Autowin actif uniquement'
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Opération impossible.'
}

function hasLoadedModel(destination: TaskDestination, models: RuntimeModel[]): boolean {
  return models.some(
    (candidate) =>
      candidate.provider === destination.provider && candidate.model === destination.model
  )
}

function modelDisplayKey(model: RuntimeModel): string {
  return `${model.provider}\u0000${model.label ?? model.model}`
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

export function TaskManagerView({ active }: { active: boolean }): React.JSX.Element {
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
  const [catalogActive, setCatalogActive] = useState(active)
  const [catalogReady, setCatalogReady] = useState(false)
  const loadGenerationRef = useRef(0)
  const modelCatalogReady = active && catalogReady && !loading

  if (catalogActive !== active) {
    setCatalogActive(active)
    setCatalogReady(false)
  }

  const load = useCallback(async (): Promise<void> => {
    const generation = ++loadGenerationRef.current
    setLoading(true)
    setCatalogReady(false)
    setError(undefined)
    setModels([])
    try {
      const [rawSnapshot, rawConversations, rawModels] = await Promise.all([
        window.api.taskManagerSnapshot(),
        window.api.conversations(),
        window.api.models().catch(() => [])
      ])
      if (generation !== loadGenerationRef.current) return
      const nextSnapshot = rawSnapshot as unknown as Snapshot
      const nextConversations = rawConversations as ConversationSummary[]
      setSnapshot(nextSnapshot)
      setConversations(nextConversations)
      setModels(rawModels as RuntimeModel[])
      setCatalogReady(true)
      setSelectedId((current) =>
        current && nextSnapshot.tasks.some(({ id }) => id === current)
          ? current
          : nextSnapshot.tasks[0]?.id
      )
    } catch (failure) {
      if (generation !== loadGenerationRef.current) return
      setModels([])
      setCatalogReady(false)
      setError(errorText(failure))
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    void Promise.resolve().then(load)
    const off = window.api.onAppEvent((event) => {
      if (event.type === 'refresh' && (event.scope === 'task-manager' || event.scope === 'roles'))
        void load()
    })
    return () => {
      loadGenerationRef.current += 1
      off()
    }
  }, [active, load])

  const selected = snapshot.tasks.find(({ id }) => id === selectedId)
  const selectableModels = useMemo(
    () =>
      uniqueModelsForPicker(models).sort(
        (left, right) =>
          left.provider.localeCompare(right.provider) ||
          (left.label ?? left.model).localeCompare(right.label ?? right.model)
      ),
    [models]
  )
  const occurrences = useMemo(
    () => snapshot.occurrences.filter(({ taskId }) => taskId === selectedId),
    [selectedId, snapshot.occurrences]
  )
  const openAlerts = snapshot.alerts.filter(({ acknowledgedAt }) => !acknowledgedAt)
  const selectedAlerts = snapshot.alerts.filter(({ taskId }) => taskId === selectedId)
  const draftDestination = draft?.destination
  const draftModelId =
    draftDestination
      ? (() => {
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

  const openCreate = (): void => {
    setEditingId(undefined)
    setDraft(defaultDraft(conversations, selectableModels[0]))
  }

  const openEdit = (task: ScheduledTask): void => {
    setEditingId(task.id)
    setDraft(structuredClone(task))
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
    if (
      !modelCatalogReady ||
      !hasLoadedModel(draft.destination, models)
    ) {
      setError('Choisis un modèle chargé dans Agent Studio pour cette tâche.')
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      if (editingId) await window.api.taskManagerUpdate(editingId, draft)
      else await window.api.taskManagerCreate(draft)
      closeEditor()
      await load()
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
      await load()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setSaving(false)
    }
  }

  const removeTask = async (task: ScheduledTask): Promise<void> => {
    if (!window.confirm(`Supprimer définitivement « ${task.title} » ?`)) return
    await window.api.taskManagerRemove(task.id)
    if (editingId === task.id) closeEditor()
    await load()
  }

  const runNow = async (task: ScheduledTask): Promise<void> => {
    setSaving(true)
    setError(undefined)
    try {
      const result = await window.api.taskManagerRunNow(task.id)
      if (!result.started) setError('La tâche n’a pas pu démarrer.')
      await load()
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setSaving(false)
    }
  }

  const acknowledge = async (alertId: string): Promise<void> => {
    await window.api.taskManagerAcknowledge(alertId)
    await load()
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
    <section className="task-manager-view" data-testid="task-manager-view">
      <header className="task-manager-head">
        <div>
          <ModuleHeader eyebrow="AUTOMATISATION" title="Task Manager" />
          <p className="task-manager-description">
            Planifie de vrais prompts Chat, visibles et traçables comme tes envois manuels.
          </p>
        </div>
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
      </header>

      <div className="task-manager-stats">
        <span>
          <strong>{snapshot.tasks.length}</strong> tâches
        </span>
        <span>
          <strong>{snapshot.tasks.filter(({ enabled }) => enabled).length}</strong> actives
        </span>
        <span className={openAlerts.length ? 'has-alerts' : ''}>
          <strong>{openAlerts.length}</strong> alertes
        </span>
        <span className="task-manager-next">
          Prochain réveil · <strong>{formatDateTime(snapshot.scheduler.nextWakeAt)}</strong>
        </span>
      </div>

      {error && (
        <div className="task-manager-error" role="alert">
          <strong>Action impossible</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setError(undefined)}>
            Fermer
          </button>
        </div>
      )}

      <div className="task-manager-layout">
        <aside className="task-manager-list" aria-label="Tâches planifiées">
          <div className="task-manager-panel-title">
            <span>Planification</span>
            <button type="button" onClick={() => void load()} disabled={loading}>
              {loading ? '…' : 'Actualiser'}
            </button>
          </div>
          {snapshot.tasks.length === 0 ? (
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
                                        : {}),
                                      authorityMode: 'auto'
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
                    {!draftModelId && draft.destination.model && (
                      <option value="" disabled>
                        {draft.destination.model} · indisponible
                      </option>
                    )}
                    {!draftModelId &&
                      !draft.destination.model &&
                      selectableModels.length > 0 && (
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
                    onChange={(event) => setSchedule({ endDate: event.target.value || undefined })}
                  />
                </label>
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
                    saving ||
                    !modelCatalogReady ||
                    !hasLoadedModel(draft.destination, models)
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
                    {recurrenceLabel(selected.schedule)} · {selected.schedule.timeZone}
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
                      ? (conversations.find(({ id }) => id === selected.destination.conversationId)
                          ?.title ?? selected.destination.conversationId)
                      : selected.destination.conversationId
                        ? `Conversation dédiée · ${selected.destination.title}`
                        : `Nouvelle conversation · ${selected.destination.title}`}
                  </dd>
                </div>
                <div>
                  <dt>Répétition</dt>
                  <dd>{recurrenceLabel(selected.schedule)}</dd>
                </div>
                <div>
                  <dt>État</dt>
                  <dd>{selected.enabled ? 'Active' : 'Désactivée'}</dd>
                </div>
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
                      <strong>{formatDateTime(occurrence.scheduledFor)}</strong>
                      <small>{occurrence.error ?? occurrence.conversationId ?? 'Tour Chat'}</small>
                    </div>
                  ))
                )}
              </section>
            </>
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
          {selectedAlerts.length === 0 ? (
            <div className="task-manager-alert-empty">
              <span>✓</span>
              <p>Aucune échéance manquée pour cette tâche.</p>
            </div>
          ) : (
            selectedAlerts.map((alert) => (
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
    </section>
  )
}
