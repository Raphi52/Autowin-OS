import { useEffect, useMemo, useRef, useState } from 'react'
import './AgentsTopologyView.css'
import { ModuleHeader } from './ModuleHeader'
import { libraryModels } from './model-library'

type ImportedModel = {
  id: string
  provider: string
  model: string
  label: string
  reasoningEfforts: string[]
  defaultReasoningEffort: string
  dynamicallyLoaded?: boolean
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
  panels: {
    scout: SlotBinding[]
    frame: SlotBinding[]
    terrain: SlotBinding[]
    judge: SlotBinding[]
  }
}

type Target = 'orchestrator' | 'subagents' | 'scout' | 'frame' | 'terrain' | 'judge'

/** Cibles dont le fan-out multi-modèles EST branché au runtime (≥2 slots → dupliqué + agrégé). */
const FANOUT_ACTIVE: ReadonlySet<Target> = new Set<Target>(['scout', 'frame', 'terrain', 'judge'])
type Profile = { id: string; name: string; updatedAt: string; topology: AgentTopology }

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

export function AgentsTopologyView({
  active = true
}: {
  active?: boolean
} = {}): React.JSX.Element {
  const [models, setModels] = useState<ImportedModel[]>([])
  const [topology, setTopology] = useState<AgentTopology | null>(null)
  const [selectedModelId, setSelectedModelId] = useState('')
  const [dropTarget, setDropTarget] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [error, setError] = useState('')
  const [profiles, setProfiles] = useState<Profile[]>([])
  /** Profil réellement appliqué, l'empreinte de la topologie qu'il a posée, et le profil en attente
   *  de confirmation : appliquer ÉCRASE la topologie courante, ce n'est pas un geste anodin. */
  const [appliedProfileId, setAppliedProfileId] = useState('')
  const [appliedFingerprint, setAppliedFingerprint] = useState('')
  const [pendingProfileId, setPendingProfileId] = useState('')
  /** Nom du profil saisi DANS l'application : `window.prompt` bloque le processus de rendu et reste
   *  intestable — aucun test ne pouvait couvrir l'enregistrement d'un profil. */
  const [profileName, setProfileName] = useState('')
  const [namingProfile, setNamingProfile] = useState(false)
  /** Relance manuelle du chargement initial : une erreur de lecture laissait la vue morte. */
  const [reloadKey, setReloadKey] = useState(0)
  /** Échec de LECTURE de la liste des profils — canal distinct : la topologie, elle, est chargée.
   *  Avalé (`.catch(() => undefined)`), il rendait un sélecteur vide indiscernable d'un « aucun
   *  profil enregistré ». */
  const [profilesError, setProfilesError] = useState('')
  const [profilesReloadKey, setProfilesReloadKey] = useState(0)
  /** Refus de VALIDATION (dépôt inerte) — jamais dans le badge de persistance : rien n'a échoué à
   *  l'écriture, et l'erreur y restait collée jusqu'au prochain enregistrement. */
  const [validationError, setValidationError] = useState('')
  const topologyRef = useRef<AgentTopology | null>(null)
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve())
  const persistVersionRef = useRef(0)

  function replaceTopology(next: AgentTopology): void {
    topologyRef.current = next
    setTopology(next)
  }

  useEffect(() => {
    // L'état « loading » est posé par le déclencheur (montage initial, ou clic sur Réessayer) :
    // l'écrire ici synchroniserait deux rendus en cascade pour rien.
    Promise.all([window.api.models(), window.api.topology()])
      .then(([catalog, current]) => {
        setModels(catalog)
        replaceTopology(current)
        setSelectedModelId(catalog.find((model) => model.dynamicallyLoaded)?.id ?? '')
        setState('ready')
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason))
        setState('error')
      })
  }, [reloadKey])
  useEffect(() => {
    if (!active) return
    const off = window.api.onAppEvent((event) => {
      if (event.type === 'refresh' && event.scope === 'roles') {
        // `.catch` obligatoire : un rejet ici (topologie invalide/illisible) restait un
        // unhandledRejection muet, la vue gardait l'ANCIENNE topologie sans le dire.
        void window.api
          .topology()
          .then(replaceTopology)
          .catch((reason: unknown) => {
            // `setError` SEUL ne s'affichait pas : le badge ne rend le message que si
            // `state === 'error'`. L'échec de rafraîchissement était donc totalement muet.
            setError(
              `Rafraîchissement de la topologie impossible : ${reason instanceof Error ? reason.message : String(reason)}`
            )
            setState('error')
          })
      }
    })
    return off
  }, [active])
  useEffect(() => {
    window.api
      .profiles()
      .then((liste) => {
        setProfiles(liste)
        setProfilesError('')
      })
      .catch((reason: unknown) =>
        setProfilesError(reason instanceof Error ? reason.message : String(reason))
      )
  }, [profilesReloadKey])

  async function saveProfile(): Promise<void> {
    if (!topology) return
    const name = profileName.trim()
    if (!name) return
    const id = `${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`
    // Même contrat que `persist()` : un rejet IPC devient une erreur AFFICHÉE, jamais un
    // unhandledRejection muet avec un bouton qui semble sans effet.
    setError('')
    try {
      setProfiles(
        (await window.api.saveProfile({
          schema: 'autowin.profile/v1',
          id,
          name,
          topology
        })) as Profile[]
      )
      setProfileName('')
      setNamingProfile(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setState('error')
    }
  }
  async function applyProfile(id: string): Promise<void> {
    setError('')
    try {
      const applied = await window.api.applyProfile(id)
      replaceTopology(applied.topology)
      setAppliedProfileId(id)
      setAppliedFingerprint(JSON.stringify(applied.topology))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setState('error')
    }
  }

  const modelsById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models])
  // Même dérivation que Routage, désormais définie une seule fois (`model-library`) : c'est cette
  // vue qui faisait référence, elle garde donc exactement son comportement.
  const sortedModels = useMemo(() => libraryModels(models), [models])
  const selectedModel = modelsById.get(selectedModelId)
  /**
   * Un slot dont le `modelId` n'existe plus au catalogue (modèle désimporté, id périmé) s'affichait
   * comme un modèle valide — `model?.label ?? slot.modelId` rend l'identifiant brut, indiscernable
   * d'un vrai libellé — et son sélecteur d'effort n'avait plus qu'une option fantôme. On le nomme,
   * et on interdit d'en figer ou d'en appliquer un profil tant qu'il n'est pas résolu.
   */
  const unresolvedSlots = useMemo(() => {
    if (!topology || models.length === 0) return []
    const tous = [
      topology.orchestrator,
      ...topology.subagents,
      ...topology.panels.scout,
      ...topology.panels.frame,
      ...topology.panels.terrain,
      ...topology.panels.judge
    ]
    return tous.filter((slot) => !modelsById.has(slot.modelId))
  }, [topology, models, modelsById])
  const topologyDirty = appliedFingerprint !== '' && JSON.stringify(topology) !== appliedFingerprint

  async function persist(next: AgentTopology): Promise<void> {
    const version = ++persistVersionRef.current
    replaceTopology(next)
    setState('saving')
    setError('')
    const request = persistQueueRef.current.then(() => window.api.setTopology(next))
    persistQueueRef.current = request.then(
      () => undefined,
      () => undefined
    )
    try {
      const saved = await request
      if (version === persistVersionRef.current) {
        replaceTopology(saved)
        setState('ready')
      }
    } catch (reason) {
      if (version === persistVersionRef.current) {
        setError(reason instanceof Error ? reason.message : String(reason))
        setState('error')
      }
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
    const current = topologyRef.current
    if (!model || !current) return
    // Le fan-out des sous-agents n'est pas branché : un 2e slot était persisté puis étiqueté « non
    // actif ». On refuse le dépôt inerte plutôt que d'enregistrer une configuration sans effet.
    if (target === 'subagents' && !slotId && current.subagents.length >= 1) {
      // Canal PROPRE : un refus de validation n'est pas un échec d'écriture. En passant par
      // `state = 'error'`, il maquillait le badge de persistance en panne jusqu'au prochain
      // enregistrement, alors que la topologie persistée était intacte.
      setValidationError(
        'Le fan-out des sous-agents n’est pas branché : un second sous-agent ne serait pas exécuté. Remplacez le slot existant.'
      )
      return
    }
    setValidationError('')
    const id = target === 'orchestrator' ? 'orchestrator' : (slotId ?? nextSlotId(target, current))
    const binding = bindingFor(model, id)
    const next =
      target === 'orchestrator'
        ? { ...current, orchestrator: binding }
        : target === 'subagents'
          ? { ...current, subagents: replaceOrAppend(current.subagents, binding) }
          : {
              ...current,
              panels: {
                ...current.panels,
                [target]: replaceOrAppend(current.panels[target], binding)
              }
            }
    void persist(next)
  }

  function replaceOrAppend(slots: SlotBinding[], binding: SlotBinding): SlotBinding[] {
    return slots.some((slot) => slot.slotId === binding.slotId)
      ? slots.map((slot) => (slot.slotId === binding.slotId ? binding : slot))
      : [...slots, binding]
  }

  function updateSlot(target: Target, slotId: string, patch: Partial<SlotBinding>): void {
    const current = topologyRef.current
    if (!current) return
    const update = (slot: SlotBinding): SlotBinding =>
      slot.slotId === slotId ? { ...slot, ...patch } : slot
    const next =
      target === 'orchestrator'
        ? { ...current, orchestrator: update(current.orchestrator) }
        : target === 'subagents'
          ? { ...current, subagents: current.subagents.map(update) }
          : {
              ...current,
              panels: { ...current.panels, [target]: current.panels[target].map(update) }
            }
    void persist(next)
  }

  function remove(target: Exclude<Target, 'orchestrator'>, slotId: string): void {
    const current = topologyRef.current
    if (!current) return
    const next =
      target === 'subagents'
        ? { ...current, subagents: current.subagents.filter((slot) => slot.slotId !== slotId) }
        : {
            ...current,
            panels: {
              ...current.panels,
              [target]: current.panels[target].filter((slot) => slot.slotId !== slotId)
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
                className={`topology-slot${!model && models.length > 0 ? ' is-unresolved' : ''}`}
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
                  {!model && models.length > 0 && (
                    <b
                      className="slot-unresolved"
                      data-testid={`slot-unresolved-${slot.slotId}`}
                      title={`Aucun modèle « ${slot.modelId} » au catalogue : déposez-en un pour résoudre ce slot`}
                    >
                      modèle introuvable
                    </b>
                  )}
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
          data-testid={`topology-add-${target}`}
          disabled={
            !selectedModel ||
            (target === 'orchestrator' && slots.length > 0) ||
            (target === 'subagents' && slots.length > 0)
          }
          title={
            target === 'subagents' && slots.length > 0
              ? 'Fan-out des sous-agents non branché : un second slot ne serait pas exécuté'
              : undefined
          }
          onClick={() => assign(selectedModel, target)}
        >
          {target === 'orchestrator'
            ? 'Remplacer avec le modèle sélectionné'
            : target === 'subagents' && slots.length > 0
              ? 'Fan-out non branché — remplacez le slot existant'
              : '+ Ajouter le modèle sélectionné'}
        </button>
      </section>
    )
  }

  if (!topology) {
    return (
      <div className="agents-topology-loading">
        {state === 'error' ? `⛔ ${error}` : 'Chargement de la topologie…'}
        {state === 'error' && (
          // Sans ce bouton, une lecture en échec laissait la vue définitivement morte : le seul
          // recours était de redémarrer l'application.
          <button
            type="button"
            className="topology-assign-button"
            data-testid="topology-retry"
            onClick={() => {
              setState('loading')
              setError('')
              setReloadKey((key) => key + 1)
            }}
          >
            Réessayer
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="agents-topology">
      <header className="topology-toolbar">
        <ModuleHeader
          eyebrow="Configuration des agents"
          title="Models"
          description="Assigne les modèles aux rôles et contrôle leur disponibilité."
        />
        <strong
          className={`topology-state is-${state}`}
          role={state === 'error' ? 'alert' : undefined}
        >
          {state === 'saving'
            ? 'Enregistrement…'
            : state === 'error'
              ? `Erreur · ${error}`
              : 'Enregistré dans le profil Autowin'}
        </strong>
        <div className="topology-profiles">
          {namingProfile ? (
            <span className="topology-profile-naming">
              <input
                data-testid="topology-profile-name"
                aria-label="Nom du profil"
                value={profileName}
                placeholder="Nom du profil"
                onChange={(event) => setProfileName(event.target.value)}
              />
              <button
                type="button"
                className="topology-assign-button"
                data-testid="topology-profile-save"
                disabled={!profileName.trim() || unresolvedSlots.length > 0}
                onClick={() => void saveProfile()}
              >
                Enregistrer
              </button>
              <button
                type="button"
                className="topology-assign-button"
                data-testid="topology-profile-cancel"
                onClick={() => {
                  setNamingProfile(false)
                  setProfileName('')
                }}
              >
                Annuler
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="topology-assign-button"
              data-testid="topology-profile-new"
              disabled={unresolvedSlots.length > 0}
              title={
                unresolvedSlots.length > 0
                  ? 'Un slot pointe un modèle introuvable : résolvez-le avant de figer un profil'
                  : undefined
              }
              onClick={() => setNamingProfile(true)}
            >
              ＋ Profil
            </button>
          )}
          {/* Select CONTRÔLÉ : en `defaultValue`, il retombait sur « Profils sauvegardés » après une
              application — rien ne disait plus quel profil était en place. */}
          <select
            aria-label="Appliquer un profil"
            data-testid="topology-profile-select"
            value={pendingProfileId || appliedProfileId}
            disabled={unresolvedSlots.length > 0}
            onChange={(event) => setPendingProfileId(event.target.value)}
          >
            <option value="">Profils sauvegardés</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          {appliedProfileId && (
            <span className="topology-profile-badge" data-testid="topology-profile-applied">
              {profiles.find((profile) => profile.id === appliedProfileId)?.name ??
                appliedProfileId}
              {topologyDirty ? ' · modifié' : ''}
            </span>
          )}
          {/* Appliquer ÉCRASE la topologie courante : le geste se confirme, et il le dit d'autant
              plus fort que la topologie a été modifiée depuis la dernière application. */}
          {pendingProfileId && pendingProfileId !== appliedProfileId && (
            <span
              className="topology-profile-confirm"
              role="alertdialog"
              aria-label="Confirmer l’application du profil"
              data-testid="topology-apply-confirm"
            >
              <span>
                Écraser la topologie courante
                {topologyDirty ? ' (modifications non enregistrées dans un profil)' : ''} ?
              </span>
              <button
                type="button"
                className="topology-assign-button"
                data-testid="topology-apply-yes"
                onClick={() => {
                  const id = pendingProfileId
                  setPendingProfileId('')
                  void applyProfile(id)
                }}
              >
                Appliquer
              </button>
              <button
                type="button"
                className="topology-assign-button"
                data-testid="topology-apply-no"
                onClick={() => setPendingProfileId('')}
              >
                Annuler
              </button>
            </span>
          )}
        </div>
      </header>

      {profilesError && (
        <p
          className="topology-unresolved-banner"
          role="alert"
          data-testid="topology-profiles-error"
        >
          Liste des profils illisible : {profilesError}
          <button
            type="button"
            className="topology-assign-button"
            data-testid="topology-profiles-retry"
            onClick={() => {
              setProfilesError('')
              setProfilesReloadKey((key) => key + 1)
            }}
          >
            Réessayer
          </button>
        </p>
      )}

      {validationError && (
        <p
          className="topology-unresolved-banner"
          role="alert"
          data-testid="topology-validation-error"
        >
          {validationError}
        </p>
      )}

      {unresolvedSlots.length > 0 && (
        <p className="topology-unresolved-banner" role="alert" data-testid="topology-unresolved">
          {unresolvedSlots.length} slot(s) pointent un modèle introuvable au catalogue (
          {unresolvedSlots.map((slot) => slot.slotId).join(', ')}) : profils et application gelés
          tant qu’ils ne sont pas résolus.
        </p>
      )}

      <aside className="topology-library">
        <span className="topology-eyebrow">Modèles importés</span>
        <p>Glissez un modèle sur un slot ou sélectionnez-le puis utilisez Ajouter.</p>
        {sortedModels.some((model) => model.provider === 'gemini') && (
          <button
            type="button"
            className="topology-provider-login"
            onClick={() =>
              // Sans ce retour, un échec de lancement du login (spawn du terminal OAuth impossible)
              // était totalement silencieux : l'utilisateur attend une fenêtre qui ne viendra pas.
              void window.api.providerLogin('gemini').catch((reason: unknown) => {
                // Même défaut que le rafraîchissement : sans `state = 'error'`, le message posé
                // n'était jamais rendu et le bouton semblait sans effet.
                setError(
                  `Le login Gemini n'a pas pu être lancé : ${reason instanceof Error ? reason.message : String(reason)}`
                )
                setState('error')
              })
            }
          >
            Connecter Gemini avec Google
          </button>
        )}
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
            Scouts, Frame, Terrain et Judges : tous les modèles déposés s’exécutent (fan-out +
            agrégation). Orchestrateur et Sous-agents : seul le premier slot alimente le runtime.
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
            target: 'scout',
            title: 'Scouts',
            description: 'Plusieurs lectures indépendantes du même front.',
            accent: 'pink'
          })}
          {renderTargetPanel({
            target: 'frame',
            title: 'Frame',
            description: 'Plusieurs modèles cadrent la même tâche ; angles fusionnés.',
            accent: 'amber'
          })}
          {renderTargetPanel({
            target: 'terrain',
            title: 'Terrain',
            description:
              'Plusieurs modèles préparent le harnais et les preuves ; sorties fusionnées.',
            accent: 'cyan'
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
            <b>Scouts, Frame, Terrain et Judges</b> : déposez-y plusieurs modèles — ils s’exécutent
            en parallèle puis l’orchestrateur agrège (union des sorties pour Scouts/Frame/Terrain,
            quorum de vote pour Judges). <b>Orchestrateur et Sous-agents</b> : seul le premier slot
            alimente le runtime (fan-out des sous-agents pas encore branché).
          </span>
        </div>
      </main>
    </div>
  )
}
