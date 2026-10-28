import { useEffect, useMemo, useRef, useState } from 'react'
import './AgentsTopologyView.css'
import { ModuleHeader } from './ModuleHeader'
import { langueCourante } from '../langue'
import { riche } from '../textes'
import { traduireAgentStudio, useTextesAgentStudio } from '../textes-ecrans/agent-studio'
import { libraryModels } from './model-library'
import { shortModelLabel } from './model-display-label'
import { Spinner } from './Spinner'

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
  const { t } = useTextesAgentStudio()
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
            // Hors `t` : l'effet ne suit que `active`, la langue est lue au moment de l'échec.
            setError(
              traduireAgentStudio('topo.erreur.rafraichissement', langueCourante(), {
                raison: reason instanceof Error ? reason.message : String(reason)
              })
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
      setValidationError(t('topo.erreur.fanout'))
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
                ? t('topo.rang.orchestrateur')
                : target === 'subagents'
                  ? t('topo.rang.sousAgents')
                  : t('topo.rang.panel')}
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
                  <strong>
                    {model ? shortModelLabel(model.label, model.provider) : slot.modelId}
                  </strong>
                  <span>
                    {slot.provider} · {model?.model ?? slot.modelId}
                  </span>
                  {!model && models.length > 0 && (
                    <b
                      className="slot-unresolved"
                      data-testid={`slot-unresolved-${slot.slotId}`}
                      title={t('topo.slot.introuvableTitre', { modele: slot.modelId })}
                    >
                      {t('topo.slot.introuvable')}
                    </b>
                  )}
                </div>
                <label>
                  {/* « Effort » : le même mot en anglais. */}
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
                    title={t('topo.slot.retirer')}
                    onClick={() => remove(target, slot.slotId)}
                  >
                    ×
                  </button>
                )}
                {index === 0 && (
                  <em>
                    {target === 'orchestrator' ? t('topo.slot.actif') : t('topo.slot.roleRuntime')}
                  </em>
                )}
                {/* Fan-out multi-modèles branché pour scout/frame/judge : un slot >1 est RÉELLEMENT
                    exécuté en parallèle puis agrégé par l'orchestrateur. Pour subagents il ne l'est
                    pas encore (seul le 1er slot alimente les phases d'exécution) → marqué non actif. */}
                {index > 0 &&
                  (FANOUT_ACTIVE.has(target) ? (
                    <em className="slot-parallel" title={t('topo.slot.paralleleTitre')}>
                      {t('topo.slot.parallele')}
                    </em>
                  ) : (
                    <em className="slot-inactive" title={t('topo.slot.inactifTitre')}>
                      {t('topo.slot.inactif')}
                    </em>
                  ))}
              </article>
            )
          })}
          {slots.length === 0 && <div className="topology-empty">{t('topo.vide')}</div>}
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
            target === 'subagents' && slots.length > 0 ? t('topo.ajouter.fanoutTitre') : undefined
          }
          onClick={() => assign(selectedModel, target)}
        >
          {target === 'orchestrator'
            ? t('topo.ajouter.remplacer')
            : target === 'subagents' && slots.length > 0
              ? t('topo.ajouter.fanout')
              : t('topo.ajouter.ajouter')}
        </button>
      </section>
    )
  }

  if (!topology) {
    return (
      <div className="agents-topology-loading">
        {state === 'error' ? (
          `⛔ ${error}`
        ) : (
          <>
            <Spinner /> {t('topo.chargement')}
          </>
        )}
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
            {t('topo.reessayer')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="agents-topology">
      <header className="topology-toolbar">
        {/* « Models » : déjà en anglais dans l'écran français. */}
        <ModuleHeader
          eyebrow={t('topo.eyebrow')}
          title="Models"
          description={t('topo.description')}
        />
        <strong
          className={`topology-state is-${state}`}
          role={state === 'error' ? 'alert' : undefined}
        >
          {state === 'saving'
            ? t('topo.etat.enregistrement')
            : state === 'error'
              ? t('topo.etat.erreur', { erreur: error })
              : t('topo.etat.enregistre')}
        </strong>
        <div className="topology-profiles">
          {namingProfile ? (
            <span className="topology-profile-naming">
              <input
                data-testid="topology-profile-name"
                aria-label={t('topo.profil.nom')}
                value={profileName}
                placeholder={t('topo.profil.nom')}
                onChange={(event) => setProfileName(event.target.value)}
              />
              <button
                type="button"
                className="topology-assign-button"
                data-testid="topology-profile-save"
                disabled={!profileName.trim() || unresolvedSlots.length > 0}
                onClick={() => void saveProfile()}
              >
                {t('topo.profil.enregistrer')}
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
                {t('topo.profil.annuler')}
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="topology-assign-button"
              data-testid="topology-profile-new"
              disabled={unresolvedSlots.length > 0}
              title={unresolvedSlots.length > 0 ? t('topo.profil.gelTitre') : undefined}
              onClick={() => setNamingProfile(true)}
            >
              {t('topo.profil.nouveau')}
            </button>
          )}
          {/* Select CONTRÔLÉ : en `defaultValue`, il retombait sur « Profils sauvegardés » après une
              application — rien ne disait plus quel profil était en place. */}
          <select
            aria-label={t('topo.profil.appliquerAria')}
            data-testid="topology-profile-select"
            value={pendingProfileId || appliedProfileId}
            disabled={unresolvedSlots.length > 0}
            onChange={(event) => setPendingProfileId(event.target.value)}
          >
            <option value="">{t('topo.profil.sauvegardes')}</option>
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
              {topologyDirty ? t('topo.profil.modifie') : ''}
            </span>
          )}
          {/* Appliquer ÉCRASE la topologie courante : le geste se confirme, et il le dit d'autant
              plus fort que la topologie a été modifiée depuis la dernière application. */}
          {pendingProfileId && pendingProfileId !== appliedProfileId && (
            <span
              className="topology-profile-confirm"
              role="alertdialog"
              aria-label={t('topo.confirmer.aria')}
              data-testid="topology-apply-confirm"
            >
              <span>
                {t(topologyDirty ? 'topo.confirmer.questionModifiee' : 'topo.confirmer.question')}
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
                {t('topo.confirmer.appliquer')}
              </button>
              <button
                type="button"
                className="topology-assign-button"
                data-testid="topology-apply-no"
                onClick={() => setPendingProfileId('')}
              >
                {t('topo.profil.annuler')}
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
          {t('topo.profils.illisible', { erreur: profilesError })}
          <button
            type="button"
            className="topology-assign-button"
            data-testid="topology-profiles-retry"
            onClick={() => {
              setProfilesError('')
              setProfilesReloadKey((key) => key + 1)
            }}
          >
            {t('topo.reessayer')}
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
          {t('topo.slotsIntrouvables', {
            n: unresolvedSlots.length,
            slots: unresolvedSlots.map((slot) => slot.slotId).join(', ')
          })}
        </p>
      )}

      <aside className="topology-library">
        <span className="topology-eyebrow">{t('topo.biblio.eyebrow')}</span>
        <p>{t('topo.biblio.aide')}</p>
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
                  t('topo.gemini.erreur', {
                    raison: reason instanceof Error ? reason.message : String(reason)
                  })
                )
                setState('error')
              })
            }
          >
            {t('topo.gemini.connecter')}
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
                <strong>{shortModelLabel(model.label, model.provider)}</strong>
                <small>
                  {model.provider}
                  {(() => {
                    // 'none' n'est pas un niveau : on ne l'affiche jamais comme effort.
                    const efforts = model.reasoningEfforts.filter((effort) => effort !== 'none')
                    return efforts.length > 0
                      ? t('topo.modele.efforts', { liste: efforts.join(', ') })
                      : ''
                  })()}
                </small>
              </span>
            </button>
          ))}
        </div>
        <div className="topology-authority-note">
          <b>{t('topo.autorite.titre')}</b>
          <span>{t('topo.autorite.main')}</span>
          <span>{t('topo.autorite.fanout')}</span>
        </div>
      </aside>

      <main className="topology-workspace">
        <div className="topology-primary">
          {renderTargetPanel({
            target: 'orchestrator',
            title: t('topo.orchestrateur.titre'),
            description: t('topo.orchestrateur.description'),
            accent: 'gold'
          })}
          {renderTargetPanel({
            target: 'subagents',
            title: t('topo.sousAgents.titre'),
            description: t('topo.sousAgents.description'),
            accent: 'cyan'
          })}
        </div>
        <div className="topology-parallel-heading">
          <div>
            <span>{t('topo.panels.eyebrow')}</span>
            <h3>{t('topo.panels.titre')}</h3>
          </div>
          <small>{t('topo.panels.note')}</small>
        </div>
        <div className="topology-parallel">
          {renderTargetPanel({
            target: 'scout',
            // « Scouts », « Frame », « Terrain », « Judges » : les noms des phases du moteur.
            title: 'Scouts',
            description: t('topo.scout.description'),
            accent: 'pink'
          })}
          {renderTargetPanel({
            target: 'frame',
            title: 'Frame',
            description: t('topo.frame.description'),
            accent: 'amber'
          })}
          {renderTargetPanel({
            target: 'terrain',
            title: 'Terrain',
            description: t('topo.terrain.description'),
            accent: 'cyan'
          })}
          {renderTargetPanel({
            target: 'judge',
            title: 'Judges',
            description: t('topo.judge.description'),
            accent: 'violet'
          })}
        </div>
        <div className="topology-runtime-limit">
          <b>{t('topo.runtime.titre')}</b>
          <span>{riche(t('topo.runtime.detail'), 'b')}</span>
        </div>
      </main>
    </div>
  )
}
