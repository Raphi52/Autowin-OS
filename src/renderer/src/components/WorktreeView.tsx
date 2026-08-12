import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitGraphCommit, GitGraphSnapshot } from '../../../shared/git-graph'
import type { WorktreeAgentActivity } from '../../../shared/worktree-activity-model'
import { ModuleHeader } from './ModuleHeader'
import { layoutGitGraph } from './GitGraphLayout'
import './WorktreeView.css'

type DataState = 'healthy' | 'unknown' | 'unavailable' | 'stale'

const staleAfterMs = 30 * 60 * 1000

function projectState(
  snapshot: GitGraphSnapshot | undefined,
  agents: WorktreeAgentActivity[],
  activityAvailable: boolean
): { state: DataState; label: string; alertCount: number } {
  if (snapshot?.available === false)
    return { state: 'unavailable', label: 'Indisponible', alertCount: 1 }
  if (!snapshot || !activityAvailable) return { state: 'unknown', label: 'Inconnu', alertCount: 0 }
  if (agents.some((agent) => !agent.verdict || agent.verdict === 'unknown'))
    return { state: 'unknown', label: 'Inconnu', alertCount: 0 }
  const now = Date.now()
  const stale = agents.some((agent) => now - (agent.endedAtMs ?? agent.startedAtMs) > staleAfterMs)
  const alerts = agents.filter(
    (agent) => agent.state === 'conflict' || agent.state === 'blocked'
  ).length
  if (stale) return { state: 'stale', label: 'Obsolète', alertCount: alerts }
  return { state: 'healthy', label: alerts ? 'Attention' : 'Sain', alertCount: alerts }
}

/**
 * La frise de survol du dépôt : tout l'historique en une bande, et la portion actuellement lue.
 *
 * Elle reprend la lecture de l'ancien plan de métro — rose = ce qui vit hors du tronc, cyan = la ligne
 * principale — mais appliquée à la MÊME géométrie que la topologie en dessous : les deux consomment
 * `layoutGitGraph`, donc une couleur vue ici désigne exactement le commit vu là. Deux tracés calculés
 * séparément auraient dérivé au premier changement de disposition.
 *
 * Le cadre clair est la portion visible du graphe, pas une décoration : c'est ce qui rend une frise
 * utile quand l'historique dépasse largement la hauteur de l'écran. Un clic y déplace la lecture.
 *
 * Périmètre : le DÉPÔT entier. Rien ici n'est propre à une conversation — les runs, les tours et leurs
 * fichiers vivent dans Observatory et Chat, et les mêler ici était justement le défaut corrigé.
 */
function FriseRepo({
  noeuds,
  fraction,
  portion,
  surClic
}: {
  noeuds: ReturnType<typeof layoutGitGraph>['nodes']
  fraction: number
  portion: number
  surClic: (fraction: number) => void
}): React.JSX.Element | null {
  if (noeuds.length === 0) return null
  const LARGEUR = 1000
  const HAUTEUR = 46
  const troncX = Math.min(...noeuds.map((n) => n.x))
  const pas = noeuds.length > 1 ? LARGEUR / (noeuds.length - 1) : 0
  return (
    <div className="wt-frise" data-testid="worktree-frise">
      <div className="wt-frise-legende">
        <span className="is-tronc">ligne principale</span>
        <span className="is-vivant">hors du tronc</span>
        <span className="is-portion">portion lue</span>
      </div>
      <svg
        viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Historique du dépôt : ${noeuds.length} commits`}
        onClick={(evenement) => {
          const cadre = evenement.currentTarget.getBoundingClientRect()
          if (cadre.width === 0) return
          surClic((evenement.clientX - cadre.left) / cadre.width)
        }}
      >
        <rect
          className="wt-frise-portion"
          x={fraction * LARGEUR}
          y={0}
          width={Math.max(portion * LARGEUR, 6)}
          height={HAUTEUR}
        />
        {noeuds.map((noeud, index) => {
          const horsTronc = noeud.x > troncX
          // Un commit hors du tronc monte plus haut : la hauteur PORTE l'information, la couleur seule
          // serait perdue pour qui distingue mal le rose du cyan.
          const hauteur = horsTronc ? HAUTEUR - 10 : HAUTEUR / 2
          return (
            <line
              key={noeud.commit.hash}
              className={horsTronc ? 'wt-frise-tick is-vivant' : 'wt-frise-tick'}
              x1={index * pas}
              x2={index * pas}
              y1={HAUTEUR}
              y2={HAUTEUR - hauteur}
            />
          )
        })}
      </svg>
    </div>
  )
}

function GitTopology({ commits }: { commits: GitGraphCommit[] }): React.JSX.Element {
  const layout = useMemo(() => layoutGitGraph(commits), [commits])
  return (
    <div className="cockpit-detail__graph" data-testid="git-topology">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
      >
        {layout.edges.map((edge) => (
          <path
            key={`${edge.from.commit.hash}-${edge.to.commit.hash}`}
            d={`M ${edge.from.x} ${edge.from.y} L ${edge.to.x} ${edge.to.y}`}
            fill="none"
            stroke="var(--cyan)"
          />
        ))}
        {layout.nodes.map((node) => (
          <g key={node.commit.hash}>
            <circle
              cx={node.x}
              cy={node.y}
              r="5"
              fill="var(--surface-inset)"
              stroke="var(--gold)"
            />
            <text x={node.x + 14} y={node.y + 4}>
              {node.commit.shortHash} · {node.commit.subject}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

export function WorktreeView({ active }: { active: boolean }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<GitGraphSnapshot>()
  const [agents, setAgents] = useState<WorktreeAgentActivity[]>([])
  const [loading, setLoading] = useState(false)
  const [activityAvailable, setActivityAvailable] = useState(true)
  const [repoPath, setRepoPath] = useState(() => localStorage.getItem('autowin:sc-repo') ?? '')
  const requestId = useRef(0)
  // Le défilement du graphe pilote le cadre de la frise. Mesuré depuis le DOM et non déduit d'un index
  // de commit : la hauteur d'un nœud n'est pas la hauteur d'une ligne rendue.
  const grapheRef = useRef<HTMLDivElement>(null)
  const [survol, setSurvol] = useState({ fraction: 0, portion: 1 })

  const load = useCallback(async (): Promise<void> => {
    const id = ++requestId.current
    setLoading(true)
    const gitPromise = window.api?.getGitGraph?.(repoPath || undefined)
    if (!gitPromise) {
      setSnapshot({ available: false, repoPath, error: 'Bridge Git indisponible' })
      setLoading(false)
      return
    }
    // `getWorktreeStatus` n'est plus appelé : il n'alimentait que le panneau de détail retiré. Garder
    // l'appel pour ranger sa réponse dans un état que personne ne lit serait un coût sans lecteur.
    const [gitResult, activityResult] = await Promise.allSettled([
      gitPromise,
      window.api.getWorktreeActivity?.() ?? Promise.reject(new Error('Activité indisponible'))
    ])
    if (id !== requestId.current) return
    setSnapshot(
      gitResult.status === 'fulfilled'
        ? gitResult.value
        : { available: false, repoPath, error: String(gitResult.reason) }
    )
    setActivityAvailable(activityResult.status === 'fulfilled')
    setAgents(activityResult.status === 'fulfilled' ? activityResult.value : [])
    setLoading(false)
  }, [repoPath])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) void load()
    return () => {
      requestId.current += 1
    }
  }, [active, load])

  // Mesurer DÈS que la disposition change : sans cela `portion` reste à 1 jusqu'au premier défilement,
  // et le cadre de la frise couvre toute la largeur en prétendant que tout est visible.
  useEffect(() => {
    const noeud = grapheRef.current
    if (!noeud || noeud.scrollHeight === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSurvol({
      fraction: noeud.scrollTop / noeud.scrollHeight,
      portion: noeud.clientHeight / noeud.scrollHeight
    })
  }, [snapshot])

  const health = projectState(snapshot, agents, activityAvailable)
  // UNE disposition pour les deux tracés : la frise et le graphe doivent désigner le même commit.
  const dispositionGraphe = useMemo(() => layoutGitGraph(snapshot?.commits ?? []), [snapshot])
  const activeAgents = agents.filter(
    (agent) => agent.state === 'working' || agent.state === 'isolated'
  )

  const pickRepo = async (): Promise<void> => {
    const chosen = await window.api.pickGitRepo?.()
    if (!chosen) return
    localStorage.setItem('autowin:sc-repo', chosen)
    setRepoPath(chosen)
  }

  return (
    <section className="worktree-tab cockpit" data-active={active}>
      <header className="cockpit-header">
        <div>
          <ModuleHeader eyebrow="Cockpit projet" title={snapshot?.repositoryName ?? 'Worktrees'} />
          <span className="cockpit-path">{snapshot?.repoPath || repoPath || 'Dépôt courant'}</span>
        </div>
        <div className="cockpit-actions">
          <button type="button" onClick={() => void pickRepo()}>
            Choisir
          </button>
          <button type="button" onClick={() => void load()} disabled={loading}>
            {loading ? 'Actualisation…' : 'Actualiser'}
          </button>
        </div>
      </header>

      {loading && !snapshot ? (
        <div className="cockpit-state" role="status">
          Chargement du cockpit projet…
        </div>
      ) : (
        <div className="cockpit-scroll">
          <section className={`project-strip is-${health.state}`} aria-label="Santé du projet">
            <div>
              <span>Santé du projet</span>
              <strong>{health.label}</strong>
            </div>
            <div>
              <span>Branche</span>
              <strong>{snapshot?.branch ?? 'Inconnue'}</strong>
            </div>
            <div>
              <span>Changements locaux</span>
              <strong>
                {snapshot?.available === false ? 'Indisponibles' : (snapshot?.changeCount ?? 0)}
              </strong>
            </div>
            <div>
              <span>Travaux actifs</span>
              <strong>{activityAvailable ? activeAgents.length : 'Inconnus'}</strong>
            </div>
            <div>
              <span>Alertes</span>
              <strong>{health.alertCount}</strong>
            </div>
          </section>

          {snapshot?.available === false && (
            <div className="cockpit-notice is-error" role="alert">
              <strong>Git indisponible</strong>
              <span>{snapshot.error ?? 'Le dépôt ne peut pas être lu.'}</span>
            </div>
          )}
          {!activityAvailable && (
            <div className="cockpit-notice" role="status">
              <strong>Données partielles</strong>
              <span>L’activité des worktrees est indisponible.</span>
            </div>
          )}

          {/*
            La topologie du DÉPÔT, plein cadre et sans clic préalable. Elle était auparavant cachée
            derrière un bouton « Ouvrir la topologie Git », sous trois sections de runs — or les runs
            sont propres à une conversation et vivent dans Observatory et Chat. Cet onglet répond à une
            seule question : où en est le dépôt.
          */}
          <section className="wt-topologie" data-testid="worktree-topology-main">
            <FriseRepo
              noeuds={dispositionGraphe.nodes}
              fraction={survol.fraction}
              portion={survol.portion}
              surClic={(fraction) => {
                const noeud = grapheRef.current
                if (!noeud) return
                noeud.scrollTop = Math.max(
                  0,
                  fraction * noeud.scrollHeight - noeud.clientHeight / 2
                )
              }}
            />
            {snapshot?.available === false ? (
              <p className="wt-topologie-vide">Topologie indisponible.</p>
            ) : (
              <div
                className="wt-topologie-defilement"
                ref={grapheRef}
                onScroll={(evenement) => {
                  const el = evenement.currentTarget
                  if (el.scrollHeight === 0) return
                  setSurvol({
                    fraction: el.scrollTop / el.scrollHeight,
                    portion: el.clientHeight / el.scrollHeight
                  })
                }}
              >
                <GitTopology commits={snapshot?.commits ?? []} />
              </div>
            )}
          </section>
        </div>
      )}

      {/*
        Le panneau latéral de détail a été RETIRÉ avec les sections de runs, et non laissé en place :
        ses seules entrées étaient ces sections, donc il devenait inatteignable. Ses onglets « État du
        travail », « Fichiers » et « RUN » portaient l'activité d'une conversation — le domaine
        d'Observatory et de Chat — et son onglet « Topologie Git » doublait désormais le tracé principal.
        Un panneau mort derrière un état qui ne peut plus être vrai est pire qu'un panneau absent.
      */}
    </section>
  )
}
