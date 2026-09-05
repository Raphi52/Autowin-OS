import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitGraphSnapshot } from '../../../shared/git-graph'
import { BureauxConserves } from './BureauxConserves'
import type { WorktreeAgentActivity } from '../../../shared/worktree-activity-model'
import { ViewTopBar } from './ViewTopBar'
import { layoutGitGraph, projectGitGraphAxes, type GitGraphLayout } from './GitGraphLayout'
import {
  formatAttente,
  LIBELLES_VERDICT,
  regrouperParChantier,
  resumerFlux,
  type Chantier
} from './worktree-chef-de-projet'
import './ViewPage.css'
import './WorktreeView.css'
import { Spinner } from './Spinner'

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

/** Combien de chantiers d'un coup d'œil, avant même de lire une ligne. Douze lignes au plus. */
const CHANTIERS_AFFICHES = 12

/**
 * Le bandeau de flux et le feu tricolore par chantier : ce qu'un chef de projet lit en trois secondes.
 *
 * Le bandeau répond « est-ce que ça avance », les lignes répondent « qu'est-ce qui m'attend ». Les deux
 * comptent des CHANTIERS et non des runs : dix runs sur une branche en conflit sont UNE décision à
 * prendre, et les compter dix fois est exactement la manière de rendre un tableau de bord inutile.
 *
 * Aucun appel Git supplémentaire ici : tout vient de l'activité déjà chargée. C'est délibéré — mesuré
 * dans ce dépôt, un `git` par copie coûte ~292 ms et gèlerait la vue pour 36 copies.
 */
function ResumeChefDeProjet({
  agents,
  disponible,
  recuEvenement
}: {
  agents: WorktreeAgentActivity[]
  disponible: boolean
  /**
   * Vrai dès qu'un événement d'activité est arrivé — y compris un événement VIDE.
   *
   * MESURÉ : avec la récupération hors du fil principal, l'inventaire des copies met ~16 s à répondre,
   * et pendant ce temps la lecture initiale rend un tableau vide. Le bandeau affichait donc « 0 chantier
   * t'attend » alors que 215 runs allaient apparaître — le même zéro qui se lit « projet au calme ».
   *
   * Ce drapeau, et pas un délai : le coordinateur publie son état à la FIN de la réconciliation, même
   * quand elle ne trouve rien. « Aucun événement reçu » et « zéro chantier » sont donc distinguables
   * sans deviner combien de temps attendre — et deviner un délai est exactement l'erreur déjà commise
   * au démarrage, où un report de 1 500 ms n'avait fait que déplacer le blocage.
   */
  recuEvenement: boolean
}): React.JSX.Element {
  // La fraîcheur est intentionnellement évaluée au rendu : elle dépend de l'heure murale.
  // eslint-disable-next-line react-hooks/purity
  const maintenant = Date.now()
  const flux = useMemo(() => resumerFlux(agents, maintenant), [agents, maintenant])
  const chantiers = useMemo(() => regrouperParChantier(agents, maintenant), [agents, maintenant])
  const attente = formatAttente(flux.plusVieilleAttenteMs)
  const caches = Math.max(chantiers.length - CHANTIERS_AFFICHES, 0)

  if (!disponible) {
    return (
      <section className="wt-cdp" data-testid="worktree-chef-de-projet">
        <p className="wt-cdp-indisponible" role="status">
          {/* Ne RIEN afficher serait lu comme « zéro chantier », donc comme un projet au calme. */}
          Avancement indisponible : l’activité des copies n’a pas pu être lue.
        </p>
      </section>
    )
  }

  // APRES l'indisponibilité, et l'ordre est le correctif : place avant, un échec de lecture s'affichait
  // « lecture en cours » — une attente éternelle, donc un mensonge pire que le zéro qu'on corrigeait.
  if (agents.length === 0 && !recuEvenement) {
    return (
      <section className="wt-cdp" data-testid="worktree-chef-de-projet">
        <p className="wt-cdp-indisponible" role="status" data-testid="worktree-cdp-attente">
          Lecture des copies en cours — l’avancement s’affichera dès qu’elle répond.
        </p>
      </section>
    )
  }

  return (
    <section className="wt-cdp" data-testid="worktree-chef-de-projet">
      <div className="wt-cdp-flux" data-testid="worktree-flux">
        <div className="wt-cdp-nombre is-attention">
          <b>{flux.aToi}</b>
          <span>{flux.aToi === 1 ? 'chantier t’attend' : 'chantiers t’attendent'}</span>
        </div>
        <div className="wt-cdp-nombre is-pret">
          <b>{flux.pret}</b>
          <span>prêts à fusionner</span>
        </div>
        <div className="wt-cdp-nombre is-vivant">
          <b>{flux.enCours}</b>
          <span>en cours</span>
        </div>
        <div className="wt-cdp-nombre is-inconnu">
          <b>{flux.aVerifier}</b>
          <span>à vérifier</span>
        </div>
        <div className="wt-cdp-nombre">
          {/*
            Le seul nombre de ce bandeau compté sur les RUNS, et son libellé le dit. Les autres comptent
            des chantiers réduits à leur verdict le plus urgent : « interrompus » y restait à 0 pendant
            que 119 runs l'étaient — un zéro qui se lit « aucun ».
          */}
          <b>{flux.runsInterrompus}</b>
          <span>runs interrompus</span>
        </div>
        <div className="wt-cdp-nombre">
          {/* Sans attente en cours on écrit « aucune », jamais un tiret muet ni un zéro trompeur. */}
          <b>{attente ?? 'aucune'}</b>
          <span>plus vieille attente</span>
        </div>
      </div>

      {chantiers.length === 0 ? (
        <p className="wt-cdp-vide">Aucun chantier en cours sur ce dépôt.</p>
      ) : (
        <ul className="wt-cdp-liste" data-testid="worktree-chantiers">
          {chantiers.slice(0, CHANTIERS_AFFICHES).map((chantier: Chantier) => (
            <li
              key={chantier.branche}
              className={`wt-cdp-ligne is-${chantier.verdict}${chantier.branche === 'main' ? ' is-main' : ''}`}
            >
              <span className="wt-cdp-pastille">{LIBELLES_VERDICT[chantier.verdict]}</span>
              <strong className="wt-cdp-branche">{chantier.branche}</strong>
              <span className="wt-cdp-sujet">{chantier.sujet ?? ''}</span>
              <span className="wt-cdp-compte">
                {/*
                  On écrit « 2 / 8 à trancher » et non « 8 runs » : mesuré sur ce dépôt, les quatre
                  chantiers ressortent « à toi », donc le verdict seul ne dit plus l'ampleur. Et
                  « 0 fichier » sur un chantier qui attend est l'information la plus utile de la ligne :
                  il ne retient aucun travail, il attend d'être relancé ou oublié.
                */}
                {chantier.aToi > 0 ? `${chantier.aToi} / ${chantier.runs} à trancher` : null}
                {chantier.aToi > 0 ? ' · ' : null}
                {chantier.fichiers} {chantier.fichiers === 1 ? 'fichier' : 'fichiers'}
              </span>
              <span className="wt-cdp-attente">
                {formatAttente(chantier.attenteDepuisMs) ?? ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {caches > 0 && (
        <p className="wt-cdp-reste">
          {/* Une troncature muette se lirait comme « tout est là ». On dit ce qui n'est pas montré. */}
          {caches} chantier{caches > 1 ? 's' : ''} de plus, non affiché
          {caches > 1 ? 's' : ''} — les moins urgents.
        </p>
      )}
    </section>
  )
}

function GitTopology({ layout }: { layout: GitGraphLayout }): React.JSX.Element {
  return (
    <div className="cockpit-detail__graph" data-testid="git-topology">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
      >
        {layout.edges.map((edge) => {
          const side =
            edge.from.side === 'main' && edge.to.side === 'main'
              ? 'main'
              : edge.from.side === 'open' || edge.to.side === 'open'
                ? 'open'
                : 'closed'
          const cle = `${edge.from.commit.hash}-${edge.to.commit.hash}${edge.elidee ? '-elide' : ''}`
          return (
            <g key={cle}>
              <path
                className={`wt-topologie-lien is-${side}${edge.elidee ? ' is-elide' : ''}`}
                d={`M ${edge.from.x} ${edge.from.y} L ${edge.to.x} ${edge.to.y}`}
                fill="none"
              />
              {/*
                Le nombre est le message. Un pointillé seul dit « ce n'est pas une parenté directe »
                sans dire ce qui manque ; « ⋯ 181 commits » transforme un trou suspect en une omission
                assumée. Mesuré le 2026-08-14 : 23 sauts sur ce dépôt, le plus large en omettant 181.
              */}
              {edge.elidee ? (
                <text
                  className="wt-topologie-elide-libelle"
                  data-testid="git-topology-elision"
                  x={edge.from.x + 10}
                  y={(edge.from.y + edge.to.y) / 2 + 4}
                >
                  {`⋯ ${edge.omis} commit${(edge.omis ?? 0) > 1 ? 's' : ''} non chargés`}
                </text>
              ) : null}
            </g>
          )
        })}
        {layout.nodes.map((node) => (
          <g key={node.commit.hash} className={`wt-topologie-noeud is-${node.side ?? 'main'}`}>
            <circle
              data-commit={node.commit.hash}
              data-side={node.side ?? 'main'}
              cx={node.x}
              cy={node.y}
              r="5"
            />
            <text
              x={node.x + (node.side === 'closed' ? -14 : 14)}
              y={node.y + 4}
              textAnchor={node.side === 'closed' ? 'end' : 'start'}
            >
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
  // Le conteneur sert aussi à centrer horizontalement l'axe principal après chaque chargement.
  const grapheRef = useRef<HTMLDivElement>(null)
  // Voir `recuEvenement` : distingue « pas encore de donnée » de « zéro chantier ».
  const [recuEvenement, setRecuEvenement] = useState(false)

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

  /**
   * L'activité arrive APRÈS le premier rendu, et il faut s'y abonner pour ne pas mentir.
   *
   * MESURÉ : au lancement, la vue lisait l'activité à ~9 s alors que la récupération des copies ne la
   * remplit qu'ensuite (~23 s de travail de fond). Le résumé affichait donc « 0 chantier t'attend » et
   * « 0 en cours » pendant que 215 runs sur 4 branches existaient, et il ne se corrigeait jamais sans
   * un clic sur « Actualiser ». Un tableau de bord à zéro se lit comme un projet au calme.
   */
  useEffect(() => {
    if (!active) return undefined
    return window.api?.onWorktreeActivity?.((suivant) => {
      setAgents(suivant)
      setActivityAvailable(true)
      setRecuEvenement(true)
    })
  }, [active])

  const health = projectState(snapshot, agents, activityAvailable)
  // Le MEME comptage que le bandeau chef de projet (resumerFlux), pour que le geste « Reprendre
  // tout » et le nombre affiche ne puissent pas se contredire.
  const runsInterrompus = resumerFlux(agents, Date.now()).runsInterrompus
  const dispositionGraphe = useMemo(() => {
    const commits = snapshot?.commits ?? []
    const axes = projectGitGraphAxes(commits, snapshot?.refs ?? [], {
      mainLineHashes: snapshot?.mainLineHashes,
      mergedIntoMainHashes: snapshot?.mergedIntoMainHashes,
      openBranchHashes: snapshot?.openBranchHashes
    })
    return layoutGitGraph(commits, axes, snapshot?.mainLineElisions)
  }, [snapshot])

  useEffect(() => {
    const noeud = grapheRef.current
    if (!noeud || noeud.scrollHeight === 0) return
    const axeMain = dispositionGraphe.nodes.find((node) => node.side === 'main')
    if (axeMain && noeud.clientWidth > 0) {
      noeud.scrollLeft = Math.max(0, axeMain.x - noeud.clientWidth / 2)
    }
  }, [dispositionGraphe])
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
    <section className="view-page worktree-tab cockpit" data-active={active}>
      {/* MÊME barre du haut que Task Manager, Agent Studio et Settings (arrangement retenu par
          l'utilisateur), au lieu d'un `cockpit-header` maison : surtitre et titre collés au chemin,
          boutons dans un bloc à part — d'où la régression visuelle signalée. Cette vue n'a pas de
          sections : `ViewTopBar` rend alors l'identité et les actions, sans barre d'onglets vide. */}
      <ViewTopBar
        eyebrow="COCKPIT PROJET"
        title={snapshot?.repositoryName ?? 'Worktrees'}
        description="Suis l’état, l’activité et les branches de ton dépôt."
        detail={snapshot?.repoPath || repoPath || 'Dépôt courant'}
        actions={
          <>
            <button type="button" onClick={() => void pickRepo()}>
              Choisir
            </button>
            <button type="button" onClick={() => void load()} disabled={loading}>
              {loading ? 'Actualisation…' : 'Actualiser'}
            </button>
          </>
        }
      />

      {loading && !snapshot ? (
        <div className="cockpit-state" role="status">
          <Spinner /> Chargement du cockpit projet…
        </div>
      ) : (
        <div className="cockpit-scroll">
          {/* Les bureaux CONSERVES apres echec, avec leur prise. Places haut et non en bas de page :
              c'est ici que l'utilisateur vient les chercher, et deux messages de refus le renvoient
              explicitement a cette vue. Un renvoi vers une section invisible vaut un renvoi vers
              rien. */}
          <BureauxConserves runsInterrompus={runsInterrompus} />
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

          <ResumeChefDeProjet
            agents={agents}
            disponible={activityAvailable}
            recuEvenement={recuEvenement || agents.length > 0}
          />

          {/*
            La topologie du DÉPÔT, plein cadre et sans clic préalable. Elle était auparavant cachée
            derrière un bouton « Ouvrir la topologie Git », sous trois sections de runs — or les runs
            sont propres à une conversation et vivent dans Observatory et Chat. Cet onglet répond à une
            seule question : où en est le dépôt.
          */}
          <section className="wt-topologie" data-testid="worktree-topology-main">
            <div className="wt-topologie-legende" aria-label="Legende de la topologie Git">
              <span className="is-closed">Fusionné / fermé</span>
              <span className="is-main">main</span>
              <span className="is-open">Ouvert</span>
            </div>
            {snapshot?.available === false ? (
              <p className="wt-topologie-vide">Topologie indisponible.</p>
            ) : (
              <div className="wt-topologie-defilement" ref={grapheRef}>
                <GitTopology layout={dispositionGraphe} />
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
