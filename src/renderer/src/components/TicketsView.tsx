import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  TicketItem,
  TicketPage,
  TicketProvider,
  TicketSourceProfile
} from '../../../shared/tickets'
import { ModuleHeader } from './ModuleHeader'
import {
  runTicketTreatmentBatch,
  ticketConversationTitle,
  type TicketTreatmentResult
} from './ticket-treatment'
import './TicketsView.css'

interface TicketSourceSummary {
  profile: TicketSourceProfile
  credentialConfigured: boolean
}

interface SourceDraft {
  provider: TicketProvider
  organization: string
  project: string
  owner: string
  namespace: string
  repository: string
  baseUrl: string
}

const SOURCE_KEY = 'autowin-os.tickets.source.v1'
const EMPTY_DRAFT: SourceDraft = {
  provider: 'azure',
  organization: '',
  project: '',
  owner: '',
  namespace: '',
  repository: '',
  baseUrl: ''
}

type SortKey = 'recent' | 'priority' | 'id' | 'title'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Impossible de charger les tickets.'
}

function plainText(value: string | undefined): string {
  if (!value) return ''
  const element = document.createElement('div')
  element.innerHTML = value
  return element.textContent?.trim() ?? ''
}

/** Initiales (2 lettres max) pour l'avatar d'assigné. */
function initialsOf(name: string): string {
  const words = name
    .replace(/<[^>]+>/g, '')
    .trim()
    .split(/[\s._@-]+/)
    .filter(Boolean)
  if (!words.length) return '?'
  const first = words[0][0] ?? ''
  const second = words.length > 1 ? (words[1][0] ?? '') : (words[0][1] ?? '')
  return (first + second).toLocaleUpperCase()
}

/** Teinte DÉTERMINISTE par libellé (état/type) : distinctes, stables entre rendus, sans mapping manuel. */
function hueOf(label: string): number {
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0
  return Math.abs(hash) % 360
}

/** Date relative courte (fr) — repère temporel plus lisible qu'un ISO brut dans la liste. */
function relativeDate(iso: string | undefined): string {
  if (!iso) return '—'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso
  const deltaMs = Date.now() - then
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 1) return 'à l’instant'
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `il y a ${days} j`
  return new Date(then).toLocaleDateString('fr-FR')
}

/** Tags Azure (`System.Tags`, séparés par « ; ») → liste propre. */
function ticketTags(item: TicketItem): string[] {
  const raw = item.fields?.['System.Tags']
  if (typeof raw !== 'string' || !raw.trim()) return []
  return raw
    .split(';')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function priorityRank(priority: TicketItem['priority']): number {
  const value = Number(priority)
  return Number.isFinite(value) && value > 0 ? value : 99
}

function sourceFromDraft(draft: SourceDraft): TicketSourceProfile | null {
  const repository = draft.repository.trim()
  if (!repository) return null
  if (draft.provider === 'azure') {
    const organization = draft.organization.trim()
    const project = draft.project.trim()
    if (!organization || !project) return null
    return {
      id: `azure:${organization}:${project}:${repository}`,
      label: `${organization} / ${project} / ${repository}`,
      provider: 'azure',
      organization,
      project,
      repository
    }
  }
  if (draft.provider === 'github') {
    const owner = draft.owner.trim()
    if (!owner) return null
    return {
      id: `github:${owner}:${repository}`,
      label: `${owner} / ${repository}`,
      provider: 'github',
      owner,
      repository,
      ...(draft.baseUrl.trim() ? { apiBaseUrl: draft.baseUrl.trim() } : {})
    }
  }
  const namespace = draft.namespace.trim()
  if (!namespace) return null
  return {
    id: `gitlab:${namespace}:${repository}`,
    label: `${namespace} / ${repository}`,
    provider: 'gitlab',
    namespace,
    repository,
    ...(draft.baseUrl.trim() ? { baseUrl: draft.baseUrl.trim() } : {})
  }
}

export function TicketsView({ active }: { active: boolean }): React.JSX.Element {
  const [sources, setSources] = useState<TicketSourceSummary[]>([])
  const [sourcesLoaded, setSourcesLoaded] = useState(false)
  const [sourceId, setSourceId] = useState(() => localStorage.getItem(SOURCE_KEY) ?? '')
  const [items, setItems] = useState<TicketItem[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set())
  const [cursor, setCursor] = useState<string>()
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [sourceError, setSourceError] = useState<string>()
  const [stale, setStale] = useState(false)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('recent')
  const [people, setPeople] = useState<string[]>([])
  const [showSourceForm, setShowSourceForm] = useState(false)
  const [draft, setDraft] = useState<SourceDraft>(EMPTY_DRAFT)
  const requestGeneration = useRef(0)
  const activeRef = useRef(active)
  const activeRequestId = useRef<string | undefined>(undefined)
  const activeSourceRef = useRef<TicketSourceProfile | undefined>(undefined)
  const itemsRef = useRef(items)
  activeRef.current = active

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const selectedSummary = sources.find(({ profile }) => profile.id === sourceId)
  const selectedSource = selectedSummary?.profile

  const resetFilters = (): void => {
    setQuery('')
    setTypeFilter('')
    setStateFilter('')
    setAssigneeFilter('')
  }

  const load = useCallback(
    async (source: TicketSourceProfile, nextCursor?: string, append = false): Promise<void> => {
      if (!activeRef.current) return
      const previousSource = activeSourceRef.current
      const sourceChanged =
        previousSource !== undefined && JSON.stringify(previousSource) !== JSON.stringify(source)
      activeSourceRef.current = source
      if (sourceChanged) {
        itemsRef.current = []
        setItems([])
        setSelectedId(undefined)
        setCheckedIds(new Set())
        setCursor(undefined)
        setHasMore(false)
        setStale(false)
        setError(undefined)
        setQuery('')
        setTypeFilter('')
        setStateFilter('')
        setAssigneeFilter('')
      }
      if (activeRequestId.current) {
        void window.api.cancelTickets(activeRequestId.current)
      }
      const generation = ++requestGeneration.current
      const requestId = `tickets-${crypto.randomUUID()}`
      activeRequestId.current = requestId
      setLoading(true)
      setError(undefined)
      try {
        const page = (await window.api.listTickets({
          source,
          requestId,
          ...(nextCursor ? { cursor: nextCursor } : {}),
          pageSize: 50
        })) as TicketPage
        if (generation !== requestGeneration.current) return
        setItems((current) => (append ? [...current, ...page.items] : page.items))
        setCursor(page.cursor)
        setHasMore(page.hasMore)
        setStale(false)
        if (!append) setSelectedId(undefined)
      } catch (failure) {
        if (generation !== requestGeneration.current) return
        if (!append && itemsRef.current.length === 0) setItems([])
        else setStale(true)
        setError(errorMessage(failure))
      } finally {
        if (generation === requestGeneration.current) {
          setLoading(false)
          if (activeRequestId.current === requestId) activeRequestId.current = undefined
        }
      }
    },
    []
  )

  // Annuaire des collaborateurs (autocomplete assigné) — best-effort : indisponible ⇒ on retombe
  // sur les assignés déjà présents dans les tickets chargés. Jamais d'erreur bloquante.
  const loadPeople = useCallback(async (source: TicketSourceProfile): Promise<void> => {
    if (typeof window.api.listTicketPeople !== 'function') return
    try {
      const names = await window.api.listTicketPeople(source)
      if (Array.isArray(names)) setPeople(names.filter((name) => typeof name === 'string'))
    } catch {
      setPeople([])
    }
  }, [])

  const loadSources = useCallback(async (): Promise<void> => {
    const generation = ++requestGeneration.current
    setSourcesLoaded(false)
    setSourceError(undefined)
    try {
      const summaries = (await window.api.ticketSources()) as TicketSourceSummary[]
      if (generation !== requestGeneration.current) return
      setSources(summaries)
      setSourcesLoaded(true)
      const persistedSourceId = localStorage.getItem(SOURCE_KEY) ?? ''
      const saved = summaries.find(({ profile }) => profile.id === persistedSourceId)?.profile
      const source = saved ?? summaries[0]?.profile
      if (!source) {
        setLoading(false)
        return
      }
      setSourceId(source.id)
      localStorage.setItem(SOURCE_KEY, source.id)
      void loadPeople(source)
      await load(source)
    } catch (failure) {
      if (generation !== requestGeneration.current) return
      setLoading(false)
      setSourceError(errorMessage(failure))
      setSourcesLoaded(true)
    }
  }, [load, loadPeople])

  useEffect(() => {
    if (!active || typeof window.api?.ticketSources !== 'function') return
    void loadSources()
    return () => {
      requestGeneration.current += 1
      const current = activeRequestId.current
      activeRequestId.current = undefined
      if (current) void window.api.cancelTickets(current)
    }
  }, [active, loadSources])

  const clearSourceData = (): void => {
    itemsRef.current = []
    setItems([])
    setSelectedId(undefined)
    setCheckedIds(new Set())
    setCursor(undefined)
    setHasMore(false)
    setStale(false)
    setError(undefined)
  }

  const changeSource = (nextId: string): void => {
    const source = sources.find(({ profile }) => profile.id === nextId)?.profile
    if (!source) return
    clearSourceData()
    setSourceId(nextId)
    localStorage.setItem(SOURCE_KEY, nextId)
    resetFilters()
    void loadPeople(source)
    void load(source)
  }

  const saveSource = async (): Promise<void> => {
    const profile = sourceFromDraft(draft)
    if (!profile) {
      setError('Complète les champs obligatoires de la source.')
      return
    }
    const generation = requestGeneration.current
    try {
      const nextSources = (await window.api.saveTicketSource(profile)) as TicketSourceSummary[]
      if (!activeRef.current || generation !== requestGeneration.current) return
      setSources(nextSources)
      setShowSourceForm(false)
      setDraft(EMPTY_DRAFT)
      changeSourceFrom(nextSources, profile.id)
    } catch (failure) {
      if (!activeRef.current || generation !== requestGeneration.current) return
      setError(errorMessage(failure))
    }
  }

  const changeSourceFrom = (nextSources: TicketSourceSummary[], nextId: string): void => {
    const source = nextSources.find(({ profile }) => profile.id === nextId)?.profile
    if (!source) return
    clearSourceData()
    setSourceId(source.id)
    localStorage.setItem(SOURCE_KEY, source.id)
    void loadPeople(source)
    void load(source)
  }

  const types = useMemo(
    () => [...new Set(items.map(({ type }) => type))].sort((a, b) => a.localeCompare(b)),
    [items]
  )
  const states = useMemo(
    () => [...new Set(items.map(({ state }) => state))].sort((a, b) => a.localeCompare(b)),
    [items]
  )
  /** Répartition par état (badges cliquables du bandeau stats). */
  const stateCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) counts.set(item.state, (counts.get(item.state) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [items])
  /** Options d'autocomplete assigné : annuaire Azure ∪ assignés déjà vus dans les tickets chargés. */
  const peopleOptions = useMemo(() => {
    const merged = new Set(people)
    for (const item of items) if (item.assignee) merged.add(item.assignee)
    return [...merged].sort((a, b) => a.localeCompare(b))
  }, [people, items])

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const who = assigneeFilter.trim().toLocaleLowerCase()
    const filtered = items.filter(
      (item) =>
        (!needle ||
          item.title.toLocaleLowerCase().includes(needle) ||
          item.id.toLocaleLowerCase().includes(needle) ||
          item.assignee?.toLocaleLowerCase().includes(needle)) &&
        (!typeFilter || item.type === typeFilter) &&
        (!stateFilter || item.state === stateFilter) &&
        (!who || (item.assignee ?? '').toLocaleLowerCase().includes(who))
    )
    const sorted = [...filtered]
    if (sortKey === 'recent')
      sorted.sort((a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? ''))
    else if (sortKey === 'priority')
      sorted.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    else if (sortKey === 'id') sorted.sort((a, b) => Number(a.id) - Number(b.id))
    else if (sortKey === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title))
    return sorted
  }, [items, query, stateFilter, typeFilter, assigneeFilter, sortKey])

  const selectedItem =
    visibleItems.find((item) => `${item.sourceId}::${item.id}` === selectedId) ?? visibleItems[0]
  const checkedVisibleItems = visibleItems.filter((item) =>
    checkedIds.has(`${item.sourceId}::${item.id}`)
  )
  const allVisibleChecked =
    visibleItems.length > 0 && checkedVisibleItems.length === visibleItems.length

  const toggleChecked = (identity: string): void => {
    setCheckedIds((current) => {
      const next = new Set(current)
      if (next.has(identity)) next.delete(identity)
      else next.add(identity)
      return next
    })
  }

  /** Tout sélectionner / tout désélectionner — porte sur les tickets VISIBLES (après filtres). */
  const toggleAllVisible = (): void => {
    setCheckedIds((current) => {
      const next = new Set(current)
      const identities = visibleItems.map((item) => `${item.sourceId}::${item.id}`)
      if (allVisibleChecked) for (const identity of identities) next.delete(identity)
      else for (const identity of identities) next.add(identity)
      return next
    })
  }

  // Traitement par lot : chaque ticket SÉLECTIONNÉ est prompté dans SA propre conversation dédiée.
  // Concurrency bornée (moteur), annulable. ⚠️ lance N runs d'agent.
  const batchActiveRef = useRef(false)
  const batchGenRef = useRef(0)
  const [batch, setBatch] = useState<(TicketTreatmentResult & { running: boolean }) | null>(null)

  const treatSelection = useCallback(async () => {
    const snapshot = checkedVisibleItems
    if (!snapshot.length || batchActiveRef.current) return
    const generation = (batchGenRef.current += 1)
    batchActiveRef.current = true
    setBatch({
      total: snapshot.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      conversationIds: [],
      running: true
    })
    let provider: string | undefined
    try {
      const roleMap = await window.api.roles()
      provider =
        roleMap.orchestrator?.provider ??
        roleMap.subagent?.provider ??
        Object.values(roleMap)[0]?.provider
    } catch {
      provider = undefined
    }
    if (!provider) {
      batchActiveRef.current = false
      setBatch((b) => (b ? { ...b, running: false } : b))
      return
    }
    const result = await runTicketTreatmentBatch(snapshot, {
      shouldContinue: () => batchActiveRef.current && generation === batchGenRef.current,
      createConversation: async (item) => {
        const conv = await window.api.conversationsCreate({
          title: ticketConversationTitle(item),
          category: provider as string,
          provider: provider as string
        })
        await window.api.conversationsSetAuthorityMode(conv.id, 'ask')
        return { id: conv.id }
      },
      promptConversation: async (conv, _item, prompt) => {
        try {
          const r = (await window.api.pilotChat([{ role: 'user', content: prompt }], conv.id)) as {
            ok?: boolean
          }
          return { ok: r?.ok !== false }
        } catch {
          return { ok: false }
        }
      },
      onProgress: (p) => {
        if (batchActiveRef.current && generation === batchGenRef.current)
          setBatch({ ...p, running: p.completed < p.total })
      }
    })
    batchActiveRef.current = false
    if (generation === batchGenRef.current) setBatch({ ...result, running: false })
  }, [checkedVisibleItems])

  const cancelBatch = (): void => {
    batchActiveRef.current = false
    setBatch((b) => (b ? { ...b, running: false } : b))
  }

  const retry = (): void => {
    if (sourceError) void loadSources()
    else if (selectedSource) void load(selectedSource)
    else void loadSources()
  }
  const initialLoading = active && !sourcesLoaded && !error

  return (
    <section className="tickets-view" data-testid="tickets-view" data-active={active}>
      <header className="tickets-head">
        <ModuleHeader eyebrow="Travail synchronisé" title="Tickets" />
        <div className="tickets-source-controls">
          <label>
            <span>Source</span>
            <select
              aria-label="Source de tickets"
              data-testid="tickets-source"
              value={sourceId}
              onChange={(event) => changeSource(event.target.value)}
            >
              {sources.map(({ profile }) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => setShowSourceForm((visible) => !visible)}>
            {showSourceForm ? 'Fermer' : 'Ajouter une source'}
          </button>
        </div>
      </header>

      {showSourceForm && (
        <div className="tickets-source-form">
          <select
            aria-label="Fournisseur"
            value={draft.provider}
            onChange={(event) =>
              setDraft({ ...EMPTY_DRAFT, provider: event.target.value as TicketProvider })
            }
          >
            <option value="azure">Azure DevOps</option>
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
          </select>
          {draft.provider === 'azure' && (
            <>
              <input
                aria-label="Organisation Azure"
                placeholder="Organisation"
                value={draft.organization}
                onChange={(event) => setDraft({ ...draft, organization: event.target.value })}
              />
              <input
                aria-label="Projet Azure"
                placeholder="Projet"
                value={draft.project}
                onChange={(event) => setDraft({ ...draft, project: event.target.value })}
              />
            </>
          )}
          {draft.provider === 'github' && (
            <input
              aria-label="Propriétaire GitHub"
              placeholder="Organisation ou propriétaire"
              value={draft.owner}
              onChange={(event) => setDraft({ ...draft, owner: event.target.value })}
            />
          )}
          {draft.provider === 'gitlab' && (
            <input
              aria-label="Namespace GitLab"
              placeholder="Groupe / sous-groupe"
              value={draft.namespace}
              onChange={(event) => setDraft({ ...draft, namespace: event.target.value })}
            />
          )}
          <input
            aria-label={draft.provider === 'azure' ? 'Dépôt Azure de contexte' : 'Dépôt'}
            placeholder={draft.provider === 'azure' ? 'Dépôt de contexte' : 'Dépôt'}
            value={draft.repository}
            onChange={(event) => setDraft({ ...draft, repository: event.target.value })}
          />
          {draft.provider !== 'azure' && (
            <>
              <input
                aria-label="URL personnalisée"
                placeholder="URL personnalisée (optionnel)"
                value={draft.baseUrl}
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              />
              <span className="tickets-auth-help" data-testid="tickets-auth-help">
                {draft.provider === 'github'
                  ? 'Privé : GH_TOKEN sur github.com ; pour une URL personnalisée, connecte gh à cet hôte.'
                  : 'Privé : GITLAB_TOKEN sur gitlab.com ; pour une URL personnalisée, connecte glab à cet hôte.'}
              </span>
            </>
          )}
          <button type="button" onClick={() => void saveSource()}>
            Enregistrer
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="tickets-stats" data-testid="tickets-stats">
          <span className="tickets-stats-total">
            <strong>{items.length}</strong> chargé(s) · <strong>{visibleItems.length}</strong>{' '}
            affiché(s)
          </span>
          <div className="tickets-stats-states" role="group" aria-label="Répartition par état">
            {stateCounts.map(([state, count]) => (
              <button
                key={state}
                type="button"
                className={`tickets-state-chip${stateFilter === state ? ' is-active' : ''}`}
                style={{ ['--chip-hue' as string]: hueOf(state) }}
                title={`Filtrer sur « ${state} »`}
                onClick={() => setStateFilter((current) => (current === state ? '' : state))}
              >
                {state} <b>{count}</b>
              </button>
            ))}
          </div>
          {checkedIds.size > 0 && (
            <span className="tickets-stats-selection" data-testid="tickets-selection-count">
              {checkedVisibleItems.length} sélectionné(s)
            </span>
          )}
        </div>
      )}

      <div className="tickets-toolbar">
        <input
          type="search"
          aria-label="Rechercher les tickets"
          placeholder="ID, titre ou assigné…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="Filtrer par type"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
        >
          <option value="">Tous les types</option>
          {types.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
        <select
          aria-label="Filtrer par état"
          value={stateFilter}
          onChange={(event) => setStateFilter(event.target.value)}
        >
          <option value="">Tous les états</option>
          {states.map((state) => (
            <option key={state}>{state}</option>
          ))}
        </select>
        <input
          list="tickets-people-list"
          aria-label="Filtrer par assigné"
          data-testid="tickets-assignee-filter"
          placeholder="Assigné…"
          value={assigneeFilter}
          onChange={(event) => setAssigneeFilter(event.target.value)}
        />
        <datalist id="tickets-people-list" data-testid="tickets-people-list">
          {peopleOptions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <select
          aria-label="Trier"
          data-testid="tickets-sort"
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as SortKey)}
        >
          <option value="recent">Plus récents</option>
          <option value="priority">Priorité</option>
          <option value="id">ID croissant</option>
          <option value="title">Titre A→Z</option>
        </select>
        {selectedSource && (
          <span className="tickets-auth-mode">
            {selectedSource.provider === 'azure'
              ? `Projet ${selectedSource.project} · ${
                  selectedSummary?.credentialConfigured ? 'Coffre configuré' : 'Session Azure CLI'
                }`
              : selectedSummary?.credentialConfigured
                ? 'Coffre configuré'
                : 'Public · session CLI/env si privée'}
          </span>
        )}
        <button
          data-testid="tickets-refresh"
          type="button"
          disabled={!selectedSource || loading}
          onClick={() => selectedSource && void load(selectedSource)}
        >
          Actualiser
        </button>
      </div>

      <div className="tickets-actions">
        <button
          data-testid="tickets-select-all"
          type="button"
          disabled={visibleItems.length === 0}
          onClick={toggleAllVisible}
        >
          {allVisibleChecked ? 'Tout désélectionner' : `Tout sélectionner (${visibleItems.length})`}
        </button>
        {batch?.running ? (
          <>
            <span className="tickets-batch-progress" data-testid="tickets-batch-progress">
              Traitement {batch.completed}/{batch.total}…
            </span>
            <button
              data-testid="tickets-treat-cancel"
              type="button"
              className="tickets-treat-cancel"
              onClick={cancelBatch}
            >
              Arrêter
            </button>
          </>
        ) : (
          <button
            data-testid="tickets-treat-selection"
            type="button"
            className="tickets-treat-selection"
            disabled={checkedVisibleItems.length === 0}
            title="Ouvre une conversation dédiée par ticket sélectionné et lance son traitement"
            onClick={() => void treatSelection()}
          >
            Traiter la sélection ({checkedVisibleItems.length})
          </button>
        )}
        {batch && !batch.running && batch.total > 0 && (
          <span className="tickets-batch-done" data-testid="tickets-batch-done">
            {batch.succeeded}/{batch.total} lancés{batch.failed ? ` · ${batch.failed} échec(s)` : ''}
          </span>
        )}
      </div>

      <div className="tickets-content">
        {sourceError ? (
          <div className="tickets-error" role="alert">
            <strong>Chargement des sources impossible</strong>
            <span>{sourceError}</span>
            <button data-testid="tickets-retry" type="button" onClick={retry}>
              Réessayer
            </button>
          </div>
        ) : (loading || initialLoading) && items.length === 0 ? (
          <div className="tickets-loading" role="status" aria-label="Chargement des tickets">
            <span className="tickets-spinner" aria-hidden="true" />
            <span>Synchronisation des tickets…</span>
          </div>
        ) : error && items.length === 0 ? (
          <div className="tickets-error" role="alert">
            <strong>Chargement impossible</strong>
            <span>{error}</span>
            <button data-testid="tickets-retry" type="button" onClick={retry}>
              Réessayer
            </button>
          </div>
        ) : sourcesLoaded && sources.length === 0 ? (
          <div className="tickets-empty">
            <strong>Aucune source configurée</strong>
            <span>Ajoute une source Azure DevOps, GitHub ou GitLab.</span>
          </div>
        ) : items.length === 0 && !hasMore ? (
          <div className="tickets-empty">
            <strong>Aucun ticket</strong>
            <span>Cette source ne renvoie aucun élément accessible.</span>
          </div>
        ) : visibleItems.length === 0 && items.length > 0 && !hasMore ? (
          <div className="tickets-empty">
            <strong>Aucun résultat</strong>
            <span>Modifie la recherche ou les filtres.</span>
          </div>
        ) : (
          <>
            {stale && error && (
              <div className="tickets-stale" data-testid="tickets-stale" role="status">
                <strong>Données périmées</strong>
                <span>{error}</span>
              </div>
            )}
            <div className="tickets-list" role="list" aria-label="Tickets">
              {visibleItems.map((item) => {
                const identity = `${item.sourceId}::${item.id}`
                return (
                  <div className="ticket-select-row" key={identity} role="listitem">
                    <input
                      type="checkbox"
                      data-testid="ticket-process-checkbox"
                      aria-label={`Cocher le ticket ${item.id}`}
                      checked={checkedIds.has(identity)}
                      onChange={() => toggleChecked(identity)}
                    />
                    <button
                      type="button"
                      data-testid="ticket-row"
                      className={selectedItem === item ? 'is-selected' : ''}
                      onClick={() => setSelectedId(identity)}
                    >
                      <span className="tickets-id">#{item.id}</span>
                      <strong className="tickets-title">{item.title}</strong>
                      <span className="tickets-updated" title={item.updatedAt}>
                        {relativeDate(item.updatedAt)}
                      </span>
                      <span className="tickets-meta">
                        <span className="tickets-badge tickets-type">{item.type}</span>
                        <span
                          className="tickets-badge tickets-state"
                          style={{ ['--chip-hue' as string]: hueOf(item.state) }}
                        >
                          {item.state}
                        </span>
                        {priorityRank(item.priority) < 99 && (
                          <span
                            className={`tickets-badge tickets-priority is-p${priorityRank(item.priority)}`}
                          >
                            P{priorityRank(item.priority)}
                          </span>
                        )}
                        <span className="tickets-assignee">
                          {item.assignee ? (
                            <>
                              <span className="tickets-avatar" aria-hidden="true">
                                {initialsOf(item.assignee)}
                              </span>
                              {item.assignee}
                            </>
                          ) : (
                            <span className="tickets-unassigned">Non assigné</span>
                          )}
                        </span>
                      </span>
                    </button>
                  </div>
                )
              })}
              {hasMore ? (
                <button
                  className="tickets-load-more"
                  type="button"
                  disabled={loading}
                  onClick={() =>
                    selectedSource && cursor ? void load(selectedSource, cursor, true) : undefined
                  }
                >
                  {loading ? 'Chargement…' : 'Charger la suite'}
                </button>
              ) : (
                <span data-testid="tickets-page-end" className="tickets-page-end">
                  Fin de la liste
                </span>
              )}
            </div>
            {selectedItem && (
              <article className="tickets-detail" data-testid="ticket-detail">
                <div className="tickets-detail-title">
                  <span className="tickets-detail-eyebrow">
                    <span className="tickets-badge tickets-type">{selectedItem.type}</span>
                    <span
                      className="tickets-badge tickets-state"
                      style={{ ['--chip-hue' as string]: hueOf(selectedItem.state) }}
                    >
                      {selectedItem.state}
                    </span>
                    {priorityRank(selectedItem.priority) < 99 && (
                      <span
                        className={`tickets-badge tickets-priority is-p${priorityRank(selectedItem.priority)}`}
                      >
                        P{priorityRank(selectedItem.priority)}
                      </span>
                    )}
                    <span className="tickets-detail-id">#{selectedItem.id}</span>
                  </span>
                  <h2>{selectedItem.title}</h2>
                </div>
                {ticketTags(selectedItem).length > 0 && (
                  <div className="tickets-tags" data-testid="ticket-tags">
                    {ticketTags(selectedItem).map((tag) => (
                      <span key={tag} className="tickets-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <dl>
                  <div>
                    <dt>Assigné</dt>
                    <dd>{selectedItem.assignee || 'Non assigné'}</dd>
                  </div>
                  <div>
                    <dt>Créé</dt>
                    <dd>{selectedItem.createdAt || '—'}</dd>
                  </div>
                  <div>
                    <dt>Mis à jour</dt>
                    <dd title={selectedItem.updatedAt}>{relativeDate(selectedItem.updatedAt)}</dd>
                  </div>
                </dl>
                <section>
                  <h3>Description</h3>
                  <p>{plainText(selectedItem.description) || 'Aucune description.'}</p>
                </section>
                <section>
                  <h3>Relations</h3>
                  {selectedItem.relations?.length ? (
                    <ul>
                      {selectedItem.relations.map((relation, index) => (
                        <li key={`${relation.kind}:${relation.target}:${index}`}>
                          <span>{relation.kind}</span> <strong>#{relation.target}</strong>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Aucune relation.</p>
                  )}
                </section>
                <a href={selectedItem.url} target="_blank" rel="noreferrer">
                  Ouvrir dans {selectedSource?.provider ?? 'la source'}
                </a>
              </article>
            )}
          </>
        )}
      </div>
    </section>
  )
}
