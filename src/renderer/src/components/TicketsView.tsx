import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildTicketListRequest,
  type TicketItem,
  type TicketPage,
  type TicketProvider,
  type TicketSourceProfile
} from '../../../shared/tickets'
import type { TicketsSection } from '../../../shared/navigation'
import { ViewTopBar } from './ViewTopBar'
import { VeilleCandidatsSection } from './VeilleCandidatsSection'
import {
  formatTicketSelectionPrompt,
  mapWithConcurrency,
  plainText,
  reconcileTicketTreatmentRecords,
  reportTicketTreatment,
  runTicketTreatmentBatch,
  saveTicketTreatmentRecord,
  ticketConversationTitle,
  ticketSelectionTitle,
  type TicketTreatmentRecord
} from './ticket-treatment'
import {
  AUTO_MODE_LIMITS,
  describeAutoModeCost,
  isAutoModeStopped,
  loadAutoModeSettings,
  loadSeen,
  pickIncomingTickets,
  primeSeen,
  remainingSessionRuns,
  resumeAutoMode,
  saveAutoModeSettings,
  saveSeen,
  stopAutoModeNow,
  type AutoModeSettings
} from './ticket-auto-mode'
import './ViewPage.css'
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

type SortKey = 'recent' | 'priority' | 'id-desc' | 'id' | 'title'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Impossible de charger les tickets.'
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
  /** Recherche ACTUELLEMENT appliquee cote serveur (titleContains). '' = aucun filtre. */
  const serverQueryRef = useRef('')
  const [serverQuery, setServerQuery] = useState('')
  /**
   * Au MONTAGE, tout record `running` persisté est orphelin : le run vivait dans ce renderer et n'a
   * pas survécu. On le rend « interrompu » plutôt que « en cours » à vie (voir
   * `reconcileTicketTreatmentRecords`). `onItemSettled` réécrit ensuite le statut réel.
   */
  const [treatmentRecords, setTreatmentRecords] = useState(() =>
    reconcileTicketTreatmentRecords(localStorage)
  )

  /** Section affichée. « externes » par défaut : c'est l'usage historique de cette vue. */
  const [sectionActive, setSectionActive] = useState<TicketsSection>('externes')

  const recordTreatment = useCallback(
    (item: Pick<TicketItem, 'sourceId' | 'id'>, record: TicketTreatmentRecord): void => {
      setTreatmentRecords(saveTicketTreatmentRecord(localStorage, item, record))
    },
    []
  )

  const openTreatmentConversation = useCallback(async (conversationId: string): Promise<void> => {
    await window.api.appCommand?.('navigate', { tab: 'chat' })
    window.dispatchEvent(new CustomEvent('autowin:open-conversation', { detail: conversationId }))
  }, [])

  /**
   * Fiches relues, RESULTAT compris. Une simple Set d'ids empêchait bien le second appel, mais
   * rendait ensuite la fiche légère après un refresh. La Promise déduplique aussi deux demandes
   * simultanées ; `updatedAt` invalide naturellement une fiche devenue plus récente.
   */
  const enrichedRef = useRef<Map<string, { updatedAt: string; value: Promise<TicketItem> }>>(
    new Map()
  )

  const enrichTicket = useCallback(
    async (item: TicketItem, source: TicketSourceProfile | undefined): Promise<TicketItem> => {
      if (!source || typeof window.api.getTicket !== 'function') return item
      const identity = `${item.sourceId}::${item.id}`
      const cached = enrichedRef.current.get(identity)
      if (cached?.updatedAt === item.updatedAt) return cached.value

      const value = window.api
        .getTicket({
          source,
          id: item.id,
          requestId: `ticket-detail-${crypto.randomUUID()}`
        })
        .then((enriched) => enriched as TicketItem)
        .catch(() => {
          // Un échec reste réessayable. Ne supprime pas une lecture plus récente lancée entre-temps.
          if (enrichedRef.current.get(identity)?.value === value)
            enrichedRef.current.delete(identity)
          return item
        })
      enrichedRef.current.set(identity, { updatedAt: item.updatedAt, value })
      return value
    },
    []
  )

  const enrichIntoList = useCallback(
    (item: TicketItem): void => {
      const identity = `${item.sourceId}::${item.id}`
      void enrichTicket(item, activeSourceRef.current).then((enriched) => {
        if (enriched === item) return
        setItems((current) =>
          current.map((candidate) =>
            `${candidate.sourceId}::${candidate.id}` === identity ? enriched : candidate
          )
        )
      })
    },
    [enrichTicket]
  )

  const selectTicket = useCallback(
    (item: TicketItem): void => {
      setSelectedId(`${item.sourceId}::${item.id}`)
      enrichIntoList(item)
    },
    [enrichIntoList]
  )

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const selectedSummary = sources.find(({ profile }) => profile.id === sourceId)
  const selectedSource = selectedSummary?.profile

  /** Lance une recherche SERVEUR (titleContains) : la page repart de zero avec ce filtre. */
  const runServerSearch = (value: string): void => {
    const next = value.trim()
    setServerQuery(next)
    if (selectedSource) void load(selectedSource, { titleContains: next })
  }

  const resetFilters = (): void => {
    setQuery('')
    setTypeFilter('')
    setStateFilter('')
    setAssigneeFilter('')
  }

  /**
   * RECHERCHE SERVEUR — `titleContains` part au fournisseur.
   *
   * Avant, le champ de recherche ne filtrait que les 50 items DEJA charges : une fiche plus ancienne
   * existait mais la vue repondait « aucun resultat ». La recherche courante est memorisee dans une
   * ref pour rester appliquee a la pagination et a « Actualiser ».
   */
  const load = useCallback(
    async (
      source: TicketSourceProfile,
      options: { cursor?: string; append?: boolean; titleContains?: string } = {}
    ): Promise<void> => {
      const { cursor: nextCursor, append = false } = options
      if (options.titleContains !== undefined) serverQueryRef.current = options.titleContains.trim()
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
        serverQueryRef.current = ''
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
        const page = (await window.api.listTickets(
          buildTicketListRequest({
            source,
            requestId,
            ...(nextCursor ? { cursor: nextCursor } : {}),
            pageSize: 75,
            titleContains: serverQueryRef.current
          })
        )) as TicketPage
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
    // Charge la source externe dès l'activation de la vue.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    else if (sortKey === 'id-desc') sorted.sort((a, b) => Number(b.id) - Number(a.id))
    else if (sortKey === 'id') sorted.sort((a, b) => Number(a.id) - Number(b.id))
    else if (sortKey === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title))
    return sorted
  }, [items, query, stateFilter, typeFilter, assigneeFilter, sortKey])

  const selectedItem =
    visibleItems.find((item) => `${item.sourceId}::${item.id}` === selectedId) ?? visibleItems[0]
  const selectedIdentity = selectedItem ? `${selectedItem.sourceId}::${selectedItem.id}` : undefined
  /**
   * Le panneau de détail affiche AUSSI le ticket de repli (`visibleItems[0]`, sans clic) : sans cet
   * effet il annonçait « Aucun commentaire chargé » / « Aucune relation » sur une fiche qui en a.
   */
  useEffect(() => {
    if (selectedItem) enrichIntoList(selectedItem)
  }, [selectedIdentity, selectedItem, enrichIntoList])
  /** Miroir stable des tickets FILTRES : le mode auto lit le perimetre courant sans se re-abonner. */
  const visibleItemsRef = useRef<TicketItem[]>([])
  useEffect(() => {
    visibleItemsRef.current = visibleItems
  }, [visibleItems])
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

  /**
   * Geste PAR DÉFAUT de la sélection (refonte du 2026-07-28).
   *
   * Avant : « Traiter la sélection » ouvrait une conversation PAR ticket et lançait aussitôt une
   * orchestration complète sur chacune — l'utilisateur ne voyait jamais le prompt et récoltait N
   * runs simultanés. Désormais PROMPT-FIRST, comme le Source control : UNE conversation, le prompt
   * pré-rempli dedans, et l'envoi seulement si « Traiter réellement » est coché.
   */
  const [sendDirectly, setSendDirectly] = useState(
    () => localStorage.getItem('autowin:tickets-send-directly') === '1'
  )
  useEffect(() => {
    localStorage.setItem('autowin:tickets-send-directly', sendDirectly ? '1' : '0')
  }, [sendDirectly])

  /**
   * MODE AUTO — traite les tickets ENTRANTS du filtre courant, sans intervention.
   *
   * Le perimetre est exactement ce que l'utilisateur voit (les filtres actifs sont le garde-fou).
   * A l'activation, l'existant est AMORCE (marque vu, non traite) : cocher la case ne declenche
   * jamais un run par ticket deja affiche. Chaque cycle est borne (AUTO_MODE_CAP_PER_CYCLE) et les
   * tickets ne sont marques vus qu APRES succes ; un echec reste donc eligible au prochain cycle.
   */
  const [autoMode, setAutoMode] = useState(
    () => localStorage.getItem('autowin:tickets-auto-mode') === '1'
  )
  const autoModeEnabledRef = useRef(autoMode)
  const seenRef = useRef<Set<string>>(loadSeen(localStorage))
  const autoBusyRef = useRef(false)
  const [autoStatus, setAutoStatus] = useState<string>()
  /** Garde-fous VISIBLES : concurrence, cap par cycle, plafond de runs de la session. */
  const [autoSettings, setAutoSettings] = useState<AutoModeSettings>(() =>
    loadAutoModeSettings(localStorage)
  )
  const autoSettingsRef = useRef(autoSettings)
  const launchedRef = useRef(0)
  const [launched, setLaunched] = useState(0)
  useEffect(() => {
    autoSettingsRef.current = autoSettings
  }, [autoSettings])

  /**
   * Le kill-switch est une LATCH de session, partagee par tout le module. Monter la vue avec la case
   * deja cochee est un choix EXPLICITE de l'utilisateur : c'est la reprise attendue. Sans cela, un
   * arret precedent gelerait definitivement le mode auto, meme reactive.
   */
  useEffect(() => {
    if (autoModeEnabledRef.current) resumeAutoMode()
    // Au MONTAGE uniquement : les (re)prises suivantes passent par la case a cocher.
  }, [])

  const updateAutoSetting = (key: keyof AutoModeSettings, value: number): void => {
    setAutoSettings((current) => saveAutoModeSettings(localStorage, { ...current, [key]: value }))
  }

  const setAutoModeChecked = (checked: boolean): void => {
    localStorage.setItem('autowin:tickets-auto-mode', checked ? '1' : '0')
    autoModeEnabledRef.current = checked
    setAutoMode(checked)
    if (checked) {
      // Reprise EXPLICITE du kill-switch : cocher la case est ce geste explicite.
      resumeAutoMode()
      // AMORCE : l'existant devient « connu » sans etre traite.
      for (const key of primeSeen(visibleItemsRef.current)) seenRef.current.add(key)
      saveSeen(localStorage, seenRef.current)
      autoPrimedRef.current = true
      setAutoStatus(
        `en veille · ${visibleItemsRef.current.length} ticket(s) déjà présents ignorés · ` +
          describeAutoModeCost(autoSettingsRef.current, 0)
      )
    } else {
      // ARRET IMMEDIAT : kill-switch global (les workers en cours le consultent a chaque boucle).
      stopAutoModeNow()
      autoBusyRef.current = false
      setAutoStatus('arrêté')
    }
  }

  const treatIncoming = useCallback(async () => {
    if (!autoMode || autoBusyRef.current || isAutoModeStopped()) return
    const settings = autoSettingsRef.current
    let budget = remainingSessionRuns(settings, launchedRef.current)
    if (budget <= 0) {
      setAutoStatus(`arrêté · plafond de session atteint (${settings.maxRunsPerSession} runs)`)
      return
    }
    let selection = pickIncomingTickets(
      visibleItemsRef.current,
      seenRef.current,
      Math.min(settings.capPerCycle, budget)
    )
    if (!selection.toTreat.length) return
    autoBusyRef.current = true
    setAutoStatus(
      `traitement de ${selection.toTreat.length} entrant(s)${
        selection.deferred ? ` · ${selection.deferred} reporté(s)` : ''
      } · ${describeAutoModeCost(settings, selection.toTreat.length)}`
    )
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
      autoBusyRef.current = false
      setAutoStatus('en veille · aucun rôle configuré')
      return
    }
    if (typeof window.api.providerStatus === 'function') {
      const statuses = await window.api.providerStatus().catch(() => [])
      const providerState = statuses.find((entry) => entry.provider === provider)?.status
      if (providerState && ['absent', 'expired', 'standby'].includes(providerState)) {
        autoBusyRef.current = false
        setAutoStatus(`en veille · provider ${provider} indisponible (${providerState})`)
        return
      }
    }
    // MARQUAGE AVANT le premier appel payant : un échec ou un remontage ne doit jamais repayer le
    // même ticket automatiquement. Un provider indisponible, contrôlé au-dessus, ne consomme rien.
    for (const key of selection.seenAdditions) seenRef.current.add(key)
    saveSeen(localStorage, seenRef.current)
    const attemptedThisCycle = new Set<string>()
    const cycleStartedAt = new Date().toISOString()
    let succeeded = 0
    let failed = 0
    let total = 0
    while (selection.toTreat.length) {
      const result = await runTicketTreatmentBatch(selection.toTreat, {
        concurrency: settings.concurrency,
        ...(activeSourceRef.current ? { source: activeSourceRef.current } : {}),
        shouldContinue: () =>
          autoBusyRef.current && autoModeEnabledRef.current && !isAutoModeStopped(),
        enrichItem: (item) => enrichTicket(item, activeSourceRef.current),
        createConversation: async (item) => {
          const conv = await window.api.conversationsCreate({
            title: ticketConversationTitle(item),
            category: provider as string,
            provider: provider as string
          })
          return { id: conv.id }
        },
        promptConversation: async (conv, _item, prompt) => {
          try {
            const r = await window.api.orchestrate(prompt, conv.id)
            return { ok: r?.ok !== false }
          } catch {
            return { ok: false }
          }
        },
        onConversationCreated: (conversation, item) => {
          recordTreatment(item, {
            conversationId: conversation.id,
            status: 'running',
            // Horodatage du DÉBUT : seul repère si le run reste orphelin (voir réconciliation).
            startedAt: cycleStartedAt,
            updatedAt: new Date().toISOString()
          })
        },
        onItemSettled: (item, ok, conversation) => {
          const key = `${item.sourceId}::${item.id}`
          attemptedThisCycle.add(key)
          if (conversation) {
            recordTreatment(item, {
              conversationId: conversation.id,
              status: ok ? 'succeeded' : 'failed',
              startedAt: cycleStartedAt,
              updatedAt: new Date().toISOString()
            })
            // RETOUR SUR LA FICHE : commentaire SEUL, valeurs copiées (id ticket, id conversation,
            // statut réel). Ni état ni assigné : ces changements exigent un geste explicite.
            if (typeof window.api.updateTicket === 'function') {
              void reportTicketTreatment(
                {
                  updateTicket: window.api.updateTicket,
                  ...(activeSourceRef.current ? { source: activeSourceRef.current } : {})
                },
                item,
                ok,
                conversation
              )
            }
          }
        }
      })
      succeeded += result.succeeded
      failed += result.failed
      total += result.total
      launchedRef.current += result.completed
      setLaunched(launchedRef.current)
      budget = remainingSessionRuns(settings, launchedRef.current)
      if (
        !selection.deferred ||
        !autoBusyRef.current ||
        !autoModeEnabledRef.current ||
        isAutoModeStopped() ||
        budget <= 0
      ) {
        break
      }
      selection = pickIncomingTickets(
        visibleItemsRef.current,
        new Set([...seenRef.current, ...attemptedThisCycle]),
        Math.min(settings.capPerCycle, budget)
      )
      if (!selection.toTreat.length) break
      for (const key of selection.seenAdditions) seenRef.current.add(key)
      saveSeen(localStorage, seenRef.current)
    }
    autoBusyRef.current = false
    setAutoStatus(
      autoModeEnabledRef.current && !isAutoModeStopped()
        ? `en veille · ${succeeded}/${total} lancés${failed ? ` · ${failed} échec(s)` : ''}` +
            ` · ${remainingSessionRuns(settings, launchedRef.current)} run(s) restants sur le plafond`
        : 'arrêté'
    )
  }, [autoMode, enrichTicket, recordTreatment])

  /**
   * AMORCE de la REPRISE PERSISTÉE. `primeSeen` n'existait que dans `setAutoModeChecked` : au
   * montage avec la case déjà cochée (localStorage), la première page arrivait comme une vague
   * d'« entrants » et déclenchait un run PAR ticket affiché. L'amorce couvre donc aussi ce chemin.
   */
  const autoPrimedRef = useRef(!autoMode)

  // Chaque rafraichissement de la liste est un cycle de veille : les nouveaux arrives passent.
  useEffect(() => {
    if (!autoMode) return
    if (!autoPrimedRef.current) {
      // Rien d'affiché encore : l'amorce attend la PREMIÈRE page non vide, sinon elle n'amorce rien.
      if (visibleItemsRef.current.length === 0) return
      for (const key of primeSeen(visibleItemsRef.current)) seenRef.current.add(key)
      saveSeen(localStorage, seenRef.current)
      autoPrimedRef.current = true
      setAutoStatus(
        `en veille · ${visibleItemsRef.current.length} ticket(s) déjà présents ignorés · ` +
          describeAutoModeCost(autoSettingsRef.current, 0)
      )
      return
    }
    void treatIncoming()
  }, [items, autoMode, treatIncoming])

  const openSelectionConversation = useCallback(async () => {
    const selected = checkedVisibleItems
    if (!selected.length) return
    // Les listes fournisseur sont légères. Le prompt, lui, relit chaque fiche pour inclure la
    // discussion et les titres de relations réellement courants.
    // Pool BORNÉ (même garde-fou que les lots auto) : 30 tickets cochés ne doivent pas ouvrir 30
    // requêtes distantes simultanées.
    const selection = await mapWithConcurrency(
      selected,
      autoSettingsRef.current.concurrency,
      (item) => enrichTicket(item, activeSourceRef.current)
    )
    const prompt = formatTicketSelectionPrompt(selection, activeSourceRef.current)
    if (!prompt) return
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
    if (!provider) return
    const conv = await window.api.conversationsCreate({
      title: ticketSelectionTitle(selection),
      category: provider,
      provider
    })
    for (const item of selection) {
      recordTreatment(item, {
        conversationId: conv.id,
        status: sendDirectly ? 'running' : 'prepared',
        updatedAt: new Date().toISOString()
      })
    }
    // On amène l'utilisateur SUR le Chat : préparer un prompt qu'il ne voit pas serait inutile.
    // Le main reste l'autorité de navigation (même chemin que la rail), puis le Chat pré-remplit.
    try {
      await window.api.appCommand?.('navigate', { tab: 'chat' })
    } catch {
      /* navigation refusée : le prompt est quand même préparé dans la conversation */
    }
    window.dispatchEvent(
      new CustomEvent('autowin:prefill-conversation', {
        detail: { conversationId: conv.id, prompt, send: sendDirectly }
      })
    )
  }, [checkedVisibleItems, enrichTicket, recordTreatment, sendDirectly])

  const retry = (): void => {
    if (sourceError) void loadSources()
    else if (selectedSource) void load(selectedSource)
    else void loadSources()
  }
  const initialLoading = active && !sourcesLoaded && !error
  /** Causes RÉELLES d'un écran vide : ce qui restreint le périmètre, nommé une par une. */
  const emptyCauses = [
    serverQuery ? `recherche serveur « ${serverQuery} »` : undefined,
    query.trim() ? `recherche locale « ${query.trim()} »` : undefined,
    typeFilter ? `type « ${typeFilter} »` : undefined,
    stateFilter ? `état « ${stateFilter} »` : undefined,
    assigneeFilter.trim() ? `assigné « ${assigneeFilter.trim()} »` : undefined
  ].filter((cause): cause is string => cause !== undefined)

  /** Navigation clavier ↑/↓ dans la liste (P3-9) : déplace la sélection, sans toucher aux coches. */
  const moveSelection = (delta: number): void => {
    if (!visibleItems.length) return
    const current = visibleItems.findIndex(
      (candidate) => `${candidate.sourceId}::${candidate.id}` === selectedIdentity
    )
    const next = Math.min(visibleItems.length - 1, Math.max(0, (current < 0 ? 0 : current) + delta))
    selectTicket(visibleItems[next])
  }

  return (
    <section className="view-page tickets-view" data-testid="tickets-view" data-active={active}>
      {/*
        Deux sections, comme Task Manager : le travail synchronisé d'un serveur de tickets d'un côté,
        ce qu'il vaut la peine de reprendre chez les concurrents de l'autre. La barre vient de
        `ViewTopBar`, la même que les autres vues — la recopier ici l'aurait fait diverger.
      */}
      <ViewTopBar
        eyebrow="Travail synchronisé"
        title="Tickets"
        description="Synchronise et pilote le travail issu de tes sources externes."
        ariaLabel="Sections Tickets"
        active={sectionActive}
        onSelect={setSectionActive}
        tabs={[
          { id: 'externes', label: 'Sources externes' },
          { id: 'autowin', label: 'Autowin OS' }
        ]}
      />

      {sectionActive === 'autowin' && <VeilleCandidatsSection />}

      {/*
        TOUT le contenu « sources externes » est monte SOUS condition, pas seulement son en-tete.
        Premiere version : seul l'en-tete portait `hidden`, si bien que la liste de veille s'affichait
        AU-DESSUS du selecteur de source, des filtres et du tableau de tickets — les deux sections
        empilees. Vu a la capture, pas au typecheck.
      */}
      {sectionActive === 'externes' && (
        <>
          <header className="tickets-head">
            <div className="tickets-source-controls">
              <label className="tickets-source-pill">
                <span className="tickets-source-eyebrow">Source</span>
                <span className="tickets-source-provider" aria-hidden="true">
                  {selectedSource?.provider === 'github'
                    ? ''
                    : selectedSource?.provider === 'gitlab'
                      ? '🦊'
                      : '◆'}
                </span>
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
              <button
                type="button"
                className="tickets-source-add"
                title={showSourceForm ? 'Fermer le formulaire' : 'Ajouter une source'}
                aria-label={showSourceForm ? 'Fermer le formulaire' : 'Ajouter une source'}
                aria-expanded={showSourceForm}
                onClick={() => setShowSourceForm((visible) => !visible)}
              >
                {showSourceForm ? '✕' : '＋ Source'}
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
              <button
                type="button"
                onClick={() => void saveSource()}
                aria-label="Enregistrer la source"
                title="Enregistrer la source"
              >
                Enregistrer
              </button>
            </div>
          )}

          {items.length > 0 && (
            <div className="tickets-stats" data-testid="tickets-stats">
              {/* PÉRIMÈTRE ANNONCÉ : ces compteurs ne sont PAS des statistiques projet — ils portent
              sur la page chargée uniquement (le fournisseur pagine à 50). */}
              <span
                className="tickets-stats-total"
                title="Compteurs calculés sur la page chargée, pas sur tout le projet"
              >
                <strong>{items.length}</strong> chargé(s) · <strong>{visibleItems.length}</strong>{' '}
                affiché(s) · périmètre : page chargée
              </span>
              <div
                className="tickets-stats-states"
                role="group"
                aria-label="Répartition par état sur la page chargée"
              >
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
              placeholder="ID, titre ou assigné… (Entrée = recherche serveur)"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  runServerSearch(query)
                }
              }}
            />
            {/* La recherche SERVEUR interroge tout le projet ; le champ seul ne filtrait que les
            50 items déjà chargés, et répondait « aucun résultat » sur une fiche existante. */}
            <button
              data-testid="tickets-search-server"
              type="button"
              title="Chercher ce titre sur le serveur (tout le projet), pas seulement dans la page chargée"
              disabled={!selectedSource || loading}
              onClick={() => runServerSearch(query)}
            >
              Chercher
            </button>
            {serverQuery && (
              <span className="tickets-server-query" data-testid="tickets-server-query">
                serveur : « {serverQuery} »
                <button
                  type="button"
                  title="Effacer la recherche serveur"
                  onClick={() => {
                    setQuery('')
                    runServerSearch('')
                  }}
                >
                  ×
                </button>
              </span>
            )}
            <select
              aria-label="Filtrer par type"
              title="Types présents dans la page chargée (pas tout le projet)"
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
              title="États présents dans la page chargée (pas tout le projet)"
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
              <option value="id-desc">ID décroissant</option>
              <option value="id">ID croissant</option>
              <option value="title">Titre A→Z</option>
            </select>
            {selectedSource && (
              <span className="tickets-auth-mode">
                {selectedSource.provider === 'azure'
                  ? `Projet ${selectedSource.project} · ${
                      selectedSummary?.credentialConfigured
                        ? 'Coffre configuré'
                        : 'Session Azure CLI'
                    }`
                  : selectedSummary?.credentialConfigured
                    ? 'Coffre configuré'
                    : 'Public · session CLI/env si privée'}
              </span>
            )}
            <button
              data-testid="tickets-refresh"
              type="button"
              aria-label="Actualiser les tickets"
              title="Actualiser les tickets"
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
              title={
                allVisibleChecked
                  ? 'Tout désélectionner'
                  : `Tout sélectionner (${visibleItems.length})`
              }
              disabled={visibleItems.length === 0}
              onClick={toggleAllVisible}
            >
              {allVisibleChecked
                ? 'Tout désélectionner'
                : `Tout sélectionner (${visibleItems.length})`}
            </button>
            <button
              data-testid="tickets-treat-selection"
              type="button"
              className="tickets-treat-selection"
              disabled={checkedVisibleItems.length === 0}
              title={
                sendDirectly
                  ? 'Ouvre UNE conversation pour la sélection et ENVOIE le prompt'
                  : 'Ouvre UNE conversation pour la sélection et y pré-remplit le prompt, sans l’envoyer'
              }
              onClick={() => void openSelectionConversation()}
            >
              {sendDirectly
                ? `Traiter la sélection (${checkedVisibleItems.length})`
                : `Préparer le prompt (${checkedVisibleItems.length})`}
            </button>
            {/* Le geste par défaut PRÉPARE (prompt-first, comme le Source control) : c'est
            l'utilisateur qui décide d'envoyer. Cocher cette case rend l'envoi immédiat. */}
            <label className="tickets-mode" data-testid="tickets-mode-send">
              <input
                type="checkbox"
                checked={sendDirectly}
                onChange={(e) => setSendDirectly(e.target.checked)}
              />
              Traiter réellement (envoi immédiat)
            </label>
            {/* Mode auto : la veille porte sur le FILTRE COURANT — ce que l'utilisateur voit est le
            périmètre. L'existant est ignoré à l'activation ; seuls les entrants sont traités. */}
            <label className="tickets-mode" data-testid="tickets-mode-auto">
              <input
                type="checkbox"
                checked={autoMode}
                onChange={(e) => setAutoModeChecked(e.target.checked)}
              />
              Mode auto (traite les entrants du filtre)
            </label>
            {/* GARDE-FOUS VISIBLES : le mode auto lance des runs PAYANTS. Le nombre simultané, le cap
            par cycle et le plafond de session sont réglables ici, et le coût est annoncé. */}
            <span className="tickets-auto-guards" data-testid="tickets-auto-guards">
              <label>
                Parallèle
                <input
                  type="number"
                  aria-label="Runs en parallèle"
                  data-testid="tickets-auto-concurrency"
                  min={AUTO_MODE_LIMITS.concurrency.min}
                  max={AUTO_MODE_LIMITS.concurrency.max}
                  value={autoSettings.concurrency}
                  onChange={(e) => updateAutoSetting('concurrency', Number(e.target.value))}
                />
              </label>
              <label>
                Par cycle
                <input
                  type="number"
                  aria-label="Tickets traités par cycle"
                  data-testid="tickets-auto-cap"
                  min={AUTO_MODE_LIMITS.capPerCycle.min}
                  max={AUTO_MODE_LIMITS.capPerCycle.max}
                  value={autoSettings.capPerCycle}
                  onChange={(e) => updateAutoSetting('capPerCycle', Number(e.target.value))}
                />
              </label>
              <label>
                Plafond session
                <input
                  type="number"
                  aria-label="Plafond de runs pour la session"
                  data-testid="tickets-auto-max-runs"
                  min={AUTO_MODE_LIMITS.maxRunsPerSession.min}
                  max={AUTO_MODE_LIMITS.maxRunsPerSession.max}
                  value={autoSettings.maxRunsPerSession}
                  onChange={(e) => updateAutoSetting('maxRunsPerSession', Number(e.target.value))}
                />
              </label>
              <span data-testid="tickets-auto-cost">
                {describeAutoModeCost(autoSettings, 0)} · {launched} lancé(s)
              </span>
              {/* KILL-SWITCH : arrêt global immédiat, indépendant du rendu React. */}
              <button
                type="button"
                data-testid="tickets-auto-kill"
                className="tickets-auto-kill"
                title="Arrêt immédiat du mode auto (kill-switch global)"
                onClick={() => {
                  stopAutoModeNow()
                  autoBusyRef.current = false
                  setAutoModeChecked(false)
                  setAutoStatus('arrêté (kill-switch)')
                }}
              >
                Stop
              </button>
            </span>
            {autoStatus && (
              <span className="tickets-auto-status" data-testid="tickets-auto-status">
                {autoStatus}
              </span>
            )}
          </div>

          <div className="tickets-content">
            {sourceError ? (
              <div className="tickets-error" role="alert">
                <strong>Chargement des sources impossible</strong>
                <span>{sourceError}</span>
                <button
                  data-testid="tickets-retry"
                  type="button"
                  title="Réessayer le chargement des tickets"
                  onClick={retry}
                >
                  Réessayer
                </button>
              </div>
            ) : (loading || initialLoading) && items.length === 0 ? (
              <div className="tickets-loading" role="status" aria-label="Chargement des tickets">
                <span className="spinner spinner--lg" aria-hidden="true" />
                <span>Synchronisation des tickets…</span>
              </div>
            ) : error && items.length === 0 ? (
              <div className="tickets-error" role="alert">
                <strong>Chargement impossible</strong>
                <span>{error}</span>
                <button
                  data-testid="tickets-retry"
                  type="button"
                  title="Réessayer le chargement des tickets"
                  onClick={retry}
                >
                  Réessayer
                </button>
              </div>
            ) : sourcesLoaded && sources.length === 0 ? (
              <div className="tickets-empty">
                <strong>Aucune source configurée</strong>
                <span>Ajoute une source Azure DevOps, GitHub ou GitLab.</span>
              </div>
            ) : visibleItems.length === 0 ? (
              /* Vide HONNÊTE : la cause (recherche serveur, filtres locaux) est nommée, une issue est
             offerte, et « Charger la suite » reste accessible quand la page suivante existe —
             avant, `!hasMore` supprimait tout message et l'écran restait muet. */
              <div className="tickets-empty" data-testid="tickets-empty">
                <strong>{items.length === 0 ? 'Aucun ticket' : 'Aucun résultat'}</strong>
                <span>
                  {emptyCauses.length
                    ? `Périmètre restreint par : ${emptyCauses.join(' · ')}.`
                    : 'Cette source ne renvoie aucun élément accessible sur la page chargée.'}
                </span>
                {emptyCauses.length > 0 && (
                  <button
                    type="button"
                    data-testid="tickets-empty-clear"
                    title="Effacer la recherche serveur et les filtres locaux"
                    onClick={() => {
                      resetFilters()
                      if (serverQuery) runServerSearch('')
                    }}
                  >
                    Effacer la recherche et les filtres
                  </button>
                )}
                {hasMore && (
                  <button
                    className="tickets-load-more"
                    type="button"
                    disabled={loading}
                    onClick={() =>
                      selectedSource && cursor
                        ? void load(selectedSource, { cursor, append: true })
                        : undefined
                    }
                  >
                    {loading ? 'Chargement…' : 'Charger la suite'}
                  </button>
                )}
              </div>
            ) : (
              <>
                {loading && (
                  <div
                    className="tickets-refreshing"
                    data-testid="tickets-refreshing"
                    role="status"
                    aria-label="Actualisation des tickets en cours"
                  >
                    <span className="spinner spinner--lg" aria-hidden="true" />
                    <span>Actualisation…</span>
                  </div>
                )}
                {error && (
                  <div className="tickets-stale" data-testid="tickets-stale" role="status">
                    {/* Toute erreur survenue sur une liste DÉJÀ chargée est visible : avant, elle
                    dépendait de `stale`, donc une erreur de pagination passait inaperçue. */}
                    <strong>{stale ? 'Données périmées' : 'Chargement partiel impossible'}</strong>
                    <span>{error}</span>
                  </div>
                )}
                <div
                  className="tickets-list"
                  role="list"
                  aria-label="Tickets"
                  tabIndex={-1}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                    event.preventDefault()
                    moveSelection(event.key === 'ArrowDown' ? 1 : -1)
                  }}
                >
                  {visibleItems.map((item) => {
                    const identity = `${item.sourceId}::${item.id}`
                    const treatment = treatmentRecords[identity]
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
                          aria-selected={selectedItem === item}
                          onClick={() => selectTicket(item)}
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
                        {treatment && (
                          <button
                            type="button"
                            data-testid="ticket-treatment-status"
                            className={`ticket-treatment-status is-${treatment.status}`}
                            title="Ouvrir la conversation de traitement"
                            onClick={() => void openTreatmentConversation(treatment.conversationId)}
                          >
                            {treatment.status === 'prepared'
                              ? 'prêt'
                              : treatment.status === 'running'
                                ? 'en cours'
                                : treatment.status === 'succeeded'
                                  ? 'traité'
                                  : treatment.status === 'interrupted'
                                    ? 'interrompu'
                                    : 'échec'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                  {hasMore ? (
                    <button
                      className="tickets-load-more"
                      type="button"
                      disabled={loading}
                      onClick={() =>
                        selectedSource && cursor
                          ? void load(selectedSource, { cursor, append: true })
                          : undefined
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
                        <dd title={selectedItem.updatedAt}>
                          {relativeDate(selectedItem.updatedAt)}
                        </dd>
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
                              {relation.title ? <span> — {relation.title}</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>Aucune relation.</p>
                      )}
                    </section>
                    <section>
                      <h3>Discussion</h3>
                      {selectedItem.comments?.length ? (
                        <ul data-testid="ticket-comments">
                          {selectedItem.comments.map((comment, index) => (
                            <li key={comment.id ?? `${comment.createdAt ?? 'comment'}:${index}`}>
                              <strong>{comment.author ?? 'Auteur inconnu'}</strong>
                              {comment.createdAt ? (
                                <time>{relativeDate(comment.createdAt)}</time>
                              ) : null}
                              <p>{plainText(comment.text)}</p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>Aucun commentaire chargé.</p>
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
        </>
      )}
    </section>
  )
}
