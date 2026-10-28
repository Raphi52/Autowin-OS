import { useEffect, useMemo, useState } from 'react'
import './CapabilitiesView.css'
import { ModuleHeader } from './ModuleHeader'
import { Spinner } from './Spinner'
import { useTextesSettings, type CleSettings } from '../textes-ecrans/settings'

export type CapabilityKind = 'skills' | 'hooks' | 'gates' | 'tools' | 'plugins'
type Kind = CapabilityKind
type HookModel = 'claude' | 'codex'

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

// `title` : nom de la section de Settings, le même dans les deux langues. `empty` et `description`
// sont des clés de `textes-ecrans/settings.ts` (traduction anglaise, conv-1170).
const META: Record<Kind, { title: string; empty: CleSettings; description: CleSettings }> = {
  skills: {
    title: 'Skills',
    empty: 'capacites.skills.vide',
    description: 'capacites.skills.description'
  },
  hooks: {
    title: 'Hooks',
    empty: 'capacites.hooks.vide',
    description: 'capacites.hooks.description'
  },
  gates: {
    title: 'Gates',
    empty: 'capacites.gates.vide',
    description: 'capacites.gates.description'
  },
  tools: {
    title: 'Tools',
    empty: 'capacites.tools.vide',
    description: 'capacites.tools.description'
  },
  plugins: {
    title: 'Mods',
    empty: 'capacites.plugins.vide',
    description: 'capacites.plugins.description'
  }
}

const HOOK_SOURCES: Array<{ id: HookModel; label: string }> = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' }
]

function sourceClass(source?: string): string {
  if (!source) return 'is-neutral'
  if (source.includes('claude')) return 'is-claude'
  if (source.includes('codex')) return 'is-codex'
  if (source.includes('native')) return 'is-native'
  return 'is-neutral'
}

/**
 * UN registre de capacités. Le registre affiché est choisi par la liste de sections de Settings, plus
 * par des onglets internes (conv-1109, 2026-10-23 : « sépare la partie avec 4 mots en 4 views ») :
 * Skills, Hooks, Gates, Mods et Tools y sont cinq sections. Settings remonte la vue à chaque
 * changement de section (`key`), donc filtres, source et sélection repartent à zéro comme le
 * faisait l'ancien changement d'onglet — chaque registre s'ouvre filtré sur l'ACTIF.
 */
export function CapabilitiesView({
  active,
  kind = 'skills'
}: {
  active: boolean
  kind?: Kind
}): React.JSX.Element {
  // Textes dans la langue de Settings · Interface (conv-1170). Ce qui vient des registres (noms,
  // descriptions, sources, matchers, événements) reste tel quel.
  const { t } = useTextesSettings()
  const [items, setItems] = useState<Item[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [restartRequired, setRestartRequired] = useState(false)
  const [hookModel, setHookModel] = useState<HookModel>('claude')
  const [skillSource, setSkillSource] = useState('all')
  // Tools : 'real' = actions réellement exécutées par les sous-agents (défaut) ; 'catalog' = catalogue local du registre natif.
  const [toolSource, setToolSource] = useState<'real' | 'catalog'>('real')
  // Façon 1 (« n'afficher que ce qui sert ») : par défaut on n'affiche que les capacités ACTIVES.
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('enabled')
  const [selectedId, setSelectedId] = useState('')
  const [relationCatalog, setRelationCatalog] = useState<RelatedItem[]>([])
  // L'échec d'UNE source de relations ne doit ni vider le catalogue ni polluer la liste principale :
  // il est agrégé partiellement et SIGNALÉ ici.
  // Des CLÉS de texte, traduites à l'affichage : la langue peut changer après le chargement.
  const [relationSourcesDown, setRelationSourcesDown] = useState<CleSettings[]>([])

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
    const sources: Array<{
      label: CleSettings
      relationKind: 'hook' | 'tool'
      relationSource: string
      load: () => Promise<Item[]>
    }> = [
      {
        label: 'capacites.relations.hooksClaude',
        relationKind: 'hook',
        relationSource: 'Claude',
        load: () => window.api.claudeHooks()
      },
      {
        label: 'capacites.relations.hooksCodex',
        relationKind: 'hook',
        relationSource: 'Codex',
        load: () => window.api.codexHooks()
      },
      {
        label: 'capacites.relations.hooksAutowin',
        relationKind: 'hook',
        relationSource: 'Autowin',
        load: () => window.api.capabilityControls('hooks')
      },
      {
        label: 'capacites.relations.toolsAutowin',
        relationKind: 'tool',
        relationSource: 'Autowin',
        load: () => window.api.capabilityControls('tools')
      }
    ]
    void Promise.allSettled(sources.map((source) => source.load())).then((results) => {
      if (!current) return
      const catalog: RelatedItem[] = []
      const down: CleSettings[] = []
      results.forEach((result, index) => {
        const source = sources[index]
        if (result.status === 'fulfilled') {
          for (const item of result.value)
            catalog.push({
              ...item,
              relationKind: source.relationKind,
              relationSource: source.relationSource
            })
        } else {
          down.push(source.label)
        }
      })
      setRelationCatalog(catalog)
      setRelationSourcesDown(down)
    })
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
  // FAUX état vide : des éléments EXISTENT mais le filtre d'état les masque. On le dit, avec le
  // compteur, plutôt que d'afficher « aucun ».
  const hiddenByStatus = useMemo(() => {
    if (statusFilter === 'all') return 0
    const needle = query.trim().toLocaleLowerCase('fr')
    return effectiveItems.filter((item) => {
      const sourceMatches =
        kind !== 'skills' || skillSource === 'all' || item.source === skillSource
      const statusMatches = statusFilter === 'enabled' ? item.enabled : !item.enabled
      const queryMatches =
        `${item.label} ${item.description} ${item.source ?? ''} ${item.matcher ?? ''}`
          .toLocaleLowerCase('fr')
          .includes(needle)
      return sourceMatches && !statusMatches && queryMatches
    }).length
  }, [effectiveItems, kind, query, skillSource, statusFilter])
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

  return (
    <section className="capability-cockpit">
      <header className="cockpit-header">
        <ModuleHeader
          eyebrow={t('capacites.eyebrow')}
          title={META[kind].title}
          description={t(META[kind].description)}
        />
        <div className="cockpit-toolbar">
          <input
            className="input"
            value={query}
            placeholder={t('capacites.recherche')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </header>

      {error && <div className="control-error">{error}</div>}
      {restartRequired && <div className="control-notice">{t('capacites.redemarrage')}</div>}

      <div className="cockpit-shell">
        <aside className="cockpit-sources">
          {/* « Sources » : le même mot dans les deux langues. */}
          <h2>Sources</h2>
          {kind === 'skills' ? (
            <>
              <button
                className={skillSource === 'all' ? 'is-active' : ''}
                onClick={() => setSkillSource('all')}
              >
                <b>{t('capacites.toutes')}</b>
                <strong>{items.length}</strong>
                <small>{t('capacites.registreSynchronise')}</small>
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
                <b>{t('capacites.sourceFuture')}</b>
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
                <small>{t('capacites.hooksDe', { source: source.label })}</small>
              </button>
            ))
          ) : kind === 'tools' ? (
            <>
              <button
                className={toolSource === 'real' ? 'is-active' : ''}
                onClick={() => setToolSource('real')}
              >
                <b>{t('capacites.actionsReelles')}</b>
                {toolSource === 'real' && <strong>{items.length}</strong>}
                <small>{t('capacites.executeesParAgents')}</small>
              </button>
              <button
                className={toolSource === 'catalog' ? 'is-active' : ''}
                onClick={() => setToolSource('catalog')}
              >
                <b>{t('capacites.catalogueLocal')}</b>
                {toolSource === 'catalog' && <strong>{items.length}</strong>}
                <small>{t('capacites.decoratif')}</small>
              </button>
            </>
          ) : (
            <button className="is-active">
              <b>{kind === 'gates' ? 'Autowin' : t('capacites.registreLocal')}</b>
              <strong>{items.length}</strong>
              <small>
                {kind === 'gates' ? t('capacites.gates.source') : t('capacites.plugins.source')}
              </small>
            </button>
          )}

          <h2 className="status-title">{t('capacites.etat')}</h2>
          <button
            className={statusFilter === 'enabled' ? 'is-active' : ''}
            onClick={() => setStatusFilter(statusFilter === 'enabled' ? 'all' : 'enabled')}
          >
            <b>{t('capacites.actives')}</b>
            <strong className="is-green">{enabledCount}</strong>
          </button>
          <button
            className={statusFilter === 'disabled' ? 'is-active' : ''}
            onClick={() => setStatusFilter(statusFilter === 'disabled' ? 'all' : 'disabled')}
          >
            <b>{t('capacites.desactivees')}</b>
            <strong>{effectiveItems.length - enabledCount}</strong>
          </button>
        </aside>

        <main className="cockpit-registry">
          <div className="registry-heading">
            <span>{t('capacites.disponibles', { titre: META[kind].title })}</span>
            <span>
              {t(filtered.length > 1 ? 'capacites.resultats' : 'capacites.resultat', {
                n: filtered.length
              })}
            </span>
          </div>
          <div className="control-list">
            {loading ? (
              <p className="control-empty">
                <Spinner /> {t('capacites.lecture')}
              </p>
            ) : filtered.length === 0 && hiddenByStatus > 0 ? (
              <div className="control-empty">
                <p>
                  {t(hiddenByStatus > 1 ? 'capacites.masquees' : 'capacites.masquee', {
                    n: hiddenByStatus
                  })}
                </p>
                <button
                  type="button"
                  data-testid="capabilities-reveal-disabled"
                  onClick={() => setStatusFilter('all')}
                >
                  {t(
                    statusFilter === 'enabled'
                      ? 'capacites.afficherDesactivees'
                      : 'capacites.afficherActives',
                    { n: hiddenByStatus }
                  )}
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="control-empty">{t(META[kind].empty)}</p>
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
                        {item.scope && (
                          <em>{item.scope === 'global' ? 'Global' : t('capacites.projet')}</em>
                        )}
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
                        : 'Autowin')}
                  </span>
                  {kind === 'tools' && toolSource === 'real' ? (
                    // Actions réellement exécutées = lecture seule (observabilité, pas d'admin).
                    <span className="control-usage-count" title={t('capacites.occurrences')}>
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
                      title={t('capacites.basculerOutil')}
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
                      title={t('capacites.etatLu')}
                    >
                      {item.enabled ? t('capacites.actif') : t('capacites.inactif')}
                    </span>
                  )}
                </article>
              ))
            )}
          </div>
          {!loading && kind === 'skills' && selected && (
            <section className="related-capabilities">
              <div className="registry-heading">
                <span>{t('capacites.associes', { nom: selected.label })}</span>
                {/* « relation(s) » : le même mot dans les deux langues. */}
                <span>
                  {relations.length} relation{relations.length > 1 ? 's' : ''}
                </span>
              </div>
              {relationSourcesDown.length > 0 && (
                <p className="control-notice" data-testid="relations-partial">
                  {t(
                    relationSourcesDown.length > 1
                      ? 'capacites.relationsPartielPluriel'
                      : 'capacites.relationsPartiel',
                    { liste: relationSourcesDown.map((cle) => t(cle)).join(', ') }
                  )}
                </p>
              )}
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
                  <p>{t('capacites.aucuneRelation')}</p>
                )}
              </div>
            </section>
          )}
        </main>

        <aside className="cockpit-inspector">
          <h2>{t('capacites.inspecteur')}</h2>
          {selected ? (
            <>
              <div className="inspector-hero">
                <span
                  className={`control-source-badge ${sourceClass(selected.source || (kind === 'hooks' ? hookModel : ''))}`}
                >
                  {META[kind].title.slice(0, -1)} ·{' '}
                  {selected.sourceLabel ||
                    selected.source ||
                    (kind === 'hooks' ? hookModel : 'Autowin')}
                </span>
                <h3>{selected.label}</h3>
                <p>{selected.enabled ? 'Active' : t('capacites.desactivee')}</p>
              </div>
              <dl>
                <div>
                  <dt>{t('capacites.origine')}</dt>
                  <dd>{selected.source || (kind === 'hooks' ? hookModel : 'Autowin')}</dd>
                </div>
                <div>
                  <dt>{t('capacites.portee')}</dt>
                  <dd>
                    {selected.scope === 'project' ? t('capacites.projet') : t('capacites.globale')}
                  </dd>
                </div>
                {selected.event && (
                  <div>
                    <dt>{t('capacites.evenement')}</dt>
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
                    <dt>{t('capacites.lieeA')}</dt>
                    <dd>
                      {relations.filter((item) => item.relationKind === 'hook').length} hooks ·{' '}
                      {relations.filter((item) => item.relationKind === 'tool').length} tools
                    </dd>
                  </div>
                )}
                <div>
                  <dt>{t('capacites.gestion')}</dt>
                  <dd>
                    {kind === 'tools' ? t('capacites.registreNatif') : t('capacites.lectureSeule')}
                  </dd>
                </div>
              </dl>
              <div className="inspector-impact">
                <b>{t('capacites.impact')}</b>
                <p>
                  {kind === 'tools'
                    ? t('capacites.impact.tools')
                    : t('capacites.impact.lectureSeule')}
                </p>
              </div>
            </>
          ) : (
            <p className="control-empty">{t('capacites.selectionner')}</p>
          )}
        </aside>
      </div>
    </section>
  )
}
