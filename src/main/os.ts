/**
 * Façade AutowinOS — câble ensemble les modules RÉELLEMENT utilisés en un seul
 * objet applicatif. Point d'intégration unique consommé par index.ts (IPC).
 * Principe : rien d'exposé ici n'est mort — chaque méthode a un appelant réel
 * (chat, orchestration, dashboards, graphe 3D).
 */
import { ProviderRegistry } from './providers/registry'
import { claudeActiveAccountId, claudeRotateAccount } from './claude-accounts'
import { ClaudeCliAdapter } from './providers/claude'
import { CodexAdapter } from './providers/codex'
import { KimiCliAdapter } from './providers/kimi'
import { GeminiCliAdapter } from './providers/gemini'
import type { Message } from './providers/types'
import { CONSTITUTION } from './constitution'
import { planProviderLogin, spawnLoginTerminal } from './provider-login'
import { RoleModelConfig, type Role, type RoleBinding, type ReasoningEffort } from './roles'
import { dynamicPrompt, meriteUneDecision, readWorkflowDecision } from './workflow-dynamic'
import { loadRoleBindings, saveRoleBindings } from './role-store'
// fix-ok: refonte qualité (demande user « refais comme en fable ») — purge du mort, pas un blind-fix.
import { CostAggregator } from './dashboards/cost'
import { isBlocked } from './dashboards/runs'
import { recurrentPatterns, parseJsonl } from './dashboards/kaizen'
import {
  loadBrainGraph,
  loadBrainNeighborhood,
  scanBrainGraphs,
  readNodeFile,
  searchVaultBrainNotes,
  type BrainGraphRef
} from './viz/fs-brains'
import { scanRuns, type RunEntry } from './dashboards/runs-scan'
import { ConversationStore } from './store/conversations'
import { TrustLedger } from './trust/ledger'
import {
  Orchestrator,
  watchdogClaimsFromEvidence,
  type BrainRetrievalEvent,
  type OrchestrationResult,
  type OrchestrationRuntimeSnapshot,
  type OrchestrationStep,
  type OrchestrationPhase,
  type OrchestratorDeps,
  type WorkflowRunOverride
} from './orchestrator'
import { resolveVerifyReplayConfig } from './hooks/verify-replay-config'
import { buildOrchestratorDecomposer } from './greedy-decompose'
import {
  captureCloseBaseline,
  type CloseBaseline,
  closeGreenRunOnDisk,
  type AutoCloseReport
} from './run-autoclose'
import { amitelBrainRoot } from './amitel-context'
import { regimePhases } from './task-regime'
import type { PipelinePhase } from './skill-pipeline'
import {
  clearOrchestrationState,
  loadOrchestrationStates,
  pickOrchestrationsToResume,
  pickOrchestrationToResume,
  pickResumeForTask,
  saveOrchestrationAgentCheckpoint,
  saveOrchestrationState,
  suppressOrchestrationPipeline,
  type OrchestrationRunState
} from './runs/orchestration-state'
import { defaultBehaviourWorkspace } from './behaviour-files'
import { defaultProcessIdentity, WorktreeManager } from './store/worktree-manager'
import { RunWorktreeCoordinator } from './store/run-worktree-coordinator'
import type { RunLifecycleEvent } from '../shared/run-execution'
import { WorktreeRunStateStore } from './store/worktree-run-state'
import type { WatchdogMutationClaimsSink } from './task-manager/types'
import type { WatchdogMutationClaims } from './task-manager/types'
import { preparedCommitMutationEvidence } from './providers/workspace-mutation-evidence'
import { appendExecutionEvidenceFileTrace } from './activity/conversation-file-trace-spool'
import { repositoryWorktreeIdentity } from './store/worktree-repository'
import type {
  WorktreeAgentActivity,
  WorktreeConflictDiffResult,
  WorktreeRuntimeStatus
} from '../shared/worktree-activity-model'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ensureAutowinAppData } from './app-data'
import { loadAutoClose, saveAutoClose } from './autoclose-store'
import { AUTOWIN_WORKSPACE_ENV } from '../shared/app-identity'
import { ExecutionSupervisor, type ExecutionUsageSnapshot } from './execution-supervisor'
import { compileExecutionQuote } from './execution-quote'
import { loadOrchestrationBudget } from './orchestration-budget'
import { applyWorkflowProfile } from './workflow-profile-apply'
import { graphOf, loadWorkflowProfiles } from './workflow-profiles'
import {
  loadWorkflowSelections,
  saveWorkflowSelections,
  refusExplicite,
  selectWorkflowForConversation,
  workflowForConversation
} from './workflow-selection'
import {
  preparePersistedRunForRelaunch,
  type ProcessIdentity,
  type RecoveredDetachedUsageSettlement
} from './runs/run-reattach'

interface ExecutionWorkspaceInput {
  cwd?: string
  execPath?: string
  configured?: string
}

function gitWorkspaceFrom(start: string): string | undefined {
  let cursor = resolve(start)
  for (;;) {
    if (existsSync(join(cursor, '.git')) && existsSync(join(cursor, 'package.json'))) return cursor
    const parent = dirname(cursor)
    if (parent === cursor) return undefined
    cursor = parent
  }
}

export function resolveExecutionWorkspace(input: ExecutionWorkspaceInput = {}): string {
  const configured = input.configured ?? process.env[AUTOWIN_WORKSPACE_ENV]
  if (configured && existsSync(configured)) return resolve(configured)
  const cwdWorkspace = gitWorkspaceFrom(input.cwd ?? process.cwd())
  if (cwdWorkspace) return cwdWorkspace
  const executableWorkspace = gitWorkspaceFrom(dirname(input.execPath ?? process.execPath))
  if (executableWorkspace) return executableWorkspace
  return defaultBehaviourWorkspace()
}

/** Un modèle membre d'un bloc de fan-out (topology → orchestrateur). */
export interface FanMember {
  provider: string
  model?: string
  reasoningEffort?: ReasoningEffort
}

export interface FanOutTopology {
  scout: FanMember[]
  frame: FanMember[]
  terrain: FanMember[]
  judge: FanMember[]
}

export function selectPhaseFanOut(fanOut: FanOutTopology, phase: PipelinePhase): FanMember[] {
  return phase === 'scout' || phase === 'frame' || phase === 'terrain' ? fanOut[phase] : []
}

/** Noyau applicatif : une instance partagée, injectée dans les handlers IPC. */
export class AutowinOS {
  private readonly brainGraphCache = new Map<string, ReturnType<typeof loadBrainGraph>>()
  readonly registry: ProviderRegistry
  readonly executionSupervisor = new ExecutionSupervisor()
  readonly roles = new RoleModelConfig(loadRoleBindings()) // restaure la config persistée
  readonly cost = new CostAggregator(undefined, join(ensureAutowinAppData(), 'cost.jsonl'))
  readonly conversations = new ConversationStore()
  readonly trust = new TrustLedger(join(ensureAutowinAppData(), 'trust.jsonl'))
  readonly orchestrator: Orchestrator
  /**
   * Les dépendances de l'orchestrateur, figées à la construction de l'OS.
   *
   * Un orchestrateur est construit PAR RUN à partir d'elles, avec sa propre closure de workflow :
   * c'est ce qui empêche deux conversations simultanées de se voler leur workflow. Le champ partagé
   * `activeWorkflow` qui servait avant était l'unique cause de cette contamination.
   */
  private readonly orchestratorDeps: OrchestratorDeps
  /**
   * Workflow nommé imposé au run en cours. Les runs d'une confrontation s'enchaînent en série, donc
   * un seul à la fois — la confrontation le pose puis le retire, y compris quand le run échoue.
   */
  private workflowImpose?: WorkflowRunOverride
  setActiveWorkflow(workflow: WorkflowRunOverride | undefined): void {
    this.workflowImpose = workflow
  }

  /**
   * Pose le workflow choisi POUR CETTE CONVERSATION le temps du run. Rend `true` s'il a posé quelque
   * chose, pour que l'appelant sache s'il doit le retirer.
   *
   * Ne fait rien si un workflow est déjà actif : la confrontation pose le sien autour de chaque run,
   * et il doit gagner — sinon un banc lancé depuis une conversation comparerait le workflow de cette
   * conversation à lui-même.
   */
  /**
   * L'orchestrateur de CE run, avec SA closure de workflow.
   *
   * Extrait en fabrique pour deux raisons : c'est le point unique ou l'isolation entre conversations
   * est realisee, et c'est le seul endroit qu'un harnais doit remplacer pour tester le chemin sans
   * lancer un vrai orchestrateur.
   */
  protected orchestrateurPour(workflow?: WorkflowRunOverride): Orchestrator {
    return new Orchestrator({ ...this.orchestratorDeps, currentWorkflow: () => workflow })
  }

  private async poseConversationWorkflow(
    conversationId?: string,
    task?: string
  ): Promise<WorkflowRunOverride | undefined> {
    // La confrontation IMPOSE son workflow autour de chaque run et gagne : sinon un banc lancé
    // depuis une conversation comparerait le workflow de cette conversation à lui-même.
    if (this.workflowImpose) return this.workflowImpose
    const selections = loadWorkflowSelections()
    // Un refus EXPLICITE se respecte : l'utilisateur a retiré le workflow de cette conversation, le
    // mode dynamique n'a pas à lui en réimposer un. C'est la différence entre proposer et forcer.
    if (refusExplicite(selections, conversationId)) return undefined
    const profileId = workflowForConversation(selections, conversationId)
    // MODE DYNAMIQUE : l'utilisateur ne s'est JAMAIS prononcé → on demande au modèle lequel convient.
    // Il a le droit de répondre « aucun », et c'est souvent la bonne réponse.
    if (!profileId) return task ? await this.poseWorkflowDynamique(task) : undefined
    const profile = loadWorkflowProfiles().profiles.find((p) => p.id === profileId)
    if (!profile) return undefined
    const effectif = applyWorkflowProfile({ roles: {} }, profile)
    return {
      // CHOISI À LA MAIN : la proportionnalité ne doit pas l'écraser. Un garde heuristique qui
      // désactive en silence une décision explicite affiche un workflow qui ne pilote rien.
      explicit: true,
      identity: { name: profile.name, source: 'manuel' },
      ...(graphOf(profile) ? { graph: graphOf(profile) } : {}),
      ...(effectif.phases?.length ? { phases: effectif.phases } : {}),
      ...(effectif.allocation ? { allocation: effectif.allocation } : {}),
      instructionFor: (phase) => effectif.instructionFor(phase)
    }
  }

  /**
   * Demande au modèle quelle façon de travailler convient — et accepte qu'il réponde « aucune ».
   *
   * Best-effort de bout en bout : une panne de provider, une réponse illisible, un graphe inventé
   * invalide ou trop coûteux font TOUS retomber sur « aucun workflow », c'est-à-dire le comportement
   * d'avant ce mode. Un choix automatique ne doit jamais pouvoir empêcher un run de partir.
   */
  private async poseWorkflowDynamique(task: string): Promise<WorkflowRunOverride | undefined> {
    // Ne pas payer un appel de modèle pour apprendre qu'une demande de trois mots ne mérite rien.
    if (!meriteUneDecision(task)) return undefined
    const profiles = loadWorkflowProfiles().profiles
    let reponse: string
    try {
      const binding = this.roles.all().orchestrator
      if (!binding?.provider) return undefined
      const res = await this.registry.send(
        binding.provider,
        [{ role: 'user', content: dynamicPrompt(task, profiles) }],
        { model: binding.model, reasoningEffort: 'low' }
      )
      reponse = res.text ?? ''
    } catch {
      return undefined
    }

    const decision = readWorkflowDecision(reponse, profiles)
    if (decision.kind === 'none') return undefined
    if (decision.kind === 'existing') {
      const effectif = applyWorkflowProfile({ roles: {} }, decision.profile)
      return {
        identity: { name: decision.profile.name, source: 'modele' },
        ...(graphOf(decision.profile) ? { graph: graphOf(decision.profile) } : {}),
        ...(effectif.phases?.length ? { phases: effectif.phases } : {}),
        ...(effectif.allocation ? { allocation: effectif.allocation } : {}),
        instructionFor: (phase) => effectif.instructionFor(phase)
      }
    }
    // Graphe composé à la volée : déjà validé par `readWorkflowDecision` (défauts ET plafond de coût).
    // Le nom que le modèle lui a donné était JETÉ ici : un workflow inventé pilotait le run sans que
    // rien à l'écran ne puisse dire lequel — le cas où l'utilisateur a le moins décidé était aussi
    // le plus muet.
    return {
      identity: { name: decision.name, source: 'compose' },
      graph: decision.graph,
      instructionFor: () => undefined
    }
  }

  /** Le workflow attaché à une conversation, ou `null`. */
  conversationWorkflow(conversationId: string): string | null {
    return workflowForConversation(loadWorkflowSelections(), conversationId) ?? null
  }

  /** Attache (ou détache) un workflow à une conversation. */
  selectConversationWorkflow(conversationId: string, profileId: string | null): string | null {
    const next = selectWorkflowForConversation(loadWorkflowSelections(), conversationId, profileId)
    saveWorkflowSelections(next)
    return workflowForConversation(next, conversationId) ?? null
  }
  readonly executionWorkspace: string
  /**
   * Source LIVE du fan-out multi-modèles, alimentée par la topology (index.ts `syncRuntimeTopology`).
   * Les blocs scout/frame/terrain/judge de la topology y déposent leurs N modèles ; l'orchestrateur les lit
   * (deps `phaseFanOut`/`judgeFanOut`). Vide par défaut → mono-modèle (rétrocompat).
   */
  private fanOut: FanOutTopology = { scout: [], frame: [], terrain: [], judge: [] }
  private taskReadiness: Promise<{ error?: unknown }> = Promise.resolve({})
  /**
   * Coordinateur worktree (volet B) : donne à chaque run de mutation une copie isolée, fusionnée en
   * full-auto (conflit → assisté). Présent seulement si le workspace est un repo git (sinon undefined
   * → comportement historique, workspace partagé). Exposé pour l'IPC d'observabilité (volet A).
   */
  readonly worktrees?: RunWorktreeCoordinator
  private worktreeRuntimeStatus!: WorktreeRuntimeStatus
  private worktreeActivityListener?: (a: WorktreeAgentActivity[]) => void
  private recoveredCausalClaimsListener?: WatchdogMutationClaimsSink
  private readonly pendingRecoveredCausalClaims: WatchdogMutationClaims[] = []
  private causalMemoryRetriever?: (conversationId: string) => string
  /** Dossier des états d'orchestration reprenables (survie niveau 3). */
  private readonly orchestrationStateRoot = join(ensureAutowinAppData(), 'run-state')
  private readonly orchestrationStartedAt = new Map<string, number>()

  constructor() {
    // Le 3e argument separe le mur de quota PAR COMPTE : deux abonnements Claude distincts ne
    // partagent pas leur quota, donc l'epuisement de l'un ne doit pas fermer la porte a l'autre.
    // Les autres providers n'ont qu'un compte -> `undefined` -> cle = le provider, comme avant.
    this.registry = new ProviderRegistry(
      CONSTITUTION,
      this.executionSupervisor,
      (providerId) => (providerId === 'claude' ? claudeActiveAccountId() : undefined),
      // 4e argument : la ROTATION. Un abonnement epuise ne doit pas arreter le travail s'il en reste
      // un autre. Seul `claude` est multi-comptes ; les autres providers rendent `undefined` et
      // gardent donc exactement le comportement d'avant (l'echec de quota remonte tel quel).
      (providerId, walled) => (providerId === 'claude' ? claudeRotateAccount(walled) : undefined)
    )
      .register(new ClaudeCliAdapter())
      .register(new CodexAdapter())
      .register(new KimiCliAdapter())
      .register(new GeminiCliAdapter())
    const executionWorkspace = resolveExecutionWorkspace()
    this.executionWorkspace = executionWorkspace
    // Le workspace resolu est republie dans l'environnement pour que le TRANSPORT y ait acces sans
    // nouvelle dependance : c'est ce qui permet au tour de chat de LIRE le projet (Read/Grep/Glob en
    // lecture seule) au lieu d'etre aveugle et de devoir orchestrer pour repondre a une question.
    process.env[AUTOWIN_WORKSPACE_ENV] = executionWorkspace
    // Garde : `git worktree` exige un vrai repo. Absent (.git manquant) → pas d'isolation (undefined).
    if (existsSync(join(executionWorkspace, '.git'))) {
      try {
        const identity = repositoryWorktreeIdentity(
          join(ensureAutowinAppData(), 'worktrees'),
          executionWorkspace
        )
        const manager = new WorktreeManager({
          baseRepo: executionWorkspace,
          worktreeRoot: identity.root,
          requireCanonicalRemote: true
        })
        this.worktrees = new RunWorktreeCoordinator({
          manager,
          stateStore: new WorktreeRunStateStore(identity.root, identity.repoId),
          onRecoveredPublication: (publication) => {
            const evidence = preparedCommitMutationEvidence(
              executionWorkspace,
              publication.baseSha,
              publication.agentSha,
              publication.causalWatchPaths
            )
            const publicationEventId = `worktree-publication:${publication.runId}:${publication.agentSha}`
            if (publication.conversationId && publication.turnId && evidence.length > 0) {
              appendExecutionEvidenceFileTrace(evidence, {
                conversationId: publication.conversationId,
                turnId: publication.turnId,
                workspaceRoot: executionWorkspace,
                published: true,
                eventId: publicationEventId
              })
            }
            const claims = {
              ...watchdogClaimsFromEvidence(evidence, executionWorkspace),
              eventId: publicationEventId
            }
            if (Object.keys(claims.mutatedLineFingerprints ?? {}).length === 0) return
            if (this.recoveredCausalClaimsListener) this.recoveredCausalClaimsListener(claims)
            else this.pendingRecoveredCausalClaims.push(claims)
          },
          onActivity: (a) => {
            this.worktreeActivityListener?.(a)
          }
        })
        this.worktreeRuntimeStatus = {
          available: true,
          workspacePath: executionWorkspace,
          repoId: identity.repoId
        }
      } catch {
        this.worktreeRuntimeStatus = {
          available: false,
          workspacePath: executionWorkspace,
          reason: 'identity-unavailable'
        }
      }
    } else {
      this.worktreeRuntimeStatus = {
        available: false,
        workspacePath: executionWorkspace,
        reason: 'not-git'
      }
    }
    // Les dépendances sont FIGÉES ici, mais l'orchestrateur est construit PAR RUN (`runTask`) :
    // c'est ce qui donne à chaque tour sa propre closure `currentWorkflow` et supprime l'état
    // partagé entre conversations. `this.orchestrator` n'était utilisé qu'à deux endroits — sa
    // construction et l'unique appel à `run()` — donc rien ne dépend de sa persistance.
    this.orchestratorDeps = {
      registry: this.registry,
      roles: this.roles,
      cost: this.cost,
      trust: this.trust,
      executionWorkspace,
      causalMemoryFor: (conversationId) => this.causalMemoryRetriever?.(conversationId) ?? '',
      // verify-replay EN PROD (opt-in via AUTOWIN_VERIFY_REPLAY) : rejoue la vérif au gate au lieu
      // de croire l'evidence sur parole. Off par défaut (voir resolveVerifyReplayConfig).
      ...resolveVerifyReplayConfig(),
      worktrees: this.worktrees,
      // EMPREINTE DE PROCESSUS — sans elle, la garde de vivacité ne garde rien.
      //
      // `resumeActionFor` compare, au démarrage, l'empreinte capturée au lancement de l'agent à
      // celle du pid courant, pour distinguer NOTRE agent d'un processus étranger ayant hérité du
      // même numéro ([run-reattach.ts:50](src/main/runs/run-reattach.ts:50)). Le côté LECTURE était
      // armé (`index.ts` passe `defaultProcessIdentity` à chaque appel), mais le côté ÉCRITURE ne
      // l'était pas : l'orchestrateur était construit SANS `processIdentity`, donc `identity` valait
      // toujours `undefined` et n'était jamais persistée.
      //
      // `agentVerdict` retombait donc TOUJOURS sur son défaut prudent « vivant » — pas un repli mais
      // l'unique chemin. Tout run dont le pid existe encore était jugé « un agent travaille
      // encore » : rattaché, jamais relancé, jamais déclarable terminé, et le chat attendait
      // indéfiniment. C'est le bug zombie que l'app cherchait à corriger, et il tenait à cette
      // dépendance non branchée.
      //
      // Mesuré le 2026-08-07 : TOUS les agents persistés portaient un pid sans `identity`.
      processIdentity: defaultProcessIdentity,
      // Pipeline ADAPTATIF (proportionnalité) : le régime de la tâche choisit le sous-ensemble de
      // phases (trivial → build seul ; standard → frame+build ; critical → les 5 scout→clean), puis
      // le juge (rôle distinct). Déterministe/générique (task-regime.ts). Économise tokens + latence
      // sur les tâches simples sans jamais sous-traiter les complexes (doute → critical).
      classifyPhases: regimePhases,
      currentExecutionQuote: () => this.executionSupervisor.currentQuote(),
      currentExecutionUsage: () => this.executionSupervisor.currentSnapshot(),
      // Workflow nommé actif — posé le temps d'un run par la confrontation de workflows, absent le
      // reste du temps. Même portée ambiante que le devis ci-dessus.
      // Remplacé PAR RUN dans `runTask` : ici c'est le défaut inerte, pas la vraie source.
      currentWorkflow: () => undefined,
      // SURVIE NIVEAU 3 : après CHAQUE phase, on persiste l'acquis du run ; à la clôture on l'efface.
      // Un kill du process main laisse donc un état reprenable → `resumableOrchestration()`.
      onPhaseCompleted: ({
        runId,
        task,
        conversationId,
        turnId,
        bindingOverride,
        runtimeSnapshot,
        phaseOutputs,
        executionQuote,
        usage,
        agents
      }) =>
        saveOrchestrationState(this.orchestrationStateRoot, {
          runId,
          task,
          ...(conversationId ? { conversationId } : {}),
          ...(turnId ? { turnId } : {}),
          ...(bindingOverride ? { bindingOverride } : {}),
          runtimeSnapshot,
          phaseOutputs,
          ...(executionQuote ? { executionQuote } : {}),
          ...(usage ? { usage } : {}),
          // Les agents CLI du run : un processus detache survit a l'app, ces references sont ce qui
          // permettra de le retrouver vivant et de relire sa sortie au lieu de tout relancer.
          ...(agents && agents.length ? { agents } : {}),
          startedAt: this.orchestrationStartedAt.get(runId) ?? Date.now(),
          updatedAt: Date.now()
        }),
      onAgentsChanged: (runId, agents) => {
        saveOrchestrationAgentCheckpoint(
          this.orchestrationStateRoot,
          runId,
          agents,
          this.executionSupervisor.currentSnapshot()
        )
      },
      onRunSettled: (runId) => {
        this.orchestrationStartedAt.delete(runId)
        clearOrchestrationState(this.orchestrationStateRoot, runId)
      },
      // Fan-out multi-modèles : les blocs topology scout/frame/terrain → phases composées ; judge → juges.
      // ≥2 modèles déposés → l'orchestrateur duplique + agrège (voir orchestrator.ts). Sinon mono.
      phaseFanOut: (phase) => selectPhaseFanOut(this.fanOut, phase),
      judgeFanOut: () => this.fanOut.judge,
      // Fonctionnement NORMAL : on décompose systématiquement via le modèle orchestrateur (best-effort
      // → [] pour une tâche atomique = fallback séquentiel naturel). Pas de « mode » à activer.
      decompose: buildOrchestratorDecomposer({
        registry: this.registry,
        roles: this.roles,
        cwd: executionWorkspace,
        // Sans ce sink, un échec de décomposition (JSON foiré, réseau) et une tâche jugée atomique
        // retombaient tous deux en séquentiel dans le MÊME silence — aucun moyen de distinguer
        // « le modèle a tranché » de « le modèle a planté ». `rejected` est désormais un incident
        // NOMMÉ et visible dans les logs main, distinct de `atomic`.
        onOutcome: (outcome, task) => {
          if (outcome.kind === 'rejected') {
            console.warn(
              `[decompose] rejected (${outcome.reason}) — fallback séquentiel — task="${task.slice(0, 120)}"`
            )
          } else if (outcome.kind === 'atomic') {
            console.log(
              `[decompose] atomic (jugée non décomposable) — task="${task.slice(0, 120)}"`
            )
          } else {
            console.log(
              `[decompose] plan (${outcome.nodes.length} sous-tâches) — task="${task.slice(0, 120)}"`
            )
          }
        }
      }),
      // Clôture d'un run VERT : publication sur une branche dédiée (jamais main), côté projet puis
      // Brain. OFF par défaut — tant que l'utilisateur ne l'a pas activée, rien n'est publié tout seul.
      closeGreenRun: {
        // Photo de l'arbre au démarrage : tout ce qui était déjà modifié n'appartient pas au run.
        begin: (runId) => {
          if (!this.autoClose) return
          this.closeBaselines.set(
            runId,
            captureCloseBaseline(executionWorkspace, amitelBrainRoot())
          )
        },
        close: async ({ runId, task, projectPublication }) => {
          const baselinePromise = this.closeBaselines.get(runId)
          this.closeBaselines.delete(runId)
          if (!this.autoClose || !baselinePromise) return
          this.lastAutoClose = await closeGreenRunOnDisk({
            runId,
            task,
            projectRepo: executionWorkspace,
            brainRepo: amitelBrainRoot(),
            baseline: await baselinePromise,
            projectPublication
          })
        }
      }
    }
    // Instance par DÉFAUT, conservée pour les appelants qui ne passent pas par `runTask`. Le run,
    // lui, s'en construit une avec SA closure de workflow — c'est ce qui isole les conversations.
    this.orchestrator = new Orchestrator(this.orchestratorDeps)
  }

  /**
   * Clôture automatique d'un run vert (commit + push sur branche dédiée). OFF par défaut, et
   * RESTAURÉE du disque : sans ça le réglage retombait à OFF à chaque lancement, obligeant à le
   * réarmer à la main — l'étape manuelle que la fonctionnalité doit justement supprimer.
   */
  private autoClose = loadAutoClose()
  /** Photo de l'arbre par run en cours (projet + Brain), prise au démarrage. */
  private readonly closeBaselines = new Map<string, Promise<CloseBaseline>>()
  /** Dernier résultat de clôture — remonté à l'UI pour dire ce qui a réellement été publié. */
  private lastAutoClose: AutoCloseReport | undefined

  setAutoClose(enabled: boolean): void {
    if (!saveAutoClose(enabled)) {
      throw new Error('Impossible de persister le réglage de clôture automatique.')
    }
    this.autoClose = enabled
  }
  getAutoClose(): { enabled: boolean; last?: AutoCloseReport } {
    return { enabled: this.autoClose, ...(this.lastAutoClose ? { last: this.lastAutoClose } : {}) }
  }

  /** Met à jour la source live du fan-out (appelé par la topology au boot et à chaque changement). */
  setFanOut(next: FanOutTopology): void {
    this.fanOut = next
  }

  /** Branche la mémoire causale après création du TraceStore (construit dans le point d'entrée). */
  setCausalMemoryRetriever(retriever: (conversationId: string) => string): void {
    this.causalMemoryRetriever = retriever
  }

  /** Fige l'identite complete d'un run pour que affichage, reprise et providers restent alignes. */
  captureOrchestrationRuntime(): OrchestrationRuntimeSnapshot {
    const copy = (binding: RoleBinding): RoleBinding => ({
      ...binding,
      ...(binding.phaseModel ? { phaseModel: { ...binding.phaseModel } } : {})
    })
    const current = this.roles.all()
    return {
      roles: {
        orchestrator: copy(current.orchestrator),
        subagent: copy(current.subagent),
        judge: copy(current.judge),
        scout: copy(current.scout)
      },
      phaseFanOut: {
        scout: this.fanOut.scout.map(copy),
        frame: this.fanOut.frame.map(copy),
        terrain: this.fanOut.terrain.map(copy)
      },
      judgeFanOut: this.fanOut.judge.map(copy)
    }
  }

  /** Activité worktree courante (volet A) — snapshot pour l'IPC/renderer. */
  getWorktreeActivity(): WorktreeAgentActivity[] {
    return this.worktrees ? this.worktrees.activity() : []
  }

  getWorktreeRuntimeStatus(): WorktreeRuntimeStatus {
    return (
      this.worktreeRuntimeStatus ?? {
        available: false,
        workspacePath: this.executionWorkspace,
        reason: 'identity-unavailable'
      }
    )
  }

  async getWorktreeConflictDiff(agentId: string): Promise<WorktreeConflictDiffResult> {
    return this.worktrees
      ? this.worktrees.conflictDiffAsync(agentId)
      : { available: false, reason: 'not-conflict' }
  }

  async retryWorktreeRecovery(agentId: string): Promise<WorktreeAgentActivity | undefined> {
    return this.worktrees?.retryRunAsync(agentId)
  }

  async discardHeldWorktree(agentId: string): Promise<boolean> {
    return (await this.worktrees?.discardHeldAsync(agentId)) ?? false
  }

  /** Abonne l'IPC aux changements d'activité worktree (push live vers le cockpit). Idempotent. */
  onWorktreeActivity(listener: (a: WorktreeAgentActivity[]) => void): void {
    this.worktreeActivityListener = listener
  }

  /** Rebranche sur le watchdog les publications reprises dont le callback originel est mort. */
  onRecoveredCausalMutationClaims(listener: WatchdogMutationClaimsSink): void {
    this.recoveredCausalClaimsListener = listener
    for (const claims of this.pendingRecoveredCausalClaims.splice(0)) listener(claims)
  }

  /** Empêche tout run de lire la topology avant la fin de la découverte des modèles. */
  setTaskReadiness(readiness: Promise<unknown>): void {
    this.taskReadiness = readiness.then(
      () => ({}),
      (error: unknown) => ({ error })
    )
  }

  async waitUntilReady(): Promise<void> {
    // Les harness unitaires peuvent instancier le prototype sans constructeur ; en production la
    // propriété existe toujours, mais l'absence signifie naturellement « aucune barrière ».
    for (;;) {
      const observed = this.taskReadiness
      if (!observed) return
      const readiness = await observed
      // Une actualisation peut installer une nouvelle generation pendant l'attente. Valider
      // l'ancienne seulement ferait passer un alias devenu invalide entre les deux barrieres.
      if (observed !== this.taskReadiness) continue
      if (readiness && 'error' in readiness) throw readiness.error
      return
    }
  }

  // --- Conversation directe (chat) : alimente le coût réel ---
  async runChatTurn<T>(
    task: string,
    signal: AbortSignal | undefined,
    execute: () => Promise<T>,
    onUsageSettlement?: (usage: ExecutionUsageSnapshot) => void
  ): Promise<T> {
    await this.waitUntilReady()
    // Un chat deja lance depuis un run (par exemple `chat_send` pendant AgentPilot) partage
    // l'enveloppe courante. Une nouvelle AsyncLocalStorage imbriquee remettrait les compteurs a zero.
    if (this.executionSupervisor.currentQuote()) return execute()
    const settings = loadOrchestrationBudget(
      join(ensureAutowinAppData(), 'orchestration-budget.json')
    )
    const envCalls = Number(process.env.AUTOWIN_CHAT_CALL_CAP)
    const envTokens = Number(process.env.AUTOWIN_CHAT_TOKEN_CAP)
    const envUsd = Number(process.env.AUTOWIN_CHAT_USD_CAP)
    const maxProviderCalls =
      Number.isSafeInteger(envCalls) && envCalls > 0
        ? Math.min(settings.maxProviderCalls, envCalls)
        : Math.min(settings.maxProviderCalls, 6)
    const maxTotalTokens =
      Number.isSafeInteger(envTokens) && envTokens > 0
        ? Math.min(settings.maxTotalTokens, envTokens)
        : Math.min(settings.maxTotalTokens, 1_500_000)
    const defaultUsd = Number.isFinite(envUsd) && envUsd > 0 ? envUsd : 2
    const maxUsd = settings.maxUsd === null ? defaultUsd : Math.min(settings.maxUsd, defaultUsd)
    const quote = compileExecutionQuote(task || 'chat', {
      maxProviderCalls,
      maxTotalTokens,
      maxUsd
    })
    // Un tour de chat n'a ni phase ni fan-out : ses caps sont plus petits et sa concurrence est 1.
    quote.phases = []
    quote.decomposition = { mode: 'disabled', maxNodes: 1 }
    quote.limits.maxAgents = 1
    quote.limits.maxConcurrency = 1
    quote.limits.maxRecoveries = 0
    quote.limits.maxFreshTokens = Math.min(quote.limits.maxFreshTokens, maxTotalTokens)
    return this.executionSupervisor.run(quote, signal, execute, undefined, onUsageSettlement)
  }

  async chat(
    provider: string | undefined,
    role: Role | undefined,
    messages: Message[],
    onDelta: (d: string) => void
  ): Promise<{ text: string; provider: string; systemInjected: boolean }> {
    const task =
      [...messages].reverse().find((message) => message.role === 'user')?.content ?? 'chat'
    let selectedProvider = provider
    const r = await this.runChatTurn(task, undefined, () => {
      // Comme le routeur, relire APRÈS la readiness : le catalogue peut résoudre un alias pendant
      // l'attente et remplacer `codex/flagship` par son transport concret.
      const binding = this.roles.getBinding(role ?? 'orchestrator')
      const currentProvider = provider ?? binding.provider
      selectedProvider = currentProvider
      const options = provider
        ? {}
        : { model: binding.model, reasoningEffort: binding.reasoningEffort }
      return this.registry.send(currentProvider, messages, options, (c) => onDelta(c.delta))
    })
    if (r.usage) {
      this.cost.add({
        provider: selectedProvider ?? r.provider,
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
        cacheReadTokens: r.usage.cacheReadTokens,
        costUsd: r.usage.costUsd
      })
    }
    return { text: r.text, provider: r.provider, systemInjected: r.systemInjected }
  }

  /**
   * Lance le login OFFICIEL d'un provider (bouton « Se reconnecter » de la page Routeur).
   * Les adapters qui exposent `startLogin` gèrent leur connexion ; claude/codex passent par un terminal.
   */
  startProviderLogin(provider: string, configDir?: string): void {
    const adapter = this.registry.get(provider)
    if (adapter.startLogin) {
      adapter.startLogin()
      return
    }
    // `configDir` n'est renseigné que par le multi-comptes Claude : il dirige le login vers le
    // dossier du compte visé, au lieu d'écraser la session du compte courant.
    const plan = planProviderLogin(provider, undefined, configDir)
    if (plan.kind === 'adapter')
      throw new Error(`Le provider ${provider} n'expose pas de connexion interactive.`)
    // codex : `npm run codex:login` doit tourner à la racine du repo (dev) → cwd = process.cwd().
    spawnLoginTerminal(plan.command, provider === 'codex' ? { cwd: process.cwd() } : {})
  }

  /** Change le binding d'un rôle ET persiste sur disque. */
  setRole(role: Role, binding: RoleBinding): Record<Role, RoleBinding> {
    const proposed = new RoleModelConfig(this.roles.all(), this.roles.getCatalog())
      .setBinding(role, binding)
      .all()
    saveRoleBindings(proposed)
    this.roles.setBinding(role, proposed[role])
    return this.roles.all()
  }

  // --- Orchestration disciplinée (le cœur) ---
  async runTask(
    task: string,
    onStep?: (s: OrchestrationStep) => void,
    onPhase?: (p: OrchestrationPhase) => void,
    onDelta?: (step: 'exec' | 'judge', delta: string) => void,
    signal?: AbortSignal,
    collectedContext?: string,
    /** SURVIE NIVEAU 3 : acquis d'un run interrompu → reprise à la phase suivante. */
    resumeOutputs?: { phase: PipelinePhase; text: string }[],
    /** Conversation d'origine : persistée avec l'acquis pour qu'une reprise s'affiche au bon endroit. */
    conversationId?: string,
    /** Modèle figé pour ce run uniquement, sans mutation de la topologie globale. */
    bindingOverride?: RoleBinding,
    /** Trace immédiate de la récupération Brain, y compris si le run échoue ensuite. */
    onBrainRetrieved?: (event: BrainRetrievalEvent) => void,
    turnId?: string,
    onRunLifecycle?: (event: RunLifecycleEvent) => void,
    /** Etat budgetaire du run interrompu ; utilise uniquement avec `resumeOutputs`. */
    resumeControl?: Pick<OrchestrationRunState, 'runId' | 'executionQuote' | 'usage'>,
    /** Publication terminale si un provider ignore d'abord l'abort puis se règle réellement. */
    onLateUsageSettlement?: (usage: ExecutionUsageSnapshot) => void,
    /** Snapshot deja persiste par l'appelant ; absent, capture apres readiness. */
    runtimeSnapshot?: OrchestrationRuntimeSnapshot,
    /** Sources fichier du watchdog à suivre jusque dans la copie isolée. */
    causalWatchPaths: readonly string[] = [],
    onLateCausalMutationClaims?: WatchdogMutationClaimsSink,
    runOptions: {
      workflowOverride?: WorkflowRunOverride
      publication?: 'auto' | 'hold'
      sourceSnapshot?: { workspaceId: string; baseSha: string; contentHash: string }
    } = {}
  ): Promise<OrchestrationResult> {
    await this.waitUntilReady()
    // Certains harness historiques construisent le prototype avec un orchestrateur factice sans
    // magasin de roles. En production `roles` existe toujours ; le fallback laisse le mock intact.
    const admittedRuntime =
      runtimeSnapshot ?? (this.roles ? this.captureOrchestrationRuntime() : undefined)
    const settings = loadOrchestrationBudget(
      join(ensureAutowinAppData(), 'orchestration-budget.json')
    )
    const quote = resumeControl?.executionQuote ?? compileExecutionQuote(task, settings)
    return this.executionSupervisor.run(
      quote,
      signal,
      async () => {
        // LE branchement qui fait qu'un workflow sélectionné change quelque chose. Sans lui, choisir
        // un profil n'écrivait qu'un champ dans un fichier : l'écran promettait un pilotage qui
        // n'existait pas.
        //
        // Résolu POUR CE RUN, puis enfermé dans la closure d'un orchestrateur qui n'appartient qu'à
        // lui. Avant, il était posé dans un champ partagé de l'instance et retiré dans un `finally` :
        // deux conversations simultanées se volaient leur workflow, et le `finally` de l'une effaçait
        // celui de l'autre. Ici la contamination n'est plus improbable, elle est IMPOSSIBLE.
        const workflowDuRun =
          runOptions.workflowOverride ?? (await this.poseConversationWorkflow(conversationId, task))
        const orchestrator = this.orchestrateurPour(workflowDuRun)
        const result = await orchestrator.run(
          task,
          onStep,
          onPhase,
          onDelta,
          this.executionSupervisor.currentSignal(),
          collectedContext,
          resumeOutputs,
          conversationId,
          bindingOverride,
          onBrainRetrieved,
          turnId,
          onRunLifecycle,
          admittedRuntime,
          causalWatchPaths,
          onLateCausalMutationClaims,
          {
            publication: runOptions.publication,
            sourceSnapshot: runOptions.sourceSnapshot,
            resumeRunId: resumeControl?.runId
          }
        )
        result.quote = quote
        result.usage = this.executionSupervisor.currentSnapshot()
        if (result.usage?.knownCostUsd !== null && result.usage?.knownCostUsd !== undefined) {
          result.costUsd = result.usage.knownCostUsd
        }
        return result
      },
      resumeControl?.usage,
      onLateUsageSettlement
    )
  }

  /**
   * SURVIE NIVEAU 3 — run d'orchestration interrompu par la mort du process, s'il en reste un.
   * `null` = rien à reprendre (cas normal). Lecture seule : c'est l'appelant (démarrage de l'app)
   * qui décide de relancer, via `runTask(..., state.phaseOutputs)`.
   */
  resumableOrchestration(): OrchestrationRunState | null {
    return pickOrchestrationToResume(loadOrchestrationStates(this.orchestrationStateRoot))
  }

  /** Tous les runs éligibles à la reprise automatique au démarrage, dans leur ordre de priorité. */
  resumableOrchestrations(): OrchestrationRunState[] {
    return pickOrchestrationsToResume(loadOrchestrationStates(this.orchestrationStateRoot))
  }

  /** Interdit durablement de relancer le pipeline doublon, tout en gardant son agent drainable. */
  suppressDuplicateOrchestrationPipeline(runId: string, electedRunId: string): void {
    suppressOrchestrationPipeline(this.orchestrationStateRoot, runId, electedRunId)
  }

  /** Persiste une branche reprenable sans réécrire le checkpoint source. */
  persistCheckpointFork(
    state: OrchestrationRunState,
    ancestor: NonNullable<OrchestrationRunState['forkedFrom']>
  ): OrchestrationRunState {
    const existing = loadOrchestrationStates(this.orchestrationStateRoot)
    if (existing.some((candidate) => candidate.runId === state.runId)) {
      throw new Error(`Run de fork déjà existant : ${state.runId}`)
    }
    const now = Date.now()
    const branchState = structuredClone(state)
    delete branchState.turnId
    delete branchState.resumeDisposition
    const fork: OrchestrationRunState = {
      ...branchState,
      runId: state.runId,
      forkedFrom: structuredClone(ancestor),
      startedAt: now,
      updatedAt: now,
      agents: []
    }
    saveOrchestrationState(this.orchestrationStateRoot, fork)
    return fork
  }

  /** Persiste la preuve de fin des providers orphelins avant de remettre leur budget au supervisor. */
  reconcileResumableOrchestrationForRelaunch(
    runId: string,
    identityOf: ProcessIdentity,
    onRecoveredUsage?: (settlement: RecoveredDetachedUsageSettlement) => void
  ): OrchestrationRunState | null {
    return preparePersistedRunForRelaunch(
      this.orchestrationStateRoot,
      runId,
      identityOf,
      Date.now(),
      onRecoveredUsage
    )
  }

  /**
   * Acquis reutilisable pour une tache RELANCEE dans une conversation (« reprend »). Le chemin de
   * reprise n'existait qu'au redemarrage de l'app : relancer depuis le chat repayait les phases deja
   * produites (constate le 2026-07-29). Lecture seule ; l'appelant decide.
   */
  resumableOrchestrationForTask(
    task: string,
    conversationId: string | undefined,
    nowMs = Date.now(),
    bindingOverride?: RoleBinding,
    runtimeSnapshot?: OrchestrationRuntimeSnapshot
  ): OrchestrationRunState | null {
    return pickResumeForTask(loadOrchestrationStates(this.orchestrationStateRoot), {
      task,
      conversationId,
      nowMs,
      bindingOverride,
      runtimeSnapshot
    })
  }

  /**
   * Repersiste les offsets de journal atteints après un rattachement : ce qui vient d'être montré à
   * l'utilisateur ne doit pas lui être remontré au prochain démarrage.
   */
  rememberAgentOffsets(
    runId: string,
    agents: Array<{
      token: string
      provider?: string
      phase?: PipelinePhase
      active?: boolean
      fanOut?: boolean
      pid?: number
      identity?: string
      journalPath?: string
      offset?: number
    }>
  ): void {
    const state = loadOrchestrationStates(this.orchestrationStateRoot).find(
      (candidate) => candidate.runId === runId
    )
    if (!state) return
    saveOrchestrationState(this.orchestrationStateRoot, { ...state, agents, updatedAt: Date.now() })
  }

  /** Abandonne explicitement un état reprenable (l'utilisateur ne veut pas le reprendre). */
  forgetResumableOrchestration(runId: string): void {
    clearOrchestrationState(this.orchestrationStateRoot, runId)
  }

  // --- Dashboards : données RÉELLES ---
  budget(): ReturnType<CostAggregator['budgetStatus']> {
    return this.cost.budgetStatus()
  }
  costByRole(): ReturnType<CostAggregator['byRole']> {
    return this.cost.byRole()
  }
  trustRanking(): ReturnType<TrustLedger['ranking']> {
    return this.trust.ranking()
  }
  /** Gate déterministe évalué sur les VRAIS runs vivants (plus de démo hardcodée). */
  async runsWithGate(): Promise<Array<RunEntry & { blocked: boolean }>> {
    return (await this.listRuns()).map((r) => ({ ...r, blocked: isBlocked(r.summary) }))
  }
  kaizenPatterns(jsonl: string): ReturnType<typeof recurrentPatterns> {
    return recurrentPatterns(parseJsonl(jsonl))
  }

  // --- Graphe 3D / brain (données réelles disque) ---
  listBrains(): BrainGraphRef[] {
    return scanBrainGraphs()
  }
  loadBrainGraph(
    path: string,
    lod?: number,
    community?: number
  ): ReturnType<typeof loadBrainGraph> {
    const key = `${path}\u0000${lod ?? 300}\u0000${community ?? ''}`
    const cached = this.brainGraphCache.get(key)
    if (cached) return cached
    const graph = loadBrainGraph(path, lod, community)
    this.brainGraphCache.set(key, graph)
    return graph
  }
  loadBrainNeighborhood(path: string, nodeId: string): ReturnType<typeof loadBrainNeighborhood> {
    const key = `${path}\u0000neighbourhood\u0000${nodeId}`
    const cached = this.brainGraphCache.get(key)
    if (cached) return cached
    const graph = loadBrainNeighborhood(path, nodeId)
    this.brainGraphCache.set(key, graph)
    return graph
  }
  readNodeFile(path: string): ReturnType<typeof readNodeFile> {
    return readNodeFile(path)
  }
  searchBrain(path: string, query: string): ReturnType<typeof searchVaultBrainNotes> {
    return searchVaultBrainNotes(path, query)
  }
  listRuns(): Promise<RunEntry[]> {
    return scanRuns()
  }
}
