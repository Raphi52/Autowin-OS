import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  TicketItem,
  TicketPage,
  TicketProvider,
  TicketSourceProfile
} from '../../../shared/tickets'
import { ModuleHeader } from './ModuleHeader'
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Impossible de charger les tickets.'
}

function plainText(value: string | undefined): string {
  if (!value) return ''
  const element = document.createElement('div')
  element.innerHTML = value
  return element.textContent?.trim() ?? ''
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
  const [cursor, setCursor] = useState<string>()
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [sourceError, setSourceError] = useState<string>()
  const [stale, setStale] = useState(false)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
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

  const load = useCallback(
    async (source: TicketSourceProfile, nextCursor?: string, append = false): Promise<void> => {
      if (!activeRef.current) return
      const previousSource = activeSourceRef.current
      const sourceChanged =
        previousSource !== undefined &&
        JSON.stringify(previousSource) !== JSON.stringify(source)
      activeSourceRef.current = source
      if (sourceChanged) {
        itemsRef.current = []
        setItems([])
        setSelectedId(undefined)
        setCursor(undefined)
        setHasMore(false)
        setStale(false)
        setError(undefined)
        setQuery('')
        setTypeFilter('')
        setStateFilter('')
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
      await load(source)
    } catch (failure) {
      if (generation !== requestGeneration.current) return
      setLoading(false)
      setSourceError(errorMessage(failure))
      setSourcesLoaded(true)
    }
  }, [load])

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
    setQuery('')
    setTypeFilter('')
    setStateFilter('')
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
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return items.filter(
      (item) =>
        (!needle ||
          item.title.toLocaleLowerCase().includes(needle) ||
          item.id.toLocaleLowerCase().includes(needle) ||
          item.assignee?.toLocaleLowerCase().includes(needle)) &&
        (!typeFilter || item.type === typeFilter) &&
        (!stateFilter || item.state === stateFilter)
    )
  }, [items, query, stateFilter, typeFilter])
  const selectedItem =
    visibleItems.find((item) => `${item.sourceId}::${item.id}` === selectedId) ?? visibleItems[0]

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
        <span className="tickets-count">
          {visibleItems.length} affiché(s) · {items.length} chargé(s)
        </span>
        {selectedSource && (
          <span className="tickets-auth-mode">
            {selectedSource.provider === 'azure'
              ? `Tous les Work Items du projet ${selectedSource.project} · ${
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
                  <button
                    key={identity}
                    type="button"
                    role="listitem"
                    data-testid="ticket-row"
                    className={selectedItem === item ? 'is-selected' : ''}
                    onClick={() => setSelectedId(identity)}
                  >
                    <span className="tickets-id">#{item.id}</span>
                    <strong>{item.title}</strong>
                    <span className="tickets-type">{item.type}</span>
                    <span className="tickets-state">{item.state}</span>
                    <span>{item.assignee || 'Non assigné'}</span>
                  </button>
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
                  <span>
                    #{selectedItem.id} · {selectedItem.type}
                  </span>
                  <h2>{selectedItem.title}</h2>
                </div>
                <dl>
                  <div>
                    <dt>État</dt>
                    <dd>{selectedItem.state}</dd>
                  </div>
                  <div>
                    <dt>Assigné</dt>
                    <dd>{selectedItem.assignee || 'Non assigné'}</dd>
                  </div>
                  <div>
                    <dt>Priorité</dt>
                    <dd>{selectedItem.priority ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Créé</dt>
                    <dd>{selectedItem.createdAt || '—'}</dd>
                  </div>
                  <div>
                    <dt>Mis à jour</dt>
                    <dd>{selectedItem.updatedAt}</dd>
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
