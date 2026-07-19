import { useEffect, useMemo, useState } from 'react'
import './HermesControlsView.css'

type Kind = 'skills' | 'hooks' | 'tools'

interface Item {
  id: string
  label: string
  description: string
  enabled: boolean
  mutable: boolean
  source?: string
  scope?: 'global' | 'project'
  event?: string
  matcher?: string
}

const META: Record<Kind, { title: string; description: string; empty: string }> = {
  skills: {
    title: 'Skills',
    description:
      'Compétences chargées par Hermes. Nouvelle session recommandée après configuration.',
    empty: 'Aucune skill trouvée.'
  },
  hooks: {
    title: 'Hooks',
    description: 'Hooks shell déclarés dans Hermes et consentements associés.',
    empty: 'Aucun hook shell configuré dans Hermes.'
  },
  tools: {
    title: 'Tools',
    description: 'Toolsets autorisés pour la plateforme CLI Hermes.',
    empty: 'Aucun toolset trouvé.'
  }
}

export function HermesControlsView({
  active,
  kind
}: {
  active: boolean
  kind: Kind
}): React.JSX.Element {
  const [items, setItems] = useState<Item[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [restartRequired, setRestartRequired] = useState(false)
  const [hookModel, setHookModel] = useState<'hermes' | 'claude'>('claude')

  useEffect(() => {
    if (!active) return
    let current = true
    queueMicrotask(() => {
      if (!current) return
      setLoading(true)
      setError('')
      const request =
        kind === 'hooks' && hookModel === 'claude'
          ? window.api.claudeHooks()
          : window.api.hermesControls(kind)
      request
        .then((nextItems) => {
          if (current) setItems(nextItems)
        })
        .catch((reason) => {
          if (current) setError(reason instanceof Error ? reason.message : String(reason))
        })
        .finally(() => {
          if (current) setLoading(false)
        })
    })
    return () => {
      current = false
    }
  }, [active, hookModel, kind])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fr')
    return items.filter((item) =>
      `${item.label} ${item.description} ${item.source ?? ''}`
        .toLocaleLowerCase('fr')
        .includes(needle)
    )
  }, [items, query])

  async function toggle(item: Item): Promise<void> {
    if (kind !== 'tools' || !item.mutable) return
    setBusy(item.id)
    setError('')
    try {
      const result = await window.api.setHermesTool(item.id, !item.enabled)
      setItems(result.items)
      setRestartRequired(result.restartRequired)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  function selectHookModel(model: 'hermes' | 'claude'): void {
    setLoading(true)
    setError('')
    setHookModel(model)
  }

  return (
    <section className="hermes-controls">
      <header>
        <div>
          <span>Hermes control plane</span>
          <h1>{META[kind].title}</h1>
          <p>{META[kind].description}</p>
        </div>
        <div className="control-summary">
          <strong>{items.filter((item) => item.enabled).length}</strong>
          <span>actifs / {items.length}</span>
        </div>
      </header>

      <div className="control-toolbar">
        {kind === 'hooks' && (
          <label className="control-model-picker">
            <span>Modèle</span>
            <select
              value={hookModel}
              onChange={(event) => selectHookModel(event.target.value as 'hermes' | 'claude')}
            >
              <option value="claude">Claude</option>
              <option value="hermes">Hermes</option>
            </select>
          </label>
        )}
        <input
          className="input"
          value={query}
          placeholder={`Filtrer les ${META[kind].title.toLowerCase()}…`}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className={`control-authority ${kind === 'tools' ? 'is-live' : ''}`}>
          {kind === 'tools'
            ? 'Mutation Hermes active'
            : kind === 'hooks' && hookModel === 'claude'
              ? 'Lecture Claude · global + projet'
              : 'Lecture Hermes · toggle verrouillé'}
        </span>
      </div>

      {restartRequired && (
        <div className="control-notice">
          Changement enregistré · nouvelle session Hermes ou redémarrage gateway requis.
        </div>
      )}
      {error && <div className="control-error">{error}</div>}

      <div className="control-list">
        {loading ? (
          <p className="control-empty">Lecture de Hermes…</p>
        ) : filtered.length === 0 ? (
          <p className="control-empty">{META[kind].empty}</p>
        ) : (
          filtered.map((item) => (
            <article className="control-row" key={item.id}>
              <span className={`control-status ${item.enabled ? 'is-on' : ''}`} />
              <div>
                <strong>{item.label}</strong>
                <p>{item.description}</p>
                {(item.scope || item.matcher) && (
                  <div className="control-hook-meta">
                    {item.scope && <em>{item.scope === 'global' ? 'Global' : 'Projet'}</em>}
                    {item.matcher && <code>matcher: {item.matcher}</code>}
                  </div>
                )}
                {item.source && <small>{item.source}</small>}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={item.enabled}
                className={`control-toggle ${item.enabled ? 'is-on' : ''}`}
                disabled={!item.mutable || busy === item.id}
                title={
                  item.mutable
                    ? 'Modifier dans Hermes'
                    : 'Hermes ne fournit pas de commande de toggle sûre'
                }
                onClick={() => void toggle(item)}
              >
                <i />
              </button>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
