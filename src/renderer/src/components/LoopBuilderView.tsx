import { useEffect, useMemo, useState } from 'react'
import './LoopBuilderView.css'
import { autowinStorageKey, readMigratedStorageValue } from '../storage-keys'
import { buildLoopPrompt } from './loop-builder-prompt'
import { HumanJson } from './HumanJson'

interface Skill { id: string; label: string; description: string; source: 'autowin' | 'global'; role: 'phase' | 'capability' | 'gate' | 'meta' }
interface Step { id: string; skill: string; capabilities?: string[]; prompt: string; requires?: string[]; produces?: string[] }
interface LoopEvent { runId: string; kind: string; stepId?: string; pass?: number; output?: string; error?: string }
interface StoredRun { runId: string; startedAt: string; completed: number; failed: number; events: LoopEvent[] }
interface Draft { steps: Step[]; passes: number; stopOnFailure: boolean; carryOutput: boolean }

const STORAGE_SUFFIX = 'skill-loop.v1'
const EMPTY_DRAFT: Draft = { steps: [], passes: 1, stopOnFailure: true, carryOutput: true }

function skillName(skill?: Skill): string {
  return (skill?.label ?? skill?.id.split(':').pop() ?? '').toLowerCase()
}
function brickRole(skill: Skill): string {
  return skill.role === 'phase' ? 'Phase' : skill.role === 'gate' ? 'Gate' : skill.role === 'capability' ? 'Appui' : 'Meta'
}
function brickDragType(skill: Skill): 'application/x-loop-primary' | 'application/x-loop-capability' {
  return skill.role === 'capability' ? 'application/x-loop-capability' : 'application/x-loop-primary'
}
function loadDraft(): Draft {
  try {
    const parsed = JSON.parse(readMigratedStorageValue(localStorage, STORAGE_SUFFIX) ?? '') as Draft
    if (!Array.isArray(parsed.steps) || parsed.steps.every((step) => step.id.startsWith('classic-'))) return EMPTY_DRAFT
    return { ...parsed, passes: 1, stopOnFailure: true, carryOutput: true }
  } catch { return EMPTY_DRAFT }
}

export function LoopBuilderView(): React.JSX.Element {
  const initialDraft = useMemo(loadDraft, [])
  const [skills, setSkills] = useState<Skill[]>([])
  const [draft, setDraft] = useState<Draft>(initialDraft)
  const [objective, setObjective] = useState('')
  const [events, setEvents] = useState<LoopEvent[]>([])
  const [runs, setRuns] = useState<StoredRun[]>([])
  const [running, setRunning] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [outputTab, setOutputTab] = useState<'prompt' | 'activity'>('prompt')
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    window.api.loopSkills().then((items) => {
      setSkills(items)
      setDraft((current) => ({ ...current, steps: current.steps.map((step) => ({
        ...step,
        skill: items.find((item) => item.id === step.skill)?.id ?? items.find((item) => item.label === step.skill)?.id ?? step.skill,
        capabilities: (step.capabilities ?? []).map((id) => items.find((item) => item.id === id)?.id ?? id)
      })) }))
    })
    return window.api.onSkillLoopEvent((event) => setEvents((current) => [...current, event]))
  }, [])
  useEffect(() => { window.api.loopRuns().then(setRuns).catch(() => undefined) }, [])
  useEffect(() => { localStorage.setItem(autowinStorageKey(STORAGE_SUFFIX), JSON.stringify(draft)) }, [draft])

  const skillById = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills])
  const autowinSkills = useMemo(() => skills.filter((skill) => skill.source === 'autowin'), [skills])
  const externalSkills = useMemo(() => skills.filter((skill) => skill.source === 'global'), [skills])
  const primarySkills = useMemo(() => skills.filter((skill) => skill.role === 'phase' || skill.role === 'gate'), [skills])
  const ready = draft.steps.length > 0 && draft.steps.every((step) => step.skill && step.prompt.trim())
  const livePrompt = useMemo(() => ready ? buildLoopPrompt(draft) : '', [draft, ready])
  const eventByStep = useMemo(() => {
    const map = new Map<string, LoopEvent>()
    for (const event of events) if (event.stepId) map.set(event.stepId, event)
    return map
  }, [events])

  function patchStep(id: string, patch: Partial<Step>): void {
    setDraft((current) => ({ ...current, steps: current.steps.map((step) => step.id === id ? { ...step, ...patch } : step) }))
  }
  function addStep(skill = primarySkills[0]?.id ?? '', index = draft.steps.length): void {
    setDraft((current) => ({ ...current, steps: [
      ...current.steps.slice(0, index),
      { id: `task-${Date.now().toString(36)}`, skill, capabilities: [], prompt: '' },
      ...current.steps.slice(index)
    ] }))
  }
  function dropAt(event: React.DragEvent, index: number): void {
    event.preventDefault()
    setDragOver(null)
    const stepId = event.dataTransfer.getData('application/x-loop-step')
    const skillId = event.dataTransfer.getData('application/x-loop-primary')
    if (skillId) return addStep(skillId, index)
    if (!stepId) return
    setDraft((current) => {
      const from = current.steps.findIndex((step) => step.id === stepId)
      if (from < 0) return current
      const next = [...current.steps]
      const [moved] = next.splice(from, 1)
      next.splice(from < index ? index - 1 : index, 0, moved)
      return { ...current, steps: next }
    })
  }
  function dropCapability(event: React.DragEvent, step: Step): void {
    event.preventDefault(); event.stopPropagation(); setDragOver(null)
    const capability = event.dataTransfer.getData('application/x-loop-capability')
    if (!capability || step.capabilities?.includes(capability)) return
    patchStep(step.id, { capabilities: [...(step.capabilities ?? []), capability] })
  }
  function moveStepByKeyboard(event: React.KeyboardEvent, index: number): void {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const target = event.key === 'ArrowUp' ? index - 1 : index + 1
    if (target < 0 || target >= draft.steps.length) return
    setDraft((current) => {
      const next = [...current.steps]
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...current, steps: next }
    })
    setAnnouncement(`Étape déplacée de la position ${index + 1} à la position ${target + 1}.`)
  }
  async function generateDraft(): Promise<void> {
    if (!objective.trim() || generating) return
    setGenerating(true); setError('')
    try { setDraft(await window.api.generateLoopDraft(objective.trim()) as Draft) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setGenerating(false) }
  }
  async function copyPrompt(): Promise<void> {
    if (!livePrompt) return
    try { await navigator.clipboard.writeText(livePrompt); setCopied(true); setTimeout(() => setCopied(false), 1600) }
    catch { setError('Le prompt est prêt, mais le presse-papiers est indisponible.') }
  }
  async function run(): Promise<void> {
    if (!ready || running) return
    setEvents([]); setError(''); setRunning(true); setOutputTab('activity')
    try { await window.api.runSkillLoop(draft); setRuns(await window.api.loopRuns()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setRunning(false) }
  }

  return <section className="loop-builder semantic-loop">
    <div className="sr-only" aria-live="polite">{announcement}</div>
    <header className="loop-topbar">
      <div><span>Orchestrateur</span><h1>Loop Builder</h1><p>Décris le résultat. Le workflow se structure, tu gardes la main.</p></div>
      <div className="loop-header-actions">
        <button className="btn" disabled={!ready || running} onClick={() => void run()}>{running ? 'Exécution…' : '▶ Exécuter'}</button>
        <button className="btn primary" disabled={!livePrompt} onClick={() => void copyPrompt()}>{copied ? 'Copié ✓' : 'Copier le prompt'}</button>
      </div>
    </header>

    <div className="objective-composer">
      <label><span>Objectif</span><input value={objective} disabled={generating || running} placeholder="Ex. réduire les injections inutiles du harnais sans perdre d’observabilité" onChange={(event) => setObjective(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void generateDraft() }}/></label>
      <button className="btn primary" disabled={!objective.trim() || generating || running} onClick={() => void generateDraft()}>{generating ? 'L’orchestrateur compose…' : 'Générer le workflow'}</button>
      <div className={`workflow-health ${ready ? 'is-ready' : ''}`}><i />{ready ? `${draft.steps.length} étapes valides` : 'Objectif ou étapes à compléter'}</div>
    </div>
    {error && <div className="loop-error">{error}</div>}

    <div className="semantic-columns">
      <aside className="capability-dock">
        <header><strong>Briques Autowin</strong><span>{autowinSkills.length}</span></header>
        <p>Glisse une phase ou un gate dans le flux. Dépose une brique d’appui sur une tâche pour l’enrichir.</p>
        <div className="capability-list">{autowinSkills.map((skill) => <button key={skill.id} draggable={!running} onDragStart={(event) => event.dataTransfer.setData(brickDragType(skill), skill.id)} title={skill.description}><i className={`cap-dot cap-${skillName(skill)}`} /><span>{skill.label}<small>{brickRole(skill)}</small></span><b>⠿</b></button>)}</div>
        {externalSkills.length > 0 && <details className="extra-capabilities"><summary>Autres sources · {externalSkills.length}</summary><div className="capability-list">{externalSkills.map((skill) => <button key={skill.id} draggable={!running} onDragStart={(event) => event.dataTransfer.setData(brickDragType(skill), skill.id)} title={skill.description}><i className="cap-dot" /><span>{skill.label}<small>{brickRole(skill)}</small></span><b>⠿</b></button>)}</div></details>}
        <details className="recipe-drawer"><summary>Recettes rapides</summary><button onClick={() => setObjective('Diagnostiquer un bug, le corriger, nettoyer les résidus puis prouver que tout fonctionne')}>Bug → vert</button><button onClick={() => setObjective('Concevoir puis implémenter une interface, la vérifier visuellement, la nettoyer et l’auditer')}>Feature UI</button><button onClick={() => setObjective('Auditer le livrable existant et produire des défauts prouvés et priorisés')}>Audit seul</button></details>
      </aside>

      <main className="semantic-rail" onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropAt(event, draft.steps.length)}>
        <div className="rail-heading"><div><span>WORKFLOW</span><strong>{draft.steps.length ? 'Flux généré et éditable' : 'Aucun workflow'}</strong></div><span>Glisser pour réordonner</span></div>
        {!draft.steps.length && <div className="empty-workflow"><i>✦</i><strong>Commence par ton objectif</strong><p>L’orchestrateur créera uniquement les tâches et gates nécessaires.</p></div>}
        {draft.steps.map((step, index) => {
          const selected = skillById.get(step.skill)
          const name = skillName(selected)
          const isGate = selected?.role === 'gate'
          const last = eventByStep.get(step.id)
          return <div className="rail-item" key={step.id}>
            <div className="step-drop-zone" aria-label={`Déposer avant l’étape ${index + 1}`} onDragOver={(event) => { event.preventDefault(); setDragOver(`before-${step.id}`) }} onDragLeave={() => setDragOver(null)} onDrop={(event) => { event.stopPropagation(); dropAt(event, index) }}><span className={dragOver === `before-${step.id}` ? 'visible' : ''}>Déposer ici</span></div>
            <div className={`rail-node ${isGate ? 'gate' : 'task'} ${last?.kind ?? ''}`}><span>{isGate ? '◆' : index + 1}</span></div>
            <article tabIndex={0} aria-label={`Étape ${index + 1}. Alt flèche haut ou bas pour déplacer.`} draggable={!running} onKeyDown={(event) => moveStepByKeyboard(event, index)} onDragStart={(event) => event.dataTransfer.setData('application/x-loop-step', step.id)} onDragOver={(event) => { if (!isGate && event.dataTransfer.types.includes('application/x-loop-capability')) { event.preventDefault(); setDragOver(step.id) } }} onDragLeave={() => setDragOver(null)} onDrop={(event) => { if (!isGate) dropCapability(event, step) }} className={`semantic-card ${isGate ? 'gate-card' : ''} ${dragOver === step.id ? 'drop-active' : ''}`}>
              <header><div><small>{isGate ? 'VALIDATION QUALITÉ' : name === 'frame' ? 'CADRER' : name === 'terrain' ? 'PRÉPARER' : 'AGIR'}</small><select value={step.skill} disabled={running} onChange={(event) => patchStep(step.id, { skill: event.target.value })}>{primarySkills.map((skill) => <option key={skill.id} value={skill.id}>{skill.label}</option>)}</select></div><span className="drag-handle">⠿</span><button title="Supprimer" disabled={running} onClick={() => setDraft((current) => ({ ...current, steps: current.steps.filter((item) => item.id !== step.id) }))}>×</button></header>
              <textarea value={step.prompt} disabled={running} placeholder="Décris l’action concrète et sa preuve de réussite…" onChange={(event) => patchStep(step.id, { prompt: event.target.value })}/>
              <footer><div className="attached-capabilities">{(step.capabilities ?? []).map((id) => <button key={id} title="Retirer" disabled={running} onClick={() => patchStep(step.id, { capabilities: step.capabilities?.filter((item) => item !== id) })}><i className={`cap-dot cap-${skillName(skillById.get(id))}`} />{skillById.get(id)?.label ?? id}<b>×</b></button>)}{!isGate && !(step.capabilities?.length) && <span>Déposer une capacité ici</span>}</div>{last && <em>{last.kind === 'step-done' ? 'Terminé ✓' : last.kind === 'step-error' ? 'Erreur' : 'En cours…'}</em>}</footer>
            </article>
          </div>
        })}
        <button className="semantic-add" disabled={running || draft.steps.length >= 20} onClick={() => addStep()}>＋ Ajouter une tâche</button>
      </main>

      <aside className="live-output">
        <header><div><button className={outputTab === 'prompt' ? 'active' : ''} onClick={() => setOutputTab('prompt')}>Prompt</button><button className={outputTab === 'activity' ? 'active' : ''} onClick={() => setOutputTab('activity')}>Activité {events.length ? `· ${events.length}` : ''}</button></div><span>Temps réel</span></header>
        {outputTab === 'prompt' ? <>{livePrompt ? <HumanJson className="live-prompt" value={livePrompt} /> : <div className="output-empty">Le prompt compilé apparaîtra ici dès que le workflow sera valide.</div>}<button className="copy-wide" disabled={!livePrompt} onClick={() => void copyPrompt()}>{copied ? 'PROMPT COPIÉ ✓' : 'COPIER LE PROMPT'}</button></> : <div className="activity-stream">{events.length ? events.map((event, index) => <article key={`${event.kind}-${index}`}><b>{event.kind}</b><small>{event.stepId}</small>{event.output && <HumanJson value={event.output} />}{event.error && <HumanJson className="is-error" value={event.error} />}</article>) : <div className="output-empty">Aucune exécution pour le moment.</div>}<details className="loop-history"><summary>Historique ({runs.length})</summary>{runs.map((stored) => <button key={stored.runId} onClick={() => setEvents(stored.events)}>{new Date(stored.startedAt).toLocaleString('fr-FR')} · {stored.completed} ok / {stored.failed} erreur</button>)}</details></div>}
      </aside>
    </div>
  </section>
}
