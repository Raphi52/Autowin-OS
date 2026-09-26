import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitGraphSnapshot } from '../../../shared/git-graph'
import { BureauxConserves } from './BureauxConserves'
import { useOfficeAction } from './useOfficeAction'
import { ConflitBureauPanneau } from './ConflitBureau'
import { useConflitBureau } from './useConflitBureau'
import type {
  WorktreeAgentActivity,
  WorktreeConflictResolutionChoice
} from '../../../shared/worktree-activity-model'
import { ViewTopBar } from './ViewTopBar'
import {
  HAUTEUR_LIGNE,
  LARGEUR_VOIE,
  layoutGitGraph,
  projectGitGraphAxes,
  type GitGraphLayout
} from './GitGraphLayout'
import { couleurDeBranche } from './git-graph-couleurs'
import { parserRefsCommit } from './git-graph-refs'
import { planifierActionGit, type DemandeActionGit } from '../../../shared/git-action'
import {
  formatAttente,
  LIBELLES_VERDICT,
  regrouperParChantier,
  compterRunsInterrompus,
  resumerFlux,
  type Chantier
} from './worktree-chef-de-projet'
import './ViewPage.css'
import './WorktreeActivityView.css'
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

/**
 * La date d'un commit, lisible d'un coup d'oeil dans une colonne etroite.
 *
 * Le champ `date` existait dans le modele depuis toujours et n'etait affiche NULLE PART. Format court
 * a la SourceTree : jour, mois abrege, heure. Une date illisible est rendue telle quelle plutot que
 * remplacee par un tiret — un « Invalid Date » masque est une donnee perdue en silence.
 */
function formaterDateCommit(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * CE QU'ON PEUT SAISIR ET OU ON PEUT LE LACHER.
 *
 * Deux prises : une etiquette de branche, ou une ligne de commit. Une seule zone de depot : une
 * etiquette de branche LOCALE. Deposer sur une distante est refuse — `git checkout origin/x`
 * detacherait la tete, ce qui n'est pas ce qu'un glisse veut dire.
 */
export type SaisieGraphe = { genre: 'branche'; nom: string } | { genre: 'commit'; hash: string }

export interface OutilsGeste {
  saisir: (saisie: SaisieGraphe) => void
  deposerSur: (branche: string) => void
}

/** Les etiquettes `main`, `origin/main`, `tag: v1` posees sur la ligne du commit, comme SourceTree. */
function EtiquettesRef({
  refs,
  geste
}: {
  refs: string[]
  geste: OutilsGeste
}): React.JSX.Element | null {
  const etiquettes = parserRefsCommit(refs)
  if (etiquettes.length === 0) return null
  return (
    <>
      {etiquettes.map((etiquette) => {
        const locale = etiquette.genre === 'head' || etiquette.genre === 'local'
        return (
          <span
            key={`${etiquette.genre}-${etiquette.libelle}`}
            className={`wt-st-ref is-${etiquette.genre}${locale ? ' is-prise' : ''}`}
            data-testid="git-ref-badge"
            draggable={locale}
            onDragStart={(evenement) => {
              if (!locale) return
              // Sans cela le glisse remonterait a la LIGNE, et on rapporterait un commit en croyant
              // fusionner une branche : deux gestes differents partant du meme pixel.
              evenement.stopPropagation()
              // SANS CES DONNEES LE GLISSER N'EXISTE PAS : Chromium annule un `dragstart` qui
              // laisse le `dataTransfer` vide, donc aucun `dragover`/`drop` ne suit. Les tests ne
              // le voyaient pas — ils envoient un Event nu, sans `dataTransfer`. Mesure du
              // 2026-09-15 : le geste etait injouable a la souris alors que la suite etait verte.
              evenement.dataTransfer?.setData('text/plain', etiquette.libelle)
              if (evenement.dataTransfer) evenement.dataTransfer.effectAllowed = 'move'
              geste.saisir({ genre: 'branche', nom: etiquette.libelle })
            }}
            onDragOver={(evenement) => {
              if (locale) evenement.preventDefault()
            }}
            onDrop={(evenement) => {
              if (!locale) return
              evenement.preventDefault()
              evenement.stopPropagation()
              geste.deposerSur(etiquette.libelle)
            }}
            style={
              {
                // Variable CSS et non `color` : la pastille s'en sert POUR le texte ET sa bordure.
                '--wt-ref-couleur': couleurDeBranche(etiquette.libelle)
              } as React.CSSProperties
            }
          >
            {etiquette.libelle}
          </span>
        )
      })}
    </>
  )
}

/**
 * LE GRAPHE, en tableau facon SourceTree.
 *
 * Trois choses le distinguent du trace precedent, et toutes les trois viennent de la demande du
 * 2026-09-15 :
 *  1. le SVG n'est plus qu'une COLONNE etroite — le sujet, l'auteur et la date sont du HTML aligne a
 *     droite, donc selectionnable et lisible sans defilement horizontal ;
 *  2. la couleur ne dit plus la categorie (3 couleurs pour tout le depot) mais la BRANCHE, tiree de
 *     son nom : imprevisible a l'oeil, stable d'un rendu a l'autre ;
 *  3. les etiquettes de branche sont posees sur la ligne, la ou git les decore.
 *
 * L'alignement SVG / lignes de texte tient a une seule constante partagee, `HAUTEUR_LIGNE` : la
 * recopier ici aurait suffi a decaler tous les points d'un cran le jour ou l'une des deux change.
 */
/**
 * UN conflit = UNE ligne, et trois boutons.
 *
 * Demande de l'utilisateur (2026-09-15) : « je ne veux plus voir les onglets trancher etc, juste des
 * boutons pour résoudre les conflits ». La fiche complète (`AgentOffice`) affichait ici la commande,
 * le chemin de la copie, la base vérifiée, la durée, la liste des fichiers et le message de refus —
 * constaté sur capture : ~300 px de hauteur par conflit, pour une décision binaire. Tout cela reste
 * disponible dans le Hub des bureaux ; ce qui manquait ici, c'était la décision au premier coup d'œil.
 *
 * Le fichier en cause RESTE affiché : c'est la seule information sans laquelle « garder ma version »
 * ne veut rien dire. Le retirer aurait été simplifier au prix de la justesse.
 */
function LigneConflit({
  agent,
  onComparer,
  onChoisir
}: {
  agent: WorktreeAgentActivity
  onComparer?: (agentId: string) => void
  onChoisir?: (agentId: string, choix: WorktreeConflictResolutionChoice) => unknown
}): React.JSX.Element {
  const action = useOfficeAction()
  const fichier = agent.conflictFile ?? agent.files[0]?.path
  return (
    <div className="wt-conflit-ligne" data-testid="wt-conflit-ligne" data-agent={agent.agentId}>
      <div className="wt-conflit-quoi">
        <strong>{fichier ?? agent.agentName}</strong>
        {fichier ? <span>{agent.agentName}</span> : null}
      </div>
      <div className="wt-conflit-boutons">
        {onComparer ? (
          <button
            type="button"
            className="btn btn-sm"
            data-testid="wt-resolve-conflict"
            onClick={() => onComparer(agent.agentId)}
          >
            Comparer
          </button>
        ) : null}
        {onChoisir ? (
          <>
            <button
              type="button"
              className="btn btn-sm"
              data-testid="wt-keep-agent"
              disabled={action.pending !== null}
              onClick={() => action.run('keep-agent', () => onChoisir(agent.agentId, 'agent'))}
            >
              {action.pending === 'keep-agent' ? 'Application…' : 'Version de l’agent'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              data-testid="wt-keep-mine"
              disabled={action.pending !== null}
              onClick={() => action.run('keep-mine', () => onChoisir(agent.agentId, 'mine'))}
            >
              {action.pending === 'keep-mine' ? 'Application…' : 'Ma version'}
            </button>
          </>
        ) : null}
      </div>
      {action.error ? (
        <p className="wt-conflit-erreur" data-testid="wt-office-error" role="alert">
          {action.error}
        </p>
      ) : null}
    </div>
  )
}

function GitTopology({
  layout,
  geste
}: {
  layout: GitGraphLayout
  geste: OutilsGeste
}): React.JSX.Element {
  // Une elision est portee par la ligne du commit d'ARRIVEE : c'est au-dessus de lui que l'histoire
  // manque. Le trait pointille reste dans le SVG, le nombre devient lisible dans la description.
  const elisionParCommit = new Map<string, number>()
  layout.edges.forEach((edge) => {
    if (edge.elidee) elisionParCommit.set(edge.to.commit.hash, edge.omis ?? 0)
  })

  return (
    <div
      className="wt-st"
      data-testid="git-topology"
      style={{ '--wt-st-gouttiere': `${layout.width}px` } as React.CSSProperties}
    >
      <div className="wt-st-entete" data-testid="git-topology-entete">
        <span className="wt-st-entete-graphe">Graphique</span>
        <span>Description</span>
        <span>Auteur</span>
        <span>Date</span>
      </div>
      <div className="wt-st-corps" style={{ height: layout.height }}>
        <svg
          className="wt-st-graphe"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          aria-hidden="true"
        >
          {layout.edges.map((edge) => {
            const side =
              edge.from.side === 'main' && edge.to.side === 'main'
                ? 'main'
                : edge.from.side === 'open' || edge.to.side === 'open'
                  ? 'open'
                  : 'closed'
            const cle = `${edge.from.commit.hash}-${edge.to.commit.hash}${edge.elidee ? '-elide' : ''}`
            /*
              Un COUDE, pas une diagonale : SourceTree descend dans la voie du depart puis bascule
              d'un quart de tour vers la voie d'arrivee. Une diagonale franche sur 26 px de haut
              croise les voies voisines et rend deux branches paralleles indiscernables.
            */
            const sens = Math.sign(edge.to.x - edge.from.x)
            const coude =
              edge.from.x === edge.to.x
                ? `M ${edge.from.x} ${edge.from.y} L ${edge.to.x} ${edge.to.y}`
                : `M ${edge.from.x} ${edge.from.y} L ${edge.from.x} ${edge.to.y - HAUTEUR_LIGNE / 2} Q ${edge.from.x} ${edge.to.y} ${edge.from.x + sens * (LARGEUR_VOIE / 2)} ${edge.to.y} L ${edge.to.x} ${edge.to.y}`
            return (
              <path
                key={cle}
                className={`wt-topologie-lien is-${side}${edge.elidee ? ' is-elide' : ''}`}
                d={coude}
                stroke={edge.couleur}
                fill="none"
              />
            )
          })}
          {layout.nodes.map((node) => (
            <circle
              key={node.commit.hash}
              className={`wt-topologie-noeud is-${node.side ?? 'main'}`}
              data-commit={node.commit.hash}
              data-side={node.side ?? 'main'}
              cx={node.x}
              cy={node.y}
              /*
                PLEIN, toujours. Les points creux (anneau + fond de panneau) étaient le principal
                reproche visuel du 2026-09-16 : sur fond sombre, un anneau de 3,5 px se lit comme un
                trou dans la ligne, et vingt trous alignés effacent la voie. SourceTree ne dessine
                que des disques pleins ; seul le DIAMÈTRE distingue un commit porteur de branche.
              */
              r={node.branche ? 4.5 : 3}
              stroke="var(--surface-panel, #14161d)"
              fill={node.couleur}
            />
          ))}
        </svg>

        {layout.nodes.map((node) => {
          const omis = elisionParCommit.get(node.commit.hash)
          return (
            <div
              key={node.commit.hash}
              className={`wt-st-ligne is-${node.side ?? 'main'}`}
              data-testid="git-commit-row"
              data-commit={node.commit.hash}
              draggable
              onDragStart={(evenement) => {
                // Meme raison que sur les etiquettes : un `dataTransfer` vide = glisser annule.
                evenement.dataTransfer?.setData('text/plain', node.commit.hash)
                if (evenement.dataTransfer) evenement.dataTransfer.effectAllowed = 'copy'
                geste.saisir({ genre: 'commit', hash: node.commit.hash })
              }}
              style={{ height: HAUTEUR_LIGNE }}
              title={`${node.commit.shortHash} - ${node.commit.subject}`}
            >
              <span className="wt-st-desc">
                {omis !== undefined ? (
                  /*
                    Le nombre est le message. Un pointille seul dit « ce n'est pas une parente
                    directe » sans dire ce qui manque. Mesure le 2026-08-14 : 23 sauts sur ce depot,
                    le plus large en omettant 181 commits.
                  */
                  <span className="wt-st-elision" data-testid="git-topology-elision">
                    {`⋯ ${omis} commit${omis > 1 ? 's' : ''} non chargés`}
                  </span>
                ) : null}
                <EtiquettesRef refs={node.commit.refs} geste={geste} />
                <span className="wt-st-sujet">{node.commit.subject}</span>
              </span>
              <span className="wt-st-auteur" data-testid="git-commit-auteur">
                {node.commit.author}
              </span>
              <span className="wt-st-date" data-testid="git-commit-date">
                {formaterDateCommit(node.commit.date)}
              </span>
            </div>
          )
        })}
      </div>
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
  const grapheRef = useRef<HTMLDivElement>(null)
  // Voir `recuEvenement` : distingue « pas encore de donnée » de « zéro chantier ».
  const [recuEvenement, setRecuEvenement] = useState(false)
  // La résolution de conflit vit ICI depuis qu'elle a quitté le panneau de droite du chat.
  const conflit = useConflitBureau()

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

  /*
    LE GLISSER-DEPOSER DU GRAPHE (demande du 2026-09-15).

    Ce qui est saisi vit dans une REF et non dans un etat : un glisse en cours ne doit pas
    redessiner 356 lignes a chaque survol. Ce qui est PROPOSE, lui, est un etat — il s'affiche.

    Et le geste ne lance rien tout seul. Un relachement de souris au mauvais endroit est l'accident
    le plus banal qui soit ; une fusion partie sans un mot ne se reprend pas d'un Ctrl-Z. Le geste
    propose donc la commande EXACTE, construite par la meme fonction que le processus principal
    utilisera (`planifierActionGit`, dans src/shared) : ce qui est affiche est ce qui partira.
  */
  const saisieRef = useRef<SaisieGraphe | undefined>(undefined)
  const [propositionGeste, setPropositionGeste] = useState<
    { demande: DemandeActionGit; libelle: string } | undefined
  >()
  const [refusGeste, setRefusGeste] = useState<string | undefined>()
  const [resultatGeste, setResultatGeste] = useState<{ ok: boolean; texte: string } | undefined>()
  const [gesteEnCours, setGesteEnCours] = useState(false)

  const geste = useMemo<OutilsGeste>(
    () => ({
      saisir: (saisie) => {
        saisieRef.current = saisie
        setRefusGeste(undefined)
      },
      deposerSur: (branche) => {
        const saisie = saisieRef.current
        saisieRef.current = undefined
        if (!saisie) return
        if (saisie.genre === 'branche' && saisie.nom === branche) {
          setRefusGeste('Une branche ne se fusionne pas dans elle-meme.')
          return
        }
        const demande: DemandeActionGit =
          saisie.genre === 'branche'
            ? { type: 'merge', source: saisie.nom, cible: branche }
            : { type: 'cherry-pick', commit: saisie.hash, cible: branche }
        const plan = planifierActionGit(demande)
        // Un refus de la liste blanche s'AFFICHE : sans cela le geste semblerait n'avoir rien fait.
        if ('refus' in plan) {
          setRefusGeste(plan.refus)
          return
        }
        setResultatGeste(undefined)
        setPropositionGeste({ demande, libelle: plan.libelle })
      }
    }),
    []
  )

  const lancerGeste = useCallback(async (): Promise<void> => {
    const proposition = propositionGeste
    if (!proposition) return
    setGesteEnCours(true)
    const resultat = await window.api?.runGitAction?.(proposition.demande, repoPath || undefined)
    setGesteEnCours(false)
    setPropositionGeste(undefined)
    if (!resultat) {
      setResultatGeste({ ok: false, texte: 'Le pont Git est indisponible : rien n’a été lancé.' })
      return
    }
    setResultatGeste(
      resultat.ok
        ? { ok: true, texte: `${resultat.commande} — ${resultat.sortie || 'terminé'}` }
        : { ok: false, texte: resultat.raison }
    )
    // Le graphe a bougé : le relire est la seule façon de ne pas afficher l'état d'avant.
    if (resultat.ok) void load()
  }, [load, propositionGeste, repoPath])

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
  // Le MEME comptage que le bandeau chef de projet, garanti par la MEME fonction : `resumerFlux`
  // appelle `compterRunsInterrompus` lui aussi. Ce nombre ne depend pas de l'heure — le passage par
  // `resumerFlux(agents, Date.now())` lisait l'horloge en pleine phase de rendu (React l'interdit :
  // regle react-hooks/purity) ET regroupait tous les chantiers pour n'en garder qu'un compteur.
  const runsInterrompus = useMemo(() => compterRunsInterrompus(agents), [agents])
  const dispositionGraphe = useMemo(() => {
    const commits = snapshot?.commits ?? []
    const axes = projectGitGraphAxes(commits, snapshot?.refs ?? [], {
      mainLineHashes: snapshot?.mainLineHashes,
      mergedIntoMainHashes: snapshot?.mergedIntoMainHashes,
      openBranchHashes: snapshot?.openBranchHashes
    })
    return layoutGitGraph(commits, axes, snapshot?.mainLineElisions)
  }, [snapshot])

  /*
    Le centrage horizontal sur l'axe `main` a été RETIRÉ avec l'épinglage en trois colonnes : il
    servait à ramener au centre un tracé de 2 952 px de large. La gouttière tient maintenant en une
    cinquantaine de pixels, et forcer `scrollLeft` y déplacerait la vue pour rien.
  */
  const activeAgents = agents.filter(
    (agent) => agent.state === 'working' || agent.state === 'isolated'
  )
  const agentsEnConflit = agents.filter((agent) => agent.state === 'conflict')

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

          {/* Les conflits, et EUX SEULS : c'est la seule décision que cette vue ne montrait nulle
              part, et la section reste invisible quand il n'y a rien à trancher. Aucun appel Git
              supplémentaire — ces bureaux viennent de l'activité déjà chargée. */}
          {agentsEnConflit.length > 0 && (
            <section className="wt-conflits" data-testid="worktree-conflicts">
              <h3>Conflits à trancher · {agentsEnConflit.length}</h3>
              <div className="wt-conflits-liste" aria-label="Conflits à trancher">
                {agentsEnConflit.map((agent) => (
                  <LigneConflit
                    key={agent.agentId}
                    agent={agent}
                    onComparer={conflit.openConflictDiff}
                    onChoisir={conflit.resolveConflictChoice}
                  />
                ))}
              </div>
              <ConflitBureauPanneau conflit={conflit} />
            </section>
          )}
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
            {/*
              La légende ne peut plus nommer trois couleurs : il y en a désormais une par branche.
              Elle dit donc ce que les couleurs SIGNIFIENT, et ce que les deux styles de trait disent.
            */}
            <div className="wt-topologie-legende" aria-label="Legende de la topologie Git">
              <span className="is-couleur">Une couleur par branche</span>
              <span className="is-main">Trait épais - ligne principale</span>
              <span className="is-elide">Pointillé - histoire non chargée</span>
            </div>
            {/*
              CE QUE LE GESTE VA FAIRE, avant de le faire. La commande est ecrite en toutes lettres :
              « fusionner » ne dit pas si la branche courante change, `git checkout main && git merge
              --no-ff feat/x` le dit.
            */}
            {propositionGeste && (
              <div className="wt-geste" role="alertdialog" data-testid="git-geste-confirmation">
                <strong>
                  {propositionGeste.demande.type === 'merge'
                    ? `Fusionner ${propositionGeste.demande.source} dans ${propositionGeste.demande.cible}`
                    : `Rapporter ce commit sur ${propositionGeste.demande.cible}`}
                </strong>
                <code data-testid="git-geste-commande">{propositionGeste.libelle}</code>
                <button
                  type="button"
                  data-testid="git-geste-lancer"
                  disabled={gesteEnCours}
                  onClick={() => void lancerGeste()}
                >
                  {gesteEnCours ? 'En cours…' : 'Lancer'}
                </button>
                <button
                  type="button"
                  data-testid="git-geste-annuler"
                  onClick={() => setPropositionGeste(undefined)}
                >
                  Annuler
                </button>
              </div>
            )}
            {refusGeste && (
              <p className="wt-geste-refus" role="status" data-testid="git-geste-refus">
                {refusGeste}
              </p>
            )}
            {resultatGeste && (
              <p
                className={`wt-geste-resultat is-${resultatGeste.ok ? 'ok' : 'ko'}`}
                role="status"
                data-testid="git-geste-resultat"
              >
                {resultatGeste.texte}
              </p>
            )}
            {snapshot?.available === false ? (
              <p className="wt-topologie-vide">Topologie indisponible.</p>
            ) : (
              <div className="wt-topologie-defilement" ref={grapheRef}>
                <GitTopology layout={dispositionGraphe} geste={geste} />
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
