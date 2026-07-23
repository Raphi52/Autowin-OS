import { useEffect, useMemo, useState } from 'react'
import './AgentsTopologyView.css'
import { ModuleHeader } from './ModuleHeader'
import { modelRecencyKey, modelVendor } from './chat-view-model'

type ImportedModel = {
  id: string
  provider: string
  model: string
  label: string
  reasoningEfforts: string[]
  defaultReasoningEffort: string
}

type SlotBinding = {
  slotId: string
  provider: string
  modelId: string
  reasoningEffort: string
}

type AgentTopology = {
  version: number
  orchestrator: SlotBinding
  subagents: SlotBinding[]
  panels: { scout: SlotBinding[]; judge: SlotBinding[]; frame: SlotBinding[] }
}

type Target = 'orchestrator' | 'subagents' | 'scout' | 'judge' | 'frame'

/** Cibles dont le fan-out multi-modèles EST branché au runtime (≥2 slots → dupliqué + agrégé). */
const FANOUT_ACTIVE: ReadonlySet<Target> = new Set<Target>(['scout', 'frame', 'judge'])
type Profile = { id: string; name: string; updatedAt: string; topology: AgentTopology }
type RoleBinding = { provider: string; model?: string; reasoningEffort?: string }

const DRAG_TYPE = 'application/x-autowin-model'

function ModelMark({ provider }: { provider: string }): React.JSX.Element {
  return (
    <i className={`topology-model-mark is-${provider}`}>{provider.slice(0, 1).toUpperCase()}</i>
  )
}

function nextSlotId(target: Exclude<Target, 'orchestrator'>, topology: AgentTopology): string {
  const slots = target === 'subagents' ? topology.subagents : topology.panels[target]
  let index = slots.length + 1
  while (slots.some((slot) => slot.slotId === `${target.replace(/s$/, '')}-${index}`)) index += 1
  return `${target.replace(/s$/, '')}-${index}`
}

function withOrchestratorRole(
  topology: AgentTopology,
  models: ImportedModel[],
  role: RoleBinding
): AgentTopology {
  const model = models.find(
    (candidate) =>
      candidate.provider === role.provider &&
      (candidate.id === role.model || candidate.model === role.model)
  )
  return {
    ...topology,
    orchestrator: {
      slotId: 'orchestrator',
      provider: role.provider,
      modelId: model?.id ?? role.model ?? `${role.provider}:default`,
      reasoningEffort: role.reasoningEffort ?? model?.defaultReasoningEffort ?? 'auto'
    }
  }
}

export function AgentsTopologyView(): React.JSX.Element {
  const [models, setModels] = useState<ImportedModel[]>([])
  const [topology, setTopology] = useState<AgentTopology | null>(null)
  const [selectedModelId, setSelectedModelId] = useState('')
  const [dropTarget, setDropTarget] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [error, setError] = useState('')
  const [profiles, setProfiles] = useState<Profile[]>([])
  // Coin OmniRoute (relogé depuis l'ancienne vue Router) : gateway token + accès dashboard.
  const [omniToken, setOmniToken] = useState('')
  const [omniConfigured, setOmniConfigured] = useState(false)
  const [omniBusy, setOmniBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const state = (await window.api.routerMigrationState?.()) as
          { credentialConfigured?: boolean } | undefined
        setOmniConfigured(Boolean(state?.credentialConfigured))
      } catch {
        setOmniConfigured(false)
      }
    })()
  }, [])

  async function saveOmniToken(): Promise<void> {
    if (!omniToken.trim() || omniBusy) return
    setOmniBusy(true)
    try {
      await window.api.setOmniRouteCredential(omniToken.trim())
      setOmniToken('')
      setOmniConfigured(true)
    } finally {
      setOmniBusy(false)
    }
  }

  useEffect(() => {
    Promise.all([window.api.models(), window.api.topology(), window.api.roles()])
      .then(([catalog, current, roles]) => {
        setModels(catalog)
        setTopology(withOrchestratorRole(current, catalog, roles.orchestrator))
        setSelectedModelId(catalog[0]?.id ?? '')
        setState('ready')
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason))
        setState('error')
      })
  }, [])
  useEffect(() => {
    const off = window.api.onAppEvent((event) => {
      if (event.type === 'refresh' && event.scope === 'roles') {
        void window.api.roles().then((roles) => {
          setTopology((current) =>
            current ? withOrchestratorRole(current, models, roles.orchestrator) : current
          )
        })
      }
    })
    return off
  }, [models])
  useEffect(() => {
    window.api
      .profiles()
      .then(setProfiles)
      .catch(() => undefined)
  }, [])

  async function saveProfile(): Promise<void> {
    if (!topology) return
    const name = window.prompt('Nom du profil')?.trim()
    if (!name) return
    const id = `${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`
    setProfiles(
      (await window.api.saveProfile({
        schema: 'autowin.profile/v1',
        id,
        name,
        topology
      })) as Profile[]
    )
  }
  async function applyProfile(id: string): Promise<void> {
    const applied = await window.api.applyProfile(id)
    const roles = await window.api.roles()
    setTopology(withOrchestratorRole(applied.topology, models, roles.orchestrator))
  }

  const modelsById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models])
  // Colonne gauche : les DERNIERES versions de ChatGPT et d'Anthropic en premier, entrelacees
  // (le plus recent de CHAQUE vendeur d'abord : GPT-5.6, Fable 5, Opus 4.8, ...), les autres
  // vendeurs ensuite. Evite d'enfouir Opus 4.8 sous 16 entrees ChatGPT. Cles de tri = celles du Chat.
  const sortedModels = useMemo(() => {
    const vendorKey = (id: string): string => modelVendor(id).key
    const isPriority = (k: string): boolean => k === 'openai' || k === 'anthropic'
    const rec = (id: string): number => {
      const [family, version] = modelRecencyKey(id)
      return family * 10000 + version
    }
    // Rang de recence PAR vendeur (0 = le plus recent de ce vendeur).
    const perVendorIndex = new Map<string, number>()
    const groups = new Map<string, typeof models>()
    for (const model of models) {
      const key = vendorKey(model.id)
      groups.set(key, [...(groups.get(key) ?? []), model])
    }
    for (const arr of groups.values()) {
      arr.sort((a, b) => rec(b.id) - rec(a.id) || a.label.localeCompare(b.label))
      arr.forEach((model, index) => perVendorIndex.set(model.id, index))
    }
    return [...models].sort((a, b) => {
      const pa = isPriority(vendorKey(a.id))
      const pb = isPriority(vendorKey(b.id))
      if (pa !== pb) return pa ? -1 : 1
      if (pa && pb) {
        const ia = perVendorIndex.get(a.id) ?? 999
        const ib = perVendorIndex.get(b.id) ?? 999
        if (ia !== ib) return ia - ib // plus recent de chaque vendeur d'abord (entrelace)
        // egalite de rang : ChatGPT avant Anthropic
        return (vendorKey(a.id) === 'openai' ? 0 : 1) - (vendorKey(b.id) === 'openai' ? 0 : 1)
      }
      const ra = rec(a.id)
      const rb = rec(b.id)
      if (ra !== rb) return rb - ra
      return a.label.localeCompare(b.label)
    })
  }, [models])
  const selectedModel = modelsById.get(selectedModelId)

  async function persist(next: AgentTopology): Promise<void> {
    setState('saving')
    setError('')
    try {
      const saved = await window.api.setTopology(next)
      setTopology(saved)
      setState('ready')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setState('error')
    }
  }

  async function persistOrchestrator(binding: SlotBinding): Promise<void> {
    setState('saving')
    setError('')
    try {
      const roles = await window.api.setRole(
        'orchestrator',
        binding.provider,
        modelsById.get(binding.modelId)?.model ?? binding.modelId,
        binding.reasoningEffort
      )
      setTopology((current) =>
        current ? withOrchestratorRole(current, models, roles.orchestrator) : current
      )
      setState('ready')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setState('error')
    }
  }

  function bindingFor(model: ImportedModel, slotId: string): SlotBinding {
    return {
      slotId,
      provider: model.provider,
      modelId: model.id,
      reasoningEffort: model.defaultReasoningEffort
    }
  }

  function modelFromDrop(event: React.DragEvent): ImportedModel | undefined {
    const modelId = event.dataTransfer.getData(DRAG_TYPE)
    return modelsById.get(modelId)
  }

  function assign(model: ImportedModel | undefined, target: Target, slotId?: string): void {
    if (!model || !topology) return
    const id = target === 'orchestrator' ? 'orchestrator' : (slotId ?? nextSlotId(target, topology))
    const binding = bindingFor(model, id)
    const next =
      target === 'orchestrator'
        ? { ...topology, orchestrator: binding }
        : target === 'subagents'
          ? { ...topology, subagents: replaceOrAppend(topology.subagents, binding) }
          : {
              ...topology,
              panels: {
                ...topology.panels,
                [target]: replaceOrAppend(topology.panels[target], binding)
              }
            }
    if (target === 'orchestrator') void persistOrchestrator(binding)
    else void persist(next)
  }

  function replaceOrAppend(slots: SlotBinding[], binding: SlotBinding): SlotBinding[] {
    return slots.some((slot) => slot.slotId === binding.slotId)
      ? slots.map((slot) => (slot.slotId === binding.slotId ? binding : slot))
      : [...slots, binding]
  }

  function updateSlot(target: Target, slotId: string, patch: Partial<SlotBinding>): void {
    if (!topology) return
    const update = (slot: SlotBinding): SlotBinding =>
      slot.slotId === slotId ? { ...slot, ...patch } : slot
    const next =
      target === 'orchestrator'
        ? { ...topology, orchestrator: update(topology.orchestrator) }
        : target === 'subagents'
          ? { ...topology, subagents: topology.subagents.map(update) }
          : {
              ...topology,
              panels: { ...topology.panels, [target]: topology.panels[target].map(update) }
            }
    if (target === 'orchestrator') void persistOrchestrator(next.orchestrator)
    else void persist(next)
  }

  function remove(target: Exclude<Target, 'orchestrator'>, slotId: string): void {
    if (!topology) return
    const next =
      target === 'subagents'
        ? { ...topology, subagents: topology.subagents.filter((slot) => slot.slotId !== slotId) }
        : {
            ...topology,
            panels: {
              ...topology.panels,
              [target]: topology.panels[target].filter((slot) => slot.slotId !== slotId)
            }
          }
    void persist(next)
  }

  function slotsFor(target: Target): SlotBinding[] {
    if (!topology) return []
    if (target === 'orchestrator') return [topology.orchestrator]
    if (target === 'subagents') return topology.subagents
    return topology.panels[target]
  }

  function renderTargetPanel({
    target,
    title,
    description,
    accent
  }: {
    target: Target
    title: string
    description: string
    accent: string
  }): React.JSX.Element {
    const slots = slotsFor(target)
    const panelId = `panel:${target}`
    return (
      <section
        className={`topology-panel is-${accent}${dropTarget === panelId ? ' is-drop-target' : ''}`}
        data-target={target}
        onDragOver={(event) => {
          event.preventDefault()
          setDropTarget(panelId)
        }}
        onDragLeave={() => setDropTarget('')}
        onDrop={(event) => {
          event.preventDefault()
          setDropTarget('')
          assign(modelFromDrop(event), target)
        }}
      >
        <header>
          <div>
            <span>
              {target === 'orchestrator'
                ? '01 · Autorité unique'
                : target === 'subagents'
                  ? '02 · Exécution bornée'
                  : 'Panel parallèle'}
            </span>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
          <b>{slots.length}</b>
        </header>
        <div className="topology-slots">
          {slots.map((slot, index) => {
            const model = modelsById.get(slot.modelId)
            return (
              <article
                className="topology-slot"
                key={slot.slotId}
                data-slot-id={slot.slotId}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  assign(modelFromDrop(event), target, slot.slotId)
                }}
              >
                <ModelMark provider={slot.provider} />
                <div className="topology-slot-copy">
                  <small>{slot.slotId}</small>
                  <strong>{model?.label ?? slot.modelId}</strong>
                  <span>
                    {slot.provider} · {model?.model ?? slot.modelId}
                  </span>
                </div>
                <label>
                  Effort
                  <select
                    value={slot.reasoningEffort}
                    onChange={(event) =>
                      updateSlot(target, slot.slotId, { reasoningEffort: event.target.value })
                    }
                  >
                    {(model?.reasoningEfforts ?? [slot.reasoningEffort]).map((effort) => (
                      <option key={effort}>{effort}</option>
                    ))}
                  </select>
                </label>
                {target !== 'orchestrator' && (
                  <button
                    type="button"
                    title="Retirer ce slot"
                    onClick={() => remove(target, slot.slotId)}
                  >
                    ×
                  </button>
                )}
                {index === 0 && <em>{target === 'orchestrator' ? 'actif' : 'rôle runtime'}</em>}
                {/* Fan-out multi-modèles branché pour scout/frame/judge : un slot >1 est RÉELLEMENT
                    exécuté en parallèle puis agrégé par l'orchestrateur. Pour subagents il ne l'est
                    pas encore (seul le 1er slot alimente les phases d'exécution) → marqué non actif. */}
                {index > 0 &&
                  (FANOUT_ACTIVE.has(target) ? (
                    <em
                      className="slot-parallel"
                      title="Exécuté en parallèle puis agrégé par l'orchestrateur (union pour scout/frame, quorum pour judge)"
                    >
                      parallèle · actif
                    </em>
                  ) : (
                    <em
                      className="slot-inactive"
                      title="Le fan-out des sous-agents n'est pas encore branché — ce slot n'est pas utilisé au runtime"
                    >
                      non actif
                    </em>
                  ))}
              </article>
            )
          })}
          {slots.length === 0 && <div className="topology-empty">Glissez un modèle ici</div>}
        </div>
        <button
          type="button"
          className="topology-assign-button"
          disabled={!selectedModel || (target === 'orchestrator' && slots.length > 0)}
          onClick={() => assign(selectedModel, target)}
        >
          {target === 'orchestrator'
            ? 'Remplacer avec le modèle sélectionné'
            : '+ Ajouter le modèle sélectionné'}
        </button>
      </section>
    )
  }

  if (!topology) {
    return (
      <div className="agents-topology-loading">
        {state === 'error' ? `⛔ ${error}` : 'Chargement de la topologie…'}
      </div>
    )
  }

  return (
    <div className="agents-topology">
      <header className="topology-toolbar">
        <ModuleHeader eyebrow="Configuration des agents" title="Models" />
        <strong className={`topology-state is-${state}`}>
          {state === 'saving'
            ? 'Enregistrement…'
            : state === 'error'
              ? `Erreur · ${error}`
              : 'Enregistré dans le profil Autowin'}
        </strong>
        <div className="topology-profiles">
          <button
            type="button"
            className="topology-assign-button"
            onClick={() => void saveProfile()}
          >
            ＋ Profil
          </button>
          <select
            aria-label="Appliquer un profil"
            defaultValue=""
            onChange={(event) => event.target.value && void applyProfile(event.target.value)}
          >
            <option value="">Profils sauvegardés</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>
        <div className="topology-omniroute">
          <input
            type="password"
            className="topology-omniroute-token"
            value={omniToken}
            placeholder={omniConfigured ? 'Gateway token configuré' : 'Coller le gateway token'}
            aria-label="Gateway token OmniRoute"
            onChange={(event) => setOmniToken(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void saveOmniToken()
            }}
          />
          <button
            type="button"
            className="topology-assign-button"
            disabled={omniBusy || !omniToken.trim()}
            onClick={() => void saveOmniToken()}
          >
            {omniBusy ? '…' : 'Enregistrer'}
          </button>
          <button
            type="button"
            className="topology-assign-button"
            title="Ouvrir le dashboard OmniRoute"
            onClick={() => void window.api.openOmniRouteDashboard()}
          >
            🛰️ OmniRoute
          </button>
        </div>
      </header>

      <aside className="topology-library">
        <span className="topology-eyebrow">Modèles importés</span>
        <p>Glissez un modèle sur un slot ou sélectionnez-le puis utilisez Ajouter.</p>
        <div className="topology-models">
          {sortedModels.map((model) => (
            <button
              type="button"
              draggable
              key={model.id}
              className={`topology-model${selectedModelId === model.id ? ' is-selected' : ''}`}
              onClick={() => setSelectedModelId(model.id)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'copy'
                event.dataTransfer.setData(DRAG_TYPE, model.id)
                setSelectedModelId(model.id)
              }}
            >
              <ModelMark provider={model.provider} />
              <span>
                <strong>{model.label}</strong>
                <small>
                  {model.provider}
                  {(() => {
                    // 'none' n'est pas un niveau : on ne l'affiche jamais comme effort.
                    const efforts = model.reasoningEfforts.filter((effort) => effort !== 'none')
                    return efforts.length > 0 ? ` · efforts ${efforts.join(', ')}` : ''
                  })()}
                </small>
              </span>
            </button>
          ))}
        </div>
        <div className="topology-authority-note">
          <b>Autorité</b>
          <span>La configuration est validée et persistée par le main process.</span>
          <span>
            Frame, Scouts et Judges : tous les modèles déposés s’exécutent (fan-out + agrégation).
            Orchestrateur et Sous-agents : seul le premier slot alimente le runtime.
          </span>
        </div>
      </aside>

      <main className="topology-workspace">
        <div className="topology-primary">
          {renderTargetPanel({
            target: 'orchestrator',
            title: 'Orchestrateur',
            description: 'Un seul modèle pilote et consolide.',
            accent: 'gold'
          })}
          {renderTargetPanel({
            target: 'subagents',
            title: 'Sous-agents',
            description: 'Zéro à plusieurs exécutants bornés.',
            accent: 'cyan'
          })}
        </div>
        <div className="topology-parallel-heading">
          <div>
            <span>Panels composés</span>
            <h3>Exploration et vérification parallèles</h3>
          </div>
          <small>Les sorties restent distinctes avant synthèse.</small>
        </div>
        <div className="topology-parallel">
          {renderTargetPanel({
            target: 'frame',
            title: 'Frame',
            description: 'Plusieurs modèles cadrent la même tâche ; angles fusionnés.',
            accent: 'amber'
          })}
          {renderTargetPanel({
            target: 'scout',
            title: 'Scouts',
            description: 'Plusieurs lectures indépendantes du même front.',
            accent: 'pink'
          })}
          {renderTargetPanel({
            target: 'judge',
            title: 'Judges',
            description: 'Plusieurs challenges indépendants avant verdict.',
            accent: 'violet'
          })}
        </div>
        <div className="topology-runtime-limit">
          <b>Runtime actuel</b>
          <span>
            <b>Frame, Scouts et Judges</b> : déposez-y plusieurs modèles — ils s’exécutent en
            parallèle puis l’orchestrateur agrège (union des angles pour Frame/Scouts, quorum de vote
            pour Judges). <b>Orchestrateur et Sous-agents</b> : seul le premier slot alimente le
            runtime (fan-out des sous-agents pas encore branché).
          </span>
        </div>
      </main>
    </div>
  )
}
