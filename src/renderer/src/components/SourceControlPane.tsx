import { useEffect, useRef, useState } from 'react'
import { formaterDate, formaterNombre, langueCourante } from '../langue'
import type { ValeursDeTexte } from '../textes'
import { traduireChatPanneaux, useTextesChatPanneaux } from '../textes-ecrans/chat-panneaux'
import { etapesGit } from './etapes-git'
import { ProjectPane } from './ProjectPane'
import { DiffView } from './DiffView'
import type { GitReadResult, GitChange, GitDiffResult } from '../../../shared/git-read'
import type { BrainTrace } from '../../../main/activity/brain-trace-spool'
import {
  composerRelecture,
  type CommentaireRelecture,
  type RepereLigne
} from '../../../shared/relecture-diff'
import { ecrireRelecture, lireRelecture, nouvelIdCommentaire } from './relecture-stockage'
import { LancementBarre } from './LancementBarre'
import './SourceControlPane.css'
import { Spinner } from './Spinner'

const markGlyph: Record<GitChange['status'], string> = {
  modified: '~',
  added: '+',
  deleted: '–',
  renamed: '»',
  untracked: '?',
  conflicted: '!',
  committed: '✓',
  retouched: '~'
}

/**
 * Les vues du panneau. `tree` = arborescence editable du depot : demande de l'utilisateur le
 * 2026-09-12, l'arborescence doit etre un SOUS-ONGLET a cote de Fichiers/Brain/Workspace, et non
 * un bloc empile au-dessus d'eux.
 */
type PaneView = 'project' | 'brain' | 'workspace' | 'tree'

const EMPTY_GIT: GitReadResult = {
  available: true,
  state: { branch: '', ahead: 0, behind: 0, changes: [] }
}

type AutoCloseViewResult =
  | {
      status: 'pushed'
      branch: string
      files: number
      mode?: 'direct' | 'pr'
      pr?: string
      prError?: string
    }
  | { status: 'committed'; files: number }
  | { status: 'skipped'; reason: string; detail?: string }
  | { status: 'failed'; error: string }

interface AutoCloseViewState {
  enabled: boolean
  last?: {
    runId: string
    branch: string
    project: AutoCloseViewResult
    /** Absent pour un tour de chat : il ne publie jamais le Brain. */
    brain?: AutoCloseViewResult
    at: string
    source?: 'chat'
    exclus?: Exclusion[]
    /** Tour de chat : les tests rejoués avant de pousser (absent = aucune vérification). */
    verification?: Verification
    /** Tour de chat : le typage de ce qui part (absent = aucun typage, ou aucun fichier TypeScript). */
    typage?: Typage
  }
}

interface Exclusion {
  path: string
  motif:
    | 'modifie-avant-le-tour'
    | 'touche-par-un-autre-fil'
    | 'autre-fil-en-cours'
    | 'tests-rouges'
    | 'import-hors-commit'
    | 'typage-rouge'
  /** Lignes que le fil ne réclame pas : les réécrire avec l'outil d'édition publie le fichier. */
  lignesNonReclamees?: number
  /** Motif `touche-par-un-autre-fil` : les fils qui tiennent le fichier (conv-1083). */
  fils?: string[]
  /** Motif `tests-rouges` : les fichiers de test en échec. */
  testsEnEchec?: string[]
  /** Motif `typage-rouge` : les premières erreurs nouvelles, `fichier: TSxxxx: message`. */
  erreursDeTypage?: string[]
}

/** Miroir de `TypageAvantPublication` (src/main/typage-avant-publication.ts), `sans-objet` exclu. */
type Typage =
  | { statut: 'vert'; projets: string[]; dejaRouges?: number }
  | { statut: 'echec'; projets: string[]; commande: string; erreurs: string[] }
  | { statut: 'non-verifie'; raison: string }

/**
 * Le texte d'une clé dans la langue COURANTE, pour les libellés calculés hors du composant : ils
 * sont appelés pendant son rendu, qui lit la langue par `useTextesChatPanneaux` (conv-1170).
 */
type CleDuPanneau = Parameters<typeof traduireChatPanneaux>[0]
const tx = (cle: CleDuPanneau, valeurs?: ValeursDeTexte): string =>
  traduireChatPanneaux(cle, langueCourante(), valeurs)

/** Vécu le 2026-10-15 (`9d6bb850`) : un fichier publié sans son appelant a cassé la compilation de main. */
function libelleTypage(typage: Typage): string {
  if (typage.statut === 'vert') {
    const projets = typage.projets.join(', ')
    return typage.dejaRouges
      ? tx('sc.typage.vertDejaRouges', { projets, n: typage.dejaRouges })
      : tx('sc.typage.vert', { projets })
  }
  if (typage.statut === 'echec') {
    const n = typage.erreurs.length
    return tx(n > 1 ? 'sc.typage.echec.plusieurs' : 'sc.typage.echec.un', {
      n,
      commande: typage.commande
    })
  }
  return tx('sc.typage.nonVerifie', { raison: typage.raison })
}

type Verification =
  | {
      statut: 'vert'
      commande: string
      testsJoues: number
      /** Suites rouges dans la portée complète, vertes rejouées seules : publiées, et NOMMÉES. */
      instablesSousCharge?: string[]
      /** Suites déjà rouges au dernier commit, sans échec nouveau dû au tour : publiées, et NOMMÉES. */
      dejaRouges?: string[]
      /** Suites rouges seulement à cause d'un travail qui ne part pas (autres fils) : NOMMÉES. */
      rougesDAilleurs?: string[]
    }
  | { statut: 'echec'; commande: string; detail: string; testsEnEchec: string[] }
  | { statut: 'non-verifie'; raison: string }

const MOTIFS_EXCLUSION: Record<string, CleDuPanneau> = {
  'modifie-avant-le-tour': 'sc.exclusion.modifieAvantLeTour',
  'touche-par-un-autre-fil': 'sc.exclusion.toucheParUnAutreFil',
  'autre-fil-en-cours': 'sc.exclusion.autreFilEnCours',
  'tests-rouges': 'sc.exclusion.testsRouges',
  'import-hors-commit': 'sc.exclusion.importHorsCommit',
  'typage-rouge': 'sc.exclusion.typageRouge'
}

/** Mesuré le 2026-10-01 : `b6d2a3fc` poussé sans test a laissé main rouge 20 h. */
function libelleVerification(verification: Verification): string {
  if (verification.statut === 'vert') {
    const n = verification.testsJoues
    const verts = tx(n > 1 ? 'sc.verif.verts.plusieurs' : 'sc.verif.verts.un', { n })
    const nommes: Array<[string, string[] | undefined]> = [
      [tx('sc.verif.instables'), verification.instablesSousCharge],
      [tx('sc.verif.dejaRouges'), verification.dejaRouges],
      [tx('sc.verif.rougesDAilleurs'), verification.rougesDAilleurs]
    ]
    return [
      verts,
      ...nommes
        .filter(([, suites]) => suites?.length)
        .map(([motif, suites]) => `${motif} : ${suites!.join(', ')}`)
    ].join(' — ')
  }
  if (verification.statut === 'echec') return tx('sc.verif.echec', { detail: verification.detail })
  return tx('sc.verif.nonRejoues', { raison: verification.raison })
}

/** Mesuré le 2026-09-29 : un fichier écarté pour 2 lignes sur 146, sans que le panneau le dise. */
function libelleExclusion(item: Exclusion): string {
  // Le fil qui tient le fichier, nommé (conv-1083) : « touché aussi par conv-B ».
  const cleMotif = MOTIFS_EXCLUSION[item.motif]
  const motif = item.fils?.length
    ? tx('sc.exclusion.toucheParFils', { fils: item.fils.join(', ') })
    : cleMotif
      ? tx(cleMotif)
      : item.motif
  if (item.testsEnEchec?.length) return `${item.path} (${motif} : ${item.testsEnEchec.join(', ')})`
  if (item.erreursDeTypage?.length) return `${item.path} (${motif} : ${item.erreursDeTypage[0]})`
  const n = item.lignesNonReclamees
  if (!n) return `${item.path} (${motif})`
  return tx(n > 1 ? 'sc.exclusion.lignes.plusieurs' : 'sc.exclusion.lignes.un', {
    chemin: item.path,
    motif,
    n
  })
}

const normRacine = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** Chemins (relatifs à la racine affichée) modifiés par la conversation, pour l'arbre Projet. */
function cheminsModifies(changes: GitChange[], racine?: string): string[] {
  return changes
    .filter((c) => !racine || !c.workspaceRoot || normRacine(c.workspaceRoot) === normRacine(racine))
    .map((c) => c.path.replace(/\\/g, '/'))
}

function autoCloseResultLabel(scope: string, result: AutoCloseViewResult): string {
  const portee = scope
  if (result.status === 'pushed') {
    const branche = result.branch
    if (result.mode === 'direct') return tx('sc.publi.pousseSur', { portee, branche })
    if (result.mode === 'pr')
      return result.pr
        ? tx('sc.publi.pushRefuse', { portee, branche, pr: result.pr })
        : tx('sc.publi.prNonOuverte', {
            portee,
            branche,
            erreur: result.prError ?? tx('sc.publi.motifInconnu')
          })
    return tx('sc.publi.publie', { portee, branche })
  }
  if (result.status === 'committed') return tx('sc.publi.commiteLocalement', { portee })
  if (result.status === 'failed') return tx('sc.publi.echec', { portee, erreur: result.error })
  const reasons: Record<string, CleDuPanneau> = {
    'no-changes': 'sc.raison.aucunChangement',
    'no-remote': 'sc.raison.aucunDistant',
    'recovery-baseline-missing': 'sc.raison.baselineAbsente',
    'brain-sans-depot': 'sc.raison.brainSansDepot',
    'protected-branch': 'sc.raison.brancheProtegee',
    'secret-detected': 'sc.raison.secretDetecte',
    'concurrent-commits': 'sc.raison.commitsConcurrents',
    'invalid-publication-range': 'sc.raison.plageInvalide',
    unattributed: 'sc.raison.nonAttribue',
    'tests-rouges': 'sc.raison.testsRouges',
    'typage-rouge': 'sc.raison.typageRouge'
  }
  const cle = reasons[result.reason]
  return tx('sc.publi.nonPublie', { portee, raison: cle ? tx(cle) : result.reason })
}

/**
 * Onglet Git : le FLUX est calculé depuis l'état RÉEL du dépôt (retard, fichiers modifiés,
 * avance, branche) — seules les étapes qui ont quelque chose à faire s'affichent, dans l'ordre,
 * et la première est mise en avant. Chaque clic PROPOSE la demande à l'agent, rien n'est
 * exécuté ici.
 */
/** Delai de regroupement des relectures git pendant un tour (signes de vie d'outil, texte). */
export const RELIRE_PENDANT_TOUR_MS = 1500

/** Identité d'un fichier modifié dans la liste : même chemin sous deux racines = deux fichiers. */
function cleFichier(change: GitChange): string {
  return `${change.workspaceRoot ?? ''}\0${change.path}`
}

/** Lit le diff d'un fichier : celui de la conversation dans la vue Fichiers, sinon celui du dépôt. */
function demanderDiff(
  view: PaneView,
  conversationId: string | undefined,
  repoPath: string,
  change: GitChange
): Promise<GitDiffResult> {
  const request =
    view === 'project' && conversationId && change.workspaceRoot
      ? window.api.conversationGitDiff(conversationId, change.path, change.workspaceRoot)
      : window.api.getGitDiff(change.path, repoPath || undefined)
  return request.then((value) => value as GitDiffResult)
}

/** Actions hors flux : uniquement celles qu'aucune étape ne couvre déjà. */
function actionsGit(nbChanges: number): Array<{ label: string; prompt: string }> {
  // `prompt` reste en français : c'est la consigne envoyée à l'agent, pas un texte d'écran.
  return [
    {
      label: tx('sc.action.nouvelleBranche'),
      prompt: 'crée une nouvelle branche à partir de la branche courante, nommée : '
    },
    { label: tx('sc.action.changerDeBranche'), prompt: 'change de branche vers : ' },
    ...(nbChanges > 0
      ? [
          {
            label: tx('sc.action.mettreDeCote'),
            prompt: 'mets de côté mes changements en cours (stash nommé) sans rien perdre'
          }
        ]
      : [])
  ]
}

export function SourceControlPane({
  conversationId,
  depotConversation,
  onSendPrompt
}: {
  conversationId?: string
  /** Depot de la CONVERSATION : ce que la vue « Workspace » doit lire, branche comprise. */
  depotConversation?: string
  onSendPrompt?: (prompt: string) => void
}): React.JSX.Element {
  const { t } = useTextesChatPanneaux()
  const [git, setGit] = useState<GitReadResult | null>(null)
  const [brainTraces, setBrainTraces] = useState<BrainTrace[]>([])
  const [brainUnavailable, setBrainUnavailable] = useState(false)
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [diff, setDiff] = useState<GitDiffResult | null>(null)
  const diffRequestRef = useRef(0)
  const dataRequestRef = useRef(0)
  /*
   * DEPOT DE LA VUE « WORKSPACE ».
   *
   * Il suit la CONVERSATION. Auparavant il ne lisait que `autowin:sc-repo`, un chemin choisi une
   * fois dans le navigateur et jamais revu : le panneau affichait alors le nom et la branche d'un
   * AUTRE depot que celui du fil (constate le 2026-09-23 : « CONTOSO-V3 » sur une conversation
   * AutoWinOS). Le chemin memorise ne sert plus que de repli quand la conversation n'en porte pas.
   */
  const [repoMemorise] = useState<string>(() => localStorage.getItem('autowin:sc-repo') ?? '')
  const repoPath = depotConversation?.trim() || repoMemorise
  const [refreshTick, setRefreshTick] = useState(0)
  /** Fichier dont « Annuler ces changements » attend le clic de confirmation. */
  const [annulerArme, setAnnulerArme] = useState<string | null>(null)
  /**
   * Fichiers ANNULES depuis ce panneau : une fois annules, ils sortent de la liste des modifies,
   * donc « Remettre » vit a part. Memoire de l'ecran seulement : un rechargement l'oublie, la copie
   * des changements reste sur le disque (voir la demande envoyee a l'agent).
   */
  const [annules, setAnnules] = useState<string[]>([])
  /**
   * RELECTURE LIGNE À LIGNE (2026-09-28, voir `shared/relecture-diff.ts`) : commentaires posés sur
   * les diffs de la conversation, envoyés à l'agent en UN seul message. Conservés par conversation
   * dans le stockage local : le panneau se démonte à chaque changement d'onglet.
   */
  const [relecture, setRelecture] = useState<CommentaireRelecture[]>(() =>
    lireRelecture(conversationId)
  )
  /** Dernier lot envoyé : si l'agent était occupé, l'envoi a pu ne rien produire — on peut le remettre. */
  const [relectureEnvoyee, setRelectureEnvoyee] = useState<CommentaireRelecture[] | null>(null)
  /** « Tout effacer » perd du texte tapé : un premier clic arme, le second efface. */
  const [effacerArme, setEffacerArme] = useState(false)
  const relectureConversationRef = useRef(conversationId)
  useEffect(() => {
    if (relectureConversationRef.current === conversationId) return
    relectureConversationRef.current = conversationId
    setRelecture(lireRelecture(conversationId))
    setRelectureEnvoyee(null)
    setEffacerArme(false)
  }, [conversationId])
  const [view, setView] = useState<PaneView>('project')
  const scope = `${view}:${conversationId ?? ''}:${view === 'workspace' ? repoPath : ''}`
  const [loadedScope, setLoadedScope] = useState('')
  /** Portée réellement chargée et fichier ouvert, lus par les relectures sans relancer l'effet. */
  const loadedScopeRef = useRef('')
  const openFileRef = useRef<string | null>(null)
  useEffect(() => {
    openFileRef.current = openFile
  }, [openFile])

  useEffect(() => {
    // L'activité des bureaux vit dans l'onglet Worktrees ; ici, l'événement sert seulement à relire
    // le résultat de clôture auto, qui peut se terminer APRÈS le retour du run.
    const off = window.api.onWorktreeActivity?.(() => {
      setRefreshTick((tick) => tick + 1)
    })
    return () => {
      off?.()
    }
  }, [conversationId])

  useEffect(() => {
    const requestId = ++dataRequestRef.current

    const finishGit = (value: GitReadResult): void => {
      if (dataRequestRef.current !== requestId) return
      const simpleRelecture = loadedScopeRef.current === scope
      loadedScopeRef.current = scope
      setGit(value)
      setBrainTraces([])
      setBrainUnavailable(false)
      setLoadedScope(scope)
      /*
       * SIMPLE RELECTURE DANS LA MÊME VUE (pendant ou en fin de tour) : le diff ouvert RESTE ouvert
       * et se met à jour. Le refermer à chaque relecture — toutes les 1,5 s pendant un tour depuis
       * 7791c387 — empêchait de lire ou de commenter pendant que l'agent travaille (2026-09-28).
       * Un changement de vue ou de conversation, lui, referme toujours.
       */
      const ouvert = openFileRef.current
      const toujoursLa = ouvert
        ? value.state?.changes.find((change) => cleFichier(change) === ouvert)
        : undefined
      if (simpleRelecture && toujoursLa) {
        const diffId = ++diffRequestRef.current
        void demanderDiff(view, conversationId, repoPath, toujoursLa)
          .then((relu) => {
            if (diffRequestRef.current === diffId) setDiff(relu)
          })
          .catch(() => {
            // fix-ok: relecture de FOND ratée : le dernier diff lu reste affiché ; l'ouverture
            // explicite d'un fichier, elle, affiche toujours son erreur.
          })
        return
      }
      setOpenFile(null)
      setDiff(null)
    }
    const finishBrain = (value: BrainTrace[], unavailable = false): void => {
      if (dataRequestRef.current !== requestId) return
      loadedScopeRef.current = scope
      setBrainTraces(value)
      setBrainUnavailable(unavailable)
      setGit(null)
      setOpenFile(null)
      setDiff(null)
      setLoadedScope(scope)
    }

    if (view === 'project' || view === 'tree') {
      // « Projet » (tree) lit AUSSI les fichiers de la conversation : l'arbre les surligne.
      if (!conversationId) finishGit(EMPTY_GIT)
      else {
        void window.api
          .conversationGitState(conversationId)
          .then((value) => finishGit(value as GitReadResult))
          .catch(() => finishGit({ available: false, error: tx('sc.erreur.lectureConversation') }))
      }
    } else if (view === 'brain') {
      if (!conversationId) finishBrain([])
      else {
        void window.api
          .brainTraces(conversationId)
          .then((value) => finishBrain(value))
          .catch(() => finishBrain([], true))
      }
    } else {
      void window.api
        .getGitState(repoPath || undefined)
        .then((value) => finishGit(value as GitReadResult))
        .catch(() => finishGit({ available: false, error: tx('sc.erreur.lectureGit') }))
    }

    return () => {
      if (dataRequestRef.current === requestId) dataRequestRef.current += 1
    }
  }, [conversationId, refreshTick, repoPath, scope, view])

  useEffect(() => {
    let relectureEnAttente: ReturnType<typeof setTimeout> | null = null
    const refreshConversation = (raw: unknown): void => {
      const event = raw as {
        conversationId?: string
        convId?: string
        kind?: string
        type?: string
        name?: string
      }
      const target = event.conversationId ?? event.convId
      if (target !== conversationId) return
      // OUTIL NATIF DE L'AGENT (son terminal : `git commit`, `git push`…) : il ne produit ni
      // `result` ni `done`, seulement des signes de vie `provider-status` puis du texte. Sans cette
      // relecture, le bouton restait sur « Commiter » jusqu'a la fin du tour (conv-855). Relecture
      // GROUPEE : au plus une par RELIRE_PENDANT_TOUR_MS, la derniere toujours jouee.
      if (event.kind === 'provider-status' || event.kind === 'delta') {
        if (relectureEnAttente) return
        relectureEnAttente = setTimeout(() => {
          relectureEnAttente = null
          setRefreshTick((value) => value + 1)
        }, RELIRE_PENDANT_TOUR_MS)
        return
      }
      if (
        event.kind === 'result' ||
        // FIN DE TOUR : les fichiers modifies par le chat sont notes juste avant (agent-pilot,
        // capture avant/apres). Sans cette relecture, il fallait quitter puis rouvrir l'onglet.
        event.kind === 'done' ||
        event.type === 'orchestrate-step' ||
        event.type === 'orchestrate-end'
      ) {
        setRefreshTick((value) => value + 1)
      }
    }
    const offPilot = window.api.onPilotEvent?.(refreshConversation)
    const offApp = window.api.onAppEvent?.(refreshConversation)
    return () => {
      if (relectureEnAttente) clearTimeout(relectureEnAttente)
      offPilot?.()
      offApp?.()
    }
  }, [conversationId])

  const [autoClose, setAutoClose] = useState<AutoCloseViewState | null>(null)
  const [autoCloseError, setAutoCloseError] = useState<string>()
  useEffect(() => {
    let alive = true
    void window.api.getAutoClose?.().then((state) => {
      if (alive) setAutoClose(state as AutoCloseViewState)
    })
    return () => {
      alive = false
    }
  }, [refreshTick])

  const toggleAutoClose = async (): Promise<void> => {
    // fix-ok: l'état optimiste est rétabli et expliqué si le main process ne peut pas le persister.
    const previous = autoClose?.enabled ?? false
    const next = !previous
    setAutoCloseError(undefined)
    setAutoClose({ enabled: next })
    try {
      const applied = await window.api.setAutoClose(next)
      setAutoClose(applied as AutoCloseViewState)
    } catch {
      setAutoClose({ enabled: previous })
      setAutoCloseError(tx('sc.erreur.reglageNonConserve'))
    }
  }

  const selectView = (next: PaneView): void => {
    if (next === view) setRefreshTick((value) => value + 1)
    else setView(next)
  }
  const propose = (text: string): void => onSendPrompt?.(text)
  const majRelecture = (suivante: CommentaireRelecture[]): void => {
    setRelecture(suivante)
    setEffacerArme(false)
    ecrireRelecture(conversationId, suivante)
  }
  const ajouterCommentaire = (chemin: string, repere: RepereLigne, texte: string): void => {
    const id = nouvelIdCommentaire()
    majRelecture([...relecture, { id, chemin, ...repere, texte }])
  }
  const envoyerRelecture = (): void => {
    const message = composerRelecture(relecture)
    if (!message || !onSendPrompt) return
    propose(message)
    setRelectureEnvoyee(relecture)
    majRelecture([])
  }
  const toggleDiff = (change: GitChange): void => {
    const key = `${change.workspaceRoot ?? ''}\0${change.path}`
    if (openFile === key) {
      diffRequestRef.current += 1
      setOpenFile(null)
      return
    }
    const requestId = ++diffRequestRef.current
    setOpenFile(key)
    setDiff(null)
    void demanderDiff(view, conversationId, repoPath, change)
      .then((value) => {
        if (diffRequestRef.current === requestId) setDiff(value)
      })
      .catch(() => {
        // fix-ok: une erreur obsolète ne doit ni bloquer le chargement ni écraser un diff plus récent.
        if (diffRequestRef.current === requestId) {
          setDiff({ available: false, error: tx('sc.erreur.diff') })
        }
      })
  }

  const scopeLoaded = loadedScope === scope
  const visibleGit = scopeLoaded ? git : null
  const visibleBrainTraces = scopeLoaded ? brainTraces : []
  const changes = visibleGit?.state?.changes ?? []
  /*
   * Chemin CITÉ à l'agent : relatif quand la conversation ne touche qu'un dépôt ; préfixé de sa
   * racine dès qu'elle en touche plusieurs, sinon « src/index.ts » désignerait deux fichiers.
   */
  const plusieursRacines = new Set(changes.map((c) => c.workspaceRoot ?? '')).size > 1
  const cheminCite = (change: GitChange): string =>
    plusieursRacines && change.workspaceRoot
      ? `${change.workspaceRoot.replace(/[\\/]+$/, '')}/${change.path}`
      : change.path
  const fichiersCommentes = new Set(relecture.map((c) => c.chemin)).size
  const paneLabel =
    view === 'tree'
      ? t('sc.vue.arborescence')
      : view === 'brain'
        ? t('sc.vue.brain')
        : view === 'workspace' && repoPath
          ? repoPath.replace(/^.*[\\/]/, '')
          : view === 'project'
            ? // Suit le renommage de l'onglet : un onglet « Fichiers » ouvrant un panneau intitulé
              // « Projet de la conversation » se contredirait à l'écran.
              t('sc.vue.fichiers')
            : t('sc.vue.depotCourant')
  const comptesRelecture = (n: number): string =>
    t(n > 1 ? 'sc.commentaires.plusieurs' : 'sc.commentaires.un', { n })

  return (
    <div className="sc-pane" data-testid="source-control-pane">
      <div className="sc-scroll">
        <div className="sc-repo" data-testid="sc-repo">
          <span className="sc-repo-path" title={paneLabel}>
            {view === 'brain' ? '◇' : '📁'} {paneLabel}
            {!scopeLoaded && (
              <span className="sc-loading" data-testid="sc-loading">
                {' '}
                {t('sc.lecture')}
              </span>
            )}
          </span>
          <button
            className={`sc-btn sc-repo-btn${view === 'project' ? ' is-active' : ''}`}
            data-testid="sc-repo-project"
            title={t('sc.onglet.fichiers.titre')}
            onClick={() => selectView('project')}
          >
            {/* « Fichiers » et non « Projet » : cet onglet liste les FICHIERS modifiés par la
                conversation, ce que son propre `title` disait déjà. « Projet » annonçait un périmètre
                (le dépôt) au lieu du contenu (les fichiers touchés ici). */}
            {t('sc.onglet.fichiers')}
          </button>
          <button
            className={`sc-btn sc-repo-btn${view === 'tree' ? ' is-active' : ''}`}
            data-testid="sc-view-tree"
            title={t('sc.onglet.projet.titre')}
            onClick={() => selectView('tree')}
          >
            {t('sc.onglet.projet')}
          </button>
          <button
            className={`sc-btn sc-repo-btn${view === 'brain' ? ' is-active' : ''}`}
            data-testid="sc-repo-brain"
            title={t('sc.onglet.brain.titre')}
            onClick={() => selectView('brain')}
          >
            {/* Nom propre, identique dans les deux langues. */}
            Brain
          </button>
          <button
            className={`sc-btn sc-repo-btn${view === 'workspace' ? ' is-active' : ''}`}
            data-testid="sc-view-workspace"
            title={t('sc.onglet.git.titre')}
            onClick={() => selectView('workspace')}
          >
            {/* « Git » et non « Workspace » : demande de l'utilisateur (conv-844). Nom propre,
                identique dans les deux langues. */}
            Git
          </button>
        </div>

        {/* « Lancer » vit dans l'onglet Projet (demande conv-72) ; il ne dépend pas de git. */}
        {view === 'tree' && conversationId && (
          <LancementBarre key={conversationId} conversationId={conversationId} />
        )}

        {view === 'tree' && (
          <ProjectPane
            conversationId={conversationId}
            racine={repoPath}
            modifies={cheminsModifies(changes, repoPath)}
          />
        )}

        {view !== 'brain' && view !== 'tree' && visibleGit && !visibleGit.available && (
          <div className="sc-empty">{t('sc.depotIntrouvable')}</div>
        )}

        {view === 'project' && visibleGit?.state && (
          <section className="sc-sect">
            <header className="sc-h">{t('sc.modifies', { n: changes.length })}</header>
            {relecture.length > 0 && (
              <div className="sc-relecture" data-testid="sc-relecture">
                <span className="sc-relecture-compte">
                  <b>{t('sc.relecture')}</b> ·{' '}
                  {t('sc.relecture.compte', {
                    commentaires: comptesRelecture(relecture.length),
                    fichiers: t(
                      fichiersCommentes > 1 ? 'sc.fichiers.plusieurs' : 'sc.fichiers.un',
                      {
                        n: fichiersCommentes
                      }
                    )
                  })}
                </span>
                <button
                  className="sc-btn sc-relecture-envoyer"
                  data-testid="sc-relecture-envoyer"
                  disabled={!onSendPrompt}
                  title={t('sc.relecture.envoyer.titre')}
                  onClick={envoyerRelecture}
                >
                  {t('sc.relecture.envoyer')}
                </button>
                <button
                  className={`sc-btn${effacerArme ? ' is-armed' : ''}`}
                  data-testid="sc-relecture-effacer"
                  onClick={() => (effacerArme ? majRelecture([]) : setEffacerArme(true))}
                >
                  {effacerArme ? t('sc.relecture.effacer.confirmer') : t('sc.relecture.effacer')}
                </button>
              </div>
            )}
            {relectureEnvoyee && relecture.length === 0 && (
              <div className="sc-relecture is-envoyee" data-testid="sc-relecture-envoyee">
                <span className="sc-relecture-compte">
                  {t('sc.relecture.envoyee', {
                    commentaires: comptesRelecture(relectureEnvoyee.length)
                  })}
                </span>
                <button
                  className="sc-btn"
                  data-testid="sc-relecture-remettre"
                  title={t('sc.relecture.remettre.titre')}
                  onClick={() => {
                    majRelecture([...relectureEnvoyee, ...relecture])
                    setRelectureEnvoyee(null)
                  }}
                >
                  {t('sc.relecture.remettre')}
                </button>
              </div>
            )}
            {changes.length === 0 ? (
              <div className="sc-clean">{t('sc.aucunFichier')}</div>
            ) : (
              <>
                {changes.map((change) => (
                  <div key={`${change.workspaceRoot ?? ''}:${change.path}`}>
                    <div
                      className={`sc-file${
                        openFile === `${change.workspaceRoot ?? ''}\0${change.path}`
                          ? ' sc-file-open'
                          : ''
                      }`}
                      data-testid="sc-file"
                      title={t('sc.fichier.titre', { chemin: change.path })}
                      onClick={() => toggleDiff(change)}
                    >
                      <span className={`sc-m sc-m-${change.status}`}>
                        {markGlyph[change.status]}
                      </span>
                      <span className="sc-fn">{change.path}</span>
                      <span className="sc-chev">
                        {openFile === `${change.workspaceRoot ?? ''}\0${change.path}` ? '▾' : '▸'}
                      </span>
                    </div>
                    {openFile === `${change.workspaceRoot ?? ''}\0${change.path}` && (
                      <div className="sc-diff-wrap">
                        <div className="sc-diff-card" data-testid="sc-diff-card">
                          <div className="sc-diff-head">
                            <span className="sc-diff-title" title={change.path}>
                              {change.path}
                            </span>
                            {onSendPrompt && (
                              <span className="sc-diff-astuce" title={t('sc.diff.astuce.titre')}>
                                {t('sc.diff.astuce')}
                              </span>
                            )}
                            <span className="sc-diff-wrap-mode">{t('sc.diff.retourLigne')}</span>
                          </div>
                          <div className="sc-diff-content">
                            {diff === null ? (
                              <div className="sc-clean">
                                <Spinner /> {t('sc.diff.chargement')}
                              </div>
                            ) : diff.available ? (
                              <>
                                {diff.note ? <div className="sc-clean">{diff.note}</div> : null}
                                <DiffView
                                  diff={diff.diff ?? ''}
                                  commentaires={relecture.filter(
                                    (c) => c.chemin === cheminCite(change)
                                  )}
                                  onAjouter={
                                    onSendPrompt
                                      ? (repere, texte) =>
                                          ajouterCommentaire(cheminCite(change), repere, texte)
                                      : undefined
                                  }
                                  onRetirer={(id) =>
                                    majRelecture(relecture.filter((c) => c.id !== id))
                                  }
                                />
                              </>
                            ) : (
                              <div className="sc-clean">
                                {t('sc.diff.indisponible')}
                                {diff.error ? ` : ${diff.error}` : '.'}
                              </div>
                            )}
                          </div>
                          <div className="sc-diff-actions">
                            {/* ANNULER (demande du 2026-09-23) remplace « Expliquer / committer ».
                                Geste qui PERD du travail : un premier clic arme, le second envoie.
                                Comme les autres boutons, le panneau ne lance aucun git lui-meme. */}
                            <button
                              className={`sc-btn sc-diff-action${annulerArme === change.path ? ' is-armed' : ''}`}
                              data-testid="sc-diff-annuler"
                              onClick={(event) => {
                                event.stopPropagation()
                                if (annulerArme !== change.path) {
                                  setAnnulerArme(change.path)
                                  return
                                }
                                setAnnulerArme(null)
                                setAnnules((liste) =>
                                  liste.includes(change.path) ? liste : [...liste, change.path]
                                )
                                // Consigne pour l'agent : reste en français.
                                propose(
                                  `annule les changements de ${change.path} faits par cette conversation : ` +
                                    `remets-le dans son état d'avant. Avant d'annuler, garde une copie ` +
                                    `de ces changements dans artifacts/annules/ pour pouvoir les remettre. ` +
                                    `Ne touche pas aux modifications d'autres travaux dans ce fichier.`
                                )
                              }}
                            >
                              {annulerArme === change.path
                                ? t('sc.diff.annuler.confirmer')
                                : t('sc.diff.annuler')}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div className="sc-btns">
                  <button
                    className="sc-btn"
                    onClick={() =>
                      // Consigne pour l'agent : reste en français.
                      propose('commit tous les changements avec un message clair, puis push')
                    }
                  >
                    {/* Terme Git, identique dans les deux langues. */}
                    Commit
                  </button>
                </div>
              </>
            )}
            {annules.map((path) => (
              <div className="sc-annule" data-testid="sc-annule" key={path}>
                <span className="sc-annule-path" title={path}>
                  ↺ {path}
                </span>
                <button
                  className="sc-btn"
                  data-testid="sc-remettre"
                  onClick={() => {
                    setAnnules((liste) => liste.filter((p) => p !== path))
                    // Consigne pour l'agent : reste en français.
                    propose(
                      `remets les changements de ${path} que tu viens d'annuler, ` +
                        `à partir de la copie gardée dans artifacts/annules/.`
                    )
                  }}
                >
                  {t('sc.remettreChangement')}
                </button>
              </div>
            ))}
          </section>
        )}

        {view === 'brain' && (
          <section className="sc-sect">
            <header className="sc-h">
              {t('sc.brain.appels', { n: visibleBrainTraces.length })}
            </header>
            {brainUnavailable ? (
              <div className="sc-empty">{t('sc.brain.lectureIndisponible')}</div>
            ) : visibleBrainTraces.length === 0 ? (
              <div className="sc-clean">{t('sc.brain.aucun')}</div>
            ) : (
              visibleBrainTraces.map((trace, index) => {
                const retained =
                  trace.navigation?.candidates.filter((candidate) => candidate.retained) ?? []
                return (
                  <article
                    className="sc-brain-call"
                    data-testid="sc-brain-trace"
                    key={`${trace.timestamp}:${trace.turnId ?? index}`}
                  >
                    <header>
                      <span className="sc-brain-kind">
                        {trace.kind === 'query' ? t('sc.brain.requete') : t('sc.brain.injection')}
                      </span>
                      <time dateTime={trace.timestamp}>
                        {formaterDate(trace.timestamp, {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </time>
                    </header>
                    <p>{trace.query || t('sc.brain.requeteNonExposee')}</p>
                    <footer>
                      <span title={trace.turnId ?? t('sc.brain.tourNonCorrele.titre')}>
                        {trace.turnId
                          ? t('sc.brain.tour', { id: trace.turnId.slice(0, 8) })
                          : t('sc.brain.tourNonCorrele')}
                      </span>
                      <span>
                        {trace.status === 'unavailable'
                          ? t('sc.brain.indisponible')
                          : trace.found === false
                            ? t('sc.brain.aucunResultat')
                            : trace.found === true
                              ? t('sc.brain.resultatTrouve')
                              : t('sc.brain.resultatInconnu')}
                      </span>
                      <span>
                        {t('sc.brain.caracteres', { n: formaterNombre(trace.injectedChars) })}
                      </span>
                      {retained.length > 0 && (
                        <span>{t('sc.brain.sources', { n: retained.length })}</span>
                      )}
                    </footer>
                    {retained.length > 0 && (
                      <ul className="sc-brain-sources">
                        {retained.map((candidate) => (
                          <li key={candidate.path} title={candidate.path}>
                            {candidate.path}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                )
              })
            )}
          </section>
        )}

        {view === 'workspace' && visibleGit?.state && (
          <section className="sc-sect">
            <header className="sc-h">{t('sc.branche')}</header>
            <div className="sc-branch-row">
              <span className="sc-branch">{visibleGit.state.branch || '—'}</span>
              {(visibleGit.state.ahead > 0 || visibleGit.state.behind > 0) && (
                <span className="sc-ab">
                  ↑{visibleGit.state.ahead} ↓{visibleGit.state.behind}
                </span>
              )}
              <button
                className={`sc-btn sc-toggle sc-branch-toggle ${autoClose?.enabled ? 'is-on' : 'is-off'}`}
                data-testid="sc-autoclose"
                aria-pressed={autoClose?.enabled ?? false}
                title={
                  autoClose?.enabled ? t('sc.auto.active.titre') : t('sc.auto.desactive.titre')
                }
                onClick={() => void toggleAutoClose()}
              >
                <span className="sc-toggle-dot" aria-hidden="true" />
                {t('sc.auto')}
                {/* « ON »/« OFF » : identiques dans les deux langues. */}
                <b className="sc-toggle-state">{autoClose?.enabled ? 'ON' : 'OFF'}</b>
              </button>
            </div>
            <header className="sc-h">{t('sc.etapes')}</header>
            <div className="sc-flux" data-testid="sc-git-flux">
              {etapesGit(visibleGit.state).length === 0 ? (
                <div className="sc-clean" data-testid="sc-git-a-jour">
                  {t('sc.aJour')}
                </div>
              ) : (
                etapesGit(visibleGit.state).map((etape, index) => (
                  <button
                    key={etape.label}
                    className={`sc-flux-step${index === 0 ? ' is-suggested' : ''}`}
                    title={etape.prompt}
                    onClick={() => propose(etape.prompt)}
                  >
                    <b>
                      {index + 1} {etape.label}
                    </b>
                    <span className="sc-flux-detail">{etape.detail}</span>
                  </button>
                ))
              )}
            </div>
            <div className="sc-btns" data-testid="sc-git-actions">
              {actionsGit(visibleGit.state.changes.length).map((action) => (
                <button
                  key={action.label}
                  className="sc-btn"
                  title={action.prompt}
                  onClick={() => propose(action.prompt)}
                >
                  {action.label}
                </button>
              ))}
            </div>
            {autoCloseError && (
              <div className="sc-clean" data-testid="sc-autoclose-error" role="alert">
                {autoCloseError}
              </div>
            )}
            {autoClose?.last && (
              <div className="sc-autoclose-last" data-testid="sc-autoclose-last">
                <strong>{t('sc.dernierEnchainement', { run: autoClose.last.runId })}</strong>
                <span>{autoCloseResultLabel(t('sc.portee.projet'), autoClose.last.project)}</span>
                {autoClose.last.brain && (
                  <span>{autoCloseResultLabel('Brain', autoClose.last.brain)}</span>
                )}
                {autoClose.last.typage ? (
                  <span data-testid="sc-autoclose-typage">{libelleTypage(autoClose.last.typage)}</span>
                ) : null}
                {autoClose.last.verification ? (
                  <span data-testid="sc-autoclose-verification">
                    {libelleVerification(autoClose.last.verification)}
                  </span>
                ) : null}
                {autoClose.last.exclus?.length ? (
                  <span data-testid="sc-autoclose-exclus">
                    {t('sc.laisseEnAttente', {
                      liste: autoClose.last.exclus.map(libelleExclusion).join(', ')
                    })}
                  </span>
                ) : null}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
