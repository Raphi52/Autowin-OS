import { useCallback, useEffect, useState } from 'react'
import { WorkflowBenchPanel } from './WorkflowBenchPanel'
import { WorkflowGraphEditor } from './WorkflowGraphEditor'
import './WorkflowProfilesView.css'

/**
 * Choisir SA façon de travailler.
 *
 * La manière dont un run se déroule était éparpillée : modèles et efforts dans les rôles, phases
 * dans le régime, consignes dans les skills. Impossible de dire « lance ça en Rapide, puis en
 * Rigoureux, et compare ». Cette vue rend le workflow nommable, sélectionnable — et confrontable :
 * le panneau du bas rejoue un même objectif sous plusieurs d'entre eux et en compare le résultat.
 */

interface WorkflowProfile {
  id: string
  name: string
  description?: string
  roles?: Record<string, { provider?: string; model?: string; reasoningEffort?: string }>
  phases?: string[]
  graph?: import('./WorkflowCanvas').CanvasGraph
  allocation?: { judgeMembers?: number; maxGreedyNodes?: number }
  instructions?: { mode: 'append' | 'replace'; text?: string }
}

interface ProfilesFile {
  profiles: WorkflowProfile[]
  activeId: string | null
}

/**
 * Icônes en SVG inline : un glyphe typographique détourné (× ↥ ↩) dépend de la police installée et
 * s'aligne mal. Trait de 1,5 px, `currentColor`, 14 px — elles héritent donc de la couleur du bouton,
 * y compris à son survol.
 */
function Icone({ nom }: { nom: 'import' | 'export' | 'plus' | 'poubelle' }): React.JSX.Element {
  const traces: Record<typeof nom, string> = {
    // Flèche vers le BAS dans un bac : ce qui entre dans l'application.
    import: 'M8 2v7m0 0 3-3m-3 3L5 6M2.5 11v1.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V11',
    // Flèche vers le HAUT hors du bac : ce qui en sort.
    export: 'M8 9V2m0 0 3 3M8 2 5 5M2.5 11v1.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V11',
    plus: 'M8 3.5v9M3.5 8h9',
    poubelle: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2a1 1 0 0 0 1 .8h3.8a1 1 0 0 0 1-.8l.6-8.2'
  }
  return (
    <svg
      className="wf-icone"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={traces[nom]} />
    </svg>
  )
}

/* ── La portée : la topologie d'un workflow lue d'un seul regard, sans l'ouvrir ── */
const TN_W = 118
const TN_GAP = 34
const TRACK_PAD = 14

/** Les nœuds d'un profil, que sa topologie vienne du graphe composé ou de ses seules phases. */
function trackNodes(profile: WorkflowProfile): { id: string; phase: string; agents: number }[] {
  if (profile.graph?.nodes?.length) {
    return profile.graph.nodes.map((n) => ({
      id: n.id,
      phase: n.phase,
      agents: n.agents?.length ?? 1
    }))
  }
  const vus = new Map<string, number>()
  return (profile.phases ?? []).map((phase) => {
    const rang = (vus.get(phase) ?? 0) + 1
    vus.set(phase, rang)
    return { id: `${phase}-${rang}`, phase, agents: 1 }
  })
}

/**
 * Une portée horizontale par workflow. C'est ce qui permet de COMPARER sans cliquer : la séquence, la
 * densité de fan-out et les retours bornés se lisent côte à côte, workflow après workflow.
 */
function WorkflowTrack({ profile }: { profile: WorkflowProfile }): React.JSX.Element | null {
  const nodes = trackNodes(profile)
  if (!nodes.length) return null
  const rang = new Map(nodes.map((n, i) => [n.id, i]))
  const retours = (profile.graph?.edges ?? []).filter((e) => e.when !== 'always')
  const centre = (i: number): number => TRACK_PAD + i * (TN_W + TN_GAP) + TN_W / 2
  const largeur = TRACK_PAD * 2 + nodes.length * TN_W + (nodes.length - 1) * TN_GAP
  // Les arcs de retour partent du BAS des pastilles (top 8px + ~36px de contenu) : un arc qui démarre
  // dans le vide se lit comme une flèche orpheline plutôt que comme un retour entre deux phases.
  const basPastille = 46
  const hauteur = basPastille + (retours.length ? 18 + retours.length * 16 : 4)

  return (
    <div
      className="wf-track"
      style={{ width: largeur, height: hauteur }}
      data-testid={`wf-track-${profile.id}`}
    >
      <svg width={largeur} height={hauteur} aria-hidden="true">
        <defs>
          <marker id="wft-r" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 z" className="wf-ar-r" />
          </marker>
        </defs>
        <line x1={TRACK_PAD} y1="30" x2={largeur - TRACK_PAD} y2="30" className="wf-track-line" />
        {retours.map((edge, i) => {
          const a = rang.get(edge.from)
          const b = rang.get(edge.to)
          if (a === undefined || b === undefined) return null
          const creux = basPastille + 14 + i * 16
          return (
            <path
              key={`${edge.from}>${edge.to}`}
              d={`M${centre(a)} ${basPastille} C${centre(a)} ${creux}, ${centre(b)} ${creux}, ${centre(b)} ${basPastille + 4}`}
              className={`wf-track-arc wf-wire-${edge.when}`}
              markerEnd="url(#wft-r)"
            />
          )
        })}
      </svg>
      {nodes.map((node, i) => (
        <span
          key={node.id}
          className={`wf-tn wf-ph-${node.phase}`}
          style={{ left: TRACK_PAD + i * (TN_W + TN_GAP), width: TN_W }}
        >
          <span className="wf-tn-head">
            <span className="wf-dot" />
            {node.phase}
          </span>
          <span className="wf-tn-ags">
            {Array.from({ length: node.agents }, (_, k) => (
              <i className="wf-ag" key={k} />
            ))}
          </span>
        </span>
      ))}
    </div>
  )
}

/** Résume un profil en une ligne : ce qu'il change, pas ce qu'il contient. */
export function profileSummary(profile: WorkflowProfile): string {
  const parts: string[] = []
  const roles = Object.entries(profile.roles ?? {})
  if (roles.length) {
    parts.push(
      roles
        .map(([role, binding]) =>
          [role, binding.model, binding.reasoningEffort].filter(Boolean).join(' ')
        )
        .join(' · ')
    )
  }
  if (profile.phases?.length) parts.push(profile.phases.join(' → '))
  if (typeof profile.allocation?.judgeMembers === 'number') {
    parts.push(`${profile.allocation.judgeMembers} juge(s)`)
  }
  if (profile.instructions) {
    parts.push(
      profile.instructions.mode === 'replace' ? 'consignes remplacées' : 'consigne ajoutée'
    )
  }
  // Un profil qui ne change rien est légitime (référence de comparaison) — on le dit au lieu
  // d'afficher une ligne vide.
  return parts.length ? parts.join(' · ') : 'aucun écart — configuration courante'
}

export function WorkflowProfilesView({ active }: { active: boolean }): React.JSX.Element {
  const [file, setFile] = useState<ProfilesFile>({ profiles: [], activeId: null })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const next = (await window.api.workflowProfiles?.()) as ProfilesFile | undefined
      if (next) setFile(next)
    } catch {
      setError('Impossible de lire les workflows.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (active) void refresh()
  }, [active, refresh])

  const select = async (id: string | null): Promise<void> => {
    try {
      const next = (await window.api.workflowProfileSelect?.(id)) as ProfilesFile | undefined
      if (next) setFile(next)
    } catch {
      setError('La sélection n’a pas pu être enregistrée.')
    }
  }

  const remove = async (id: string): Promise<void> => {
    try {
      const next = (await window.api.workflowProfileRemove?.(id)) as ProfilesFile | undefined
      if (next) setFile(next)
    } catch {
      setError('La suppression a échoué.')
    }
  }

  const save = async (profile: WorkflowProfile): Promise<void> => {
    try {
      const next = (await window.api.workflowProfileSave?.(profile)) as ProfilesFile | undefined
      if (next) setFile(next)
    } catch {
      setError('L’enregistrement a échoué.')
    }
  }

  /** `id` nul = tout le fichier ; un id = ce seul workflow, pour en partager un sans donner le reste. */
  const exporter = async (id: string | null): Promise<void> => {
    try {
      const res = await window.api.workflowProfilesExport?.(id)
      // Une annulation n'est pas une erreur : on ne crie pas quand l'utilisateur ferme la boîte.
      if (res && !res.ok && res.reason && res.reason !== 'annulé') setError(`Export : ${res.reason}`)
    } catch {
      setError('L’export a échoué.')
    }
  }

  const importer = async (): Promise<void> => {
    setError(undefined)
    try {
      const res = await window.api.workflowProfilesImport?.()
      if (!res) return
      if (res.file) setFile(res.file)
      if (!res.ok && res.reason && res.reason !== 'annulé') {
        setError(`Import : ${res.reason}`)
        return
      }
      // Ce qui a été ÉCARTÉ se dit : un import silencieux qui perd la moitié du fichier ment.
      if (res.rejected?.length) {
        setError(
          `${res.imported ?? 0} workflow(s) importé(s) ; ${res.rejected.length} écarté(s) : ${res.rejected.join(', ')}`
        )
      }
    } catch {
      setError('L’import a échoué.')
    }
  }

  const create = async (): Promise<void> => {
    // Un identifiant lisible dérivé du rang : on ne demande pas à l'utilisateur d'inventer une clé.
    const rang = file.profiles.length + 1
    try {
      const next = (await window.api.workflowProfileSave?.({
        id: `workflow-${rang}`,
        name: `Workflow ${rang}`
      })) as ProfilesFile | undefined
      if (next) setFile(next)
    } catch {
      setError('La création a échoué.')
    }
  }

  return (
    <section className="workflow-profiles" data-testid="workflow-profiles-view">
      <header className="workflow-profiles-head">
        <div>
          <h2>Workflows</h2>
          <p className="workflow-profiles-sub">
            Une façon de travailler nommée — modèles, efforts, phases, consignes. Sélectionne-la
            pour comparer plus tard le même objectif sous plusieurs workflows.
          </p>
        </div>
        <div className="workflow-profiles-actions">
          <button type="button" onClick={() => void importer()} data-testid="workflow-import">
            <Icone nom="import" />
            Importer
          </button>
          <button
            type="button"
            onClick={() => void exporter(null)}
            data-testid="workflow-export-all"
            disabled={file.profiles.length === 0}
          >
            <Icone nom="export" />
            Tout exporter
          </button>
          <button type="button" onClick={() => void create()} data-testid="workflow-create">
            <Icone nom="plus" />
            Nouveau
          </button>
        </div>
      </header>

      {error && (
        <p className="workflow-profiles-error" role="alert">
          {error}
        </p>
      )}

      {file.profiles.length === 0 && !loading ? (
        <p className="workflow-profiles-empty" data-testid="workflow-empty">
          Aucun workflow pour l’instant. Crée-en un pour figer une façon de travailler et pouvoir la
          comparer à une autre.
        </p>
      ) : (
        <ul className="workflow-profiles-list">
          <li className={`workflow-profile${file.activeId === null ? ' is-active' : ''}`}>
            <button
              type="button"
              className="workflow-profile-pick"
              data-testid="workflow-pick-none"
              aria-pressed={file.activeId === null}
              onClick={() => void select(null)}
            >
              {/* Le badge marque CE QUI EST EN VIGUEUR, y compris quand c'est « aucun workflow ».
                  Le réserver aux profils faisait disparaître tout repère dès qu'on revenait ici :
                  plus rien à l'écran ne disait sous quel régime le chat allait tourner. */}
              <span className="workflow-profile-line">
                <span className="workflow-profile-name workflow-profile-name-static">
                  Configuration courante
                </span>
                {file.activeId === null && (
                  <span className="wf-badge is-on" data-testid="workflow-active-none">
                    actif
                  </span>
                )}
              </span>
              <span className="workflow-profile-summary">
                Aucun workflow imposé — les réglages d’Agent Studio s’appliquent.
              </span>
            </button>
          </li>
          {file.profiles.map((profile) => (
            <li
              key={profile.id}
              className={`workflow-profile${file.activeId === profile.id ? ' is-active' : ''}`}
              data-testid={`workflow-profile-${profile.id}`}
            >
              {/* En-tête sur UNE ligne, puis portée et éditeur PLEINE LARGEUR dessous. Sans cette
                  séparation, la ligne étant un flex horizontal, l'éditeur se retrouvait comprimé
                  dans une colonne entre le bouton de sélection et la croix de suppression. */}
              <div className="workflow-profile-row">
                <button
                  type="button"
                  className="workflow-profile-pick"
                  data-testid={`workflow-pick-${profile.id}`}
                  aria-pressed={file.activeId === profile.id}
                  onClick={() => void select(profile.id)}
                >
                  <span className="workflow-profile-line">
                    {/* Le nom se corrige SUR PLACE. Un workflow créé « Workflow 3 » et jamais
                        renommable ne se distingue plus de ses voisins dès qu'il y en a quatre. */}
                    <input
                      className="workflow-profile-name"
                      data-testid={`workflow-rename-${profile.id}`}
                      value={profile.name}
                      aria-label={`Nom du workflow ${profile.name}`}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const name = e.target.value
                        // Un nom vide rendrait le profil illisible ET le ferait rejeter à la
                        // relecture : on refuse l'enregistrement plutôt que de le perdre.
                        if (name.trim()) void save({ ...profile, name })
                      }}
                    />
                    {file.activeId === profile.id && <span className="wf-badge is-on">actif</span>}
                    <span className="workflow-profile-summary">{profileSummary(profile)}</span>
                  </span>
                  {profile.description && (
                    <span className="workflow-profile-desc">{profile.description}</span>
                  )}
                </button>
                <button
                  type="button"
                  className="workflow-profile-remove"
                  data-testid={`workflow-export-${profile.id}`}
                  title={`Exporter ${profile.name}`}
                  aria-label={`Exporter ${profile.name}`}
                  onClick={() => void exporter(profile.id)}
                >
                  <Icone nom="export" />
                </button>
                <button
                  type="button"
                  className="workflow-profile-remove"
                  data-testid={`workflow-remove-${profile.id}`}
                  title={`Supprimer ${profile.name}`}
                  aria-label={`Supprimer ${profile.name}`}
                  onClick={() => void remove(profile.id)}
                >
                  <Icone nom="poubelle" />
                </button>
              </div>
              {/* La portée reste visible même quand l'éditeur est ouvert : on ne perd jamais la vue d'ensemble. */}
              <WorkflowTrack profile={profile} />
              {file.activeId === profile.id && (
                <WorkflowGraphEditor
                  profile={profile}
                  onSave={(graph) => void save({ ...profile, graph })}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <WorkflowBenchPanel profiles={file.profiles} />
    </section>
  )
}
