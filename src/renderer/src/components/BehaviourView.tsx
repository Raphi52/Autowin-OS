import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  filterBehaviourFiles,
  groupBehaviourFiles,
  preferredBehaviourFileId,
  type BehaviourEngine,
  type BehaviourFileItem,
  type BehaviourState
} from './behaviour-view-model'
import './BehaviourView.css'

interface BehaviourContextItem {
  path: string
  label: string
  depth: number
}

const ENGINE_LABEL: Record<BehaviourEngine, string> = {
  codex: 'Codex',
  claude: 'Claude',
  hermes: 'Hermes'
}

const STATE_LABEL: Record<BehaviourState, string> = {
  active: 'Actif',
  injected: 'Injecté',
  conditional: 'Conditionnel',
  declared: 'Déclaré · non tracé',
  shadowed: 'Masqué'
}

const SCOPE_LABEL = {
  global: 'Global',
  workspace: 'Workspace',
  project: 'Projet',
  skill: 'Skill'
} as const

export function BehaviourView(): React.JSX.Element {
  const [files, setFiles] = useState<BehaviourFileItem[]>([])
  const [contexts, setContexts] = useState<BehaviourContextItem[]>([])
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [contextRoot, setContextRoot] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [content, setContent] = useState('')
  const [query, setQuery] = useState('')
  const [engine, setEngine] = useState<'all' | BehaviourEngine>('all')
  const [state, setState] = useState<'all' | BehaviourState>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadWorkspace = useCallback(async (root: string, preferredContext?: string) => {
    setLoading(true)
    setError('')
    try {
      const nextContexts = await window.api.behaviourContexts(root)
      const nextContext =
        preferredContext && nextContexts.some((item) => item.path === preferredContext)
          ? preferredContext
          : root
      const nextFiles = await window.api.behaviourFiles(root, nextContext)
      setWorkspaceRoot(root)
      setContextRoot(nextContext)
      setContexts(nextContexts)
      setFiles(nextFiles)
      setSelectedId(preferredBehaviourFileId(nextFiles))
      setContent('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    window.api
      .behaviourWorkspace()
      .then((root) => loadWorkspace(root))
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason))
        setLoading(false)
      })
  }, [loadWorkspace])

  useEffect(() => {
    if (!selectedId || !workspaceRoot || !contextRoot) return
    window.api
      .readBehaviourFile(selectedId, workspaceRoot, contextRoot)
      .then(setContent)
      .catch((reason) =>
        setContent(`Erreur : ${reason instanceof Error ? reason.message : String(reason)}`)
      )
  }, [contextRoot, selectedId, workspaceRoot])

  const selectContext = async (nextContext: string): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const nextFiles = await window.api.behaviourFiles(workspaceRoot, nextContext)
      setContextRoot(nextContext)
      setFiles(nextFiles)
      setSelectedId(preferredBehaviourFileId(nextFiles))
      setContent('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  const chooseWorkspace = async (): Promise<void> => {
    const next = await window.api.chooseBehaviourWorkspace()
    if (next) await loadWorkspace(next)
  }

  const filtered = useMemo(
    () => filterBehaviourFiles(files, query, engine, state),
    [engine, files, query, state]
  )
  const groups = useMemo(() => groupBehaviourFiles(filtered), [filtered])
  const selected = files.find((file) => file.id === selectedId)
  const activeCount = files.filter((file) => file.active).length
  const locationLabel = (file: BehaviourFileItem): string => {
    if (file.scope === 'global' || file.scope === 'skill') return SCOPE_LABEL[file.scope]
    const normalizedRoot = workspaceRoot.replaceAll('\\', '/').replace(/\/$/, '')
    const normalizedPath = file.path.replaceAll('\\', '/')
    const relativePath = normalizedPath.startsWith(`${normalizedRoot}/`)
      ? normalizedPath.slice(normalizedRoot.length + 1)
      : normalizedPath
    return relativePath.split('/').slice(0, -1).join(' / ') || 'Workspace'
  }

  return (
    <section className="behaviour-view">
      <header>
        <div>
          <span>Instructions effectives</span>
          <h1>Behaviour Map</h1>
          <p>La chaîne qui gouverne chaque moteur, du global au projet courant.</p>
        </div>
        <div className="behaviour-count">
          <strong>{activeCount}</strong>
          <span>applicables · {files.length} inventoriés</span>
        </div>
      </header>

      <div className="behaviour-context-bar">
        <div>
          <span>Workspace</span>
          <strong title={workspaceRoot}>{workspaceRoot || 'Détection…'}</strong>
        </div>
        <button type="button" onClick={chooseWorkspace}>
          Changer…
        </button>
        <label>
          <span>Contexte actif</span>
          <select
            aria-label="Contexte projet actif"
            value={contextRoot}
            onChange={(event) => void selectContext(event.target.value)}
            disabled={loading}
          >
            {contexts.map((item) => (
              <option key={item.path} value={item.path}>
                {'  '.repeat(item.depth)}
                {item.depth > 0 ? '↳ ' : ''}
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <span className="behaviour-readonly">Lecture seule · chemins revalidés</span>
      </div>

      <div className="behaviour-toolbar">
        <input
          className="input"
          value={query}
          placeholder="Filtrer nom, chemin ou raison…"
          onChange={(event) => setQuery(event.target.value)}
        />
        {(['all', 'codex', 'claude', 'hermes'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={engine === value ? 'active' : ''}
            onClick={() => setEngine(value)}
          >
            {value === 'all' ? 'Tous' : ENGINE_LABEL[value]}
          </button>
        ))}
        <select
          aria-label="État d’activation"
          value={state}
          onChange={(event) => setState(event.target.value as 'all' | BehaviourState)}
        >
          <option value="all">Tous les états</option>
          {Object.entries(STATE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="behaviour-error">{error}</div>}
      <div className="behaviour-workspace">
        <aside className="behaviour-files" aria-label="Fichiers de comportement">
          {groups.map((group) =>
            group.files.length > 0 ? (
              <section
                key={group.engine}
                className={`behaviour-engine-group behaviour-engine-group--${group.engine}`}
              >
                <header>
                  <strong>{ENGINE_LABEL[group.engine]}</strong>
                  <small>{group.files.length}</small>
                </header>
                {group.files.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    data-engine={file.engine}
                    data-state={file.state}
                    data-path={file.path}
                    className={selectedId === file.id ? 'active' : ''}
                    onClick={() => setSelectedId(file.id)}
                  >
                    <i className={`is-${file.state}`} />
                    <span>
                      <strong>{file.label}</strong>
                      <small>
                        {locationLabel(file)} · {STATE_LABEL[file.state]}
                      </small>
                    </span>
                  </button>
                ))}
              </section>
            ) : null
          )}
          {!loading && filtered.length === 0 && (
            <p className="behaviour-list-empty">Aucun fichier pour ce filtre.</p>
          )}
        </aside>

        <article className="behaviour-reader">
          {selected ? (
            <>
              <header>
                <div>
                  <span>
                    {ENGINE_LABEL[selected.engine]} · {SCOPE_LABEL[selected.scope]}
                  </span>
                  <h2>{selected.label}</h2>
                  <p title={selected.path}>{selected.path}</p>
                </div>
                <b className={`is-${selected.state}`}>{STATE_LABEL[selected.state]}</b>
              </header>
              <dl>
                <div>
                  <dt>Pourquoi</dt>
                  <dd>{selected.reason}</dd>
                </div>
                <div>
                  <dt>Quand</dt>
                  <dd>{selected.injectedAt}</dd>
                </div>
                <div>
                  <dt>Où</dt>
                  <dd>{selected.injectedInto}</dd>
                </div>
              </dl>
              <pre>{content}</pre>
            </>
          ) : (
            <p className="behaviour-empty">
              {loading ? 'Construction de la chaîne…' : 'Sélectionne un fichier Markdown.'}
            </p>
          )}
        </article>
      </div>
    </section>
  )
}
