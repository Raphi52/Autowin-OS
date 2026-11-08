// Point d'entrée d'un run (préparation, choix du parcours, clôture) — méthodes de la classe Orchestrator déplacées telles quelles depuis
// orchestrator.ts ; elles s'exécutent avec `this` = l'instance, via les délégués de la classe.
import type { RoleBinding } from '../profil/roles'
import { raisonDeBlocageIntegration } from '../../shared/raison-de-blocage'
import { fichiersTouchesGit } from '../hooks/default-gate-hooks'
import { type PipelinePhase, type NodePhase } from '../skills/skill-pipeline'
import { rootExecutionRequirements, programmeSansEcriture } from '../gardes/root-execution-contract'
import { isMutationTask } from './task-mutation-classifier'
import { routeSkillRequest } from '../skills/skill-routing'
import { refusEtapeDesactivee } from './etapes-desactivees'
import {
  allocationFromGraph,
  recoveriesFromGraph,
  worstCaseNodeExecutions
} from '../workflow/workflow-graph'
import { resumeConsigne } from '../runs/plan-en-vagues'
import type { ExecutionEvidence } from '../providers/types'
import { preparedCommitMutationEvidence } from '../providers/workspace-mutation-evidence'
import { appendExecutionEvidenceFileTrace } from '../activity/conversation-file-trace-spool'
import type { WatchdogMutationClaimsSink } from '../task-manager/types'
import { identifiantBureauCache } from '../consignes/consigne-bureau-cache'
import { instantDeRetourAnnonce } from '../../shared/reprise-quota'
import { alignReportWithDisk, dispositionPourIssue } from '../git/worktree-path-rewrite'
import { annonceCommitLocal, pushDuCompteRendu, type PushDuRun } from '../chat/annonce-commit-local'
import {
  PublicationARejouer,
  refusDePublication,
  type RefusDePublication
} from '../../shared/echec-publication'
import type { RunLifecycleEvent } from '../../shared/run-execution'
import type { WorktreeAgentActivity } from '../../shared/worktree-activity-model'
import { allocateExecutionTopology } from './execution-quote'
import { protegerRappel } from '../gel/observabilite-non-bloquante'
import { attendSaPublication, causeDInterruption } from './classe-terminale-echec'
import {
  BrainRetrievalEvent,
  GreedyTaskNode,
  OrchestrationPhase,
  OrchestrationResult,
  OrchestrationRunOptions,
  OrchestrationRuntimeSnapshot,
  OrchestrationStep,
  appelsRequisParWorkflow,
  hasVerifiedExternalGitMutation,
  instantaneAssaini,
  jetonDeReservation,
  limitGreedyPlan,
  murDeQuotaDuRun,
  raisonsDArretDuRun,
  watchdogClaimsFromEvidence
} from './orchestrator-contrats'
import type { Orchestrator } from './orchestrator'

/**
 * Flip live worktree : enveloppe le pipeline. Un run de mutation reçoit une copie isolée (cwd),
 * fusionnée en fin (full-auto / conflit) via le coordinateur. Sans coordinateur → cwd = base
 * (comportement historique intact).
 */
export async function run(
  this: Orchestrator,
  task: string,
  onStep?: (s: OrchestrationStep) => void,
  onPhase?: (p: OrchestrationPhase) => void,
  onDelta?: (step: 'exec' | 'judge', delta: string, note?: string, reasoning?: string) => void,
  signal?: AbortSignal,
  collectedContext = '',
  /**
   * SURVIE NIVEAU 3 : reprise d'un run interrompu par la mort du process. Les phases présentes ici
   * ne sont PAS rejouées au modèle — leur livrable est réinjecté tel quel et l'exécution redémarre
   * à la phase suivante (aucun token regaspillé).
   */
  resumeOutputs: {
    phase: NodePhase
    text: string
    agentToken?: string
    executionEvidence?: ExecutionEvidence[]
  }[] = [],
  /** Conversation d'origine, persistée avec l'acquis pour qu'une reprise s'affiche au bon endroit. */
  conversationId?: string,
  /** Binding figé pour ce run, prioritaire sur tous les rôles et panels de la topologie. */
  bindingOverride?: RoleBinding,
  /** Émis dès la récupération Brain, avant toute phase susceptible d'échouer. */
  onBrainRetrieved?: (event: BrainRetrievalEvent) => void,
  /** Tour Chat causal, persisté avec l'état reprenable. */
  turnId?: string,
  onRunLifecycle?: (event: RunLifecycleEvent) => void,
  runtimeSnapshot?: OrchestrationRuntimeSnapshot,
  causalWatchPaths: readonly string[] = [],
  onLateCausalMutationClaims?: WatchdogMutationClaimsSink,
  runOptions: OrchestrationRunOptions = {}
): Promise<OrchestrationResult> {
  /*
   * UN GEL NE CASSE PAS LE TOUR. Ces trois rappels ecrivent la trace causale, qui passe par un
   * verrou de sequence JETANT au dela de son budget d'acquisition — exactement ce qui arrive
   * quand la boucle d'evenements est tenue. Invoques a nu en aval (`onStep?.(s)`, `onPhase?.(p)`),
   * ils faisaient remonter ce jet jusqu'ici et tuaient un run par ailleurs sain. On les protege
   * UNE fois, a leur entree dans le pipeline : meme contrat que `emitLifecycle` juste dessous.
   */
  /*
   * ETAT DE DEPART DU DEPOT — ce qui etait DEJA modifie avant que ce run commence.
   *
   * Mesure du 2026-09-12 : les garde-fous de preuve visuelle et de mouvement
   * reconstruisent leur diff depuis `git status` du depot, faute de recevoir celui du run.
   * Sur un arbre partage deja sale — 217 fichiers, dont 55 de rendu, laisses par d'autres
   * sessions — ils attribuaient tout au run courant et refusaient un vert merite. On fige
   * donc la saleté PREEXISTANTE ici, une fois, pour que les hooks la soustraient.
   */
  this.fichiersSalesAuDemarrage = await fichiersTouchesGit(this.deps.executionWorkspace)
  onStep = protegerRappel('onStep', onStep)
  onPhase = protegerRappel('onPhase', onPhase)
  onDelta = protegerRappel('onDelta', onDelta)
  const runId = runOptions.resumeRunId ?? `run-${this.runNamespace}-${++this.runSeq}`
  this.causalWatchPathsByRun.set(runId, [...causalWatchPaths])
  const runStartedAtMs = Date.now()
  const executionQuote = this.deps.currentExecutionQuote?.()
  const emitLifecycle = (event: RunLifecycleEvent): void => {
    try {
      onRunLifecycle?.(event)
    } catch {
      /* observabilité best-effort : elle ne casse jamais le run */
    }
  }
  const activityForRun = (): WorktreeAgentActivity | undefined =>
    this.deps.worktrees?.activity?.().find((activity) => activity.agentId === runId)
  const isMut = isMutationTask(task)
  // Un tournoi compare des solutions, pas seulement des textes : même une tâche classée
  // lecture-seule doit donc disposer de son propre bureau attestable et conservé.
  const requiresIsolatedWorkspace = isMut || runOptions.publication === 'hold'
  const workflow = this.workflowDuRun()
  const phases = this.effectivePhases(task)
  const explicitPhase = routeSkillRequest(task)?.explicitPhase
  // Étape nommée ou build d'un run qui modifie, désactivés dans Settings › Skills : refus AVANT le
  // premier appel, comme les autres refus de départ.
  const refusEtape = refusEtapeDesactivee({
    phaseNommee: explicitPhase,
    modifie: isMut,
    desactivee: (phase) => this.etapeDesactivee(phase)
  })
  if (refusEtape) throw new Error(refusEtape)
  const workflowGraph = this.graphePourTache(task)
  const depuisGraphe = workflowGraph ? allocationFromGraph(workflowGraph) : undefined
  const impose =
    workflow?.allocation || depuisGraphe
      ? {
          ...depuisGraphe,
          ...workflow?.allocation,
          phaseMembers: {
            ...depuisGraphe?.phaseMembers,
            ...workflow?.allocation?.phaseMembers
          }
        }
      : undefined
  const appelsWorkflow = workflowGraph ? appelsRequisParWorkflow(workflowGraph, impose) : undefined
  if (executionQuote && workflow?.explicit && workflowGraph) {
    // Une sélection manuelle engage le graphe affiché. Le devis doit donc refléter ses phases et
    // la borne de reprise qu'il porte, puis lui réserver les places nécessaires sans dépasser le
    // plafond d'appels déjà fixé par le régime / l'utilisateur.
    executionQuote.phases = [...phases]
    // En mode bloquant, une arête rouge décrit le chemin de reprise à afficher, pas
    // l'autorisation de repayer ce chemin sans nouvelle stratégie humaine. En mesure seule
    // (défaut, décision du 12/08), la reprise bornée par le graphe se joue automatiquement :
    // « 1 prompt = 1 réussite » exige que le juge rouge déclenche la réparation sans tour humain.
    executionQuote.limits.maxRecoveries =
      executionQuote.limits.spendEnforcement === 'blocking'
        ? 0
        : (recoveriesFromGraph(workflowGraph) ?? executionQuote.limits.maxRecoveries)
    const mandatory = appelsWorkflow!
    const maxPanel = Math.max(
      impose?.judgeMembers ?? 1,
      ...Object.values(impose?.phaseMembers ?? {}).map((count) => count ?? 1)
    )
    // `maxProviderCalls` est un plafond de PORTEFEUILLE : en mesure seule (défaut depuis le
    // 12/08), un workflow déterministe plus large que le régime agrandit le devis au lieu d'être
    // refusé (12 obligatoires pour 10 places tuait le run avant le premier appel).
    // `maxConcurrency` protège la MACHINE, pas le portefeuille : son refus reste inconditionnel.
    if (
      mandatory > executionQuote.limits.maxProviderCalls &&
      executionQuote.limits.spendEnforcement === 'metering-only'
    ) {
      executionQuote.limits.maxProviderCalls = mandatory
    }
    if (
      mandatory > executionQuote.limits.maxProviderCalls ||
      maxPanel > executionQuote.limits.maxConcurrency
    ) {
      throw new Error(
        `Plan d’exécution impossible : workflow exige ${mandatory} appel(s) et ${maxPanel} agent(s) simultané(s), plafonds ${executionQuote.limits.maxProviderCalls}/${executionQuote.limits.maxConcurrency}.`
      )
    }
    /*
     * UN APPEL N EST PAS UN AGENT — corrige le 2026-08-31.
     *
     * `maxAgents` etait cale sur `mandatory`, le nombre d appels OBLIGATOIRES du workflow. Or
     * une phase en FAN-OUT lance un agent PAR MEMBRE de son panel : le plafond valait donc
     * exactement le minimum structurel, sans une seule place pour le fan-out. Symptome mesure :
     * un run tue sur « Budget d agents atteint (6) » — six phases, six places — au tout premier
     * fan-out de build, AVANT que le moindre modele ait produit une sortie. La pire issue
     * possible : paye, et rien de fini.
     *
     * Le raisonnement est celui deja pose quelques lignes plus haut pour `maxProviderCalls` : un
     * workflow deterministe plus large que le regime AGRANDIT le devis au lieu d etre refuse.
     * On dimensionne donc sur le fan-out REEL — chaque appel obligatoire pouvant
     * etre servi par un panel de `maxPanel` membres — plus les reprises promises.
     *
     * AUCUN frein reel ne bouge : `maxTotalTokens`, `maxUsd` et `maxDurationMs` bornent toujours
     * exactement ce qu ils bornaient, et `maxConcurrency` — qui protege la MACHINE et non le
     * portefeuille — garde son refus inconditionnel. Ce plafond-ci ne comptait que des tetes.
     */
    const placesFanOut = mandatory * Math.max(1, maxPanel) + executionQuote.limits.maxRecoveries
    executionQuote.limits.maxAgents = Math.max(executionQuote.limits.maxAgents, placesFanOut)
  }
  // Un instantané FOURNI est assaini AVANT tout usage : il est consommé par plusieurs chemins
  // (fan-out de phase, fan-out de juge, phase séquentielle) et le premier qui atteignait le registre
  // jetait `Provider inconnu: <x>`. Un instantané construit ICI vient de la configuration courante,
  // donc rien à assainir.
  const assainissement = runtimeSnapshot
    ? instantaneAssaini(runtimeSnapshot, this.deps.roles.all(), this.deps.registry.ids())
    : undefined
  for (const note of assainissement?.notes ?? []) onDelta?.('exec', `[binding] ${note}\n`)
  const admittedRuntime: OrchestrationRuntimeSnapshot = assainissement?.instantane ?? {
    roles: this.deps.roles.all(),
    phaseFanOut: Object.fromEntries(
      phases.map((phase) => [phase, [...(this.deps.phaseFanOut?.(phase) ?? [])]])
    ),
    judgeFanOut: [...(this.deps.judgeFanOut?.() ?? [])]
  }
  if (executionQuote && !executionQuote.allocation) {
    const usage = this.deps.currentExecutionUsage?.()
    const completedPhases = resumeOutputs
      .filter((output) => output.text.trim().length > 0)
      .map((output) => output.phase)
    const phaseFanOut = Object.fromEntries(
      phases.map((phase) => [
        phase,
        bindingOverride
          ? 0
          : (impose?.phaseMembers?.[phase] ?? (admittedRuntime.phaseFanOut[phase] ?? []).length)
      ])
    ) as Partial<Record<PipelinePhase, number>>
    executionQuote.allocation = allocateExecutionTopology(executionQuote, {
      phases,
      completedPhases,
      startedAgents: usage?.startedAgents ?? usage?.startedCalls ?? 0,
      startedCalls: usage?.startedCalls ?? 0,
      mutation: isMut,
      hasDecomposer: Boolean(
        !explicitPhase && !workflowGraph && !bindingOverride && this.deps.decompose
      ),
      phaseFanOut,
      judgeFanOut: bindingOverride
        ? 0
        : (impose?.judgeMembers ?? admittedRuntime.judgeFanOut.length),
      // Un graphe à boucles rejoue des nœuds : provisionner sa seule chaîne ferait accepter un run
      // qui serait ensuite coupé en plein milieu, faute de places.
      ...(workflowGraph
        ? {
            worstCaseNodeExecutions: worstCaseNodeExecutions(workflowGraph),
            worstCaseProviderCalls: appelsWorkflow
          }
        : {})
    })
    // Le workflow impose son allocation PAR-DESSUS le calcul du devis, clé par clé : c'est tout
    // l'intérêt de comparer « 5 juges » à « 1 juge ». Ce qu'il ne dit pas reste ce que le devis a
    // décidé — sinon un workflow qui ne règle que le jury effacerait aussi le reste.
    // Les agents composés sur les nœuds DICTENT l'allocation : sans cela le devis provisionnerait
    // un panel d'un membre et le fan-out serait tronqué — trois juges composés, un seul joué. Une
    // allocation écrite explicitement dans le profil reste prioritaire sur cette déduction.
    if (impose) {
      const refusesJudge =
        impose.judgeMembers !== undefined &&
        executionQuote.allocation.judgeMembers !== impose.judgeMembers
      const refusePhase = Object.entries(impose.phaseMembers ?? {}).find(
        ([phase, count]) =>
          executionQuote.allocation?.phaseMembers[phase as PipelinePhase] !== count
      )
      const refuseGreedy =
        impose.maxGreedyNodes !== undefined &&
        executionQuote.allocation.maxGreedyNodes < impose.maxGreedyNodes
      if (refusesJudge || refusePhase || refuseGreedy) {
        // MESURE SEULE = ON COMPTE, ON NE REFUSE PAS. Les deux refus voisins
        // (`maxProviderCalls` ci-dessus, agents obligatoires dans `execution-quote.ts`) ont été
        // assouplis le 12/08 ; celui-ci avait été oublié et tuait encore le run AVANT le premier
        // appel. En mesure seule (défaut), l'allocation s'ALIGNE sur ce que le workflow impose ;
        // le refus ne subsiste qu'en `spendEnforcement: 'blocking'`, choisi explicitement.
        if (executionQuote.limits.spendEnforcement === 'blocking') {
          throw new Error(
            `Plan d’exécution impossible : l'allocation du workflow dépasse les plafonds du run.`
          )
        }
        if (impose.judgeMembers !== undefined) {
          executionQuote.allocation.judgeMembers = impose.judgeMembers
        }
        for (const [phase, count] of Object.entries(impose.phaseMembers ?? {})) {
          if (count !== undefined) {
            executionQuote.allocation.phaseMembers[phase as PipelinePhase] = count
          }
        }
        if (impose.maxGreedyNodes !== undefined) {
          executionQuote.allocation.maxGreedyNodes = Math.max(
            executionQuote.allocation.maxGreedyNodes,
            impose.maxGreedyNodes
          )
        }
      }
    }
    executionQuote.decomposition =
      executionQuote.allocation.maxGreedyNodes >= 2
        ? { mode: 'build-only', maxNodes: executionQuote.allocation.maxGreedyNodes }
        : { mode: 'disabled', maxNodes: 1 }
  }
  if (requiresIsolatedWorkspace && !this.deps.worktrees) {
    throw new Error(
      'Isolation bloquée : le moteur de bureaux workspace est indisponible pour ce projet.'
    )
  }
  // PAS DE PRÉ-VOL BASE-DIRTY — un run de mutation PART sur une base sale, délibérément.
  //
  // Un pré-vol a refusé ici, du 2026-08-18 au 2026-08-25, tout run isolé dès que `git status` de
  // la base rendait la moindre ligne. Il refusait sur l'état BRUT : TOUS les fichiers non
  // committés. Or la garde qu'il prétendait anticiper est CHIRURGICALE — `blockingDirtyFiles`
  // (`worktree-manager.ts:1455`) ne bloque que sur l'INTERSECTION entre les fichiers touchés par
  // l'agent et les fichiers sales de l'utilisateur. Le pré-vol était donc strictement plus dur
  // que le refus qu'il annonçait, et tuait des runs qui n'auraient jamais approché le travail en
  // cours. Sur un dépôt où l'utilisateur travaille en continu, ce refus était la NORME.
  //
  // Il sur-refusait par NÉCESSITÉ, pas par excès de zèle : au lancement, les fichiers que l'agent
  // va toucher ne sont pas encore connus (`worktree-manager.ts:3906`), donc l'intersection est
  // incalculable à cet instant. Le choix assumé ici est de payer un run gaspillé quand la
  // collision est RÉELLE, plutôt que de refuser en masse des runs inoffensifs.
  //
  // CE QUI PROTÈGE LE TRAVAIL NON COMMITTÉ N'EST PAS CE PRÉ-VOL, et c'est pourquoi le retirer ne
  // cède rien : la copie remise à l'agent EXCLUT déjà les fichiers sales du snapshot
  // (`worktree-manager.ts:3703`), et la garde `base-dirty` de la PUBLICATION reste souveraine —
  // elle prime même sur le ref de secours (`worktree-manager.ts:4013`). Aucun `stash`, aucun
  // `checkout` : le travail de l'utilisateur n'est jamais déplacé.
  // Verdict du run, lu dans le `finally` : seul un run VERT ramène son travail dans la base.
  let green = false
  // L'exception qui a arrêté le run, lue dans le `finally` : un mur de quota y SUSPEND le run au
  // lieu de le clore (voir `murDeQuotaDuRun`).
  let erreurDuRun: unknown
  // Reference du rapport rendu : le `finally` doit pouvoir aligner ses chemins APRES avoir su ce que
  // la fusion a fait de la copie isolee. Muter l'objet rendu fonctionne (la valeur de retour est
  // cette reference), reassigner la variable ne fonctionnerait PAS.
  let produced: OrchestrationResult | undefined
  // Photo de l'arbre AVANT le run → la clôture ne publiera que le delta produit par ce run.
  this.deps.closeGreenRun?.begin(runId)
  // SURVIE : l'acquis n'était persisté qu'à la FIN d'une phase. Un run tué avant la première (le cas
  // le plus courant : la phase 1 est longue) ne laissait donc RIEN, et la reprise automatique au
  // démarrage n'avait aucune prise — l'utilisateur devait relancer la tâche à la main. On enregistre
  // dès maintenant, acquis vide : la reprise repart de zéro plutôt que de perdre la tâche.
  this.deps.onPhaseCompleted?.({
    runId,
    task,
    conversationId,
    turnId,
    bindingOverride,
    runtimeSnapshot: admittedRuntime,
    phaseOutputs: [...resumeOutputs],
    executionQuote,
    usage: this.deps.currentExecutionUsage?.(),
    agents: this.agentsOf(runId)
  })
  const beginWorktree = this.deps.worktrees?.beginAsync?.bind(this.deps.worktrees)
  const isolatedCwd = beginWorktree
    ? await beginWorktree(runId, 'Agent', requiresIsolatedWorkspace, {
        task,
        role: 'build',
        conversationId,
        ...(turnId ? { turnId } : {}),
        ...(causalWatchPaths.length ? { causalWatchPaths } : {}),
        ...(runOptions.resumeRunId ? { resumeExisting: true } : {}),
        ...(runOptions.sourceSnapshot
          ? {
              sourceWorkspacePath: runOptions.sourceSnapshot.workspaceId,
              sourceBaseSha: runOptions.sourceSnapshot.baseSha
            }
          : {})
      })
    : this.deps.worktrees?.begin(runId, 'Agent', requiresIsolatedWorkspace, {
        task,
        role: 'build',
        conversationId,
        ...(turnId ? { turnId } : {}),
        ...(causalWatchPaths.length ? { causalWatchPaths } : {}),
        ...(runOptions.resumeRunId ? { resumeExisting: true } : {}),
        ...(runOptions.sourceSnapshot
          ? {
              sourceWorkspacePath: runOptions.sourceSnapshot.workspaceId,
              sourceBaseSha: runOptions.sourceSnapshot.baseSha
            }
          : {})
      })
  if (requiresIsolatedWorkspace && !isolatedCwd) {
    throw new Error('Isolation bloquée : Autowin n’a pas pu créer un bureau agent isolé.')
  }
  const workCwd = isolatedCwd ?? this.deps.executionWorkspace
  const initialActivity = activityForRun()
  emitLifecycle({
    stage: 'workspace',
    runId,
    timestampMs: runStartedAtMs,
    workspace: {
      mode: isolatedCwd ? 'worktree' : 'base',
      repositoryPath: initialActivity?.workspacePath ?? this.deps.executionWorkspace,
      path: workCwd,
      baseBranch: initialActivity?.baseBranch,
      baseSha: initialActivity?.baseSha
    }
  })
  emitLifecycle({
    stage: 'closure',
    runId,
    timestampMs: runStartedAtMs,
    closure: { status: 'open', totalDurationMs: 0, totalCostUsd: 0 }
  })
  if (executionQuote) {
    emitLifecycle({
      stage: 'quote',
      runId,
      timestampMs: Date.now(),
      quote: {
        quoteId: executionQuote.id,
        // Le devis engage des plafonds qui DÉCOULENT du workflow (cf. `worstCaseNodeExecutions`
        // plus haut) : les annoncer sans nommer leur cause revient à afficher un prix sans article.
        ...(this.workflowDuRun()?.identity
          ? { workflow: { ...this.workflowDuRun()!.identity! } }
          : {}),
        regime: executionQuote.regime,
        phases: [...executionQuote.phases],
        decomposition: { ...executionQuote.decomposition },
        limits: { ...executionQuote.limits },
        ...(executionQuote.allocation
          ? {
              allocation: {
                ...executionQuote.allocation,
                phaseMembers: { ...executionQuote.allocation.phaseMembers }
              }
            }
          : {})
      }
    })
  }
  // Les observateurs sont posés pour TOUT run, pas seulement les mutations : le rattachement a
  // besoin du journal même quand aucune copie isolée n'est en jeu. Les rappels worktree, eux,
  // restent conditionnels — sans copie, il n'y a pas de bail à tenir.
  this.processObservers.set(runId, {
    process: (pid, active) => {
      const agent = this.agentsOf(runId).find((candidate) => candidate.pid === pid)
      // `active` suit la RÉSERVATION provider, pas seulement le PID. Entre la fermeture du CLI et
      // le règlement du stream, la conserver vraie maintient la liaison causale récupérable.
      if (agent && (active || !agent.reservationId)) {
        this.rememberAgent(runId, agent.token, { active })
      }
      if (isMut) this.deps.worktrees?.process?.(runId, pid, active)
    },
    reserved: (reservationId, assignment) =>
      // L'appel est admis : son agent compte comme actif dès maintenant, sous un jeton d'attente,
      // pour que le compteur d'appels réservés et la liste des agents actifs restent égaux à chaque
      // sauvegarde, même pendant les attentes de l'adaptateur avant `spawnIntent`.
      this.rememberAgent(runId, jetonDeReservation(reservationId), {
        ...assignment,
        active: true,
        reservationId
      }),
    spawnIntent: (token, active, assignment, reservationId) => {
      // L'intention est émise AVANT le spawn. À cet instant la réservation provider porte déjà
      // activeCalls=1 : checkpoint-er le token maintenant ferme la fenêtre où un CLI détaché
      // pouvait naître avant que son PID/journal ne soit persisté. Un spawn avorté retire ce pending.
      if (active) {
        // Le vrai jeton REMPLACE l'inscription d'attente dans la MÊME écriture : deux occurrences
        // portant la même réservation seraient elles aussi refusées par le contrôle de cohérence.
        if (reservationId) this.runAgents.get(runId)?.delete(jetonDeReservation(reservationId))
        this.rememberAgent(runId, token, {
          ...assignment,
          active: true,
          ...(reservationId ? { reservationId } : {})
        })
      } else this.forgetPendingAgent(runId, token)
      if (isMut) this.deps.worktrees?.spawnIntent?.(runId, token, active)
    },
    spawned: (token, pid, assignment) => {
      // Empreinte capturée MAINTENANT : au redémarrage, elle distingue notre agent d'un processus
      // étranger ayant hérité du même numéro de pid.
      const identity = this.deps.processIdentity?.(pid)
      this.rememberAgent(runId, token, {
        ...assignment,
        active: true,
        pid,
        ...(identity ? { identity } : {})
      })
      if (isMut) this.deps.worktrees?.spawned?.(runId, token, pid)
    },
    journal: (token, journalPath, assignment) =>
      this.rememberAgent(runId, token, { ...assignment, active: true, journalPath }, 'required'),
    reservationSettled: (reservationId) => this.settleAgentReservationInMemory(runId, reservationId)
  })
  try {
    // Fonctionnement NORMAL : on tente TOUJOURS de décomposer (le modèle orchestrateur juge s'il
    // peut). ≥2 sous-tâches → dispatch completion-driven (DAG). Tâche atomique (plan <2) ou pas de
    // décomposeur → pipeline séquentiel classique (fallback naturel, aucun « mode » à basculer).
    let greedyPlan: GreedyTaskNode[] | undefined
    // Un modèle explicitement choisi pour la tâche doit rester l'unique décideur du run :
    // le décomposeur est lié au rôle orchestrateur global et casserait cet invariant.
    const decompositionAllowed =
      !explicitPhase && (!executionQuote || executionQuote.decomposition.mode === 'build-only')
    if (
      decompositionAllowed &&
      !bindingOverride &&
      this.deps.decompose &&
      phases.includes('build')
    ) {
      // L'issue de la décomposition devient un STEP observable, pas une ligne de log : un
      // `rejected` sort en `status: 'failed'`, donc un test peut l'assérer et l'Observatory le
      // montre. Avant, un JSON foiré et une tâche atomique produisaient le même `[]` silencieux.
      const plan = await this.deps.decompose(
        task,
        admittedRuntime.roles.orchestrator,
        (outcome) => {
          onStep?.({
            step: 'gate',
            role: 'decompose',
            status: outcome.kind === 'rejected' ? 'failed' : 'completed',
            detail:
              outcome.kind === 'rejected'
                ? `DÉCOMPOSITION REJETÉE (${outcome.reason}) — fallback séquentiel`
                : outcome.kind === 'atomic'
                  ? 'tâche jugée atomique — séquentiel'
                  : `plan de ${outcome.nodes.length} sous-tâches`,
            // Le plan ADMIS (même borne que plus bas) : c'est lui que le build exécutera, et que
            // le RUN.md montre avant le code.
            ...(outcome.kind === 'plan'
              ? {
                  plan: (executionQuote
                    ? limitGreedyPlan(
                        outcome.nodes,
                        executionQuote.allocation?.maxGreedyNodes ??
                          executionQuote.decomposition.maxNodes
                      )
                    : outcome.nodes
                  ).map((n) => ({
                    id: n.id,
                    consigne: resumeConsigne(n.prompt),
                    deps: [...n.deps]
                  }))
                }
              : {}),
            execution: { runId }
          })
        }
      )
      const admittedPlan = executionQuote
        ? limitGreedyPlan(
            plan,
            executionQuote.allocation?.maxGreedyNodes ?? executionQuote.decomposition.maxNodes
          )
        : plan
      if (admittedPlan.length >= 2) {
        if (phases.length !== 1 || phases[0] !== 'build') {
          greedyPlan = admittedPlan
        } else {
          const greedyResult = await this.runGreedyPipeline(
            task,
            admittedPlan,
            workCwd,
            runId,
            onStep,
            onPhase,
            onDelta,
            signal,
            collectedContext,
            bindingOverride,
            admittedRuntime
          )
          green = !greedyResult.gateBlocked
          produced = greedyResult
          return greedyResult
        }
      }
    }
    const result = await this.runInner(
      task,
      workCwd,
      onStep,
      onPhase,
      onDelta,
      signal,
      greedyPlan,
      collectedContext,
      runId,
      resumeOutputs,
      conversationId,
      bindingOverride,
      onBrainRetrieved,
      turnId,
      admittedRuntime
    )
    green = !result.gateBlocked
    produced = result
    return result
  } catch (erreur) {
    erreurDuRun = erreur
    throw erreur
  } finally {
    // EN PREMIER : plus aucun processus de ce run ne doit tourner dans l'espace de travail quand
    // la fin du run (fusion, retrait de la copie) commence. Voir `lecturesDeFondByRun`.
    const lectureDeFond = this.lecturesDeFondByRun.get(runId)
    this.lecturesDeFondByRun.delete(runId)
    if (lectureDeFond) await lectureDeFond
    this.processObservers.delete(runId)
    this.causalWatchPathsByRun.delete(runId)
    this.costContextByRun.delete(runId)
    this.learningOraclesByRun.delete(runId)
    // Le bureau caché du run se ferme à la fin, quelle que soit l'issue (lot 1). Sans
    // conversation, hdesk-lancer refuse de lancer : rien à fermer. Non attendu, jamais levé.
    if (conversationId && this.deps.fermerBureauCache) {
      try {
        void this.deps
          .fermerBureauCache({ id: identifiantBureauCache(runId), conversationId })
          .catch(() => undefined)
      } catch {
        /* best-effort : une fermeture ratée ne casse jamais le run */
      }
    }
    // Le travail n'est fusionné dans la base QUE si le run est vert. Un run rouge, annulé ou planté
    // garde sa copie isolée (l'exception saute le `green = true` ci-dessus) : on ne ramène plus
    // automatiquement dans la base un travail jugé raté.
    let endReturned = false
    let projectPublication: { baseSha: string; publishedSha: string } | undefined
    let closeStarted = false
    // Ce que la clôture a poussé : l'annonce du commit le dit au lieu d'écrire « non poussé » en dur.
    let pushDuRun: PushDuRun | undefined
    // Pourquoi l'envoi n'est pas parti (refus de règle, erreur) : la réponse du run le dit dans le fil.
    // fix-ok: la clôture peut lever après un refus ; le motif est gardé avant que l'erreur remonte.
    let refusDuRun: RefusDePublication | undefined
    const closePublishedRun = async (publication?: {
      baseSha: string
      publishedSha: string
    }): Promise<void> => {
      if (closeStarted || !green || !this.deps.closeGreenRun) return
      closeStarted = true
      let compteRendu: unknown
      try {
        compteRendu = await this.deps.closeGreenRun.close({
          runId,
          task,
          workCwd: this.deps.executionWorkspace,
          ...(publication ? { projectPublication: publication } : {})
        })
      } catch (erreur) {
        // Publication à rejouer : l'erreur porte le compte rendu. On garde la raison, puis l'erreur
        // remonte comme avant pour que le coordinateur garde la publication à rejouer.
        if (erreur instanceof PublicationARejouer) refusDuRun = refusDePublication(erreur.project)
        throw erreur
      }
      pushDuRun = pushDuCompteRendu(compteRendu)
      refusDuRun = refusDePublication(compteRendu)
    }
    const onPublished = async (publication: {
      baseSha: string
      agentSha: string
    }): Promise<void> => {
      projectPublication = {
        baseSha: publication.baseSha,
        publishedSha: publication.agentSha
      }
      if (produced && causalWatchPaths.length > 0) {
        const evidence = preparedCommitMutationEvidence(
          this.deps.executionWorkspace,
          publication.baseSha,
          publication.agentSha,
          causalWatchPaths
        )
        produced.causalMutationEvidence = evidence
        // Une finalisation différée arrive APRÈS le retour de la commande : elle doit publier sa
        // trace elle-même, sinon le scheduler a déjà lu un résultat vide et la ligne reboucle.
        if (endReturned && conversationId && turnId && evidence.length > 0) {
          const publicationEventId = `worktree-publication:${runId}:${publication.agentSha}`
          appendExecutionEvidenceFileTrace(evidence, {
            conversationId,
            turnId,
            workspaceRoot: this.deps.executionWorkspace,
            published: true,
            eventId: publicationEventId
          })
          try {
            onLateCausalMutationClaims?.({
              ...watchdogClaimsFromEvidence(evidence, this.deps.executionWorkspace),
              eventId: publicationEventId
            })
          } catch {
            // L'observateur ne doit jamais invalider une publication Git déjà réussie.
          }
        }
      }
      // Le coordinateur n'acquitte la publication qu'apres resolution de ce callback. La publication
      // distante doit donc etre TERMINEE ici, y compris quand la fusion locale est synchrone : sinon
      // un crash entre l'acquittement et le push perdrait definitivement la publication distante.
      await closePublishedRun(projectPublication)
    }
    const retained = green && requiresIsolatedWorkspace && runOptions.publication === 'hold'
    // MUR DE QUOTA : le run n'a pas échoué sur son travail, l'abonnement a dit non. Sa copie reste
    // en place pour la reprise (`suspendu`), et son état reprenable n'est pas effacé plus bas.
    const murDeQuota = green ? undefined : murDeQuotaDuRun(erreurDuRun)
    const finalizeOptions = {
      merge: retained ? false : green,
      ...(retained ? { retainGreen: true } : {}),
      ...(murDeQuota ? { suspendu: true } : {}),
      onPublished
    }
    // L'activite est lue AVANT `end` : la finalisation supprime la copie, donc apres l'appel on ne
    // saurait plus dire si le run avait produit des fichiers.
    const activityBeforeFinalize = activityForRun()
    const producedFileCount = activityBeforeFinalize?.files.length ?? 0
    const executionEvidence =
      produced?.phaseOutputs.flatMap((output) => output.executionEvidence ?? []) ?? []
    // Une action Git explicitement ciblee et verifiee sur le depot reel n'a rien a publier depuis
    // la copie isolee. L'activite doit cependant prouver que cette copie n'a produit aucun fichier.
    // fix-ok: (2026-10-13) — run-a8a70cd0ee56-1, copie de 16 fichiers, fusion refusée
    // (base-dirty), déclaré intégré par cette porte : `producedFileCount` lit `activity().files`,
    // que le coordinateur ne remplit qu'à la finalisation (run-worktree-coordinator.ts), donc 0
    // ici. La clôture a alors commité et poussé sous son nom 36 fichiers d'autres conversations
    // (be8c2f87). Test « fusion refusée sur une copie qui a des fichiers » : rouge avant, vert après.
    // La copie est donc MESURÉE avant la finalisation (qui peut la committer ou la supprimer) ; une
    // mesure impossible ne vaut pas « copie vide ». Cette mesure UNIQUE sert aussi la garde
    // « intégration vide » plus bas : `undefined` = copie non mesurable.
    let fichiersDeLaCopie: number | undefined = producedFileCount
    if (producedFileCount === 0 && this.deps.worktrees?.fichiersChangesDeLaCopie) {
      try {
        fichiersDeLaCopie = (await this.deps.worktrees.fichiersChangesDeLaCopie(runId)).length
      } catch {
        fichiersDeLaCopie = undefined
      }
    }
    const copieMesureeVide = fichiersDeLaCopie === 0
    const externalGitMutationDelivered =
      activityBeforeFinalize !== undefined &&
      copieMesureeVide &&
      hasVerifiedExternalGitMutation(executionEvidence, this.deps.executionWorkspace)
    const finalized = this.deps.worktrees?.endAsync
      ? await this.deps.worktrees.endAsync(runId, finalizeOptions)
      : this.deps.worktrees?.end(runId, finalizeOptions)
    endReturned = true
    const finalizeOutcome =
      typeof finalized === 'object' && finalized !== null
        ? (finalized as { outcome?: string }).outcome
        : undefined
    // Defaut vecu le 2026-08-18 : un run dont la copie portait 4 fichiers modifies a
    // renvoye `nothing`, compte comme integre, et l'utilisateur a lu « fusion verifiee » alors que
    // le correctif n'avait jamais quitte la copie isolee. « Rien a fusionner » n'est credible que
    // si le run n'a RIEN produit : sinon c'est une integration vide, donc un faux vert.
    // fix-ok: (2026-10-14) — cette garde lisait `producedFileCount`, donc
    // `activity().files`, vide jusqu'à la finalisation : elle ne mordait jamais en production (son
    // test historique fournissait une activité déjà remplie). Elle lit maintenant la mesure réelle
    // `fichiersDeLaCopie` ; une copie non mesurable ne prouve pas « rien produit ». Test « copie
    // mesurée avec 2 fichiers + finalisation « rien » » : rouge avant, vert après.
    const emptyIntegrationClaim = finalizeOutcome === 'nothing' && fichiersDeLaCopie !== 0
    const integrated =
      !requiresIsolatedWorkspace ||
      externalGitMutationDelivered ||
      finalizeOutcome === 'merged' ||
      (finalizeOutcome === 'nothing' && !emptyIntegrationClaim) ||
      finalizeOutcome === 'cleanup-pending' ||
      finalizeOutcome === 'published-residue'
    // TOTALE et NON optionnelle : voir `raison-de-blocage.ts`. Une issue absente, de forme
    // inconnue ou sans `reason` produit quand meme une phrase — le silence mesure
    // (run « reprend-pardon-mthg437j », 2,13 $) n'est plus representable.
    const finalizeDiagnosis = raisonDeBlocageIntegration(finalized)
    const finalActivity = activityForRun()
    if (retained && produced && isolatedCwd) {
      produced.retainedWorkspace = {
        runId,
        path: finalActivity?.worktreePath ?? isolatedCwd,
        ...(finalActivity?.baseSha ? { baseSha: finalActivity.baseSha } : {}),
        files: finalActivity?.files.map((file) => file.path) ?? []
      }
    }
    if (
      requiresIsolatedWorkspace &&
      finalized &&
      typeof finalized === 'object' &&
      finalizeOutcome
    ) {
      const result = finalized as {
        outcome: string
        files?: string[]
        reason?: string
        detail?: string
        publishedSha?: string
        agentSha?: string
      }
      const outcome =
        result.outcome === 'merged' ||
        result.outcome === 'nothing' ||
        result.outcome === 'conflict' ||
        result.outcome === 'blocked'
          ? result.outcome
          : 'kept'
      emitLifecycle({
        stage: 'git',
        runId,
        timestampMs: Date.now(),
        git: {
          outcome,
          rawOutcome: result.outcome,
          commitSha: result.publishedSha ?? result.agentSha ?? finalActivity?.publishedSha,
          baseBranch: finalActivity?.baseBranch,
          worktreePath: finalActivity?.worktreePath ?? isolatedCwd,
          files: result.files ?? finalActivity?.files.map((file) => file.path),
          reason: result.reason,
          detail: result.detail ?? finalActivity?.detail
        }
      })
    }
    // Un run dont le PROGRAMME ne comporte aucune phase d'ecriture (frame/scout/terrain) n'a rien
    // a integrer : lui reprocher une « integration locale non terminee » est un reproche
    // insatisfaisable. Des que `build` est au programme, la garde mord exactement comme avant.
    if (green && !integrated && !retained && produced && !programmeSansEcriture(phases)) {
      produced.valid = false
      produced.gateBlocked = true
      if (!produced.gateReasons.includes('intégration locale non terminée')) {
        produced.gateReasons.push('intégration locale non terminée')
      }
      if (emptyIntegrationClaim) {
        const vide =
          fichiersDeLaCopie === undefined
            ? 'intégration vide non vérifiable : la copie isolée n’a pas pu être mesurée avant la finalisation, rien publié'
            : `intégration vide : ${fichiersDeLaCopie} fichier(s) modifié(s) dans la copie isolée, rien publié`
        if (!produced.gateReasons.includes(vide)) produced.gateReasons.push(vide)
      }
      // La cause exacte (base-dirty / base-in-progress / merge-failed + fichiers) doit atterrir
      // dans le rapport : sinon le run rouge ne dit PAS pourquoi et le diagnostic recommence.
      // `finalizeDiagnosis` est TOUJOURS renseigne : la seule question est de ne pas le doubler.
      if (!produced.gateReasons.includes(finalizeDiagnosis)) {
        produced.gateReasons.push(finalizeDiagnosis)
      }
    }
    // Lu ICI, avant la garde « commit demandé » plus bas : elle pose `green = false` sur ce même
    // refus, dont l'absence de commit n'est que la conséquence.
    // fix-ok: cause mesurée : la clôture d'un run validé puis refusé `base-dirty` partait `red` sans `interruption` (RUN.md mvz01n0m « status: red » ; test « commit demandé + base-dirty (conv-1431) » : expected undefined to be 'publication' avant, vert après).
    const enAttenteDePublication =
      green && !integrated && !retained && attendSaPublication(finalized)
    // Le rapport a ete redige DANS la copie isolee ; la ligne ci-dessus vient de la fusionner puis de
    // la supprimer. Sans cet alignement, chaque chemin cite est mort — constate le 2026-07-29, dit
    // par l'agent lui-meme : « le rapport pointe vers un worktree qui n'existe plus ».
    // La DÉCISION vit dans `dispositionPourIssue` — fonction pure, testable, et SEULE porteuse de la
    // mesure qui la justifie (cf. `WorktreeDisposition` dans `worktree-path-rewrite.ts`). Elle était
    // en ligne ici, avec sa garde en forme de grep sur le TEXTE de ce fichier : un juge externe a
    // neutralisé le comportement sans faire rougir la suite. Le paragraphe de mesure qui vivait ici
    // en double a été ramené à son unique domicile — un fait répété à deux endroits finit par
    // diverger de lui-même.
    if (produced && workCwd !== this.deps.executionWorkspace) {
      const aligned = alignReportWithDisk(
        { result: produced.result, phaseOutputs: produced.phaseOutputs },
        workCwd,
        this.deps.executionWorkspace,
        dispositionPourIssue({
          integrated,
          ...(finalizeOutcome ? { outcome: finalizeOutcome } : {}),
          ...(typeof finalized === 'object' &&
          finalized !== null &&
          typeof (finalized as { reason?: string }).reason === 'string'
            ? { reason: (finalized as { reason: string }).reason }
            : {})
        }),
        // L'adresse voyage par la NOTE, pas par le diagnostic de gate : celui-ci n'est rendu que
        // pour un run VERT, si bien qu'un run rouge recevait une adresse écrite et jamais montrée
        // — exactement le cas où retrouver le travail partiel compte le plus.
        typeof finalized === 'object' &&
          finalized !== null &&
          typeof (finalized as { rescueRef?: string }).rescueRef === 'string'
          ? (finalized as { rescueRef: string }).rescueRef
          : undefined
      )
      produced.result = aligned.result
      produced.phaseOutputs = aligned.phaseOutputs ?? produced.phaseOutputs
    }
    const publishedCommitSha =
      projectPublication?.publishedSha ??
      (typeof finalized === 'object' && finalized !== null
        ? ((finalized as { publishedSha?: string; agentSha?: string }).publishedSha ??
          (finalized as { agentSha?: string }).agentSha)
        : undefined) ??
      finalActivity?.publishedSha
    if (
      green &&
      rootExecutionRequirements(task, phases).commit &&
      !publishedCommitSha?.trim() &&
      produced
    ) {
      green = false
      produced.valid = false
      produced.gateBlocked = true
      if (!produced.gateReasons.includes('Commit demande sans identite Git publiee verifiable')) {
        produced.gateReasons.push('Commit demande sans identite Git publiee verifiable')
      }
    }
    // Clôture auto APRÈS la fusion (le travail est dans la base) et seulement si vert.
    // La clôture est attendue pour que le statut distant soit déterministe avant la fin du run.
    // Son échec reste un rapport de clôture, jamais une raison d'invalider le run vert.
    if (green && integrated && this.deps.closeGreenRun) {
      // Chemin legacy sans callback de publication. Un echec de cloture reste un rapport distant et
      // ne rend pas rouge le travail valide ; le callback durable, lui, propage l'echec pour etre rejoue.
      await closePublishedRun(projectPublication).catch(() => undefined)
    }
    // Le commit de transport est ANNONCÉ dans la réponse : il arrivait dans l'historique sans un mot
    // et passait pour un commit fait en cachette malgré la consigne. L'annonce vient
    // APRÈS la dernière clôture possible (rappel pendant la fusion, ou chemin ci-dessus) : elle dit
    // ce que la clôture a VRAIMENT poussé (2026-10-25).
    const annonceCommit = produced
      ? annonceCommitLocal(finalized, runId, task, pushDuRun, refusDuRun)
      : undefined
    if (produced && annonceCommit && !produced.result.includes(annonceCommit)) {
      produced.result = `${produced.result.trimEnd()}

${annonceCommit}`
    }
    // Un vert dont l'intégration n'est pas terminée reste reprenable. Un run rouge peut lui aussi
    // garder un provider en drainage après le watchdog : effacer son checkpoint ici supprimerait
    // la seule garde durable contre une relance/double facturation après crash.
    const hasUnsettledProviderCall = (this.deps.currentExecutionUsage?.()?.activeCalls ?? 0) > 0
    // fix-ok: conv-914/conv-916 (2026-10-13) — deux runs arrêtés sur « session limit · resets 1pm »,
    // l'un en phase clean après un build payé : `!green` les rendait terminaux, `onRunSettled`
    // effaçait leur état reprenable, et `run-state/` ne les contenait plus. Un mur de quota SUSPEND
    // le run : son acquis reste reprenable (relance de la tâche, « Reprendre tout », démarrage
    // après l'heure annoncée). La décision ne dépend QUE du mur — la copie vient d'être gardée sur
    // ce seul critère (`suspendu`) : un run dont la copie est gardée mais l'état effacé ne serait
    // plus ni reprenable ni présenté au tri. Un appel encore en vol (membre de fan-out) retarde
    // seulement la marque jusqu'à son règlement : une date ne lève jamais un verrou.
    const suspenduParQuota = murDeQuota !== undefined
    const terminalRun = (!green && !suspenduParQuota) || integrated || retained
    if (murDeQuota) {
      const resumeAfter = instantDeRetourAnnonce(murDeQuota)
      const mur = { reason: murDeQuota, ...(resumeAfter !== undefined ? { resumeAfter } : {}) }
      if (hasUnsettledProviderCall) this.suspendusEnAttenteDeReglement.set(runId, mur)
      else this.noterSuspensionParQuota(runId, mur)
    }
    if (terminalRun) {
      if (hasUnsettledProviderCall) {
        this.terminalRunsAwaitingProviderSettlement.add(runId)
      } else {
        try {
          this.deps.onRunSettled?.(runId)
        } catch {
          /* effacement best-effort */
        }
        this.terminalRunsAwaitingProviderSettlement.delete(runId)
        this.runAgents.delete(runId)
      }
    }
    emitLifecycle({
      stage: 'closure',
      runId,
      timestampMs: Date.now(),
      closure: {
        status: green && (integrated || retained) ? 'green' : 'red',
        // La cause d'un arrêt étranger au travail : elle ne change pas ce statut — le run n'a rien
        // livré —, elle dit au RUN.md qu'il est interrompu, pas en échec (piste 4).
        ...(() => {
          // Validé mais refusé par une base occupée : il attend sa reprise automatique, il n'a
          // pas échoué. Sans cette cause, le RUN.md disait `red` et le run restait « bloqué »
          // même une fois publié (Publié en b0c4cad9, toujours bloqué).
          if (enAttenteDePublication) return { interruption: 'publication' as const }
          if (green) return {}
          const interruption = causeDInterruption(erreurDuRun, signal?.aborted === true)
          return interruption ? { interruption } : {}
        })(),
        totalDurationMs: Math.max(0, Date.now() - runStartedAtMs),
        totalCostUsd: this.deps.currentExecutionUsage?.()?.knownCostUsd ?? produced?.costUsd ?? 0,
        // Un run qui PLANTE (quota, connexion, phase en échec) n'a pas de rapport : la clôture
        // rouge partait sans aucune raison (run-68594dd94c08-1, quota du sous-agent
        // clean). L'erreur qui l'a arrêté devient sa raison.
        gateReasons: produced?.gateReasons ?? raisonsDArretDuRun(erreurDuRun),
        integrationOutcome: finalizeOutcome,
        usage: this.deps.currentExecutionUsage?.()
      }
    })
  }
}
