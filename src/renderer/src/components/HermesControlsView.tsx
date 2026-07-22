import { useEffect, useMemo, useState } from 'react'
import './HermesControlsView.css'
import { ModuleHeader } from './ModuleHeader'

type Kind = 'skills' | 'hooks' | 'tools'
type HookModel = 'hermes' | 'claude' | 'codex'

interface Item {
  id: string
  label: string
  description: string
  enabled: boolean
  mutable: boolean
  source?: string
  sourceLabel?: string
  scope?: 'global' | 'project'
  event?: string
  matcher?: string
}

type RelatedItem = Item & { relationKind: 'hook' | 'tool'; relationSource: string }

const META: Record<Kind, { title: string; empty: string }> = {
  skills: { title: 'Skills', empty: 'Aucune skill trouvée.' },
  hooks: { title: 'Hooks', empty: 'Aucun hook configuré.' },
  tools: { title: 'Tools', empty: 'Aucun toolset trouvé.' }
}

const HOOK_SOURCES: Array<{ id: HookModel; label: string }> = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'hermes', label: 'Hermes' }
]

function sourceClass(source?: string): string {
  if (!source) return 'is-neutral'
  if (source.includes('claude')) return 'is-claude'
  if (source.includes('codex')) return 'is-codex'
  if (source.includes('hermes')) return 'is-hermes'
  return 'is-neutral'
}

export function HermesControlsView({ active }: { active: boolean }): React.JSX.Element {
  const [kind, setKind] = useState<Kind>('skills')
  const [items, setItems] = useState<Item[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [restartRequired, setRestartRequired] = useState(false)
  const [hookModel, setHookModel] = useState<HookModel>('claude')
  const [skillSource, setSkillSource] = useState('all')
  // Tools : 'real' = actions réellement exécutées par les sous-agents (défaut) ; 'hermes' = catalogue.
  const [toolSource, setToolSource] = useState<'real' | 'hermes'>('real')
  // Façon 1 (« n'afficher que ce qui sert ») : par défaut on n'affiche que les capacités ACTIVES.
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('enabled')
  const [selectedId, setSelectedId] = useState('')
  const [relationCatalog, setRelationCatalog] = useState<RelatedItem[]>([])

  useEffect(() => {
    if (!active) return
    let current = true
    queueMicrotask(() => {
      if (!current) return
      setLoading(true)
      setError('')
      const request =
        kind === 'skills'
          ? window.api.skills()
          : kind === 'hooks' && hookModel === 'claude'
            ? window.api.claudeHooks()
            : kind === 'hooks' && hookModel === 'codex'
              ? window.api.codexHooks()
              : kind === 'tools' && toolSource === 'real'
                ? window.api.toolUsage()
                : window.api.capabilityControls(kind)
      request
        .then((nextItems) => {
          if (!current) return
          setItems(nextItems)
          setSelectedId((id) =>
            nextItems.some((item) => item.id === id) ? id : (nextItems[0]?.id ?? '')
          )
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
  }, [active, hookModel, kind, toolSource])

  useEffect(() => {
    if (!active) return
    let current = true
    Promise.all([
      window.api.claudeHooks().then((entries) =>
        entries.map((item) => ({
          ...item,
          relationKind: 'hook' as const,
          relationSource: 'Claude'
        }))
      ),
      window.api.codexHooks().then((entries) =>
        entries.map((item) => ({
          ...item,
          relationKind: 'hook' as const,
          relationSource: 'Codex'
        }))
      ),
      window.api.capabilityControls('hooks').then((entries) =>
        entries.map((item) => ({
          ...item,
          relationKind: 'hook' as const,
          relationSource: 'Hermes'
        }))
      ),
      window.api.capabilityControls('tools').then((entries) =>
        entries.map((item) => ({
          ...item,
          relationKind: 'tool' as const,
          relationSource: 'Hermes'
        }))
      )
    ])
      .then((groups) => {
        if (current) setRelationCatalog(groups.flat())
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [active])

  // État = celui de la source native (registre disque) directement — plus de couche « profil ».
  const effectiveItems = items

  const skillSources = useMemo(() => {
    const labels = new Map<string, string>()
    for (const item of items)
      if (item.source) labels.set(item.source, item.sourceLabel || item.source)
    return [...labels].map(([id, label]) => ({
      id,
      label,
      count: items.filter((item) => item.source === id).length
    }))
  }, [items])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fr')
    return effectiveItems.filter((item) => {
      const sourceMatches =
        kind !== 'skills' || skillSource === 'all' || item.source === skillSource
      const statusMatches =
        statusFilter === 'all' || (statusFilter === 'enabled' ? item.enabled : !item.enabled)
      const queryMatches =
        `${item.label} ${item.description} ${item.source ?? ''} ${item.matcher ?? ''}`
          .toLocaleLowerCase('fr')
          .includes(needle)
      return sourceMatches && statusMatches && queryMatches
    })
  }, [effectiveItems, kind, query, skillSource, statusFilter])

  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0]
  const enabledCount = effectiveItems.filter((item) => item.enabled).length
  const relations = useMemo(() => {
    if (!selected || kind !== 'skills') return []
    const needle = selected.label.toLocaleLowerCase('fr')
    return relationCatalog.filter((item) =>
      `${item.id} ${item.label} ${item.description} ${item.matcher ?? ''}`
        .toLocaleLowerCase('fr')
        .includes(needle)
    )
  }, [kind, relationCatalog, selected])

  // Seul le canal `tools` a un backend d'activation RÉEL (setCapabilityTool → registre natif). Les
  // skills/hooks n'écrivaient que dans le profil décoratif (retiré) → ils sont désormais en
  // lecture seule (pas de toggle qui ne ferait rien).
  async function toggle(item: Item): Promise<void> {
    if (kind !== 'tools') return
    setBusy(item.id)
    setError('')
    try {
      const result = await window.api.setCapabilityTool(item.id, !item.enabled)
      setItems(result.items)
      setRestartRequired(result.restartRequired)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  function selectKind(nextKind: Kind): void {
    setKind(nextKind)
    setSelectedId('')
    // Façon 1 : chaque onglet s'ouvre filtré sur l'ACTIF (Skills · Hooks · Tools) — on ne montre
    // par défaut que les capacités en service, pas le registre complet bruité.
    setStatusFilter('enabled')
    setSkillSource('all')
  }

  return (
    <section className="capability-cockpit">
      <header className="cockpit-header">
        <ModuleHeader eyebrow="Capacités connectées" title="Skills · Hooks · Tools" />
        <div className="cockpit-toolbar">
          <input
            className="input"
            value={query}
            placeholder="Rechercher une capacité…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </header>

      {error && <div className="control-error">{error}</div>}
      {restartRequired && (
        <div className="control-notice">
          Changement enregistré · nouvelle session Hermes ou redémarrage gateway requis.
        </div>
      )}

      <div className="cockpit-shell">
        <aside className="cockpit-sources">
          <h2>Sources</h2>
          {kind === 'skills' ? (
            <>
              <button
                className={skillSource === 'all' ? 'is-active' : ''}
                onClick={() => setSkillSource('all')}
              >
                <b>Toutes</b>
                <strong>{items.length}</strong>
                <small>Registre synchronisé</small>
              </button>
              {skillSources.map((source) => (
                <button
                  key={source.id}
                  className={skillSource === source.id ? 'is-active' : ''}
                  onClick={() => setSkillSource(source.id)}
                >
                  <b>{source.label}</b>
                  <strong>{source.count}</strong>
                  <small>{source.id}</small>
                </button>
              ))}
              <button className="is-future" disabled>
                <b>＋ Source future</b>
              </button>
            </>
          ) : kind === 'hooks' ? (
            HOOK_SOURCES.map((source) => (
              <button
                key={source.id}
                className={hookModel === source.id ? 'is-active' : ''}
                onClick={() => setHookModel(source.id)}
              >
                <b>{source.label}</b>
                {hookModel === source.id && <strong>{items.length}</strong>}
                <small>Hooks {source.label}</small>
              </button>
            ))
          ) : (
            <>
              <button
                className={toolSource === 'real' ? 'is-active' : ''}
                onClick={() => setToolSource('real')}
              >
                <b>Actions réelles</b>
                {toolSource === 'real' && <strong>{items.length}</strong>}
                <small>Exécutées par les agents</small>
              </button>
              <button
                className={toolSource === 'hermes' ? 'is-active' : ''}
                onClick={() => setToolSource('hermes')}
              >
                <b>Catalogue Hermes</b>
                {toolSource === 'hermes' && <strong>{items.length}</strong>}
                <small>Décoratif · non invoqué</small>
              </button>
            </>
          )}

          <h2 className="status-title">État</h2>
          <button
            className={statusFilter === 'enabled' ? 'is-active' : ''}
            onClick={() => setStatusFilter(statusFilter === 'enabled' ? 'all' : 'enabled')}
          >
            <b>Actives</b>
            <strong className="is-green">{enabledCount}</strong>
          </button>
          <button
            className={statusFilter === 'disabled' ? 'is-active' : ''}
            onClick={() => setStatusFilter(statusFilter === 'disabled' ? 'all' : 'disabled')}
          >
            <b>Désactivées</b>
            <strong>{effectiveItems.length - enabledCount}</strong>
          </button>
        </aside>

        <main className="cockpit-registry">
          <div className="cockpit-tabs" role="tablist" aria-label="Registre des capacités">
            {(['skills', 'hooks', 'tools'] as const).map((candidate) => (
              <button
                key={candidate}
                role="tab"
                aria-selected={kind === candidate}
                className={kind === candidate ? 'is-active' : ''}
                onClick={() => selectKind(candidate)}
              >
                {META[candidate].title}
                {candidate === kind && <small> · {items.length}</small>}
              </button>
            ))}
          </div>
          <div className="registry-heading">
            <span>{META[kind].title} disponibles</span>
            <span>
              {filtered.length} résultat{filtered.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="control-list">
            {loading ? (
              <p className="control-empty">Lecture des sources…</p>
            ) : filtered.length === 0 ? (
              <p className="control-empty">{META[kind].empty}</p>
            ) : (
              filtered.map((item) => (
                <article
                  className={`control-row ${selected?.id === item.id ? 'is-selected' : ''}`}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                >
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
                  </div>
                  <span
                    className={`control-source-badge ${sourceClass(item.source || (kind === 'hooks' ? hookModel : ''))}`}
                  >
                    {item.sourceLabel ||
                      item.source ||
                      (kind === 'hooks'
                        ? HOOK_SOURCES.find((source) => source.id === hookModel)?.label
                        : 'Hermes')}
                  </span>
                  {kind === 'tools' && toolSource === 'real' ? (
                    // Actions réellement exécutées = lecture seule (observabilité, pas d'admin).
                    <span className="control-usage-count" title="Occurrences observées">
                      ×{(item as { count?: number }).count ?? ''}
                    </span>
                  ) : kind === 'tools' ? (
                    // Seul le catalogue Tools a un backend d'activation réel (registre natif).
                    <button
                      type="button"
                      role="switch"
                      aria-checked={item.enabled}
                      className={`control-toggle ${item.enabled ? 'is-on' : ''}`}
                      disabled={busy === item.id}
                      title="Activer ou désactiver cet outil dans le registre natif"
                      onClick={(event) => {
                        event.stopPropagation()
                        void toggle(item)
                      }}
                    >
                      <i />
                    </button>
                  ) : (
                    // Skills/hooks = lecture seule (état lu du registre natif, pas d'admin ici).
                    <span
                      className={`control-status-tag ${item.enabled ? 'is-on' : ''}`}
                      title="État lu du registre (lecture seule)"
                    >
                      {item.enabled ? 'Actif' : 'Inactif'}
                    </span>
                  )}
                </article>
              ))
            )}
          </div>
          {!loading && kind === 'skills' && selected && (
            <section className="related-capabilities">
              <div className="registry-heading">
                <span>Hooks & tools associés à {selected.label}</span>
                <span>
                  {relations.length} relation{relations.length > 1 ? 's' : ''}
                </span>
              </div>
              <div className="related-list">
                {relations.length > 0 ? (
                  relations.slice(0, 4).map((relation) => (
                    <button
                      key={`${relation.relationKind}-${relation.relationSource}-${relation.id}`}
                      type="button"
                    >
                      <span
                        className={`control-source-badge ${sourceClass(relation.relationSource)}`}
                      >
                        {relation.relationSource}
                      </span>
                      <b>{relation.label}</b>
                      <small>
                        {relation.matcher ? `matcher: ${relation.matcher}` : relation.description}
                      </small>
                    </button>
                  ))
                ) : (
                  <p>Aucune relation explicite détectée dans les déclarations.</p>
                )}
              </div>
            </section>
          )}
        </main>

        <aside className="cockpit-inspector">
          <h2>Inspecteur</h2>
          {selected ? (
            <>
              <div className="inspector-hero">
                <span
                  className={`control-source-badge ${sourceClass(selected.source || (kind === 'hooks' ? hookModel : ''))}`}
                >
                  {META[kind].title.slice(0, -1)} ·{' '}
                  {selected.sourceLabel ||
                    selected.source ||
                    (kind === 'hooks' ? hookModel : 'Hermes')}
                </span>
                <h3>{selected.label}</h3>
                <p>{selected.enabled ? 'Active' : 'Désactivée'}</p>
              </div>
              <dl>
                <div>
                  <dt>Origine</dt>
                  <dd>{selected.source || (kind === 'hooks' ? hookModel : 'Hermes')}</dd>
                </div>
                <div>
                  <dt>Portée</dt>
                  <dd>{selected.scope === 'project' ? 'Projet' : 'Globale'}</dd>
                </div>
                {selected.event && (
                  <div>
                    <dt>Événement</dt>
                    <dd>{selected.event}</dd>
                  </div>
                )}
                {selected.matcher && (
                  <div>
                    <dt>Matcher</dt>
                    <dd>
                      <code>{selected.matcher}</code>
                    </dd>
                  </div>
                )}
                {kind === 'skills' && (
                  <div>
                    <dt>Liée à</dt>
                    <dd>
                      {relations.filter((item) => item.relationKind === 'hook').length} hooks ·{' '}
                      {relations.filter((item) => item.relationKind === 'tool').length} tools
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Gestion</dt>
                  <dd>{kind === 'tools' ? 'Registre natif' : 'Lecture seule'}</dd>
                </div>
              </dl>
              <div className="inspector-impact">
                <b>Impact du changement</b>
                <p>
                  {kind === 'tools'
                    ? 'Modifie le registre natif ; peut nécessiter une nouvelle session pour prise en compte.'
                    : 'Capacité en lecture seule ici : son état est lu du registre, non modifiable depuis cette vue.'}
                </p>
              </div>
            </>
          ) : (
            <p className="control-empty">Sélectionne une capacité pour afficher ses détails.</p>
          )}
        </aside>
      </div>
    </section>
  )
}
