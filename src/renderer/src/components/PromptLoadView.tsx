import { useEffect, useMemo, useState } from 'react'
import {
  detectPromptLoadPreset,
  promptLoadSummary,
  targetToolIds,
  type PromptLoadPreset
} from './prompt-load-model'
import { HumanJson } from './HumanJson'
import './PromptLoadView.css'

type ControlKind = 'tools' | 'skills' | 'plugins' | 'hooks'

interface ControlItem {
  id: string
  label: string
  description: string
  enabled: boolean
  mutable: boolean
  source?: string
}

interface ObservedPromptCall {
  id: string
  ts: string
  conversationId: string
  turnId: string
  iteration: number
  actor: string
  provider: string
  model?: string
  transport: string
  boundary: string
  limitation: string
  system?: string
  messages: Array<{ role: string; content: string }>
  options: Record<string, unknown>
  response: string
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    costUsd?: number
  }
}

const PRESETS: Array<{
  id: Exclude<PromptLoadPreset, 'custom'>
  label: string
  kicker: string
  description: string
}> = [
  {
    id: 'minimal',
    label: 'Minimal',
    kicker: 'Essentiel',
    description: 'Fichiers, terminal, mémoire et coordination de base.'
  },
  {
    id: 'standard',
    label: 'Standard',
    kicker: 'Recommandé',
    description: 'Ajoute web, code, vision et délégation au socle.'
  },
  {
    id: 'full',
    label: 'Complet',
    kicker: 'Maximum',
    description: 'Expose tous les toolsets découverts sur ce profil.'
  }
]

const SECTION_META: Record<ControlKind, { title: string; detail: string; activation: string }> = {
  tools: {
    title: 'Schémas d’outils',
    detail: 'Chaque toolset actif ajoute ses fonctions au contexte envoyé au modèle.',
    activation: 'Session suivante'
  },
  skills: {
    title: 'Catalogue de skills',
    detail: 'Procédures disponibles. Le contenu complet est chargé uniquement à l’invocation.',
    activation: 'Configuration interactive Hermes'
  },
  plugins: {
    title: 'Plugins & injections',
    detail: 'Extensions susceptibles d’ajouter outils, hooks ou contexte à chaque tour.',
    activation: 'Redémarrage'
  },
  hooks: {
    title: 'Hooks runtime',
    detail: 'Automatismes d’exécution ; ils ne constituent pas un bloc de prompt permanent.',
    activation: 'Lecture seule'
  }
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export function PromptLoadView({ active }: { active: boolean }): React.JSX.Element {
  const [catalogues, setCatalogues] = useState<Record<ControlKind, ControlItem[]>>({
    tools: [],
    skills: [],
    plugins: [],
    hooks: []
  })
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [restartRequired, setRestartRequired] = useState(false)
  const [promptCalls, setPromptCalls] = useState<ObservedPromptCall[]>([])
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    let current = true
    Promise.all(
      (['tools', 'skills', 'plugins', 'hooks'] as const).map(async (kind) => [
        kind,
        await window.api.hermesControls(kind)
      ])
    ).then((entries) => {
      if (!current) return
      setCatalogues(Object.fromEntries(entries) as Record<ControlKind, ControlItem[]>)
      setError('')
    })
    void window.api
      .promptCalls()
      .then((calls) => {
        if (current) setPromptCalls(calls as ObservedPromptCall[])
      })
      .catch(() => undefined)
      .catch((reason) => {
        if (current) setError(message(reason))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [active])

  const preset = detectPromptLoadPreset(catalogues.tools)
  const summary = promptLoadSummary(catalogues.tools)
  const observed = useMemo(() => {
    const measuredCalls = promptCalls.filter((call) => call.usage !== undefined).length
    const inputTokens = promptCalls.reduce((sum, call) => sum + (call.usage?.inputTokens ?? 0), 0)
    const outputTokens = promptCalls.reduce((sum, call) => sum + (call.usage?.outputTokens ?? 0), 0)
    const cacheTokens = promptCalls.reduce(
      (sum, call) => sum + (call.usage?.cacheReadTokens ?? 0),
      0
    )
    const characters = promptCalls.reduce(
      (sum, call) =>
        sum +
        (call.system?.length ?? 0) +
        call.messages.reduce((messageSum, item) => messageSum + item.content.length, 0),
      0
    )
    return { inputTokens, outputTokens, cacheTokens, characters, measuredCalls }
  }, [promptCalls])
  const selectedCall =
    promptCalls.find((call) => call.id === selectedCallId) ?? promptCalls.at(0) ?? null
  const needle = query.trim().toLocaleLowerCase('fr')

  const visible = useMemo(() => {
    const result = {} as Record<ControlKind, ControlItem[]>
    for (const kind of ['tools', 'skills', 'plugins', 'hooks'] as const) {
      result[kind] = catalogues[kind].filter((item) =>
        `${item.label} ${item.description} ${item.source ?? ''}`
          .toLocaleLowerCase('fr')
          .includes(needle)
      )
    }
    return result
  }, [catalogues, needle])

  async function applyPreset(next: Exclude<PromptLoadPreset, 'custom'>): Promise<void> {
    setBusy(`preset:${next}`)
    setError('')
    try {
      const result = await window.api.setHermesToolSelection(
        targetToolIds(
          next,
          catalogues.tools.map((item) => item.id)
        )
      )
      setCatalogues((current) => ({ ...current, tools: result.items }))
      setRestartRequired(result.restartRequired)
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy('')
    }
  }

  async function toggle(kind: 'tools' | 'plugins', item: ControlItem): Promise<void> {
    const key = `${kind}:${item.id}`
    setBusy(key)
    setError('')
    try {
      const result =
        kind === 'tools'
          ? await window.api.setHermesTool(item.id, !item.enabled)
          : await window.api.setHermesPlugin(item.id, !item.enabled)
      setCatalogues((current) => ({ ...current, [kind]: result.items }))
      setRestartRequired(result.restartRequired)
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="prompt-load">
      <header className="prompt-load-header">
        <div>
          <span className="prompt-load-eyebrow">Hermes · prompt control plane</span>
          <h1>Prompt Load</h1>
          <p>Contrôle les schémas de toolsets et inventorie les autres sources de contexte.</p>
        </div>
        <div className="prompt-load-meter" aria-label={`${summary.percent}% des toolsets actifs`}>
          <div>
            <strong>{summary.percent}%</strong>
            <span>ratio toolsets</span>
          </div>
          <i style={{ '--prompt-load-ratio': summary.ratio } as React.CSSProperties} />
          <small>
            {summary.active} / {summary.total} schémas actifs
          </small>
        </div>
      </header>

      <div className="prompt-load-presets" role="group" aria-label="Niveaux de chargement">
        {PRESETS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={preset === item.id ? 'is-active' : ''}
            disabled={Boolean(busy)}
            onClick={() => void applyPreset(item.id)}
          >
            <span>{item.kicker}</span>
            <strong>{item.label}</strong>
            <p>{item.description}</p>
            <em>{busy === `preset:${item.id}` ? 'Application…' : 'Appliquer'}</em>
          </button>
        ))}
        <div className={`prompt-custom-state${preset === 'custom' ? ' is-active' : ''}`}>
          <span>Réglage fin</span>
          <strong>Personnalisé</strong>
          <p>État hors preset ; ajuste chaque toolset ci-dessous.</p>
        </div>
      </div>

      <div className="prompt-source-map">
        <article>
          <span className="is-fixed">Fixe</span>
          <strong>SOUL + règles projet</strong>
          <p>Injectés au démarrage, sauf lancement isolé avec --ignore-rules.</p>
        </article>
        <article>
          <span className="is-config">Config</span>
          <strong>Profil + mémoire</strong>
          <p>Gérés par Hermes ; le toolset Memory ne mesure pas leur taille textuelle.</p>
        </article>
        <article>
          <span className="is-demand">À la demande</span>
          <strong>Skills complets</strong>
          <p>
            Le catalogue est visible ; un SKILL.md complet se charge seulement lorsqu’il est
            invoqué.
          </p>
        </article>
        <article>
          <span className="is-neutral">Hors prompt</span>
          <strong>Cron · gateway · sessions</strong>
          <p>Services runtime distincts du ratio de schémas affiché ici.</p>
        </article>
      </div>

      <section className="prompt-observatory" aria-label="Charge réellement observée">
        <div className="prompt-observatory-head">
          <div>
            <span className="prompt-load-eyebrow">Mesuré aux frontières providers</span>
            <h2>Charge réellement observée</h2>
            <p>
              Les tokens viennent du provider. Les caractères correspondent au payload exact
              visible.
            </p>
          </div>
          <div className="prompt-observed-metrics">
            <strong>
              {observed.measuredCalls ? observed.inputTokens.toLocaleString('fr-FR') : 'non mesuré'}
              <small>tokens in</small>
            </strong>
            <strong>
              {observed.measuredCalls
                ? observed.outputTokens.toLocaleString('fr-FR')
                : 'non mesuré'}
              <small>tokens out</small>
            </strong>
            <strong>
              {observed.measuredCalls ? observed.cacheTokens.toLocaleString('fr-FR') : 'non mesuré'}
              <small>cache lu</small>
            </strong>
            <strong>
              {observed.characters.toLocaleString('fr-FR')}
              <small>caractères visibles</small>
            </strong>
          </div>
        </div>

        {promptCalls.length === 0 ? (
          <p className="prompt-load-empty">
            Aucun appel observé. Lance un chat pour mesurer son payload exact.
          </p>
        ) : (
          <div className="prompt-observed-layout">
            <div className="prompt-call-list" role="list" aria-label="Appels observés">
              {promptCalls.slice(0, 30).map((call) => (
                <button
                  type="button"
                  role="listitem"
                  key={call.id}
                  className={selectedCall?.id === call.id ? 'is-active' : ''}
                  onClick={() => setSelectedCallId(call.id)}
                >
                  <span>
                    {call.actor} → {call.provider}
                  </span>
                  <strong>{call.model ?? call.provider}</strong>
                  <small>
                    {new Date(call.ts).toLocaleString('fr-FR')} · {call.usage?.inputTokens ?? '—'}{' '}
                    in
                  </small>
                </button>
              ))}
            </div>
            {selectedCall && (
              <article className="prompt-call-inspector">
                <header>
                  <div>
                    <strong>Payload exact</strong>
                    <small>{selectedCall.boundary}</small>
                  </div>
                  <span>{selectedCall.transport}</span>
                </header>
                <details open>
                  <summary>
                    Instructions système · {selectedCall.system?.length ?? 0} caractères
                  </summary>
                  <pre>{selectedCall.system || '(aucune)'}</pre>
                </details>
                <details>
                  <summary>Messages · {selectedCall.messages.length}</summary>
                  <HumanJson value={selectedCall.messages} />
                </details>
                <details>
                  <summary>Options et provenance</summary>
                  <HumanJson
                    value={{
                      conversationId: selectedCall.conversationId,
                      turnId: selectedCall.turnId,
                      iteration: selectedCall.iteration,
                      actor: selectedCall.actor,
                      provider: selectedCall.provider,
                      model: selectedCall.model,
                      transport: selectedCall.transport,
                      options: selectedCall.options
                    }}
                  />
                </details>
                <details>
                  <summary>Réponse exacte</summary>
                  <pre>{selectedCall.response}</pre>
                </details>
                <p className="prompt-envelope-limit">Zone opaque : {selectedCall.limitation}</p>
              </article>
            )}
          </div>
        )}
      </section>

      <div className="prompt-load-toolbar">
        <input
          className="input"
          value={query}
          aria-label="Filtrer l’inventaire Hermes"
          placeholder="Filtrer toutes les features Hermes…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <span>Profil default · CLI</span>
      </div>

      {restartRequired && (
        <div className="prompt-load-notice" role="status" aria-live="polite">
          Configuration enregistrée. Les toolsets s’appliquent à la prochaine session CLI ; les
          plugins peuvent nécessiter le redémarrage de leur runtime.
        </div>
      )}
      {error && (
        <div className="prompt-load-error" role="alert">
          {error}
        </div>
      )}

      <div className="prompt-load-sections">
        {loading ? (
          <p className="prompt-load-empty">Lecture des autorités Hermes…</p>
        ) : (
          (['tools', 'plugins', 'skills', 'hooks'] as const).map((kind) => (
            <details key={kind} open={kind === 'tools' || Boolean(needle)}>
              <summary>
                <div>
                  <strong>{SECTION_META[kind].title}</strong>
                  <p>{SECTION_META[kind].detail}</p>
                </div>
                <span>
                  {catalogues[kind].filter((item) => item.enabled).length}/{catalogues[kind].length}
                  <em>{SECTION_META[kind].activation}</em>
                </span>
              </summary>
              <div className="prompt-feature-grid">
                {visible[kind].length === 0 ? (
                  <p className="prompt-load-empty">Aucune feature correspondante.</p>
                ) : (
                  visible[kind].map((item, index) => {
                    const mutable = item.mutable && (kind === 'tools' || kind === 'plugins')
                    return (
                      <article
                        className="prompt-feature"
                        key={`${item.id}:${item.source}:${index}`}
                      >
                        <span className={`prompt-feature-dot${item.enabled ? ' is-on' : ''}`} />
                        <div>
                          <strong>{item.label}</strong>
                          <p>{item.description}</p>
                          <small>
                            {item.source ? `${item.source} · ` : ''}
                            {mutable ? SECTION_META[kind].activation : 'Autorité en lecture seule'}
                          </small>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={item.enabled}
                          aria-label={`${item.enabled ? 'Désactiver' : 'Activer'} ${item.label}`}
                          className={`prompt-feature-toggle${item.enabled ? ' is-on' : ''}`}
                          disabled={!mutable || Boolean(busy)}
                          title={
                            mutable
                              ? `Modifier ${item.label} dans Hermes`
                              : 'Identifiant Hermes ambigu ou mutation non interactive indisponible'
                          }
                          onClick={() => {
                            if (kind === 'tools' || kind === 'plugins') void toggle(kind, item)
                          }}
                        >
                          <i />
                        </button>
                      </article>
                    )
                  })
                )}
              </div>
            </details>
          ))
        )}
      </div>
    </section>
  )
}
