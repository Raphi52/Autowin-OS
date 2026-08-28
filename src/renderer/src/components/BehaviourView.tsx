import { useCallback, useEffect, useState } from 'react'
import './BehaviourView.css'
import { ModuleHeader } from './ModuleHeader'

/**
 * Vue « Behaviour » — miroir FIDÈLE (config statique) de TOUT ce qui influe sur le comportement du
 * chat Autowin, et RIEN d'autre. Organisée par ANATOMIE d'un tour (ordre réel du pipeline), avec un
 * distingue les 3 chemins réels : COCKPIT (AgentPilot + RAG), ORCHESTRÉ et DIRECT (os.chat).
 * Source unique = `window.api.behaviourComposition()` (assemblé côté main depuis les modules réels ;
 * chaque champ porte sa citation file:line). Aucun non-influenceur (capabilities/hooks natifs) ici.
 */
interface InfluencerField {
  label: string
  value: string
  source: string
  excerpt?: string
}
interface PhaseSystemPrompt {
  phase: string
  blocks: InfluencerField[]
}
interface BehaviourComposition {
  inspection?: {
    workspace: string
    files: Array<{
      id: string
      label: string
      path: string
      engine: string
      state: string
      reason: string
      active: boolean
      excerpt?: string
    }>
  }
  cockpit: {
    systemPrompt: InfluencerField[]
    retrievedContext: InfluencerField[]
    turnContext: InfluencerField[]
    modelSelection: InfluencerField[]
  }
  orchestrated: {
    systemPrompt: PhaseSystemPrompt[]
    injectedContext: InfluencerField[]
    modelSelection: InfluencerField[]
    topology: InfluencerField[]
    regime: InfluencerField[]
    guardrails: InfluencerField[]
  }
  direct: {
    systemPrompt: InfluencerField[]
    modelSelection: InfluencerField[]
  }
}
type OutcomeLearningMode = 'off' | 'shadow' | 'inbox' | 'auto'
interface LearningCurationEvent {
  kind: 'curation'
  value: {
    eventId: string
    action: 'retract' | 'restore' | 'supersede'
    knowledgeId: string
  }
}

function Field({ field }: { field: InfluencerField }): React.JSX.Element {
  return (
    <li className="behaviour-field">
      <div className="behaviour-field-head">
        <strong>{field.label}</strong>
        <code className="behaviour-field-source" title="Source dans le code (preuve d'effet réel)">
          {field.source}
        </code>
      </div>
      <p className="behaviour-field-value">{field.value}</p>
      {field.excerpt && (
        <details className="behaviour-field-excerpt">
          <summary>texte injecté</summary>
          <pre>{field.excerpt}</pre>
        </details>
      )}
    </li>
  )
}

function Category({
  title,
  hint,
  fields
}: {
  title: string
  hint: string
  fields: InfluencerField[]
}): React.JSX.Element {
  return (
    <section className="behaviour-category">
      <header>
        <h3>{title}</h3>
        <small>{hint}</small>
      </header>
      <ul>
        {fields.map((f) => (
          <Field key={`${f.label}:${f.source}`} field={f} />
        ))}
      </ul>
    </section>
  )
}

export function BehaviourView(): React.JSX.Element {
  const [composition, setComposition] = useState<BehaviourComposition | null>(null)
  const [path, setPath] = useState<'cockpit' | 'orchestrated' | 'direct'>('cockpit')
  const [error, setError] = useState('')
  // Le choix de workspace ouvre un dialogue natif : son échec ne doit pas partir en promesse
  // non gérée, et son attente doit être VISIBLE.
  const [choosing, setChoosing] = useState(false)
  const [workspace, setWorkspace] = useState<string | undefined>(undefined)
  const [learningMode, setLearningMode] = useState<OutcomeLearningMode>()
  const [learningEvents, setLearningEvents] = useState(0)
  const [learningAudit, setLearningAudit] = useState<
    Array<{ kind: string; value: Record<string, unknown> }>
  >([])
  const [learningCurations, setLearningCurations] = useState<LearningCurationEvent[]>([])
  const [learningCurationTotal, setLearningCurationTotal] = useState(0)

  const loadComposition = useCallback(async (next?: string): Promise<void> => {
    setError('')
    try {
      setComposition((await window.api.behaviourComposition(next)) as BehaviourComposition)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  const loadOutcomeLearning = useCallback(async (): Promise<void> => {
    const load = window.api?.outcomeLearning
    if (typeof load !== 'function') return
    const state = await load()
    const page =
      typeof window.api.outcomeLearningCurations === 'function'
        ? await window.api.outcomeLearningCurations(0, 20)
        : undefined
    setLearningMode(state.mode)
    setLearningEvents(state.events.length)
    setLearningAudit(state.events)
    const curations = page
      ? (page.events as LearningCurationEvent[])
      : state.events.filter((event): event is LearningCurationEvent => event.kind === 'curation')
    setLearningCurations(curations)
    setLearningCurationTotal(page?.total ?? curations.length)
  }, [])

  const loadMoreCurations = useCallback(async (): Promise<void> => {
    if (typeof window.api.outcomeLearningCurations !== 'function') return
    const page = await window.api.outcomeLearningCurations(learningCurations.length, 20)
    setLearningCurations((current) => [
      ...current,
      ...(page.events as LearningCurationEvent[]).filter(
        (event) => !current.some((known) => known.value.eventId === event.value.eventId)
      )
    ])
    setLearningCurationTotal(page.total)
  }, [learningCurations.length])

  useEffect(() => {
    queueMicrotask(() => void loadComposition(workspace))
  }, [loadComposition, workspace])

  useEffect(() => {
    queueMicrotask(
      () =>
        void loadOutcomeLearning().catch((reason) =>
          setError(reason instanceof Error ? reason.message : String(reason))
        )
    )
  }, [loadOutcomeLearning])

  async function chooseWorkspace(): Promise<void> {
    setChoosing(true)
    setError('')
    try {
      const chosen = await window.api.chooseBehaviourWorkspace()
      if (chosen) {
        setWorkspace(chosen)
        await loadComposition(chosen)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setChoosing(false)
    }
  }

  const orch = composition?.orchestrated
  const direct = composition?.direct
  const cockpit = composition?.cockpit

  return (
    <section className="behaviour-view">
      <header>
        <ModuleHeader
          eyebrow="Tout ce qui influe sur le comportement du chat — et rien d'autre"
          title="Behaviour"
          description="Configure ce qui influence les réponses et les décisions du Chat."
        />
        <div className="behaviour-workspace">
          <span title={composition?.inspection?.workspace}>
            Workspace : {composition?.inspection?.workspace ?? 'chargement…'}
          </span>
          <button type="button" disabled={choosing} onClick={() => void chooseWorkspace()}>
            {choosing ? 'Sélection…' : 'Choisir un workspace'}
          </button>
        </div>
        {learningMode && (
          <div className="behaviour-workspace" aria-label="Apprentissage Brain des runs">
            <span>
              Brain des runs : {learningEvents} événements audités ·{' '}
              {learningMode === 'off' ? 'arrêté' : learningMode}
            </span>
            <label>
              Mode{' '}
              <select
                aria-label="Mode d’apprentissage Brain"
                value={learningMode}
                onChange={(event) => {
                  const mode = event.currentTarget.value as OutcomeLearningMode
                  void window.api
                    .setOutcomeLearningMode(mode)
                    .then((state) => setLearningMode(state.mode))
                    .catch((reason) =>
                      setError(reason instanceof Error ? reason.message : String(reason))
                    )
                }}
              >
                <option value="auto">Auto</option>
                <option value="inbox">Inbox uniquement</option>
                <option value="shadow">Simulation</option>
                <option value="off">Off · kill switch</option>
              </select>
            </label>
            {learningCurations.map((curation) => (
              <button
                type="button"
                key={curation.value.eventId}
                onClick={() => {
                  void window.api
                    .undoOutcomeLearningCuration(curation.value.eventId)
                    .then(loadOutcomeLearning)
                    .catch((reason) =>
                      setError(reason instanceof Error ? reason.message : String(reason))
                    )
                }}
              >
                Annuler {curation.value.action} · {curation.value.knowledgeId}
              </button>
            ))}
            {learningCurations.length < learningCurationTotal && (
              <button
                type="button"
                onClick={() =>
                  void loadMoreCurations().catch((reason) =>
                    setError(reason instanceof Error ? reason.message : String(reason))
                  )
                }
              >
                Afficher plus de curations
              </button>
            )}
            <details>
              <summary>Journal détaillé · {learningAudit.length} plus récents</summary>
              <ol aria-label="Journal outcome-learning détaillé">
                {learningAudit.map((event, index) => (
                  <li key={String(event.value.eventId ?? `${event.kind}-${index}`)}>
                    <strong>{event.kind}</strong>{' '}
                    {String(
                      event.value.route ??
                        event.value.action ??
                        event.value.status ??
                        event.value.title ??
                        'enregistré'
                    )}
                    {Array.isArray(event.value.reasons)
                      ? ` · ${event.value.reasons.join(', ')}`
                      : ''}
                  </li>
                ))}
              </ol>
            </details>
          </div>
        )}
        <div className="behaviour-path-toggle" role="tablist" aria-label="Chemin de chat">
          <button
            type="button"
            role="tab"
            aria-selected={path === 'cockpit'}
            className={path === 'cockpit' ? 'active' : ''}
            onClick={() => setPath('cockpit')}
          >
            Cockpit <small>(chat visible)</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={path === 'orchestrated'}
            className={path === 'orchestrated' ? 'active' : ''}
            onClick={() => setPath('orchestrated')}
          >
            Orchestré <small>(pipeline)</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={path === 'direct'}
            className={path === 'direct' ? 'active' : ''}
            onClick={() => setPath('direct')}
          >
            Direct <small>(os.chat)</small>
          </button>
        </div>
      </header>

      {error && (
        <div className="behaviour-error">
          <p role="alert">{error}</p>
          <button type="button" onClick={() => void loadComposition(workspace)}>
            Réessayer
          </button>
        </div>
      )}
      {!composition && !error && (
        <p className="behaviour-empty">
          <span className="spinner" aria-hidden="true" /> Chargement de la composition…
        </p>
      )}
      {composition?.inspection && (
        <section className="behaviour-inspection" aria-label="Instructions du workspace inspecté">
          <strong>Instructions réellement lues · {composition.inspection.files.length}</strong>
          {composition.inspection.files.length === 0 ? (
            <small>Aucun fichier d’instructions découvert dans ce workspace.</small>
          ) : (
            <ul>
              {composition.inspection.files.map((file) => (
                <li key={file.id} data-active={file.active ? 'true' : 'false'}>
                  <span>{file.label}</span>
                  <small>
                    {file.engine} · {file.state} · {file.reason}
                  </small>
                  {file.excerpt && <pre>{file.excerpt}</pre>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {cockpit && path === 'cockpit' && (
        <div className="behaviour-anatomy">
          <p className="behaviour-path-note">
            Le chat principal visible passe par AgentPilot : il reçoit la CONSTITUTION, le contexte
            projet et un RAG dynamique Amitel Brain + preuves Graphify avant de pouvoir piloter
            l’application.
          </p>
          <Category
            title="System prompt"
            hint="composition réellement envoyée au modèle du cockpit"
            fields={cockpit.systemPrompt}
          />
          <Category
            title="RAG dynamique"
            hint="récupéré pour le dernier message utilisateur, avec fallbacks indépendants"
            fields={cockpit.retrievedContext}
          />
          <Category
            title="Contexte du tour"
            hint="commandes, état, historique, pièces jointes et bornes réellement appliqués"
            fields={cockpit.turnContext ?? []}
          />
          <Category
            title="Modèle / rôle"
            hint="binding utilisé par AgentPilot"
            fields={cockpit.modelSelection}
          />
        </div>
      )}

      {orch && path === 'orchestrated' && (
        <div className="behaviour-anatomy">
          <p className="behaviour-path-note">
            Le vrai pipeline (os:orchestrate) : le system prompt VARIE par phase, du contexte est
            injecté, le modèle/rôle est choisi, le régime décide des phases, des garde-fous
            encadrent.
          </p>

          <section className="behaviour-category">
            <header>
              <h3>A · System prompt par phase</h3>
              <small>blocs concaténés dans `system`, différents selon la phase</small>
            </header>
            {orch.systemPrompt.map((p) => (
              <details key={p.phase} className="behaviour-phase">
                <summary>
                  <span className="behaviour-phase-name">{p.phase}</span>
                  <small>{p.blocks.map((b) => b.label).join(' + ')}</small>
                </summary>
                <ul>
                  {p.blocks.map((b) => (
                    <Field key={`${p.phase}:${b.label}`} field={b} />
                  ))}
                </ul>
              </details>
            ))}
          </section>

          <Category
            title="B · Contexte injecté"
            hint="ajouté au message (hors system) : Brain, tâche, portage, session-resume"
            fields={orch.injectedContext}
          />
          <Category
            title="C · Modèle / rôle / effort"
            hint="qui répond, avec quel modèle — y compris la redirection d'exécution"
            fields={orch.modelSelection}
          />
          <Category
            title="C2 · Topologie / fan-out"
            hint="panels vivants scout, frame, terrain et judge, avec règle de quorum"
            fields={orch.topology ?? []}
          />
          <Category
            title="D · Régime → phases"
            hint="quelles phases tournent selon la tâche (heuristique déterministe)"
            fields={orch.regime}
          />
          <Category
            title="E · Garde-fous"
            hint="ce qui borne ou coupe le tour (déterministe)"
            fields={orch.guardrails}
          />
        </div>
      )}

      {direct && path === 'direct' && (
        <div className="behaviour-anatomy">
          <p className="behaviour-path-note">
            Le chat direct (os.chat) : beaucoup plus simple — pas de phases, pas de Brain, pas de
            garde-fous. Son system prompt par défaut vient de la CONSTITUTION.
          </p>
          <Category
            title="System prompt"
            hint="CONSTITUTION (source commune au chat direct et aux phases orchestrées)"
            fields={direct.systemPrompt}
          />
          <Category
            title="Modèle / rôle"
            hint="binding du rôle si aucun provider explicite ; sinon override provider seul"
            fields={direct.modelSelection}
          />
        </div>
      )}
    </section>
  )
}
