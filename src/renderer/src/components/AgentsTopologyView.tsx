import { useEffect, useMemo, useRef, useState } from 'react'
import './AgentsTopologyView.css'
import { langueCourante } from '../langue'
import { riche } from '../textes'
import { traduireAgentStudio, useTextesAgentStudio } from '../textes-ecrans/agent-studio'
import { ID_DU_PROFIL_DEFAUT } from '../../../shared/profil-defaut-id'
import { libraryModels } from './model-library'
import { Spinner } from './Spinner'
import { CeQueCaCouvre } from './CeQueCaCouvre'
import type { OrchestratorProviderStatus } from './OrchestratorModelSelector'
import { ModeleDeroulant } from './ModeleDeroulant'
import type { OrchestratorModelOption } from './chat-view-model'
// Même bloc que « Modèle des petites tâches » : mêmes classes (`.router-default`, `.router-hint`).
import './RouterView.css'

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

/**
 * Les seuls panneaux montrés. Scouts, Frame, Judges et Terrain n'en ont plus : les skills lancent
 * elles-mêmes leurs sous-agents, et un workflow place les siens sur une étape. Leurs listes restent
 * dans la topologie enregistrée — le processus principal les lit encore (`runtimeRoleSlots`) —,
 * l'écran ne propose simplement plus d'y mettre un modèle.
 */
type Target = 'orchestrator' | 'subagents'

type CleAgentStudio = Parameters<ReturnType<typeof useTextesAgentStudio>['t']>[0]

/**
 * Ce que couvre chaque panneau : une paire (intitulé, explication) par ligne. Chaque fait est lu
 * dans le processus principal, pas supposé — sans panel scout ni judge, ces rôles se replient sur
 * `subagents[0]`, lui-même sur l'orchestrateur (`runtimeRoleSlots`) ; avec plusieurs sous-agents,
 * scout, frame, terrain et judge tournent sur TOUS (`runtimeFanOutSlots`) ; toute autre étape tombe
 * sur le premier sous-agent (`bindingDeRepliPourPhase`) ; les agents qu'un workflow pose sur un nœud priment
 * (`resolvePhaseFanOut`) ; et les sous-agents qu'une skill lance d'elle-même ne reçoivent que le
 * `--model` de l'agent qui la joue (`appendClaudeSelectionArgs`). Changer l'un de ces
 * comportements, c'est changer ce texte.
 */
const COUVERTURE: Readonly<
  Record<Target, ReadonlyArray<readonly [CleAgentStudio, CleAgentStudio]>>
> = {
  orchestrator: [
    ['topo.couvre.couvre', 'topo.couvre.orchestrateur.couvre'],
    ['topo.couvre.pendant', 'topo.couvre.orchestrateur.pendant'],
    ['topo.couvre.horsChamp', 'topo.couvre.orchestrateur.horsChamp']
  ],
  subagents: [
    ['topo.couvre.couvre', 'topo.couvre.sousAgents.couvre'],
    ['topo.couvre.plusieurs', 'topo.couvre.sousAgents.plusieurs'],
    ['topo.couvre.vide', 'topo.couvre.sousAgents.vide'],
    ['topo.couvre.skills', 'topo.couvre.sousAgents.skills'],
    ['topo.couvre.modeleSkills', 'topo.couvre.sousAgents.modeleSkills']
  ]
}
type Profile = { id: string; name: string; updatedAt: string; topology: AgentTopology }

/**
 * Le menu de modèle d'un rôle : le même menu déroulant que « Modèle des petites tâches » dans Agent
 * Studio. Composant à part, hors de la vue : défini dedans, il serait recréé à chaque rendu et
 * refermerait le menu ouvert.
 */
function MenuDeRole({
  idBase,
  binding,
  models,
  modelsById,
  statuses,
  pending,
  libelle,
  aide,
  onSelect
}: {
  idBase: string
  binding: SlotBinding | null
  models: ImportedModel[]
  modelsById: Map<string, ImportedModel>
  statuses: OrchestratorProviderStatus[] | undefined
  pending: boolean
  libelle: string
  aide: string
  onSelect: (option: OrchestratorModelOption) => void
}): React.JSX.Element {
  const model = binding ? modelsById.get(binding.modelId) : undefined
  return (
    <ModeleDeroulant
      busy={false}
      catalogLoaded
      models={models}
      statuses={statuses}
      binding={
        binding
          ? {
              provider: binding.provider,
              model: model?.model ?? binding.modelId,
              reasoningEffort: binding.reasoningEffort
            }
          : null
      }
      pending={pending}
      // Les échecs d'écriture ont leur badge en tête de vue : pas de second message par menu.
      error={null}
      onSelect={onSelect}
      idBase={idBase}
      libelle={libelle}
      aide={aide}
    />
  )
}

function nextSubagentSlotId(topology: AgentTopology): string {
  const slots = topology.subagents
  let index = slots.length + 1
  while (slots.some((slot) => slot.slotId === `subagent-${index}`)) index += 1
  return `subagent-${index}`
}

export function AgentsTopologyView({
  active = true,
  carteVoisine
}: {
  active?: boolean
  /** Carte posée juste après l'orchestrateur, sur sa rangée (le modèle des petites tâches, dans
   *  Agent Studio). Pendant le chargement de la topologie, elle reste affichée seule. */
  carteVoisine?: React.ReactNode
} = {}): React.JSX.Element {
  const { t } = useTextesAgentStudio()
  const [models, setModels] = useState<ImportedModel[]>([])
  const [topology, setTopology] = useState<AgentTopology | null>(null)
  /** États de connexion des providers : le menu refuse un modèle qu'on ne peut pas joindre. */
  const [statuses, setStatuses] = useState<OrchestratorProviderStatus[] | undefined>(undefined)
  /** Ligne « nouveau sous-agent » ouverte : son menu attend un choix, rien n'est encore écrit. */
  const [ajoutOuvert, setAjoutOuvert] = useState(false)
  /** Le menu dont le choix est en cours d'écriture : lui seul tourne, les autres restent libres. */
  const [slotEnCours, setSlotEnCours] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [error, setError] = useState('')
  const [profiles, setProfiles] = useState<Profile[]>([])
  /** Profil réellement appliqué, l'empreinte de la topologie qu'il a posée, et le profil en attente
   *  de confirmation : appliquer ÉCRASE la topologie courante, ce n'est pas un geste anodin. */
  const [appliedProfileId, setAppliedProfileId] = useState('')
  const [appliedFingerprint, setAppliedFingerprint] = useState('')
  const [pendingProfileId, setPendingProfileId] = useState('')
  /** Profil dont la suppression attend confirmation : un profil supprimé ne se retrouve pas. */
  const [profilASupprimer, setProfilASupprimer] = useState('')
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
        setState('ready')
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason))
        setState('error')
      })
    // À part : un statut illisible laisse simplement tous les modèles choisissables, comme avant —
    // il ne doit pas empêcher la topologie de s'afficher.
    void Promise.resolve(window.api.providerStatus?.())
      .then((liste) => {
        if (Array.isArray(liste)) setStatuses(liste as OrchestratorProviderStatus[])
      })
      .catch(() => setStatuses(undefined))
  }, [reloadKey])
  /**
   * LA VUE RESTE MONTÉE QUAND ON LA QUITTE (App.tsx, `visitedTabs`) et n'écoute les changements de
   * rôles que visible. Un orchestrateur changé ailleurs pendant ce temps — depuis l'en-tête d'un
   * chat, — était donc manqué : en revenant, l'utilisateur voyait l'ANCIEN modèle (vécu le
   * 2026-11-04 : « high » posé à 16:11:08, Agents Studio affichait encore « xhigh »). Chaque RETOUR
   * à l'écran relit donc la topologie ; le premier montage la lit déjà par l'effet ci-dessus.
   */
  const etaitVisibleRef = useRef(active)
  useEffect(() => {
    const revient = active && !etaitVisibleRef.current
    etaitVisibleRef.current = active
    if (!active) return
    const relire = (): void => {
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
    if (revient) relire()
    const off = window.api.onAppEvent((event) => {
      if (event.type === 'refresh' && event.scope === 'roles') relire()
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
  async function deleteProfile(id: string): Promise<void> {
    setError('')
    try {
      setProfiles((await window.api.deleteProfile(id)) as Profile[])
      // La topologie en place reste telle quelle ; seule la pastille qui la nommait disparaît.
      if (id === appliedProfileId) {
        setAppliedProfileId('')
        setAppliedFingerprint('')
      }
      if (id === pendingProfileId) setPendingProfileId('')
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

  async function persist(next: AgentTopology, slotId = ''): Promise<void> {
    const version = ++persistVersionRef.current
    replaceTopology(next)
    setSlotEnCours(slotId)
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
        setSlotEnCours('')
        setState('ready')
      }
    } catch (reason) {
      if (version === persistVersionRef.current) {
        setSlotEnCours('')
        setError(reason instanceof Error ? reason.message : String(reason))
        setState('error')
      }
    }
  }

  /**
   * Le choix du menu (provider + modèle + effort) devient un emplacement de la topologie. Le menu
   * rend le nom de TRANSPORT du modèle (`option.model`) ; la topologie, elle, range l'identifiant du
   * catalogue (`model.id`). Un effort que le modèle ne propose pas retombe sur son effort par défaut.
   */
  function bindingFromOption(option: OrchestratorModelOption, slotId: string): SlotBinding | null {
    const model =
      sortedModels.find((m) => m.provider === option.provider && m.model === option.model) ??
      models.find((m) => m.provider === option.provider && m.model === option.model)
    if (!model) return null
    const effort =
      option.reasoningEffort && model.reasoningEfforts.includes(option.reasoningEffort)
        ? option.reasoningEffort
        : model.defaultReasoningEffort
    return { slotId, provider: model.provider, modelId: model.id, reasoningEffort: effort }
  }

  /** Le même modèle au même effort ferait deux fois le même passage : refusé, et DIT. */
  function estDoublon(slots: SlotBinding[], binding: SlotBinding): boolean {
    return slots.some(
      (slot) =>
        slot.slotId !== binding.slotId &&
        slot.modelId === binding.modelId &&
        slot.reasoningEffort === binding.reasoningEffort
    )
  }

  /** Remplace le modèle d'un emplacement existant (orchestrateur ou un sous-agent). */
  function choisir(target: Target, slotId: string, option: OrchestratorModelOption): void {
    const current = topologyRef.current
    if (!current) return
    const binding = bindingFromOption(option, slotId)
    if (!binding) return
    if (target === 'subagents' && estDoublon(current.subagents, binding)) {
      setValidationError(t('topo.sousAgents.doublon'))
      return
    }
    setValidationError('')
    const next =
      target === 'orchestrator'
        ? { ...current, orchestrator: binding }
        : {
            ...current,
            subagents: current.subagents.map((slot) => (slot.slotId === slotId ? binding : slot))
          }
    void persist(next, slotId)
  }

  /** Ajoute un sous-agent : la ligne « nouveau » n'écrit rien tant qu'aucun modèle n'est choisi. */
  function ajouter(option: OrchestratorModelOption): void {
    const current = topologyRef.current
    if (!current) return
    const slotId = nextSubagentSlotId(current)
    const binding = bindingFromOption(option, slotId)
    if (!binding) return
    if (estDoublon(current.subagents, binding)) {
      setValidationError(t('topo.sousAgents.doublon'))
      return
    }
    setValidationError('')
    setAjoutOuvert(false)
    void persist({ ...current, subagents: [...current.subagents, binding] }, slotId)
  }

  function removeSubagent(slotId: string): void {
    const current = topologyRef.current
    if (!current) return
    setValidationError('')
    void persist({
      ...current,
      subagents: current.subagents.filter((slot) => slot.slotId !== slotId)
    })
  }

  function slotsFor(target: Target): SlotBinding[] {
    if (!topology) return []
    return target === 'orchestrator' ? [topology.orchestrator] : topology.subagents
  }

  function renderTargetPanel({
    target,
    surtitre,
    title,
    description
  }: {
    target: Target
    surtitre: string
    title: string
    description: string
  }): React.JSX.Element {
    const slots = slotsFor(target)
    return (
      <section
        className="router-default topology-panel"
        data-target={target}
        data-testid={`topology-panel-${target}`}
      >
        <header>
          <span className="carte-surtitre">{surtitre}</span>
          <h3>{title}</h3>
          <small>{description}</small>
        </header>
        <CeQueCaCouvre
          id={`topologie-${target}`}
          testId={`topology-couvre-${target}`}
          titre={t('topo.couvre.titre')}
          repliParDefaut
          lignes={COUVERTURE[target].map(([intitule, explication]) => ({
            intitule: t(intitule),
            explication: t(explication)
          }))}
        />
        <div className="topology-lignes">
          {slots.map((slot, index) => {
            const model = modelsById.get(slot.modelId)
            const introuvable = !model && models.length > 0
            return (
              <article
                className={`topology-ligne${introuvable ? ' is-unresolved' : ''}`}
                key={slot.slotId}
                data-slot-id={slot.slotId}
              >
                <MenuDeRole
                  idBase={`topology-modele-${slot.slotId}`}
                  binding={slot}
                  models={sortedModels}
                  modelsById={modelsById}
                  statuses={statuses}
                  pending={state === 'saving' && slotEnCours === slot.slotId}
                  libelle={
                    target === 'orchestrator'
                      ? t('topo.orchestrateur.titre')
                      : t('topo.sousAgents.libelle', { n: index + 1 })
                  }
                  aide={
                    target === 'orchestrator'
                      ? t('topo.orchestrateur.aide')
                      : t('topo.sousAgents.aide')
                  }
                  onSelect={(option) => choisir(target, slot.slotId, option)}
                />
                {introuvable && (
                  <b
                    className="slot-unresolved"
                    data-testid={`slot-unresolved-${slot.slotId}`}
                    title={t('topo.slot.introuvableTitre', { modele: slot.modelId })}
                  >
                    {t('topo.slot.introuvable')}
                  </b>
                )}
                {/* Avec plusieurs sous-agents, seul le premier écrit le code (runtimeFanOutSlots). */}
                {target === 'subagents' && index === 0 && slots.length > 1 && (
                  <em
                    className="topology-ligne-role"
                    title={t('topo.sousAgents.premierTitre')}
                    data-testid="topology-premier-sous-agent"
                  >
                    {t('topo.sousAgents.premier')}
                  </em>
                )}
                {target === 'subagents' && (
                  <button
                    type="button"
                    className="topology-ligne-retirer"
                    title={t('topo.slot.retirer')}
                    aria-label={t('topo.slot.retirer')}
                    data-testid={`topology-retirer-${slot.slotId}`}
                    onClick={() => removeSubagent(slot.slotId)}
                  >
                    ×
                  </button>
                )}
              </article>
            )
          })}
          {target === 'subagents' && ajoutOuvert && (
            <article className="topology-ligne is-nouveau" data-slot-id="nouveau">
              <MenuDeRole
                idBase="topology-modele-nouveau"
                binding={null}
                models={sortedModels}
                modelsById={modelsById}
                statuses={statuses}
                pending={false}
                libelle={t('topo.sousAgents.libelle', { n: slots.length + 1 })}
                aide={t('topo.sousAgents.aide')}
                onSelect={(option) => ajouter(option)}
              />
              <button
                type="button"
                className="topology-ligne-retirer"
                title={t('topo.profil.annuler')}
                aria-label={t('topo.profil.annuler')}
                data-testid="topology-ajout-annuler"
                onClick={() => {
                  setAjoutOuvert(false)
                  setValidationError('')
                }}
              >
                ×
              </button>
            </article>
          )}
          {target === 'subagents' && slots.length === 0 && !ajoutOuvert && (
            <p className="router-hint" data-testid="topology-sous-agents-vide">
              {t('topo.sousAgents.vide')}
            </p>
          )}
        </div>
        {target === 'subagents' && !ajoutOuvert && (
          <button
            type="button"
            className="router-petites-taches-reset topology-ajouter"
            data-testid="topology-add-subagents"
            disabled={sortedModels.length === 0}
            onClick={() => setAjoutOuvert(true)}
          >
            {t('topo.sousAgents.ajouter')}
          </button>
        )}
      </section>
    )
  }

  if (!topology) {
    return (
      <>
        {carteVoisine}
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
      </>
    )
  }

  return (
    <div className="agents-topology">
      {/* Les profils sont au premier plan : une pastille par profil enregistré, celle en place en or.
          Pas de titre ici, l'en-tête d'Agent Studio le porte déjà. */}
      <header className="topology-toolbar">
        <div
          className="topology-profiles"
          role="group"
          aria-label={t('topo.profil.appliquerAria')}
          data-testid="topology-profile-select"
        >
          {profiles.map((profile) => {
            const enPlace = profile.id === appliedProfileId
            return (
              <span className="topology-profil-groupe" key={profile.id}>
                <button
                  type="button"
                  className={`topology-profil${enPlace ? ' is-applique' : ''}${
                    profile.id === pendingProfileId ? ' is-en-attente' : ''
                  }`}
                  data-profile-id={profile.id}
                  data-testid={enPlace ? 'topology-profile-applied' : undefined}
                  aria-pressed={enPlace}
                  disabled={unresolvedSlots.length > 0}
                  title={unresolvedSlots.length > 0 ? t('topo.profil.gelTitre') : undefined}
                  onClick={() => {
                    setProfilASupprimer('')
                    setPendingProfileId(enPlace ? '' : profile.id)
                  }}
                >
                  {profile.name}
                  {enPlace && topologyDirty ? t('topo.profil.modifie') : ''}
                </button>
                {/* « Défaut » est fourni par l'application : il n'a pas de croix. La croix reste
                    active même gelée, car supprimer n'écrit rien dans la topologie. */}
                {profile.id !== ID_DU_PROFIL_DEFAUT && (
                  <button
                    type="button"
                    className={`topology-profil-supprimer${
                      profile.id === profilASupprimer ? ' is-en-attente' : ''
                    }`}
                    data-testid={`topology-profile-delete-${profile.id}`}
                    title={t('topo.profil.supprimer', { nom: profile.name })}
                    aria-label={t('topo.profil.supprimer', { nom: profile.name })}
                    onClick={() => {
                      setPendingProfileId('')
                      setProfilASupprimer(profile.id === profilASupprimer ? '' : profile.id)
                    }}
                  >
                    ×
                  </button>
                )}
              </span>
            )
          })}
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
              className="topology-profil is-nouveau"
              data-testid="topology-profile-new"
              disabled={unresolvedSlots.length > 0}
              title={unresolvedSlots.length > 0 ? t('topo.profil.gelTitre') : undefined}
              onClick={() => setNamingProfile(true)}
            >
              {t('topo.profil.nouveau')}
            </button>
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
          {profilASupprimer && (
            <span
              className="topology-profile-confirm"
              role="alertdialog"
              aria-label={t('topo.supprimer.aria')}
              data-testid="topology-delete-confirm"
            >
              <span>
                {t('topo.supprimer.question', {
                  nom: profiles.find((p) => p.id === profilASupprimer)?.name ?? profilASupprimer
                })}
              </span>
              <button
                type="button"
                className="topology-assign-button"
                data-testid="topology-delete-yes"
                onClick={() => {
                  const id = profilASupprimer
                  setProfilASupprimer('')
                  void deleteProfile(id)
                }}
              >
                {t('topo.supprimer.confirmer')}
              </button>
              <button
                type="button"
                className="topology-assign-button"
                data-testid="topology-delete-no"
                onClick={() => setProfilASupprimer('')}
              >
                {t('topo.profil.annuler')}
              </button>
            </span>
          )}
        </div>
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

      {/* Chaque rôle se règle par son menu de modèle, le même que « Modèle des petites tâches » :
          un seul geste à connaître dans tout Agent Studio. */}
      <main className="topology-workspace">
        {/* L'orchestrateur d'abord : c'est le modèle qui répond dans le chat, le premier réglé. */}
        {renderTargetPanel({
          target: 'orchestrator',
          surtitre: t('studio.surtitre.orchestrateur'),
          title: t('topo.orchestrateur.titre'),
          description: t('topo.orchestrateur.description')
        })}
        {carteVoisine}
        {renderTargetPanel({
          target: 'subagents',
          surtitre: t('studio.surtitre.sousAgents'),
          title: t('topo.sousAgents.titre'),
          description: t('topo.sousAgents.description')
        })}
        <div className="topology-runtime-limit">
          <b>{t('topo.runtime.titre')}</b>
          <span>
            {riche(t('topo.runtime.detail'), 'b')}
            <br />
            {riche(t('topo.runtime.workflow'), 'b')}
          </span>
        </div>
      </main>
    </div>
  )
}
