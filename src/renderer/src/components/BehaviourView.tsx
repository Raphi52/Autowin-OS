import { useCallback, useEffect, useState } from 'react'
import './BehaviourView.css'
import { ModuleHeader } from './ModuleHeader'
import { Spinner } from './Spinner'
import { useTextesSettings, type CleSettings } from '../textes-ecrans/settings'
import type { ValeursDeTexte } from '../textes'

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

/**
 * Titre de l'inventaire : ne compte que les FICHIERS réellement chargés, une fois chacun.
 *
 * conv-984 (2026-10-16) : il comptait les LIGNES, chargées ou non. Or un même fichier y figure sous
 * plusieurs moteurs (AGENTS.md vu par Codex, inactif car `project_doc_max_bytes=0`, ET replié par
 * Autowin ; un CLAUDE.md seul, vu par Claude et par Autowin) : « réellement lues · 3 » pour un seul
 * fichier chargé. On compte donc les CHEMINS distincts dont au moins une ligne est active, et on dit
 * à part combien de fichiers listés ne sont chargés par personne.
 */
function titreInspection(
  files: ReadonlyArray<{ path: string; active: boolean }>,
  t: (cle: CleSettings, valeurs?: ValeursDeTexte) => string
): string {
  const charges = new Set(files.filter((file) => file.active).map((file) => file.path))
  const nonCharges = new Set(
    files.filter((file) => !charges.has(file.path)).map((file) => file.path)
  ).size
  const suite =
    nonCharges > 0
      ? t(nonCharges > 1 ? 'behaviour.nonChargees' : 'behaviour.nonChargee', { n: nonCharges })
      : ''
  return t('behaviour.instructionsLues', { n: charges.size, suite })
}

function Field({ field }: { field: InfluencerField }): React.JSX.Element {
  const { t } = useTextesSettings()
  return (
    <li className="behaviour-field">
      <div className="behaviour-field-head">
        <strong>{field.label}</strong>
        <code className="behaviour-field-source" title={t('behaviour.source')}>
          {field.source}
        </code>
      </div>
      <p className="behaviour-field-value">{field.value}</p>
      {field.excerpt && (
        <details className="behaviour-field-excerpt">
          <summary>{t('behaviour.texteInjecte')}</summary>
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
  // Textes dans la langue de Settings · Interface (conv-1170). Restent tels quels : les noms propres
  // (Behaviour, Cockpit, Direct, System prompt), les modes lus du moteur (auto, inbox, shadow) et
  // tout ce que rend `behaviourComposition` (libellés, valeurs et citations des champs).
  const { t } = useTextesSettings()
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
          eyebrow={t('behaviour.eyebrow')}
          title="Behaviour"
          description={t('behaviour.description')}
        />
        <div className="behaviour-workspace">
          <span title={composition?.inspection?.workspace}>
            {t('behaviour.workspace', {
              chemin: composition?.inspection?.workspace ?? t('behaviour.chargement')
            })}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={choosing}
            onClick={() => void chooseWorkspace()}
          >
            {choosing ? t('behaviour.selection') : t('behaviour.choisir')}
          </button>
        </div>
        {learningMode && (
          <div className="behaviour-workspace" aria-label={t('behaviour.apprentissage')}>
            <span>
              {t('behaviour.brainDesRuns', { n: learningEvents })}{' '}
              {learningMode === 'off' ? t('behaviour.arrete') : learningMode}
            </span>
            <label>
              Mode{' '}
              <select
                className="select"
                aria-label={t('behaviour.modeAria')}
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
                <option value="inbox">{t('behaviour.inbox')}</option>
                <option value="shadow">Simulation</option>
                <option value="off">Off · kill switch</option>
              </select>
            </label>
            {learningCurations.map((curation) => (
              <button
                type="button"
                className="btn btn-sm"
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
                {t('behaviour.annuler', {
                  action: curation.value.action,
                  id: curation.value.knowledgeId
                })}
              </button>
            ))}
            {learningCurations.length < learningCurationTotal && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  void loadMoreCurations().catch((reason) =>
                    setError(reason instanceof Error ? reason.message : String(reason))
                  )
                }
              >
                {t('behaviour.plusDeCurations')}
              </button>
            )}
            <details>
              <summary>{t('behaviour.journal', { n: learningAudit.length })}</summary>
              <ol aria-label={t('behaviour.journalAria')}>
                {learningAudit.map((event, index) => (
                  <li key={String(event.value.eventId ?? `${event.kind}-${index}`)}>
                    <strong>{event.kind}</strong>{' '}
                    {String(
                      event.value.route ??
                        event.value.action ??
                        event.value.status ??
                        event.value.title ??
                        t('behaviour.enregistre')
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
        <div className="behaviour-path-toggle" role="tablist" aria-label={t('behaviour.chemin')}>
          <button
            type="button"
            role="tab"
            aria-selected={path === 'cockpit'}
            className={path === 'cockpit' ? 'active' : ''}
            onClick={() => setPath('cockpit')}
          >
            Cockpit <small>{t('behaviour.chatVisible')}</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={path === 'orchestrated'}
            className={path === 'orchestrated' ? 'active' : ''}
            onClick={() => setPath('orchestrated')}
          >
            {t('behaviour.orchestre')} <small>(pipeline)</small>
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
          <button type="button" className="btn" onClick={() => void loadComposition(workspace)}>
            {t('behaviour.reessayer')}
          </button>
        </div>
      )}
      {!composition && !error && (
        <p className="behaviour-empty">
          <Spinner /> {t('behaviour.chargementComposition')}
        </p>
      )}
      {composition?.inspection && (
        <section className="behaviour-inspection" aria-label={t('behaviour.inspectionAria')}>
          <strong>{titreInspection(composition.inspection.files, t)}</strong>
          {composition.inspection.files.length === 0 ? (
            <small>{t('behaviour.aucunFichier')}</small>
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
          <p className="behaviour-path-note">{t('behaviour.cockpit.note')}</p>
          <Category
            title="System prompt"
            hint={t('behaviour.cockpit.systemPrompt')}
            fields={cockpit.systemPrompt}
          />
          <Category
            title={t('behaviour.cockpit.rag')}
            hint={t('behaviour.cockpit.rag.aide')}
            fields={cockpit.retrievedContext}
          />
          <Category
            title={t('behaviour.cockpit.tour')}
            hint={t('behaviour.cockpit.tour.aide')}
            fields={cockpit.turnContext ?? []}
          />
          <Category
            title={t('behaviour.modeleRole')}
            hint={t('behaviour.cockpit.modele.aide')}
            fields={cockpit.modelSelection}
          />
        </div>
      )}

      {orch && path === 'orchestrated' && (
        <div className="behaviour-anatomy">
          <p className="behaviour-path-note">{t('behaviour.orch.note')}</p>

          <section className="behaviour-category">
            <header>
              <h3>{t('behaviour.orch.systemPrompt')}</h3>
              <small>{t('behaviour.orch.systemPrompt.aide')}</small>
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
            title={t('behaviour.orch.contexte')}
            hint={t('behaviour.orch.contexte.aide')}
            fields={orch.injectedContext}
          />
          <Category
            title={t('behaviour.orch.modele')}
            hint={t('behaviour.orch.modele.aide')}
            fields={orch.modelSelection}
          />
          <Category
            title={t('behaviour.orch.topologie')}
            hint={t('behaviour.orch.topologie.aide')}
            fields={orch.topology ?? []}
          />
          <Category
            title={t('behaviour.orch.regime')}
            hint={t('behaviour.orch.regime.aide')}
            fields={orch.regime}
          />
          <Category
            title={t('behaviour.orch.gardeFous')}
            hint={t('behaviour.orch.gardeFous.aide')}
            fields={orch.guardrails}
          />
        </div>
      )}

      {direct && path === 'direct' && (
        <div className="behaviour-anatomy">
          <p className="behaviour-path-note">{t('behaviour.direct.note')}</p>
          <Category
            title="System prompt"
            hint={t('behaviour.direct.systemPrompt.aide')}
            fields={direct.systemPrompt}
          />
          <Category
            title={t('behaviour.modeleRole')}
            hint={t('behaviour.direct.modele.aide')}
            fields={direct.modelSelection}
          />
        </div>
      )}
    </section>
  )
}
