import { useEffect, useState } from 'react'
import './BehaviourView.css'
import { ModuleHeader } from './ModuleHeader'

/**
 * Vue « Behaviour » — miroir FIDÈLE (config statique) de TOUT ce qui influe sur le comportement du
 * chat Autowin, et RIEN d'autre. Organisée par ANATOMIE d'un tour (ordre réel du pipeline), avec un
 * toggle entre les 2 chemins : ORCHESTRÉ (pipeline riche) et DIRECT (os.chat, kit SOUL seul).
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
  orchestrated: {
    systemPrompt: PhaseSystemPrompt[]
    injectedContext: InfluencerField[]
    modelSelection: InfluencerField[]
    regime: InfluencerField[]
    guardrails: InfluencerField[]
  }
  direct: {
    systemPrompt: InfluencerField[]
    modelSelection: InfluencerField[]
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
  const [path, setPath] = useState<'orchestrated' | 'direct'>('orchestrated')
  const [error, setError] = useState('')

  useEffect(() => {
    window.api
      .behaviourComposition()
      .then((c) => setComposition(c as BehaviourComposition))
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [])

  const orch = composition?.orchestrated
  const direct = composition?.direct

  return (
    <section className="behaviour-view">
      <header>
        <ModuleHeader
          eyebrow="Tout ce qui influe sur le comportement du chat — et rien d'autre"
          title="Behaviour"
        />
        <div className="behaviour-path-toggle" role="tablist" aria-label="Chemin de chat">
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

      {error && <div className="behaviour-error">{error}</div>}
      {!composition && !error && <p className="behaviour-empty">Chargement de la composition…</p>}

      {orch && path === 'orchestrated' && (
        <div className="behaviour-anatomy">
          <p className="behaviour-path-note">
            Le vrai pipeline (os:orchestrate) : le system prompt VARIE par phase, du contexte est
            injecté, le modèle/rôle est choisi, le régime décide des phases, des garde-fous encadrent.
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
                  <small>
                    {p.blocks.map((b) => b.label).join(' + ')}
                  </small>
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
            garde-fous. Sa « personnalité » vient du seul kit SOUL.
          </p>
          <Category
            title="System prompt"
            hint="kit SOUL (chat direct uniquement)"
            fields={direct.systemPrompt}
          />
          <Category
            title="Modèle / rôle"
            hint="binding du rôle demandé, sans pipeline"
            fields={direct.modelSelection}
          />
        </div>
      )}
    </section>
  )
}
