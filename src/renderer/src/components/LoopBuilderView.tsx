import { useEffect, useMemo, useState } from 'react'
import './LoopBuilderView.css'
import { autowinStorageKey, readMigratedStorageValue } from '../storage-keys'

interface Skill {
  id: string
  label: string
  description: string
  source: 'autowin' | 'global'
}
interface Step {
  id: string
  skill: string
  prompt: string
}
interface LoopEvent {
  runId: string
  kind: string
  stepId?: string
  pass?: number
  output?: string
  error?: string
}
interface Draft {
  steps: Step[]
  passes: number
  stopOnFailure: boolean
  carryOutput: boolean
}

const STORAGE_SUFFIX = 'skill-loop.v1'
const LIBRARY_SUFFIX = 'skill-loop.library.v1'
const CLASSIC_DRAFT: Draft = {
  steps: [
    {
      id: 'classic-frame',
      skill: 'autowin:frame',
      prompt: 'Cadre le besoin, clarifie le résultat attendu et choisis l’approche.'
    },
    {
      id: 'classic-terrain',
      skill: 'autowin:terrain',
      prompt: 'Prépare le terrain, les points d’observation et les vérifications nécessaires.'
    },
    {
      id: 'classic-build',
      skill: 'autowin:build',
      prompt: 'Exécute le travail cadré jusqu’à obtenir un résultat réellement vérifié.'
    },
    {
      id: 'classic-judge',
      skill: 'autowin:judge',
      prompt: 'Audite le résultat de manière adversariale et relève les défauts restants.'
    }
  ],
  passes: 1,
  stopOnFailure: true,
  carryOutput: true
}

function loadDraft(): Draft {
  try {
    const raw = readMigratedStorageValue(localStorage, STORAGE_SUFFIX)
    if (!raw) return CLASSIC_DRAFT
    const parsed = JSON.parse(raw) as Draft
    return Array.isArray(parsed.steps) && parsed.steps.length > 0 ? parsed : CLASSIC_DRAFT
  } catch {
    return CLASSIC_DRAFT
  }
}

function loadLibrary(): string[] {
  try {
    const parsed = JSON.parse(readMigratedStorageValue(localStorage, LIBRARY_SUFFIX) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function LoopBuilderView(): React.JSX.Element {
  const initialDraft = useMemo(() => loadDraft(), [])
  const [skills, setSkills] = useState<Skill[]>([])
  const [libraryIds, setLibraryIds] = useState<string[]>([])
  const [draft, setDraft] = useState<Draft>(initialDraft)
  const [events, setEvents] = useState<LoopEvent[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.loopSkills().then((items) => {
      setSkills(items)
      const saved = loadLibrary()
      const migrated = initialDraft.steps.map((step) => ({
        ...step,
        skill:
          items.find((skill) => skill.id === step.skill)?.id ??
          items.find((skill) => skill.source === 'autowin' && skill.label === step.skill)?.id ??
          items.find((skill) => skill.label === step.skill)?.id ??
          step.skill
      }))
      setDraft((current) => ({ ...current, steps: migrated }))
      setLibraryIds([
        ...new Set([
          ...items.filter((skill) => skill.source === 'autowin').map((skill) => skill.id),
          ...migrated.map((step) => step.skill),
          ...saved.filter((id) => items.some((skill) => skill.id === id))
        ])
      ])
    })
    return window.api.onSkillLoopEvent((event) => setEvents((current) => [...current, event]))
  }, [initialDraft])
  useEffect(() => {
    localStorage.setItem(autowinStorageKey(STORAGE_SUFFIX), JSON.stringify(draft))
  }, [draft])
  useEffect(() => {
    if (libraryIds.length)
      localStorage.setItem(autowinStorageKey(LIBRARY_SUFFIX), JSON.stringify(libraryIds))
  }, [libraryIds])

  const library = useMemo(
    () => libraryIds.flatMap((id) => skills.filter((skill) => skill.id === id)),
    [libraryIds, skills]
  )
  const globalAvailable = useMemo(
    () => skills.filter((skill) => skill.source === 'global' && !libraryIds.includes(skill.id)),
    [libraryIds, skills]
  )

  const ready =
    draft.steps.length > 0 && draft.steps.every((step) => step.skill && step.prompt.trim())
  const eventByStep = useMemo(() => {
    const map = new Map<string, LoopEvent>()
    for (const event of events) if (event.stepId) map.set(event.stepId, event)
    return map
  }, [events])

  function addStep(skill = library[0]?.id ?? '', index = draft.steps.length): void {
    setDraft((current) => ({
      ...current,
      steps: [
        ...current.steps.slice(0, index),
        { id: `turn-${Date.now().toString(36)}`, skill, prompt: '' },
        ...current.steps.slice(index)
      ]
    }))
  }
  function patchStep(id: string, patch: Partial<Step>): void {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === id ? { ...step, ...patch } : step))
    }))
  }
  function moveStep(index: number, delta: number): void {
    setDraft((current) => {
      const next = [...current.steps]
      const target = index + delta
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...current, steps: next }
    })
  }
  function dropAt(event: React.DragEvent, index: number): void {
    event.preventDefault()
    const skill = event.dataTransfer.getData('application/x-loop-skill')
    if (skill) {
      addStep(skill, index)
      return
    }
    const stepId = event.dataTransfer.getData('application/x-loop-step')
    if (!stepId) return
    setDraft((current) => {
      const from = current.steps.findIndex((step) => step.id === stepId)
      if (from < 0 || from === index) return current
      const next = [...current.steps]
      const [moved] = next.splice(from, 1)
      next.splice(from < index ? index - 1 : index, 0, moved)
      return { ...current, steps: next }
    })
  }
  async function run(): Promise<void> {
    if (!ready || running) return
    setEvents([])
    setError('')
    setRunning(true)
    try {
      await window.api.runSkillLoop(draft)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="loop-builder">
      <header>
        <div>
          <span>Sequential skill runner</span>
          <h1>Loop Builder</h1>
          <p>Prépare tous les prompts, puis laisse Hermes exécuter chaque skill tour par tour.</p>
        </div>
        <button className="btn primary" disabled={!ready || running} onClick={() => void run()}>
          {running ? 'Exécution…' : '▶ Lancer la loop'}
        </button>
      </header>

      <div className="loop-settings">
        <label>
          Passes{' '}
          <input
            type="number"
            min="1"
            max="10"
            value={draft.passes}
            onChange={(event) => setDraft({ ...draft, passes: Number(event.target.value) })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.carryOutput}
            onChange={(event) => setDraft({ ...draft, carryOutput: event.target.checked })}
          />{' '}
          Transmettre le résultat au tour suivant
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.stopOnFailure}
            onChange={(event) => setDraft({ ...draft, stopOnFailure: event.target.checked })}
          />{' '}
          Arrêter au premier échec
        </label>
        <span>
          {draft.steps.length} tours · {draft.steps.length * draft.passes} exécutions
        </span>
      </div>
      {error && <div className="loop-error">{error}</div>}

      <div className="loop-columns">
        <aside className="loop-library">
          <header>
            <strong>Skills Autowin</strong>
            <span>{library.length}</span>
          </header>
          <p>Glisse une skill dans la loop.</p>
          <div className="loop-skill-list">
            {library.map((skill) => (
              <article
                key={skill.id}
                draggable={!running}
                onDragStart={(event) =>
                  event.dataTransfer.setData('application/x-loop-skill', skill.id)
                }
              >
                <div>
                  <strong>{skill.label}</strong>
                  <small>{skill.source === 'autowin' ? 'Autowin' : 'Globale ajoutée'}</small>
                </div>
                <p>{skill.description}</p>
                {skill.source === 'global' && (
                  <button
                    title="Retirer de cette bibliothèque"
                    disabled={draft.steps.some((step) => step.skill === skill.id)}
                    onClick={() =>
                      setLibraryIds((current) => current.filter((id) => id !== skill.id))
                    }
                  >
                    ×
                  </button>
                )}
              </article>
            ))}
          </div>
          <details className="loop-global-skills">
            <summary>＋ Ajouter depuis les skills globales</summary>
            {globalAvailable.map((skill) => (
              <button
                key={skill.id}
                onClick={() => setLibraryIds((current) => [...current, skill.id])}
              >
                <span>{skill.label}</span>
                <small>{skill.description}</small>
              </button>
            ))}
            {globalAvailable.length === 0 && <p>Toutes les skills globales sont ajoutées.</p>}
          </details>
        </aside>

        <div
          className="loop-plan"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => dropAt(event, draft.steps.length)}
        >
          {draft.steps.map((step, index) => {
            const last = eventByStep.get(step.id)
            return (
              <article
                className={`loop-step ${last?.kind ?? ''}`}
                key={step.id}
                draggable={!running}
                onDragStart={(event) =>
                  event.dataTransfer.setData('application/x-loop-step', step.id)
                }
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.stopPropagation()
                  dropAt(event, index)
                }}
              >
                <div className="loop-order">
                  <strong>{index + 1}</strong>
                  <button disabled={index === 0 || running} onClick={() => moveStep(index, -1)}>
                    ↑
                  </button>
                  <button
                    disabled={index === draft.steps.length - 1 || running}
                    onClick={() => moveStep(index, 1)}
                  >
                    ↓
                  </button>
                </div>
                <div className="loop-editor">
                  <select
                    value={step.skill}
                    disabled={running}
                    onChange={(event) => patchStep(step.id, { skill: event.target.value })}
                  >
                    <option value="">Choisir une skill…</option>
                    {library.map((skill) => (
                      <option key={skill.id} value={skill.id}>
                        {skill.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={step.prompt}
                    disabled={running}
                    placeholder="Prompt préparé pour ce tour…"
                    onChange={(event) => patchStep(step.id, { prompt: event.target.value })}
                  />
                </div>
                <div className="loop-step-actions">
                  <span>
                    {last ? `${last.kind}${last.pass ? ` · passe ${last.pass}` : ''}` : 'prêt'}
                  </span>
                  <button
                    disabled={running}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        steps: current.steps.filter((item) => item.id !== step.id)
                      }))
                    }
                  >
                    ×
                  </button>
                </div>
              </article>
            )
          })}
          <button
            className="loop-add"
            disabled={running || draft.steps.length >= 20}
            onClick={() => addStep()}
          >
            ＋ Ajouter un tour
          </button>
        </div>

        <aside className="loop-output">
          <header>
            <strong>Journal d’exécution</strong>
            <span>{events.length} événements</span>
          </header>
          {events.length === 0 ? (
            <p>La sortie de chaque tour apparaîtra ici.</p>
          ) : (
            events.map((event, index) => (
              <article key={`${event.kind}-${event.stepId}-${event.pass}-${index}`}>
                <b>{event.kind}</b>
                <small>
                  {event.stepId}
                  {event.pass ? ` · passe ${event.pass}` : ''}
                </small>
                {event.output && <pre>{event.output}</pre>}
                {event.error && <pre className="is-error">{event.error}</pre>}
              </article>
            ))
          )}
        </aside>
      </div>
    </section>
  )
}
