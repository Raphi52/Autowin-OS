import { useEffect, useMemo, useState } from 'react'
import {
  assignResource,
  configureInvocation,
  moveAssignment,
  removeAssignment as removeWorkflowAssignment,
  restoreAgentWorkflow,
  type AgentAssignment,
  type AgentPersona,
  type AgentResource,
  type AgentStageId,
  type AgentWorkflow,
  type InvocationConfiguration
} from './agent-workflow-model'
import './RolesView.css'
import { autowinStorageKey, readMigratedStorageValue } from '../storage-keys'
export { AgentsTopologyView as RolesView } from './AgentsTopologyView'

type Bindings = Record<string, { provider: string; model?: string }>
type StudioMode = 'frames' | 'matrix'
type DragPayload =
  | { type: 'resource'; id: string }
  | { type: 'persona'; id: string }
  | { type: 'assignment'; id: string }

const STORAGE_SUFFIX = 'agent-workflow.v1'
const DEFAULT_PERSONA: Record<AgentStageId, string> = {
  scout: 'target-scout',
  frame: 'solution-framer',
  terrain: 'terrain-engineer',
  build: 'bounded-builder',
  judge: 'adversarial-reviewer'
}

function parseDrag(event: React.DragEvent): DragPayload | null {
  try {
    return JSON.parse(event.dataTransfer.getData('application/x-agent-studio')) as DragPayload
  } catch {
    return null
  }
}

function beginDrag(event: React.DragEvent, payload: DragPayload): void {
  event.dataTransfer.effectAllowed = payload.type === 'assignment' ? 'move' : 'copy'
  event.dataTransfer.setData('application/x-agent-studio', JSON.stringify(payload))
}

function resourceFor(
  workflow: AgentWorkflow,
  assignment: AgentAssignment
): AgentResource | undefined {
  return workflow.resources.find((resource) => resource.id === assignment.resourceId)
}

function personaFor(
  workflow: AgentWorkflow,
  assignment: AgentAssignment
): AgentPersona | undefined {
  return workflow.personas.find((persona) => persona.id === assignment.personaId)
}

function AssignmentCard({
  assignment,
  workflow,
  selected,
  expanded,
  onSelect,
  onToggle,
  onRemove
}: {
  assignment: AgentAssignment
  workflow: AgentWorkflow
  selected: boolean
  expanded: boolean
  onSelect: () => void
  onToggle: () => void
  onRemove: () => void
}): React.JSX.Element {
  const resource = resourceFor(workflow, assignment)
  const persona = personaFor(workflow, assignment)
  const composed = Boolean(resource?.steps?.length)

  return (
    <article
      className={`studio-assignment${selected ? ' is-selected' : ''}${composed ? ' is-skill' : ''}`}
      draggable
      onDragStart={(event) => beginDrag(event, { type: 'assignment', id: assignment.id })}
      onClick={onSelect}
      data-assignment-id={assignment.id}
    >
      <span className="studio-live-dot" />
      <button
        type="button"
        className="studio-remove"
        title="Retirer l’affectation"
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
      >
        ×
      </button>
      <strong>{persona?.label ?? assignment.personaId}</strong>
      <small>{resource?.label ?? assignment.resourceId}</small>
      <div className="studio-injection-meta">
        <span>
          {assignment.stageId} → {assignment.slotId}
        </span>
        <span>
          {assignment.trigger} · {assignment.mode} #{assignment.order + 1}
        </span>
        <span>
          {assignment.modelId ?? 'Modèle non affecté'}
          {assignment.reasoningEffort ? ` · ${assignment.reasoningEffort}` : ''}
        </span>
      </div>
      {composed && (
        <button
          type="button"
          className="studio-expand"
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
        >
          {expanded ? 'Replier' : 'Déplier'}
        </button>
      )}
      {composed && expanded && (
        <div className="studio-skill-steps">
          {resource?.steps?.map((step, index) => (
            <span key={step}>
              {String(index + 1).padStart(2, '0')} · {step}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

export function LegacyRolesView(): React.JSX.Element {
  const [bindings, setBindings] = useState<Bindings>({})
  const [providers, setProviders] = useState<string[]>([])
  const [mode, setMode] = useState<StudioMode>('frames')
  const [query, setQuery] = useState('')
  const [workflow, setWorkflow] = useState<AgentWorkflow>(() =>
    restoreAgentWorkflow(readMigratedStorageValue(localStorage, STORAGE_SUFFIX))
  )
  const [selectedId, setSelectedId] = useState('judge-skill')
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(() => new Set(['judge-skill']))
  const [dropTarget, setDropTarget] = useState('')

  useEffect(() => {
    Promise.all([window.api.roles(), window.api.listProviders()]).then(([roles, ids]) => {
      setBindings(roles)
      setProviders(ids)
    })
  }, [])

  useEffect(() => {
    localStorage.setItem(autowinStorageKey(STORAGE_SUFFIX), JSON.stringify(workflow))
  }, [workflow])

  const selected = workflow.assignments.find((assignment) => assignment.id === selectedId)
  const selectedResource = selected ? resourceFor(workflow, selected) : undefined
  const selectedPersona = selected ? personaFor(workflow, selected) : undefined
  const selectedBinding = selectedResource?.role ? bindings[selectedResource.role] : undefined

  const assignmentsByStage = useMemo(
    () =>
      Object.fromEntries(
        workflow.stages.map((stage) => [
          stage.id,
          workflow.assignments.filter((assignment) => assignment.stageId === stage.id)
        ])
      ) as Record<AgentStageId, AgentAssignment[]>,
    [workflow]
  )
  const matchesQuery = (...values: string[]): boolean =>
    values.join(' ').toLocaleLowerCase('fr').includes(query.trim().toLocaleLowerCase('fr'))

  function drop(payload: DragPayload | null, stageId: AgentStageId, personaId?: string): void {
    setDropTarget('')
    if (!payload) return

    if (payload.type === 'assignment') {
      const assignment = workflow.assignments.find((candidate) => candidate.id === payload.id)
      if (!assignment) return
      const targetPersonaId = personaId ?? assignment.personaId
      const targetPersona = workflow.personas.find((candidate) => candidate.id === targetPersonaId)
      const resource = resourceFor(workflow, assignment)
      if (resource?.kind === 'skill' && resource.id !== stageId) return
      if (resource?.kind === 'skill' && !targetPersona?.skills.includes(resource.id)) return

      setWorkflow(moveAssignment(workflow, payload.id, stageId, targetPersonaId))
      setSelectedId(payload.id)
      return
    }

    if (payload.type === 'persona') {
      const persona = workflow.personas.find((candidate) => candidate.id === payload.id)
      if (!persona?.skills.includes(stageId)) return
      const next = assignResource(workflow, stageId, stageId, payload.id)
      setWorkflow(next)
      setSelectedId(next.assignments.at(-1)?.id ?? selectedId)
      return
    }

    const resource = workflow.resources.find((candidate) => candidate.id === payload.id)
    const targetPersonaId =
      personaId ??
      (resource?.kind === 'skill'
        ? workflow.personas.find((persona) => persona.skills.includes(payload.id))?.id
        : DEFAULT_PERSONA[stageId])
    const targetPersona = workflow.personas.find((candidate) => candidate.id === targetPersonaId)
    if (!targetPersonaId) return
    if (resource?.kind === 'skill' && resource.id !== stageId) return
    if (resource?.kind === 'skill' && !targetPersona?.skills.includes(resource.id)) return

    const next = assignResource(workflow, payload.id, stageId, targetPersonaId)
    setWorkflow(next)
    setSelectedId(next.assignments.at(-1)?.id ?? selectedId)
  }

  async function changeBinding(provider: string, model?: string): Promise<void> {
    if (!selectedResource?.role) return
    const next = (await window.api.setRole(
      selectedResource.role,
      provider,
      model || undefined
    )) as Bindings
    setBindings(next)
  }

  function updateInvocation(patch: Partial<InvocationConfiguration>): void {
    if (!selected) return
    setWorkflow((current) => configureInvocation(current, selected.id, patch))
  }

  function toggleSkill(id: string): void {
    setExpandedSkills((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function removeAssignment(id: string): void {
    const next = removeWorkflowAssignment(workflow, id)
    setWorkflow(next)
    if (selectedId === id) setSelectedId(next.assignments[0]?.id ?? '')
  }

  return (
    <div className="agent-studio">
      <header className="studio-toolbar">
        <div>
          <span className="studio-kicker">Agent Studio</span>
          <h2>{workflow.label}</h2>
        </div>
        <span className="studio-regime">Workflow · Standard</span>
        <div className="studio-mode-switch" aria-label="Mode d'affichage">
          <button
            type="button"
            className={mode === 'frames' ? 'is-active' : ''}
            onClick={() => setMode('frames')}
          >
            Frames
          </button>
          <button
            type="button"
            className={mode === 'matrix' ? 'is-active' : ''}
            onClick={() => setMode('matrix')}
          >
            Matrice
          </button>
        </div>
        <span className="studio-save-state">Brouillon local enregistré</span>
      </header>

      <aside className="studio-library">
        <span className="studio-eyebrow">Bibliothèque</span>
        <input
          className="input studio-search"
          placeholder="Rechercher agent, persona, skill"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <h3>Personas de sous-agents</h3>
        {workflow.personas
          .filter((persona) =>
            matchesQuery(persona.label, persona.objective, persona.prompt, ...persona.skills)
          )
          .map((persona) => (
            <button
              type="button"
              draggable
              className="studio-resource"
              key={persona.id}
              onDragStart={(event) => beginDrag(event, { type: 'persona', id: persona.id })}
            >
              <i>{persona.initials}</i>
              <span>
                <strong>{persona.label}</strong>
                <small>{persona.objective}</small>
              </span>
            </button>
          ))}
        <h3>Agents système</h3>
        {workflow.resources
          .filter((resource) => resource.kind === 'agent')
          .filter((resource) => matchesQuery(resource.label, resource.description))
          .map((resource) => (
            <button
              type="button"
              draggable
              className="studio-resource"
              key={resource.id}
              onDragStart={(event) => beginDrag(event, { type: 'resource', id: resource.id })}
            >
              <i>{resource.label.slice(0, 1)}</i>
              <span>
                <strong>{resource.label}</strong>
                <small>{resource.description}</small>
              </span>
            </button>
          ))}
        <h3>Skills composées</h3>
        {workflow.resources
          .filter((resource) => resource.kind === 'skill')
          .filter((resource) => matchesQuery(resource.label, resource.description))
          .map((resource) => (
            <button
              type="button"
              draggable
              className="studio-resource is-skill"
              key={resource.id}
              onDragStart={(event) => beginDrag(event, { type: 'resource', id: resource.id })}
            >
              <i>{resource.label.slice(0, 1)}</i>
              <span>
                <strong>{resource.label}</strong>
                <small>{resource.description}</small>
              </span>
            </button>
          ))}
      </aside>

      <main className="studio-canvas">
        {mode === 'frames' ? (
          <div className="studio-frames" data-view="frames">
            {workflow.stages.map((stage) => (
              <section
                className={`studio-frame${dropTarget === stage.id ? ' is-drop-target' : ''}`}
                key={stage.id}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDropTarget(stage.id)
                }}
                onDragLeave={() => setDropTarget('')}
                onDrop={(event) => {
                  event.preventDefault()
                  drop(parseDrag(event), stage.id)
                }}
              >
                <header>
                  <span>{String(stage.order).padStart(2, '0')}</span>
                  <div>
                    <h3>{stage.label}</h3>
                    <p>{stage.description}</p>
                  </div>
                  <small>{assignmentsByStage[stage.id].length}</small>
                </header>
                <div className="studio-frame-slot">
                  {assignmentsByStage[stage.id].map((assignment) => (
                    <AssignmentCard
                      key={assignment.id}
                      assignment={assignment}
                      workflow={workflow}
                      selected={selectedId === assignment.id}
                      expanded={expandedSkills.has(assignment.id)}
                      onSelect={() => setSelectedId(assignment.id)}
                      onToggle={() => toggleSkill(assignment.id)}
                      onRemove={() => removeAssignment(assignment.id)}
                    />
                  ))}
                  {assignmentsByStage[stage.id].length === 0 && <em>Déposer ici</em>}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="studio-matrix" data-view="matrix">
            <div className="studio-matrix-grid">
              <div className="studio-matrix-corner">Sous-agent / objectif</div>
              {workflow.stages.map((stage) => (
                <div className="studio-matrix-head" key={stage.id}>
                  {String(stage.order).padStart(2, '0')}
                  <strong>{stage.label}</strong>
                </div>
              ))}
              {workflow.personas.map((persona) => (
                <div className="studio-matrix-row" key={persona.id}>
                  <div className="studio-persona-cell">
                    <strong>{persona.label}</strong>
                    <p>{persona.objective}</p>
                  </div>
                  {workflow.stages.map((stage) => {
                    const cellId = `${persona.id}:${stage.id}`
                    const assignments = workflow.assignments.filter(
                      (assignment) =>
                        assignment.personaId === persona.id && assignment.stageId === stage.id
                    )
                    return (
                      <div
                        className={`studio-matrix-cell${dropTarget === cellId ? ' is-drop-target' : ''}`}
                        key={stage.id}
                        onDragOver={(event) => {
                          event.preventDefault()
                          setDropTarget(cellId)
                        }}
                        onDragLeave={() => setDropTarget('')}
                        onDrop={(event) => {
                          event.preventDefault()
                          drop(parseDrag(event), stage.id, persona.id)
                        }}
                      >
                        {assignments.map((assignment) => (
                          <AssignmentCard
                            key={assignment.id}
                            assignment={assignment}
                            workflow={workflow}
                            selected={selectedId === assignment.id}
                            expanded={expandedSkills.has(assignment.id)}
                            onSelect={() => setSelectedId(assignment.id)}
                            onToggle={() => toggleSkill(assignment.id)}
                            onRemove={() => removeAssignment(assignment.id)}
                          />
                        ))}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <aside className="studio-inspector">
        <span className="studio-eyebrow">Inspecteur</span>
        {selected && selectedResource ? (
          <>
            <h2>{selectedPersona?.label}</h2>
            <p>{selectedPersona?.objective}</p>
            <dl>
              <div>
                <dt>Skill invoquée</dt>
                <dd>{selectedResource.label}</dd>
              </div>
              <div>
                <dt>Étape</dt>
                <dd>{workflow.stages.find((stage) => stage.id === selected.stageId)?.label}</dd>
              </div>
            </dl>
            <div className="studio-injection-path">
              <span>Où</span>
              <strong>
                {selectedResource.label} → {selected.stageId} → {selected.slotId}
              </strong>
              <span>Quand</span>
              <strong>
                {selected.trigger} · {selected.mode} · ordre {selected.order + 1}
              </strong>
            </div>
            <div className="studio-config-grid" key={selected.id}>
              <label>
                Objectif propre
                <textarea
                  defaultValue={selected.objective}
                  onBlur={(event) => updateInvocation({ objective: event.target.value })}
                />
              </label>
              <label>
                Prompt / instructions
                <textarea
                  defaultValue={selected.prompt}
                  onBlur={(event) => updateInvocation({ prompt: event.target.value })}
                />
              </label>
              <label>
                Contexte injecté
                <textarea
                  defaultValue={selected.context}
                  placeholder="Artefacts, diff, captures, décisions…"
                  onBlur={(event) => updateInvocation({ context: event.target.value })}
                />
              </label>
              <label>
                Contraintes · une par ligne
                <textarea
                  defaultValue={selected.constraints.join('\n')}
                  onBlur={(event) =>
                    updateInvocation({
                      constraints: event.target.value
                        .split('\n')
                        .map((value) => value.trim())
                        .filter(Boolean)
                    })
                  }
                />
              </label>
              <label>
                Déclenchement
                <input
                  className="input"
                  defaultValue={selected.trigger}
                  onBlur={(event) => updateInvocation({ trigger: event.target.value })}
                />
              </label>
              <label>
                Ordre
                <input
                  className="input"
                  type="number"
                  min="0"
                  defaultValue={selected.order}
                  onBlur={(event) => updateInvocation({ order: Number(event.target.value) })}
                />
              </label>
              <label>
                Mode
                <select
                  className="select"
                  value={selected.mode}
                  onChange={(event) =>
                    updateInvocation({ mode: event.target.value as 'sequential' | 'parallel' })
                  }
                >
                  <option value="sequential">Séquentiel</option>
                  <option value="parallel">Parallèle</option>
                </select>
              </label>
              <label>
                Dépendances · IDs séparés par virgule
                <input
                  className="input"
                  defaultValue={selected.dependsOn.join(', ')}
                  onBlur={(event) =>
                    updateInvocation({
                      dependsOn: event.target.value
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean)
                    })
                  }
                />
              </label>
              <label>
                Condition de sortie
                <input
                  className="input"
                  defaultValue={selected.exitCondition}
                  onBlur={(event) => updateInvocation({ exitCondition: event.target.value })}
                />
              </label>
              <label>
                Échec / reprise
                <select
                  className="select"
                  value={selected.failurePolicy}
                  onChange={(event) => updateInvocation({ failurePolicy: event.target.value })}
                >
                  <option value="stop-and-report">Arrêter et signaler</option>
                  <option value="retry-once-then-escalate">
                    Réessayer une fois puis escalader
                  </option>
                  <option value="continue-degraded">Continuer en mode dégradé</option>
                </select>
              </label>
            </div>
            {selectedResource.role && (
              <fieldset className="studio-model-binding">
                <legend>Modèle + effort du sous-agent</legend>
                <label>
                  Provider
                  <select
                    className="select"
                    value={selected.provider ?? selectedBinding?.provider ?? ''}
                    onChange={(event) => {
                      void changeBinding(event.target.value, selected.modelId ?? undefined)
                      if (selected.modelId && selected.reasoningEffort)
                        updateInvocation({ provider: event.target.value })
                    }}
                  >
                    {providers.map((provider) => (
                      <option key={provider}>{provider}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Modèle
                  <input
                    className="input"
                    defaultValue={selected.modelId ?? ''}
                    placeholder="Déposer ou choisir un modèle"
                    onBlur={(event) => {
                      const modelId = event.target.value.trim()
                      if (!modelId) return
                      updateInvocation({
                        provider: selected.provider ?? selectedBinding?.provider ?? providers[0],
                        modelId,
                        reasoningEffort: selected.reasoningEffort ?? 'medium'
                      })
                    }}
                  />
                </label>
                <label>
                  Effort
                  <select
                    className="select"
                    value={selected.reasoningEffort ?? 'medium'}
                    onChange={(event) => {
                      if (selected.modelId)
                        updateInvocation({ reasoningEffort: event.target.value })
                    }}
                  >
                    {['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(
                      (effort) => (
                        <option key={effort}>{effort}</option>
                      )
                    )}
                  </select>
                </label>
                <small>
                  Binding de slot persisté dans le brouillon local ; l’exécution reste sous autorité
                  Hermes.
                </small>
              </fieldset>
            )}
            {selectedResource.steps && (
              <div className="studio-inspector-steps">
                <span>Étapes de la skill</span>
                {selectedResource.steps.map((step, index) => (
                  <div key={step}>
                    <b>{String(index + 1).padStart(2, '0')}</b> {step}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p>Sélectionne une affectation pour la configurer.</p>
        )}
      </aside>
    </div>
  )
}
