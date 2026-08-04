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
    parts.push(profile.instructions.mode === 'replace' ? 'consignes remplacées' : 'consigne ajoutée')
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
            Une façon de travailler nommée — modèles, efforts, phases, consignes. Sélectionne-la pour
            comparer plus tard le même objectif sous plusieurs workflows.
          </p>
        </div>
        <button type="button" onClick={() => void create()} data-testid="workflow-create">
          Nouveau workflow
        </button>
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
              <span className="workflow-profile-name">Configuration courante</span>
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
              <button
                type="button"
                className="workflow-profile-pick"
                data-testid={`workflow-pick-${profile.id}`}
                aria-pressed={file.activeId === profile.id}
                onClick={() => void select(profile.id)}
              >
                <span className="workflow-profile-name">{profile.name}</span>
                <span className="workflow-profile-summary">{profileSummary(profile)}</span>
                {profile.description && (
                  <span className="workflow-profile-desc">{profile.description}</span>
                )}
              </button>
              {file.activeId === profile.id && (
                <WorkflowGraphEditor
                  profile={profile}
                  onSave={(graph) => void save({ ...profile, graph })}
                />
              )}
              <button
                type="button"
                className="workflow-profile-remove"
                data-testid={`workflow-remove-${profile.id}`}
                title={`Supprimer ${profile.name}`}
                onClick={() => void remove(profile.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <WorkflowBenchPanel profiles={file.profiles} />
    </section>
  )
}
