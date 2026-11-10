/**
 * Façade AutowinOS — câble ensemble les modules RÉELLEMENT utilisés en un seul
 * objet applicatif. Point d'intégration unique consommé par index.ts (IPC).
 * Principe : rien d'exposé ici n'est mort — chaque méthode a un appelant réel
 * (chat, orchestration, dashboards, graphe 3D).
 */
import { AgyAdapter } from '../providers/agy'
import { GrokAdapter } from '../providers/grok'
import { adaptateursServicesHttp } from '../providers/services-http'
import { Notification, app } from 'electron'
import { traduireCoeur } from '../consignes/textes-coeur'
import { fermerBureauCacheSiOuvert, racineScriptsHorsArchive } from '../bureau/hdesk-tv'
import { resolveAutomationInstanceMode } from './headless-instance'
import { interfaceVisible } from './startup-gate'
import { CoordinateursParDepot } from '../store/coordinateurs-par-depot'
import { cheminDuLivrableEntier, ecrireLivrableEntier } from '../runs/livrable-entier'
import { ProviderRegistry } from '../providers/registry'
import {
  assertDepotJetable,
  fournisseurFixtureOrchestration,
  retrieveBrainNeutre,
  rolesFixture,
  scenarioDemande
} from '../orchestration/fixture-orchestration'
import {
  claudeActiveAccountId,
  claudeCompteDuFil,
  claudeNomDuCompte,
  claudeAccountEnv
} from '../providers/claude-accounts'
import { ClaudeCliAdapter, dossierModAutowin } from '../providers/claude'
import { CodexAdapter } from '../providers/codex'
import type { Message } from '../providers/types'
import { CONSTITUTION } from '../consignes/constitution'
import { planProviderLogin, spawnLoginTerminal } from '../providers/provider-login'
import { RoleModelConfig, type Role, type RoleBinding, type ReasoningEffort } from '../profil/roles'
import {
  dynamicPrompt,
  issueDeDecision,
  profilEcraseLeCadrage,
  meriteUneDecision,
  readWorkflowDecision,
  type ModeDecision,
  type WorkflowDecision
} from '../workflow/workflow-dynamic'
import { noterAppelCourt, signalerPanneAppelCourt } from '../orchestration/petites-taches-trace'
import { loadRoleBindings, saveRoleBindings } from '../profil/role-store'
// fix-ok: refonte qualité (demande user « refais comme en fable ») — purge du mort, pas un blind-fix.
import { CostAggregator } from '../dashboards/cost'
import { lecteurVersionMod } from '../mods/empreinte-mod'
import { isBlocked } from '../dashboards/runs'
import { recurrentPatterns, parseJsonl } from '../dashboards/kaizen'
import { loadBrainGraph, scanBrainGraphs, type BrainGraphRef } from '../viz/fs-brains'
import {
  attachConversationIds,
  attachPublicationStates,
  runsRoot,
  scanRuns,
  scanRunsPourSnapshot,
  type RunEntry
} from '../dashboards/runs-scan'
import { convRunsRoot } from '../runs/conv-runs'
import { ConversationStore } from '../store/conversations'
import { TrustLedger } from '../trust/ledger'
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
} from '../orchestration/orchestrator'
import { resolveVerifyReplayConfig } from '../hooks/verify-replay-config'
import { buildOrchestratorDecomposer } from '../orchestration/greedy-decompose'
import {
  captureCloseBaseline,
  type CloseBaseline,
  closeGreenRunOnDisk,
  projectPublicationNeedsRetry,
  type AutoCloseReport,
  type VerificationAvantPublication
} from '../runs/run-autoclose'
import { publierTourDeChat, type ChatTurnStart } from '../chat/chat-turn-publication'
import { estUnPassageDePorte } from '../orchestration/garder-un-essai'
import type { TypageAvantPublication } from '../verify/typage-avant-publication'
import { sharedBrainRoot } from '../brain/brain-context'
import { brainEstUnDepot } from '../brain/brain-paths'
import { regimePhases } from '../orchestration/task-regime'
import { etapeDesactiveeDansLesReglages } from '../orchestration/etapes-desactivees'
import type { NodePhase } from '../skills/skill-pipeline'
import {
  clearOrchestrationState,
  DatesDesCheckpoints,
  marquerCheckpointCoupeParQuota,
  loadOrchestrationState,
  loadOrchestrationStates,
  pickOrchestrationsToResume,
  pickOrchestrationToResume,
  pickAcquiredAnalysis,
  pickResumeForTask,
  saveOrchestrationAgentCheckpointAsync,
  saveOrchestrationState,
  saveOrchestrationStateAsync,
  suppressOrchestrationPipeline,
  type OrchestrationRunState
} from '../runs/orchestration-state'
import { defaultBehaviourWorkspace } from '../behaviour/behaviour-files'
import { defaultProcessIdentity, WorktreeManager } from '../store/worktree-manager'
import { RunWorktreeCoordinator } from '../store/run-worktree-coordinator'
import { surveillerReferencesGit } from '../store/surveillance-references-git'
import type { RunLifecycleEvent } from '../../shared/run-execution'
import { WorktreeRunStateStore } from '../store/worktree-run-state'
import { racineDesCopiesDeTaches } from '../copies/chemins-de-copies'
import type { WatchdogMutationClaimsSink } from '../task-manager/types'
import type { WatchdogMutationClaims } from '../task-manager/types'
import { preparedCommitMutationEvidence } from '../providers/workspace-mutation-evidence'
import {
  appendExecutionEvidenceFileTrace,
  readRecentConversationFileTraces
} from '../activity/conversation-file-trace-spool'
import { repositoryWorktreeIdentity } from '../store/worktree-repository'
import type {
  WorktreeAgentActivity,
  WorktreeConflictDiffResult,
  WorktreeConflictResolutionChoice,
  WorktreeConflictResolutionResult,
  WorktreeRuntimeStatus
} from '../../shared/worktree-activity-model'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { sansThinkPerime } from '../consignes/think-briefing'
import { workflowSansScoutPourSelection } from '../scout/selection-sans-scout'
import { ensureAutowinAppData } from './app-data'
import {
  loadAutoClose,
  loadGitApresFil,
  loadLastAutoCloseReport,
  saveAutoClose,
  saveGitApresFil,
  saveLastAutoCloseReport
} from '../runs/autoclose-store'
import { AUTOWIN_WORKSPACE_ENV, AUTOWIN_WORKSPACE_ORIGIN_ENV } from '../../shared/app-identity'
import type { RapportRetention } from '../../shared/rapport-retention'
import { PublicationARejouer } from '../../shared/echec-publication'
import { annonceRefusDuProjet } from '../chat/annonce-commit-local'
import {
  ExecutionSupervisor,
  type ExecutionUsageSnapshot
} from '../orchestration/execution-supervisor'
import { compileExecutionQuote } from '../orchestration/execution-quote'
import { DEFAULT_ORCHESTRATION_BUDGET } from '../orchestration/orchestration-budget'
import { applyWorkflowProfile } from '../workflow/workflow-profile-apply'
import { graphOf, loadWorkflowProfiles, type WorkflowProfile } from '../workflow/workflow-profiles'
import {
  loadWorkflowSelections,
  refusExplicite,
  workflowForConversation
} from '../workflow/workflow-selection'
import {
  preparePersistedRunForRelaunch,
  terminalizeInterruptedPersistedRun,
  type InterruptedTerminalizationProbes,
  type ProcessIdentity,
  type RecoveredDetachedUsageSettlement
} from '../runs/run-reattach'
import { preparerCopie } from './scripts-copie-main'
import {
  cleDepot,
  noterPistesScout,
  noterChoixScout,
  bilanDesChoix,
  facteursDesChoix,
  pistesDejaConnues,
  titresStockVeilleAutowin,
  type ClasseResultatRun,
  type LecteurResultatRun
} from '../scout/scout-memoire'
import { sujetsDejaFaits } from '../scout/scout-plafond'
import type { LanceurCommandeSkill } from '../skills/skill-node-tools'
import {
  executionWorkspacePreferenceFile,
  readExecutionWorkspacePreference
} from '../orchestration/execution-workspace-preference'

interface ExecutionWorkspaceInput {
  cwd?: string
  execPath?: string
  configured?: string
  /** Fichier du choix fait depuis l'interface — injectable pour les tests. */
  preferenceFile?: string
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
  // Le dossier CHOISI depuis l'interface passe avant toute detection : c'est une decision
  // explicite de l'utilisateur. Absent ou disparu -> les replis d'avant, inchanges.
  const chosen = readExecutionWorkspacePreference(
    input.preferenceFile ?? executionWorkspacePreferenceFile()
  )
  if (chosen) return chosen
  const cwdWorkspace = gitWorkspaceFrom(input.cwd ?? process.cwd())
  if (cwdWorkspace) return cwdWorkspace
  const executableWorkspace = gitWorkspaceFrom(dirname(input.execPath ?? process.execPath))
  if (executableWorkspace) return executableWorkspace
  return defaultBehaviourWorkspace()
}

/**
 * Le texte de la bulle d'un travail abandonné, dans la langue réglée (lot 18). Sorti de
 * `onAbandon` pour être testé sans Electron (`textes-coeur.branchement.test.ts`).
 */
export function contenuDeNotificationDAbandon(info: { runId: string; tache?: string }): {
  title: string
  body: string
} {
  return {
    title: traduireCoeur('abandon.titre'),
    body: info.tache
      ? traduireCoeur('abandon.corps', { tache: info.tache.slice(0, 120) })
      : traduireCoeur('abandon.corpsRun', { run: info.runId })
  }
}

const abandonsEnAttente: { runId: string; tache?: string }[] = []

/**
 * UNE bulle pour plusieurs abandons (2026-11-03) : une même réconciliation en abandonne
 * souvent plusieurs d'un coup — 5 runs à la même seconde (15:47:47) ont sonné 5 bulles, vécu comme
 * du spam. Un seul abandon garde le texte d'origine.
 */
export function contenuDeNotificationDAbandons(infos: { runId: string; tache?: string }[]): {
  title: string
  body: string
} {
  if (infos.length === 1) return contenuDeNotificationDAbandon(infos[0])
  const noms = infos.map((i) => (i.tache ?? i.runId).slice(0, 40))
  return {
    title: traduireCoeur('abandon.titrePlusieurs', { n: String(infos.length) }),
    body: traduireCoeur('abandon.corpsPlusieurs', { taches: noms.join(' · ').slice(0, 200) })
  }
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

export function selectPhaseFanOut(fanOut: FanOutTopology, phase: NodePhase): FanMember[] {
  return phase === 'scout' || phase === 'frame' || phase === 'terrain' ? fanOut[phase] : []
}

/**
 * UN appel de la décision de workflow, tracé dans `cost.jsonl`. `choisir` part sur le
 * modèle des petites tâches, `composer` sur celui du chat. Best-effort : une panne rend « aucun »,
 * comme avant, mais elle est désormais NOMMÉE au lieu d'être avalée.
 *
 * `conversationId` : le fil du run. Sans lui, mesuré le 2026-11-02, les 53 lignes
 * `choixWorkflow` de `cost.jsonl` étaient orphelines et le coût affiché par fil les oubliait.
 */
async function demanderDecisionWorkflow(
  os: Pick<AutowinOS, 'registry' | 'cost'>,
  task: string,
  profiles: WorkflowProfile[],
  mode: ModeDecision,
  binding: RoleBinding,
  conversationId?: string
): Promise<WorkflowDecision> {
  const appel = mode === 'choisir' ? 'choixWorkflow' : 'compositionWorkflow'
  if (!binding.provider) return { kind: 'none', reason: 'aucun modèle réglé' }
  let res: Awaited<ReturnType<ProviderRegistry['send']>>
  try {
    res = await os.registry.send(
      binding.provider,
      [{ role: 'user', content: dynamicPrompt(task, profiles, mode) }],
      { model: binding.model, reasoningEffort: binding.reasoningEffort }
    )
  } catch (error) {
    signalerPanneAppelCourt(appel, error)
    return { kind: 'none', reason: 'panne du modèle' }
  }
  const decision = readWorkflowDecision(res.text ?? '', profiles, mode)
  noterAppelCourt(os.cost, {
    appel,
    ...(mode === 'composer' ? { role: 'orchestrator' } : {}),
    binding,
    res,
    issue: issueDeDecision(decision),
    conversationId
  })
  return decision
}

/** Noyau applicatif : une instance partagée, injectée dans les handlers IPC. */
export class AutowinOS {
  private readonly brainGraphCache = new Map<string, ReturnType<typeof loadBrainGraph>>()
  readonly registry: ProviderRegistry
  readonly executionSupervisor = new ExecutionSupervisor()
  readonly roles = new RoleModelConfig(loadRoleBindings()) // restaure la config persistée
  /**
   * Aucun plafond de coût depuis le retrait du réglage Budget (2026-10-23) : le
   * plafond USD n'est plus réglable, `budgetStatus()` rend donc `budget: null` et aucune alerte à
   * 80 % — honnête, puisqu'il n'y a plus de limite à approcher.
   */
  readonly cost = new CostAggregator(
    () => DEFAULT_ORCHESTRATION_BUDGET.maxUsd,
    join(ensureAutowinAppData(), 'cost.jsonl'),
    // Version du harnais sur chaque ligne de coût : coût d'une demande avant/après une modif du mod.
    lecteurVersionMod(() => dossierModAutowin([__dirname, process.cwd()]))
  )
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
  /**
   * Directives utilisateur en attente pour une conversation, branche par `index.ts` (qui possede la
   * file). Sans ce fournisseur, un run ne peut pas etre oriente : le pilote de chat est bloque dans
   * l'appel `orchestrate` et ne draine rien avant la fin.
   */
  directivesEnAttente?: (conversationId: string) => string[]
  /**
   * Environnement du Brain PERSO, branché par `index.ts` (`envDuBrainPerso`) ; absent = aucun Brain
   * perso, comme dans les tests. Branchement tardif plutôt qu'un appel direct ici : un test qui
   * construit l'OS ne doit pas aller lire le réglage réel du poste (2026-10-28).
   */
  brainPersoDuRun?: () => NodeJS.ProcessEnv | undefined
  /** Serveur du Brain perso injoignable pendant un run : `index.ts` tente de le démarrer. */
  brainPersoInjoignable?: () => void
  private readonly orchestratorDeps: OrchestratorDeps
  /**
   * Le workflow ACTIF de la vue Workflows (`index.ts`, `appliquerWorkflowActif`) : une VALEUR PAR
   * DÉFAUT, plus un forçage (choix de l'utilisateur, 2026-10-22). Il ne pilote un run que
   * si ni la conversation ni le choix automatique ne proposent de workflow (`poseConversationWorkflow`).
   * Avant, il passait avant tout : 39 démarrages sur 39 en source `manuel` dans `causal-trace/`, le
   * choix automatique ne tournait jamais. La confrontation qui imposait autrefois son workflow par ce
   * champ a été retirée (`workflow-run-override.ts`).
   */
  private workflowParDefaut?: WorkflowRunOverride
  setActiveWorkflow(workflow: WorkflowRunOverride | undefined): void {
    this.workflowParDefaut = workflow
  }

  /**
   * L'orchestrateur de CE run, avec SA closure de workflow.
   *
   * Extrait en fabrique pour deux raisons : c'est le point unique ou l'isolation entre conversations
   * est realisee, et c'est le seul endroit qu'un harnais doit remplacer pour tester le chemin sans
   * lancer un vrai orchestrateur.
   */
  protected orchestrateurPour(
    workflow?: WorkflowRunOverride,
    task = '',
    workspace?: string
  ): Orchestrator {
    // LE DOSSIER DU RUN, et non celui du DEMARRAGE (2026-09-17).
    // `orchestratorDeps.executionWorkspace` est fige a la construction de l'OS : il ne peut pas
    // savoir qu'une conversation est rangee sur un autre depot. L'appelant le resout par tour et
    // le passe ici ; un rangement absent ou inutilisable retombe sur le global, comme avant.
    // Le dépôt du run suit son dossier pour la copie et le décomposeur. La clôture d'un run vert, elle,
    // publie à la RACINE de ce dépôt, jamais dans une copie de travail. Sans ces éléments, un fil rangé
    // sur un autre dépôt lisait le sien, puis copiait et publiait dans le dossier principal.
    // fix-ok: cause localisée — `worktrees`, `decompose` et `closeGreenRun` étaient figés sur le dossier principal.
    const depot = workspace ?? this.executionWorkspace
    const racine = this.copiesParDepot
      ? this.copiesParDepot.depotPour(workspace)
      : this.executionWorkspace
    const deps = {
      ...this.orchestratorDeps,
      executionWorkspace: depot,
      worktrees: this.copiesParDepot ? this.copiesParDepot.pour(workspace) : this.worktrees,
      decompose: this.decomposeurPour(depot),
      // Hors de tout dépôt, rien ne se publie : le run n'a pas de racine où publier.
      closeGreenRun: racine ? this.fermetureDeRunPour(racine) : undefined
    }
    /*
     * FIXTURE D'ORCHESTRATION — on remplace le FOURNISSEUR, jamais le pipeline.
     *
     * Trois preuves hors-modèle observent l'orchestrateur (relance, outils d'un nœud skill,
     * propreté des bureaux) et coûtaient de vrais agents : elles sont donc restées manuelles,
     * c'est-à-dire jamais jouées. Ici, les phases, les juges et les portes restent les VRAIS ; seuls
     * l'appel au modèle et le contexte Brain deviennent constants. Cadrage complet :
     * `docs/fixture-orchestration-cadrage-2026-09-06.md`.
     *
     * `scenarioDemande` ignore le préfixe hors instance isolée : la porte n'existe pas ailleurs.
     */
    const scenario = scenarioDemande(task)
    if (scenario) {
      // Le depot verifie est celui ou le run va REELLEMENT travailler, pas le global.
      assertDepotJetable(deps.executionWorkspace)
      return new Orchestrator({
        ...deps,
        registry: new ProviderRegistry().register(fournisseurFixtureOrchestration(scenario)),
        // Les QUATRE rôles avec : sans eux, le premier rôle oublié rappelle un vrai fournisseur.
        roles: rolesFixture(),
        retrieveBrain: retrieveBrainNeutre,
        currentWorkflow: () => workflow
      })
    }
    return new Orchestrator({ ...deps, currentWorkflow: () => workflow })
  }

  /**
   * Le décompositeur d'un run lit le dépôt de CE run : un fil rangé sur un autre dépôt décompose
   * dans le sien, pas dans le dossier principal.
   */
  private decomposeurPour(depot: string): NonNullable<OrchestratorDeps['decompose']> {
    return buildOrchestratorDecomposer({
      registry: this.registry,
      roles: this.roles,
      cwd: depot,
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
          console.log(`[decompose] atomic (jugée non décomposable) — task="${task.slice(0, 120)}"`)
        } else {
          console.log(
            `[decompose] plan (${outcome.nodes.length} sous-tâches) — task="${task.slice(0, 120)}"`
          )
        }
      }
    })
  }

  /**
   * La clôture d'un run vert publie dans le dépôt où ce run a sa copie : un commit né dans la copie
   * d'un autre dépôt n'existe pas dans le dossier principal, le viser publierait au mauvais endroit.
   */
  private fermetureDeRunPour(depot: string): NonNullable<OrchestratorDeps['closeGreenRun']> {
    return {
      // Photo de l'arbre au démarrage : tout ce qui était déjà modifié n'appartient pas au run.
      begin: (runId) => {
        if (!this.autoClose) return
        this.closeBaselines.set(
          runId,
          captureCloseBaseline(depot, brainEstUnDepot() ? sharedBrainRoot() : undefined)
        )
      },
      close: async ({ runId, task, projectPublication }) => {
        const baselinePromise = this.closeBaselines.get(runId)
        this.closeBaselines.delete(runId)
        if (!this.autoClose || !baselinePromise) return
        this.lastAutoClose = await closeGreenRunOnDisk({
          runId,
          direct: true,
          task,
          projectRepo: depot,
          brainRepo: brainEstUnDepot() ? sharedBrainRoot() : undefined,
          baseline: await baselinePromise,
          projectPublication
        })
        // fix-ok: une erreur de texte seul ne laisse pas l'orchestrateur lire la raison du refus ;
        // l'erreur typée porte le compte rendu.
        if (projectPublication && projectPublicationNeedsRetry(this.lastAutoClose)) {
          throw new PublicationARejouer(this.lastAutoClose.project)
        }
        // Rendu à l'orchestrateur : l'annonce du commit dit ce qui a VRAIMENT été poussé, au lieu
        // de « non poussé » écrit en dur (2026-10-25).
        return this.lastAutoClose.project
      }
    }
  }

  private async poseConversationWorkflow(
    conversationId?: string,
    task?: string
  ): Promise<WorkflowRunOverride | undefined> {
    const selections = loadWorkflowSelections()
    // Un refus EXPLICITE se respecte : l'utilisateur a retiré le workflow de cette conversation, le
    // mode dynamique n'a pas à lui en réimposer un. C'est la différence entre proposer et forcer.
    // Le workflow actif de la vue ne le contourne pas non plus : ce n'est qu'une valeur par défaut.
    if (refusExplicite(selections, conversationId)) return undefined
    const profileId = workflowForConversation(selections, conversationId)
    // MODE DYNAMIQUE : l'utilisateur ne s'est JAMAIS prononcé → on demande au modèle lequel convient.
    // Il a le droit de répondre « aucun ». Le workflow actif de la vue n'est alors que le REPLI : il
    // ne passe plus avant ce choix (2026-10-22).
    if (!profileId) {
      const proposition = task ? await this.poseWorkflowDynamique(task, conversationId) : undefined
      if (proposition) return proposition
      // Le REPLI subit la même garde que le choix du modèle (2026-10-22) : un workflow
      // actif de réparation (« Correctif » : think, build, clean, judge) sur un symptôme dont la
      // cause est inconnue ferait sauter le cadrage. On rend alors la main au régime, qui le joue.
      const parDefaut = this.workflowParDefaut
      const phasesParDefaut =
        parDefaut?.graph?.nodes.map((node) => node.phase) ?? parDefaut?.phases ?? []
      if (profilEcraseLeCadrage(task ?? '', phasesParDefaut)) return undefined
      return parDefaut
    }
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
  private async poseWorkflowDynamique(
    task: string,
    conversationId?: string
  ): Promise<WorkflowRunOverride | undefined> {
    // Ne pas payer un appel de modèle pour apprendre qu'une demande de trois mots ne mérite rien.
    if (!meriteUneDecision(task)) return undefined
    const profiles = loadWorkflowProfiles().profiles
    // Le modèle des petites tâches (réglage du Routeur ; Haiku par défaut) CHOISIT dans
    // le catalogue. Il ne compose jamais : un « nouveau » repart sur le modèle du chat, seul à
    // écrire un graphe (`workflow-dynamic.ts`, ModeDecision).
    let decision = await demanderDecisionWorkflow(
      this,
      task,
      profiles,
      'choisir',
      this.roles.bindingDesPetitesTaches(),
      conversationId
    )
    if (decision.kind === 'a-composer') {
      decision = await demanderDecisionWorkflow(
        this,
        task,
        profiles,
        'composer',
        this.roles.getBinding('orchestrator'),
        conversationId
      )
    }
    if (decision.kind === 'none' || decision.kind === 'a-composer') return undefined
    if (decision.kind === 'existing') {
      const effectif = applyWorkflowProfile({ roles: {} }, decision.profile)
      // Un profil de REPARATION ne doit pas ecraser le cadrage quand la cause est inconnue : on rend
      // la main au regime, qui portait deja la bonne reponse (`workflow-dynamic.ts`, fonction dediee).
      const phasesDuProfil =
        graphOf(decision.profile)?.nodes.map((node) => node.phase) ?? effectif.phases ?? []
      if (profilEcraseLeCadrage(task, phasesDuProfil)) return undefined
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
    if (
      profilEcraseLeCadrage(
        task,
        decision.graph.nodes.map((node) => node.phase)
      )
    )
      return undefined
    return {
      identity: { name: decision.name, source: 'compose' },
      graph: decision.graph,
      instructionFor: () => undefined
    }
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
  /**
   * Le coordinateur du dépôt d'un run : `worktrees` pour le dossier principal, un autre pour un fil
   * rangé sur un autre dépôt. `worktrees` seul donnait à ce fil une copie du dossier principal.
   */
  private readonly copiesParDepot: CoordinateursParDepot<RunWorktreeCoordinator>
  /** Le gestionnaire de copies, pour les lectures qui n'orchestrent rien (retention). */
  readonly worktreeManager?: WorktreeManager
  private worktreeRuntimeStatus!: WorktreeRuntimeStatus
  private worktreeActivityListener?: (a: WorktreeAgentActivity[]) => void
  /** Prévenu quand un run vient d'être SUSPENDU par le quota (`reveil-apres-quota.ts`). */
  private murDeQuotaListener?: () => void
  private finDeRunListener?: (runId: string) => void
  private refusIntegrationListener?: (refus: {
    cause: string
    agentId: string
    files: readonly string[]
    tentative: number
    detail?: string
  }) => void
  private recoveredCausalClaimsListener?: WatchdogMutationClaimsSink
  private readonly pendingRecoveredCausalClaims: WatchdogMutationClaims[] = []
  private causalMemoryRetriever?: (conversationId: string) => string
  /** Le dernier résultat de chaque run, lu dans le journal de l'app (cf. `setResultatsDesRuns`). */
  private resultatsDesRuns?: () => ReadonlyMap<string, ClasseResultatRun>
  /** Outils Brain d'un noeud skill, branches apres creation du bus (cf. `setSkillCommandRunner`). */
  private skillCommandRunner?: LanceurCommandeSkill
  private outilsDuLot?: (
    conversationId: string,
    dossier?: string
  ) => LanceurCommandeSkill | undefined
  /** Dossier des états d'orchestration reprenables (survie niveau 3). */
  private readonly orchestrationStateRoot = join(ensureAutowinAppData(), 'run-state')
  /** Premier départ et dernière activité réelle de chaque run : la péremption de 36 h en dépend. */
  private readonly datesDesCheckpoints = new DatesDesCheckpoints()

  constructor() {
    // Le 3e argument separe le mur de quota PAR COMPTE : deux abonnements Claude distincts ne
    // partagent pas leur quota, donc l'epuisement de l'un ne doit pas fermer la porte a l'autre.
    // Les autres providers n'ont qu'un compte -> `undefined` -> cle = le provider, comme avant.
    this.registry = new ProviderRegistry(
      CONSTITUTION,
      this.executionSupervisor,
      (providerId) => (providerId === 'claude' ? claudeActiveAccountId() : undefined),
      // 4e argument : le compte CHOISI pour le fil de l'appel. Un refus de quota ne change jamais de
      // compte : le tour s'arrête et nomme celui qui est vide. Les autres providers rendent `undefined`.
      (providerId, fil) => (providerId === 'claude' ? claudeCompteDuFil(fil) : undefined),
      // 5e argument : le nom d'un compte, pour qu'un refus de quota dise QUEL compte est vide.
      (providerId, compte) => (providerId === 'claude' ? claudeNomDuCompte(compte) : undefined)
    )
      // Claude d'abord : il reste l'exécuteur par défaut (`executors[0]` du registre). ChatGPT se
      // choisit, il n'est jamais élu seul. Kimi et Gemini sont retirés : leurs adaptateurs n'existent
      // plus, donc jamais lancés, jamais sondés, jamais routés. Voir `routed-providers.ts`.
      .register(new ClaudeCliAdapter())
      .register(new CodexAdapter())
      // Gemini par l'abonnement Google : choisi à la main, jamais exécuteur par défaut.
      .register(new AgyAdapter())
      // Grok par l'abonnement SuperGrok, via le CLI officiel d'xAI.
      .register(new GrokAdapter())
    // Services HTTP sans CLI : après les deux CLI, donc jamais élus exécuteur par défaut.
    for (const adaptateur of adaptateursServicesHttp()) this.registry.register(adaptateur)
    const executionWorkspace = resolveExecutionWorkspace()
    this.executionWorkspace = executionWorkspace
    // Le workspace resolu est republie dans l'environnement pour que le TRANSPORT y ait acces sans
    // nouvelle dependance : c'est ce qui permet au tour de chat de LIRE le projet (Read/Grep/Glob en
    // lecture seule) au lieu d'etre aveugle et de devoir orchestrer pour repondre a une question.
    process.env[AUTOWIN_WORKSPACE_ENV] = executionWorkspace
    // ... et TRACE que cette valeur vient de nous. Le redemarrage transmet l'environnement au
    // processus suivant : sans ce marqueur, notre propre republication y passerait pour une consigne
    // de lanceur externe et gagnerait contre le dossier choisi dans les Reglages.
    process.env[AUTOWIN_WORKSPACE_ORIGIN_ENV] = 'resolved'
    // UN GESTIONNAIRE DE COPIES PAR DÉPÔT (`coordinateurs-par-depot.ts`) : celui du dossier principal est
    // ouvert ici ; celui d'un autre dépôt l'est au premier run d'un fil rangé dessus, par la même fabrique.
    const ouvrirLesCopiesDe = (
      depot: string
    ): { manager: WorktreeManager; coordinateur: RunWorktreeCoordinator; repoId: string } => {
      const identity = repositoryWorktreeIdentity(join(ensureAutowinAppData(), 'worktrees'), depot)
      // La racine unique des copies d'agent : les NOUVELLES copies y naissent ; celles d'avant restent
      // sous `worktrees` jusqu'à leur retrait, et se reprennent là où elles sont.
      const racineCopiesDeTaches = racineDesCopiesDeTaches(ensureAutowinAppData())
      const manager = new WorktreeManager({
        baseRepo: depot,
        worktreeRoot: identity.root,
        racineCopiesDeTaches, // fix-ok: le gestionnaire crée les copies sous la racine unique, la même que celle du store de l'état des runs.
        requireCanonicalRemote: true
      })
      const coordinateur = new RunWorktreeCoordinator({
        // Promesse d'attente FOURNIE ici, et seulement ici : en production ce constructeur tourne
        // au premier niveau du module principal, et énumérer les copies git bloquait ~25 s avant
        // qu'aucune fenêtre n'existe. La récupération n'a aucune urgence, l'affichage si. Les
        // tests, eux, gardent la réconciliation synchrone.
        //
        // MAIS elle n'est PAS toujours honorée, et le dire importe : quand les opérations sont
        // isolées, le coordinateur lance l'inventaire IMMÉDIATEMENT dans son worker et ignore
        // cette promesse (`run-worktree-coordinator.ts:190-194`) — le thread principal n'est pas
        // bloqué pour autant, c'est l'autre moitié de la même correction. L'attente ci-dessous ne
        // sert donc que la branche NON isolée (`:211`). Le commentaire précédent disait « la
        // réconciliation est REPORTÉE ici » sans cette réserve, et un agent de cadrage l'a cru :
        // il a bâti un besoin sur un ordonnancement inexistant, que le juge a réfuté en citant
        // exactement ces lignes (2026-08-19). Un commentaire trop affirmatif se paie en diagnostic.
        deferRecoveryUntil: interfaceVisible,
        // `app?.` : hors d'Electron (bancs de test), `app` n'existe pas ; le `try` autour avalerait
        // l'erreur et l'app partirait sans aucune copie isolée (e2e-chaine).
        sansRecuperation: resolveAutomationInstanceMode(
          process.argv,
          process.env,
          app?.isPackaged === true
        ).isolated,
        manager,
        // La liste des travaux non publiés suit le dépôt, même touché en ligne de commande
        // Sans lire git, seulement les fichiers de références sous `.git`.
        surveillerReferences: (siChange) => surveillerReferencesGit(depot, siChange),
        // fix-ok: le store et le gestionnaire reçoivent la même racine, pour qu'une copie neuve naisse et soit relue au même endroit.
        stateStore: new WorktreeRunStateStore(identity.root, identity.repoId, {
          racineCopiesDeTaches
        }),
        /**
         * PREVENIR quand un travail est abandonne. Verifie le 2026-08-23 : l'application ne
         * comportait AUCUNE notification -- un travail fini pouvait mourir en silence, et trois
         * l'ont fait le meme jour. On sonne sur l'ABANDON seulement, jamais sur un refus
         * ordinaire : 1649 refus sont traces, en notifier une fraction noierait le signal.
         */
        /*
         * SCRIPTS DE COPIE (2026-09-28) : fichiers locaux et préparation déclarés dans
         * `.autowin/scripts.json` du dépôt, joués à la création de chaque copie d'agent. Voir
         * `scripts-copie-main.ts` ; rien de déclaré = rien de joué, aucune ligne de trace.
         */
        preparerCopie: async (copie, signaler) =>
          (
            await preparerCopie(
              { depot: copie.depot, chemin: copie.chemin, nom: copie.runId },
              { auDebut: signaler }
            )
          )?.resume,
        onAbandon: ({ tache, runId }) => {
          // Regroupés sur 2 s : une réconciliation abandonne ses runs dans la même boucle.
          abandonsEnAttente.push({ tache, runId })
          if (abandonsEnAttente.length > 1) return
          setTimeout(() => {
            const lot = abandonsEnAttente.splice(0)
            try {
              if (!Notification.isSupported()) return
              new Notification(contenuDeNotificationDAbandons(lot)).show()
            } catch {
              // Une notification qui echoue ne doit jamais faire tomber la reconciliation.
            }
          }, 2000)
        },
        onRecoveredPublication: async (publication) => {
          // Un passage de porte fait entrer le travail d'un fil dans main LOCAL, sans plus : l'envoi
          // vers le distant reste celui de la publication après le fil, jamais un effet de la porte.
          // fix-ok: cause mesurée — `endAsync({ merge: true })` sans `onPublished` appelle ce rappel
          // (`runId: porte-conv-1-x`, coordinateur et WorktreeManager réels), qui poussait main.
          if (this.autoClose && !estUnPassageDePorte(publication.runId)) {
            const rapport = await closeGreenRunOnDisk({
              runId: publication.runId,
              direct: true,
              task: publication.task ?? 'Run récupéré',
              projectRepo: depot,
              brainRepo: brainEstUnDepot() ? sharedBrainRoot() : undefined,
              projectPublication: {
                baseSha: publication.baseSha,
                publishedSha: publication.agentSha
              },
              recoveredWithoutBrainBaseline: true
            })
            this.lastAutoClose = rapport
            // La réponse du run est déjà partie : le refus, s'il y en a un, va dans le fil lui-même.
            if (publication.conversationId)
              annonceRefusDuProjet(this.conversations, publication.conversationId, rapport.project)
            if (projectPublicationNeedsRetry(rapport)) {
              throw new PublicationARejouer(rapport.project)
            }
          }
          const evidence = preparedCommitMutationEvidence(
            depot,
            publication.baseSha,
            publication.agentSha,
            publication.causalWatchPaths
          )
          const publicationEventId = `worktree-publication:${publication.runId}:${publication.agentSha}`
          if (publication.conversationId && publication.turnId && evidence.length > 0) {
            appendExecutionEvidenceFileTrace(evidence, {
              conversationId: publication.conversationId,
              turnId: publication.turnId,
              workspaceRoot: depot,
              published: true,
              eventId: publicationEventId
            })
          }
          const claims = {
            ...watchdogClaimsFromEvidence(evidence, depot),
            eventId: publicationEventId
          }
          if (Object.keys(claims.mutatedLineFingerprints ?? {}).length === 0) return
          if (this.recoveredCausalClaimsListener) this.recoveredCausalClaimsListener(claims)
          else this.pendingRecoveredCausalClaims.push(claims)
        },
        onActivity: (a) => {
          // Plusieurs dépôts ouverts : l'écran reçoit l'activité de tous, pas celle du seul émetteur.
          this.worktreeActivityListener?.(
            this.copiesParDepot?.plusieurs() ? this.getWorktreeActivity() : a
          )
        },
        onRefusIntegration: (refus) => {
          this.refusIntegrationListener?.(refus)
        }
      })
      return { manager, coordinateur, repoId: identity.repoId }
    }
    // Garde : `git worktree` exige un vrai repo. Absent (.git manquant) → pas d'isolation (undefined).
    if (existsSync(join(executionWorkspace, '.git'))) {
      try {
        const ouvert = ouvrirLesCopiesDe(executionWorkspace)
        // Le manager est EXPOSE a part : la retention LIT, le coordinateur ORCHESTRE.
        ;(this as { worktreeManager?: WorktreeManager }).worktreeManager = ouvert.manager
        this.worktrees = ouvert.coordinateur
        this.worktreeRuntimeStatus = {
          available: true,
          workspacePath: executionWorkspace,
          repoId: ouvert.repoId
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
    this.copiesParDepot = new CoordinateursParDepot<RunWorktreeCoordinator>(
      { depot: executionWorkspace, coordinateur: () => this.worktrees },
      (depot) => {
        try {
          return ouvrirLesCopiesDe(depot).coordinateur
        } catch {
          // Dépôt dont l'identité ne se lit pas : aucun gestionnaire, le run le dira (« Isolation bloquée »).
          return undefined
        }
      }
    )
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
      // Pistes deja proposees par les scouts precedents (`scout-memoire.ts`). Le stock de la veille ne
      // vaut que pour le depot que la veille analyse : `executionWorkspace` (`index.ts`, `racineDepot`).
      // fix-ok: sans ce branchement, `memoireScout` restait vide en production : le test au site d'appel
      // (orchestrator.scout-cible.test.ts) tombe quand la memoire n'est plus lue.
      memoireScout: {
        connues: (depot, sauf, demande) =>
          pistesDejaConnues({
            depot,
            sauf,
            demande,
            stockVeille:
              cleDepot(depot) === cleDepot(executionWorkspace) ? titresStockVeilleAutowin() : []
          }),
        noter: (depot, texteScout, run) =>
          noterPistesScout({ depot, texte: texteScout, run, maintenant: new Date().toISOString() }),
        choisir: (depot, demande, run) =>
          noterChoixScout({ depot, demande, run, maintenant: new Date().toISOString() }),
        bilan: (depot) => bilanDesChoix({ depot, resultatDuRun: this.lecteurResultatRun() }),
        // fix-ok: sans cette ligne, la note ajustee sur les choix reels restait vide en production.
        facteurs: (depot) => facteursDesChoix({ depot }),
        // Piste 4 : commits recents et pistes deja livrees, pour la marque « deja fait ? ».
        dejaFaits: (depot) => sujetsDejaFaits({ depot, resultatDuRun: this.lecteurResultatRun() })
      },
      // Lue A CHAQUE phase, comme `skillCommands` : le fournisseur est branche par `index.ts` apres
      // construction, et une valeur figee ici resterait vide.
      drainDirectives: (conversationId) => this.directivesEnAttente?.(conversationId) ?? [],
      // BRAIN PERSO : relu à chaque run, même branchement tardif que `drainDirectives`.
      brainPerso: () => this.brainPersoDuRun?.(),
      persoInjoignable: () => this.brainPersoInjoignable?.(),
      // Fin de run : ferme le bureau cache du run s'il a ete ouvert (lot 1). Le chemin des
      // scripts n'est lu qu'a ce moment-la : rien ne change au demarrage.
      fermerBureauCache: (demande) =>
        fermerBureauCacheSiOuvert(racineScriptsHorsArchive(app.getAppPath()), demande),
      // Lue A CHAQUE phase, pas figee ici : le bus de commandes n'existe pas encore a cet instant.
      skillCommands: () => this.skillCommandRunner,
      outilsDuLot: (conversationId, dossier) => this.outilsDuLot?.(conversationId, dossier),
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
      // L'interrupteur de Settings › Skills, relu à chaque run : une étape désactivée ne se joue
      // plus.
      etapeDesactivee: etapeDesactiveeDansLesReglages,
      currentExecutionQuote: () => this.executionSupervisor.currentQuote(),
      currentExecutionUsage: () => this.executionSupervisor.currentSnapshot(),
      // Workflow nommé actif — posé le temps d'un run par la confrontation de workflows, absent le
      // reste du temps. Même portée ambiante que le devis ci-dessus.
      // Remplacé PAR RUN dans `runTask` : ici c'est le défaut inerte, pas la vraie source.
      currentWorkflow: () => undefined,
      // La copie ENTIERE des sorties d'etapes, que nomme la marque de coupe du juge. Le
      // checkpoint ci-dessous est efface a la cloture ; celle-ci reste (`runs/livrable-entier.ts`).
      cheminDuLivrableEntier: (runId) => cheminDuLivrableEntier(runId),
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
      }) => {
        // Differee comme le checkpoint : une copie non ecrite ne coute qu'une marque qui pointe dans
        // le vide, jamais un run casse.
        void ecrireLivrableEntier(runId, phaseOutputs).catch(() => undefined)
        // ECRITURE DIFFEREE, mesuree : ce checkpoint bloquait 21,6 s de fil principal le 2026-09-04
        // (`gels.jsonl`, pointes a 10 s pour un rename de 173 Ko). Atomicite et ordre preserves.
        void saveOrchestrationStateAsync(this.orchestrationStateRoot, {
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
          ...this.datesDesCheckpoints.pourEcriture(runId, Date.now())
        })
      },
      onAgentsChanged: (runId, agents) => {
        saveOrchestrationAgentCheckpointAsync(
          this.orchestrationStateRoot,
          runId,
          agents,
          this.executionSupervisor.currentSnapshot()
        )
      },
      onRunSettled: (runId) => {
        this.datesDesCheckpoints.oublier(runId)
        clearOrchestrationState(this.orchestrationStateRoot, runId)
        // « Publication auto » relit les travaux d'agents restés hors de la branche.
        this.finDeRunListener?.(runId)
      },
      // Mur de quota : l'état reprenable est GARDÉ et marqué, jamais effacé (`orchestrator.ts`).
      onRunQuotaWalled: (runId, mur, regle) => {
        const racine = this.orchestrationStateRoot
        void marquerCheckpointCoupeParQuota(racine, runId, mur, regle)
          // Agents et consommation incohérents entre eux : on pose au moins le refus et l'heure. Le
          // verrou éventuellement resté sur le disque sera réconcilié à la relance, comme après un
          // crash (`reconcileResumableOrchestrationForRelaunch`).
          .catch(() => marquerCheckpointCoupeParQuota(racine, runId, mur))
          .catch((erreur: unknown) =>
            console.warn('[orchestration] mur de quota non noté sur le checkpoint', runId, erreur)
          )
          // APRÈS l'écriture : le réveil relit l'heure de retour sur le disque.
          .then(() => this.murDeQuotaListener?.())
      },
      // Fan-out multi-modèles : les blocs topology scout/frame/terrain → phases composées ; judge → juges.
      // ≥2 modèles déposés → l'orchestrateur duplique + agrège (voir orchestrator.ts). Sinon mono.
      phaseFanOut: (phase) => selectPhaseFanOut(this.fanOut, phase),
      judgeFanOut: () => this.fanOut.judge,
      // Fonctionnement NORMAL : on décompose systématiquement via le modèle orchestrateur (best-effort
      // → [] pour une tâche atomique = fallback séquentiel naturel). Pas de « mode » à activer.
      decompose: this.decomposeurPour(executionWorkspace),
      // Clôture d'un run VERT : publication sur une branche dédiée (jamais main), côté projet puis
      // Brain. OFF par défaut — tant que l'utilisateur ne l'a pas activée, rien n'est publié tout seul.
      closeGreenRun: this.fermetureDeRunPour(executionWorkspace)
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
  /**
   * Dernier résultat de clôture — remonté à l'UI pour dire ce qui a réellement été publié, ou
   * pourquoi rien ne l'a été. PERSISTÉ et relu au démarrage : le 2026-10-01, le motif du
   * non-commit du tour 235b91bd a disparu au redémarrage, faute d'exister ailleurs qu'en mémoire.
   */
  private dernierRapport: AutoCloseReport | undefined = loadLastAutoCloseReport()
  private get lastAutoClose(): AutoCloseReport | undefined {
    return this.dernierRapport
  }
  private set lastAutoClose(report: AutoCloseReport | undefined) {
    this.dernierRapport = report
    if (report && !saveLastAutoCloseReport(report)) {
      console.warn(
        '[cloture auto] dernier rapport non persisté : il ne survivra pas au redémarrage'
      )
    }
  }

  setAutoClose(enabled: boolean): void {
    if (!saveAutoClose(enabled)) {
      throw new Error('Impossible de persister le réglage de clôture automatique.')
    }
    this.autoClose = enabled
  }
  getAutoClose(): { enabled: boolean; gitApresFil: boolean; last?: AutoCloseReport } {
    return {
      enabled: this.autoClose,
      gitApresFil: this.gitApresFil,
      ...(this.lastAutoClose ? { last: this.lastAutoClose } : {})
    }
  }

  /** « Publier les fils finis » (voir git-apres-fil.ts) : éteint tant qu'on ne l'allume pas. */
  private gitApresFil = loadGitApresFil()

  setGitApresFil(enabled: boolean): void {
    if (!saveGitApresFil(enabled)) {
      throw new Error('Impossible de persister le réglage « Publier les fils finis ».')
    }
    this.gitApresFil = enabled
  }

  /** Relu à chaque fin de tour : l'éteindre pendant un tour suffit à ne rien lancer. */
  gitApresFilActif(): boolean {
    return this.gitApresFil
  }

  /** Lu au DÉPART d'un tour de chat : la photo de l'arbre n'est prise que si l'enchaînement est actif. */
  autoCloseEnabled(): boolean {
    return this.autoClose
  }

  /** Une publication de tour de chat à la fois, dans l'ordre des tours : git n'aime pas le parallèle. */
  private chatTurnPublications: Promise<unknown> = Promise.resolve()

  /**
   * Enchaînement auto d'un tour de chat TERMINÉ (voir `chat-turn-publication.ts`). Relit l'interrupteur
   * au moment de publier : le désactiver pendant le tour suffit à ne rien pousser.
   */
  publishChatTurn(input: {
    conversationId: string
    turnId: string
    request: string
    /** Texte final du tour : son « ✅ Fait » titre le commit. */
    compteRendu?: string
    debut: ChatTurnStart
    /** Dossiers de travail des tours d'AUTRES fils en cours, relus au moment de publier. */
    autresToursEnCours?: () => readonly string[]
    /** Tests des fichiers du tour, rejoués AVANT de pousser (voir `chat-turn-publication.ts`). */
    verifierAvantPublication?: (
      repo: string,
      fichiers: readonly string[]
    ) => Promise<VerificationAvantPublication>
    /** Typage de ce qui part, joué AVANT les tests (voir `typage-avant-publication.ts`). */
    typerAvantPublication?: (
      repo: string,
      fichiers: readonly string[]
    ) => Promise<TypageAvantPublication>
  }): Promise<AutoCloseReport | undefined> {
    const { autresToursEnCours, ...tour } = input
    const next = this.chatTurnPublications.then(async () => {
      if (!this.autoClose) return undefined
      // Relevé AVANT la lecture du journal : un tour fini entre les deux y a déjà tout écrit.
      const enCours = autresToursEnCours?.() ?? []
      const worktrees = this.worktrees
      // Le dépôt de la porte est celui DU FIL, noté sur sa copie : un projet lié ou un autre dépôt git ne se devine
      // pas dans sa copie. Le dépôt d'Autowin ne sert que de repli, pour un fil qui n'a pas de copie notée.
      // fix-ok: sans le dépôt du fil, la porte viserait Autowin et le travail d'un projet lié n'entrerait pas dans sa branche.
      const depot =
        this.conversations.get(tour.conversationId)?.copieDuFil?.depot ??
        this.worktreeManager?.baseRepo
      const report = await publierTourDeChat({
        ...tour,
        autresToursEnCours: enCours,
        traces: await readRecentConversationFileTraces(),
        // La porte d'un fil en copie : la publication d'une copie, la même que « Garder ».
        ...(worktrees && depot
          ? {
              porte: {
                depot,
                publication: {
                  ouvrir: (runId: string) =>
                    worktrees.beginAsync(runId, 'Porte du fil', true, {
                      task: `porte du fil ${tour.conversationId}`,
                      role: 'command',
                      conversationId: tour.conversationId
                    }),
                  fermer: (runId: string, publier: boolean) =>
                    worktrees.endAsync(runId, { merge: publier })
                },
                // la porte reçoit le dossier de données, sans quoi la racine unique n'entre jamais par la primitive.
                dossierDeDonnees: ensureAutowinAppData()
              }
            }
          : {})
      })
      if (report) {
        this.lastAutoClose = report
        // fix-ok: seul le panneau Git recevait le refus d'un tour ; l'écriture dans le fil n'existait
        // qu'à la reprise au démarrage. Le refus d'un tour va désormais dans le fil de ce tour.
        annonceRefusDuProjet(this.conversations, tour.conversationId, report.project)
        // Le panneau ne garde que le DERNIER rapport : le journal garde chaque issue, motif compris.
        const laisses = (report.exclus ?? []).map((e) => `${e.path} (${e.motif})`).join(', ')
        console.log(
          '[enchainement chat]',
          report.runId,
          '→',
          JSON.stringify(report.project).slice(0, 400),
          laisses ? `; laissés en attente : ${laisses}` : ''
        )
        // Même signal que la fin d'une tâche d'agent : le panneau Git relit le dernier rapport.
        this.worktreeActivityListener?.(this.getWorktreeActivity())
      }
      return report
    })
    this.chatTurnPublications = next.catch(() => undefined)
    return next
  }

  /** Met à jour la source live du fan-out (appelé par la topology au boot et à chaque changement). */
  setFanOut(next: FanOutTopology): void {
    this.fanOut = next
  }

  /**
   * Branche les outils Brain des noeuds SKILL, apres creation du bus de commandes.
   *
   * Sans cet appel, un noeud `think` ou `learn` s'execute SANS outil : il decrit ce qu'il ferait au
   * lieu de le faire. C'est precisement le cablage manquant que ce run corrige — la dependance
   * existait deja, declaree et jamais branchee.
   */
  setSkillCommandRunner(runner: LanceurCommandeSkill): void {
    this.skillCommandRunner = runner
  }

  /** Branche l'outil des étapes d'un run de lot, une fois le coordinateur des plans créé. */
  setOutilsDuLot(
    outils: (conversationId: string, dossier?: string) => LanceurCommandeSkill | undefined
  ): void {
    this.outilsDuLot = outils
  }

  /**
   * Branche la lecture des résultats de runs (journal `outcome-learning`, construit dans le point
   * d'entrée) : la mémoire du scout y relit ce que sont devenues les pistes prises (piste 1).
   */
  setResultatsDesRuns(lecteur: () => ReadonlyMap<string, ClasseResultatRun>): void {
    this.resultatsDesRuns = lecteur
  }

  /** Une lecture du journal par appel ; non branché → `undefined`, le bilan se tait sur la livraison. */
  private lecteurResultatRun(): LecteurResultatRun | undefined {
    const resultats = this.resultatsDesRuns?.()
    return resultats ? (run) => resultats.get(run) : undefined
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
  /** Tous les travaux termines mais jamais publies, avec leurs fichiers. Lecture seule. */
  travauxNonPublies(): Array<{
    agentId: string
    date: string
    fichiers: string[]
    /** VRAI quand `fichiers` est l'echo d'une lecture ratee, pas une constatation de vide. */
    lectureEchouee?: boolean
  }> {
    return this.worktrees?.travauxNonPublies() ?? []
  }

  /** La meme liste, calculee HORS du thread qui dessine la fenetre. Lecture seule. */
  async travauxNonPubliesAsync(): Promise<
    Array<{ agentId: string; date: string; fichiers: string[] }>
  > {
    return (await this.worktrees?.travauxNonPubliesAsync?.()) ?? this.travauxNonPublies()
  }

  /** La version BORNEE et CACHEE, pour les chemins chauds (`get_state`). Lecture seule. */
  travauxNonPubliesBornes(): Array<{ agentId: string; date: string; fichiers: string[] }> {
    return this.worktrees?.travauxNonPubliesBornes?.() ?? []
  }

  /** Le patch d'un de ces travaux, pour le lire avant d'en decider. Lecture seule. */
  patchTravailNonPublie(agentId: string): { patch: string; tronque: boolean } {
    return this.worktrees?.patchTravailNonPublie(agentId) ?? { patch: '', tronque: false }
  }

  /**
   * LE DERNIER RAPPORT DU BALAYAGE DE RETENTION, garde en memoire pour la fenetre.
   *
   * Le balayage horaire ecrivait son verdict dans `console.info` — donc dans un terminal que
   * l'utilisateur de l'application ne regarde pas. Un rapport qu'il faut savoir ou chercher est un
   * rapport que personne ne lit : les quatorze travaux du 2026-08-24 ont dormi pour cette raison
   * exacte. On garde donc le DERNIER plan ici, et l'interface vient le lire.
   *
   * `undefined` tant qu'aucune passe n'a eu lieu — a distinguer d'un plan vide, qui lui affirme
   * que le stock est sain.
   */
  private dernierRapportRetention?: RapportRetention

  /** Appele par la passe horaire. Ecrase le precedent : seul le dernier etat a un sens. */
  poserRapportRetention(rapport: RapportRetention): void {
    this.dernierRapportRetention = rapport
  }

  /** Lecture seule, pour l'IPC. `undefined` = aucune passe encore faite. */
  rapportRetention(): RapportRetention | undefined {
    return this.dernierRapportRetention
  }

  getWorktreeActivity(): WorktreeAgentActivity[] {
    return this.tousLesCoordinateurs().flatMap((coordinateur) => coordinateur.activity())
  }

  /** Les coordinateurs ouverts, tous dépôts confondus (un objet monté sans constructeur n'a que le principal). */
  private tousLesCoordinateurs(): RunWorktreeCoordinator[] {
    return this.copiesParDepot?.tous() ?? (this.worktrees ? [this.worktrees] : [])
  }

  /** Le coordinateur qui suit cet agent : celui de son dépôt, sinon celui du dossier principal. */
  private coordinateurDe(agentId: string): RunWorktreeCoordinator | undefined {
    return (
      this.tousLesCoordinateurs().find((coordinateur) =>
        coordinateur.activity().some((activite) => activite.agentId === agentId)
      ) ?? this.worktrees
    )
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
    const coordinateur = this.coordinateurDe(agentId)
    return coordinateur
      ? coordinateur.conflictDiffAsync(agentId)
      : { available: false, reason: 'not-conflict' }
  }

  async resolveWorktreeConflict(
    agentId: string,
    choice: WorktreeConflictResolutionChoice
  ): Promise<WorktreeConflictResolutionResult> {
    return (
      (await this.coordinateurDe(agentId)?.resolveConflictAsync(agentId, choice)) ?? {
        resolved: false,
        reason: 'unsupported'
      }
    )
  }

  async retryWorktreeRecovery(agentId: string): Promise<WorktreeAgentActivity | undefined> {
    return this.coordinateurDe(agentId)?.retryRunAsync(agentId)
  }

  /** Libere une copie en PRESERVANT son travail (branche de recuperation), contrairement a `discard`. */
  preserverEtLibererWorktree(agentId: string): {
    outcome: string
    branche?: string
    detail?: string
  } {
    return (
      this.coordinateurDe(agentId)?.preserverEtLiberer(agentId) ?? {
        outcome: 'refuse',
        detail: 'coordinateur indisponible'
      }
    )
  }

  async discardHeldWorktree(agentId: string): Promise<boolean> {
    return (await this.coordinateurDe(agentId)?.discardHeldAsync(agentId)) ?? false
  }

  /**
   * Abonne le réveil des runs suspendus : sans lui, un run coupé par le quota app ouverte ne
   * repartait qu'au redémarrage suivant. Idempotent.
   */
  onMurDeQuota(listener: () => void): void {
    this.murDeQuotaListener = listener
  }

  /**
   * Abonne « Publication auto » à la fin de chaque run d'agents : un travail fini resté
   * dans sa copie de travail part alors par un /git, sans bouton « Traiter » à cliquer. Idempotent.
   */
  onFinDeRun(listener: (runId: string) => void): void {
    this.finDeRunListener = listener
  }

  /** Abonne l'IPC aux changements d'activité worktree (push live vers le cockpit). Idempotent. */
  onWorktreeActivity(listener: (a: WorktreeAgentActivity[]) => void): void {
    this.worktreeActivityListener = listener
  }

  /**
   * Abonne un puits de mesure aux REFUS d'integration. Emis a chaque tentative : l'abonne distingue
   * incidents et reessais par `tentative`. Existe parce que rien ne comptait ces refus.
   */
  onRefusIntegration(
    listener: (refus: {
      cause: string
      agentId: string
      files: readonly string[]
      tentative: number
      detail?: string
    }) => void
  ): void {
    this.refusIntegrationListener = listener
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
    const settings = DEFAULT_ORCHESTRATION_BUDGET
    /*
     * Le plafond d'un tour de chat vient UNIQUEMENT des plafonds fixes (`maxChatProviderCalls`,
     * `maxTotalTokens`, `maxUsd`) — plus de reglage utilisateur depuis le 2026-10-23.
     *
     * Les caps d'environnement AUTOWIN_CHAT_CALL_CAP / _TOKEN_CAP / _USD_CAP ont ete SUPPRIMES le
     * 2026-09-16 avec le budget du tour de chat : plus aucun reglage cache ne resserre un tour.
     */
    const maxProviderCalls = settings.maxChatProviderCalls
    const maxTotalTokens = settings.maxTotalTokens
    const maxUsd = settings.maxUsd
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
    /*
     * LE PLAFOND D'APPELS DU TOUR EST CELUI DU REGLAGE, PAS CELUI DU REGIME.
     *
     * Mesure du 2026-09-08 : trois tours morts sur « Budget d'appels
     * provider atteint : 10 appels » alors que le reglage en autorise 50. Cause : `compileExecutionQuote`
     * classe un tour de chat en regime `trivial`, dont le PREREGLAGE vaut 10 appels, et `stricter`
     * garde le plus petit des deux. Le plafond effectif ne venait donc ni du reglage ni d'un cap pose
     * par l'utilisateur, mais d'un prereglage de regime concu pour les RUN.
     *
     * Ce compteur compte des ETAPES (lire, editer, verifier), pas de la depense : le laisser tuer un
     * tour agentique en plein travail rend la pire issue possible — paye, et rien de fini. On lui
     * rend donc la valeur decidee plus haut, qui vient du SEUL reglage utilisateur (les caps
     * d'environnement ont ete supprimes le 2026-09-16 : plus rien ne la resserre).
     */
    quote.limits.maxProviderCalls = maxProviderCalls
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
    let selectedModel: string | undefined
    const r = await this.runChatTurn(task, undefined, () => {
      // Comme le routeur, relire APRÈS la readiness : le catalogue peut résoudre un alias pendant
      // l'attente et remplacer `codex/flagship` par son transport concret.
      const binding = this.roles.getBinding(role ?? 'orchestrator')
      const currentProvider = provider ?? binding.provider
      const options = provider
        ? {}
        : { model: binding.model, reasoningEffort: binding.reasoningEffort }
      selectedModel = options.model
      return this.registry.send(currentProvider, messages, options, (c) => onDelta(c.delta))
    })
    if (r.usage) {
      this.cost.add({
        provider: r.provider,
        model: r.model ?? selectedModel,
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
   * Les adapters qui exposent `startLogin` gèrent leur connexion ; claude et codex passent par un
   * terminal. Les moteurs retirés n'ont plus de plan de login (throw).
   */
  startProviderLogin(provider: string, configDir?: string): void {
    const adapter = this.registry.get(provider)
    if (adapter.startLogin) {
      adapter.startLogin()
      return
    }
    // `configDir` n'est renseigné que par le multi-comptes Claude : il dirige le login vers le
    // dossier du compte visé, au lieu d'écraser la session du compte courant.
    // Sans cible explicite, le login vise le compte Claude ACTIF. Sinon « Se reconnecter »
    // authentifiait toujours le dossier par defaut : l'utilisateur, actif sur un second compte,
    // ecrasait la session de son PREMIER compte sans le voir (incident 2026-09-01).
    const cible = configDir ?? claudeAccountEnv().CLAUDE_CONFIG_DIR
    const plan = planProviderLogin(provider, undefined, cible)
    spawnLoginTerminal(plan.command, {})
  }

  /**
   * Change le binding d'un rôle ET persiste sur disque.
   * fix-ok: cause mesurée — `saveRoleBindings` réécrit `roles.json` en entier : chaque appel doit passer
   * les deux interrupteurs, sinon celui qui manque disparaît du disque (lu : role-store.ts, en-tête de
   * `saveRoleBindings`). Les trois appels ci-dessous passent désormais `chatLectureSeuleSurHaiku`.
   */
  setRole(role: Role, binding: RoleBinding): Record<Role, RoleBinding> {
    const proposed = new RoleModelConfig(this.roles.all(), this.roles.getCatalog())
      .setBinding(role, binding)
      .all()
    saveRoleBindings(
      proposed,
      this.roles.getPetitesTaches(),
      this.roles.getBuildTrivialSurHaiku(),
      this.roles.getChatLectureSeuleSurHaiku()
    )
    this.roles.setBinding(role, proposed[role])
    return this.roles.all()
  }

  /**
   * Pose (ou efface avec `undefined`) le MODÈLE DES PETITES TÂCHES — choix automatique du workflow —
   * et le persiste dans `roles.json` à côté des quatre rôles. Persister
   * AVANT d'appliquer : un disque qui refuse l'écriture ne laisse pas un réglage fantôme en mémoire.
   */
  setPetitesTaches(binding: RoleBinding | undefined): RoleBinding | undefined {
    saveRoleBindings(
      this.roles.all(),
      binding,
      this.roles.getBuildTrivialSurHaiku(),
      this.roles.getChatLectureSeuleSurHaiku()
    )
    this.roles.setPetitesTaches(binding)
    return this.roles.getPetitesTaches()
  }

  /**
   * Pose l'interrupteur « les questions du chat passent par les petites tâches » ET l'écrit sur disque.
   * Même ordre que `setPetitesTaches` : écrire d'abord, poser ensuite, pour qu'un disque qui refuse
   * n'installe pas un réglage fantôme en mémoire.
   */
  setRoutageChatLectureSeule(actif: boolean): boolean {
    saveRoleBindings(
      this.roles.all(),
      this.roles.getPetitesTaches(),
      this.roles.getBuildTrivialSurHaiku(),
      actif
    )
    this.roles.setChatLectureSeuleSurHaiku(actif)
    return this.roles.routageChatLectureSeuleActif()
  }

  /**
   * Change PLUSIEURS rôles et persiste UNE seule fois. `setRole` en boucle réécrivait `roles.json`
   * par rôle (écriture temporaire + relectures de validation, toutes synchrones) : mesuré le
   * 2026-09-23 dans gels.jsonl, 8 lectures bloquantes pour 20,7 s de gel sur le fil principal.
   */
  setRoles(bindings: ReadonlyArray<readonly [Role, RoleBinding]>): Record<Role, RoleBinding> {
    if (bindings.length === 0) return this.roles.all()
    const proposed = new RoleModelConfig(this.roles.all(), this.roles.getCatalog())
    for (const [role, binding] of bindings) proposed.setBinding(role, binding)
    const all = proposed.all()
    saveRoleBindings(
      all,
      this.roles.getPetitesTaches(),
      this.roles.getBuildTrivialSurHaiku(),
      this.roles.getChatLectureSeuleSurHaiku()
    )
    for (const [role] of bindings) this.roles.setBinding(role, all[role])
    return this.roles.all()
  }

  // --- Orchestration disciplinée (le cœur) ---
  async runTask(
    task: string,
    onStep?: (s: OrchestrationStep) => void,
    onPhase?: (p: OrchestrationPhase) => void,
    onDelta?: (step: 'exec' | 'judge', delta: string, note?: string, reasoning?: string) => void,
    signal?: AbortSignal,
    collectedContext?: string,
    /** SURVIE NIVEAU 3 : acquis d'un run interrompu → reprise à la phase suivante. */
    resumeOutputs?: { phase: NodePhase; text: string }[],
    /** Conversation d'origine : persistée avec l'acquis pour qu'une reprise s'affiche au bon endroit. */
    conversationId?: string,
    /** Modèle figé pour ce run uniquement, sans mutation de la topologie globale. */
    bindingOverride?: RoleBinding,
    /** Trace immédiate de la récupération Brain, y compris si le run échoue ensuite. */
    onBrainRetrieved?: (event: BrainRetrievalEvent) => void,
    turnId?: string,
    onRunLifecycle?: (event: RunLifecycleEvent) => void,
    /**
     * Etat budgetaire du run interrompu ; utilise uniquement avec `resumeOutputs`. Ses dates, quand
     * l'appelant passe le checkpoint entier, restent celles du run d'origine (`DatesDesCheckpoints`).
     */
    resumeControl?: Pick<OrchestrationRunState, 'runId' | 'executionQuote' | 'usage'> &
      Partial<Pick<OrchestrationRunState, 'startedAt' | 'updatedAt'>>,
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
      /**
       * Le dossier de travail DE CE RUN, resolu par l'appelant depuis la conversation.
       * Absent -> `this.executionWorkspace`, le repli global : comportement d'avant, a l'identique.
       */
      workspace?: string
    } = {}
  ): Promise<OrchestrationResult> {
    await this.waitUntilReady()
    // Une reprise ne remet pas l'horloge à zéro : sinon un run refusé à chaque démarrage échappe à
    // la péremption de 36 h (`run-49e50da90997-1`).
    if (resumeControl) this.datesDesCheckpoints.reprendre(resumeControl)
    // Certains harness historiques construisent le prototype avec un orchestrateur factice sans
    // magasin de roles. En production `roles` existe toujours ; le fallback laisse le mock intact.
    const admittedRuntime =
      runtimeSnapshot ?? (this.roles ? this.captureOrchestrationRuntime() : undefined)
    const settings = DEFAULT_ORCHESTRATION_BUDGET
    const quote = resumeControl?.executionQuote ?? compileExecutionQuote(task, settings)
    // Runs que CE process execute en ce moment : une demande identique s'y rattache au lieu de
    // tenter une reprise de leur checkpoint (voir `isOrchestrationLive`).
    const runIdsDeCetAppel = new Set<string>()
    const suivreLeRun = (event: RunLifecycleEvent): void => {
      if (event.runId && !runIdsDeCetAppel.has(event.runId)) {
        runIdsDeCetAppel.add(event.runId)
        this.liveOrchestrationRunIds.add(event.runId)
      }
      onRunLifecycle?.(event)
    }
    try {
      return await this.executionSupervisor.run(
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
          //
          // Une sélection de candidats scout ne rejoue pas le scout du workflow du fil (
          // `selection-sans-scout.ts`). Le workflow actif de la vue, devenu une simple valeur par
          // défaut, passe par le même filtre : il n'y a plus de workflow imposé.
          const workflowDuRun =
            runOptions.workflowOverride ??
            workflowSansScoutPourSelection(
              await this.poseConversationWorkflow(conversationId, task),
              task
            )
          const orchestrator = this.orchestrateurPour(workflowDuRun, task, runOptions.workspace)
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
            suivreLeRun,
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
        onLateUsageSettlement,
        {
          /*
           * PATIENTER PLUTOT QUE REFUSER (mesure du 2026-09-12 : 17 refus « appel(s) provider encore
           * actif(s) » sur 75 lancements, la famille d'echec la plus frequente). Le compteur qui
           * bloque est PERSISTE : l'appel en vol le remet a zero en se reglant, dans ce meme process.
           * On relit donc le checkpoint du run repris jusqu'a ce qu'il retombe, au lieu de renvoyer
           * l'utilisateur retaper sa demande au tour suivant.
           */
          relire: () =>
            resumeControl?.runId
              ? loadOrchestrationState(this.orchestrationStateRoot, resumeControl.runId)?.usage
              : undefined
        }
      )
    } finally {
      for (const runId of runIdsDeCetAppel) this.liveOrchestrationRunIds.delete(runId)
    }
  }

  private readonly liveOrchestrationRunIds = new Set<string>()

  /** Vrai si ce process est en train d'executer ce run (entre son admission et la fin de `runTask`). */
  isOrchestrationLive(runId: string): boolean {
    return this.liveOrchestrationRunIds.has(runId)
  }

  /**
   * Le run que ce process execute DEJA pour ce tour de cette conversation, s'il y en a un.
   *
   * fix-ok: 2026-09-30 (objection du juge, reparation 4 de run-85d8e7f57af2-1) — au
   * redemarrage, run-3180eec71b06-1 repart a 13:36:17.850 sur le tour 386f4c48 ; le tour de chat
   * restaure relance `orchestrate` avec une tache REECRITE, la reprise stricte (meme texte) ne le
   * reconnait pas, et run-66d6d5bdfc5a-1 part a 13:36:21.030 sur le MEME tour : `think` rejoue,
   * 1,94 $. Le tour est le signal fiable ; le texte de la tache ne l'est pas.
   */
  liveOrchestrationForTurn(
    conversationId: string | undefined,
    turnId: string | undefined
  ): string | undefined {
    if (!conversationId || !turnId || this.liveOrchestrationRunIds.size === 0) return undefined
    return loadOrchestrationStates(this.orchestrationStateRoot).find(
      (state) =>
        this.liveOrchestrationRunIds.has(state.runId) &&
        state.conversationId === conversationId &&
        state.turnId === turnId
    )?.runId
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
  resumableOrchestrations(nowMs = Date.now()): OrchestrationRunState[] {
    // L'horloge est passee ICI et nulle part ailleurs : elle ecarte les checkpoints perimes, qui
    // sinon rouvraient a chaque demarrage la conversation d'un run mort depuis des jours.
    return pickOrchestrationsToResume(loadOrchestrationStates(this.orchestrationStateRoot), nowMs)
  }

  /** Ferme durablement les appels dont le PID a disparu, sans jamais les rejouer. */
  terminalizeAbandonedOrchestrations(
    identityOf: ProcessIdentity,
    allowUnknown = false,
    nowMs = Date.now(),
    probes: InterruptedTerminalizationProbes = {}
  ): OrchestrationRunState[] {
    return loadOrchestrationStates(this.orchestrationStateRoot).map(
      (state) =>
        terminalizeInterruptedPersistedRun(
          this.orchestrationStateRoot,
          state.runId,
          identityOf,
          nowMs,
          allowUnknown,
          probes
        ) ?? state
    )
  }

  terminalizeAbandonedOrchestration(
    runId: string,
    identityOf: ProcessIdentity,
    allowUnknown = false,
    nowMs = Date.now(),
    probes: InterruptedTerminalizationProbes = {}
  ): OrchestrationRunState | null {
    return terminalizeInterruptedPersistedRun(
      this.orchestrationStateRoot,
      runId,
      identityOf,
      nowMs,
      allowUnknown,
      probes
    )
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
      phase?: NodePhase
      active?: boolean
      fanOut?: boolean
      pid?: number
      identity?: string
      journalPath?: string
      offset?: number
    }>
  ): void {
    const state = loadOrchestrationState(this.orchestrationStateRoot, runId)
    if (!state) return
    saveOrchestrationState(this.orchestrationStateRoot, { ...state, agents, updatedAt: Date.now() })
  }

  /**
   * Analyse en lecture seule déjà produite dans cette conversation, réutilisable même si le
   * libellé de la demande a changé entre deux tours. Ne reprend AUCUN checkpoint : uniquement des
   * textes de phase, que l'orchestrateur saute alors au lieu de les repayer.
   */
  // fix-ok: run-85d8e7f57af2-1 réparation 2 — reprendre `think` exige de savoir si un fichier cité a
  // changé depuis le commit du briefing (`git diff`, sans bloquer la fenêtre) : la méthode devient
  // asynchrone (1 édition), puis ses imports `execFile` / `promisify` / `sansThinkPerime` (1 édition).
  async acquiredAnalysisForConversation(
    task: string,
    conversationId: string | undefined,
    nowMs = Date.now(),
    /** Tour et dossier du NOUVEAU run : `think` n'est repris que pour la même demande, à jour. */
    contexte: { turnId?: string; workspace?: string } = {}
  ): Promise<Array<{ phase: NodePhase; text: string; codeSha?: string }>> {
    const acquis = pickAcquiredAnalysis(loadOrchestrationStates(this.orchestrationStateRoot), {
      task,
      conversationId,
      nowMs,
      ...(contexte.turnId ? { turnId: contexte.turnId } : {})
    })
    // Un briefing `think` pointe des lignes : repris seulement si aucun fichier qu'il cite n'a
    // changé depuis le commit qu'il a lu. `git diff` ASYNCHRONE — un appel synchrone fige la fenêtre
    // (`depot-git.ts`). Échec ou dossier inconnu → `think` est rejoué, jamais repris à l'aveugle.
    const workspace = contexte.workspace ?? this.executionWorkspace
    const garde = await sansThinkPerime(acquis, async (sha) => {
      try {
        const r = await promisify(execFile)('git', ['diff', '--name-only', sha, '--'], {
          cwd: workspace,
          windowsHide: true,
          timeout: 15_000
        })
        return r.stdout.split(/\r?\n/).filter((ligne) => ligne.trim())
      } catch {
        return undefined
      }
    })
    return garde.length > 0 ? garde : []
  }

  /** Abandonne explicitement un état reprenable (l'utilisateur ne veut pas le reprendre). */
  forgetResumableOrchestration(runId: string): void {
    clearOrchestrationState(this.orchestrationStateRoot, runId)
  }

  // --- Dashboards : données RÉELLES ---
  budget(): ReturnType<CostAggregator['budgetStatus']> {
    return this.cost.budgetStatus()
  }
  trustRanking(): ReturnType<TrustLedger['ranking']> {
    return this.trust.ranking()
  }
  /**
   * L'HUMAIN TRANCHE : « c'etait bon » / « c'etait faux » sur les verdicts d'un run.
   *
   * Sans ce geste, trust.jsonl n'accumulait que des verdicts non confirmes et `calibration()`
   * rendait structurellement accuracy:null — un classement de juges sans aucune mesure.
   * Rend le nombre de verdicts re-etiquetes (0 si le run est inconnu du registre).
   */
  confirmerVerdictJuge(runId: string, humanTruth: 'green' | 'red'): number {
    return this.trust.confirmer(runId, humanTruth)
  }
  /**
   * Gate déterministe évalué sur les VRAIS runs vivants (plus de démo hardcodée).
   *
   * BORNÉ : ce chemin est appelé par `snapshot()`, donc à CHAQUE tour de chat. La variante sans
   * borne (`listRuns()`) lisait tous les RUN.md de la racine pour n'en afficher que 12 — mesuré à
   * p95 1 288 ms / max 19 250 ms par tour le 2026-08-28. Le geste explicite de l'utilisateur
   * (Observatoire) garde `listRuns()`, lui, intact.
   */
  async runsWithGate(): Promise<
    Array<RunEntry & { blocked: boolean }> & { horsFenetre?: number; horsFenetreARegarder?: number }
  > {
    /*
     * LA RACINE OÙ AUTOWIN ÉCRIT, PAS SEULEMENT CELLE DU KIT. `runsRoot()` (`~/.claude/runs`) n'existe
     * pas sur le poste : `get_state`, l'état du prompt et le contexte des orchestrations voyaient
     * ZÉRO run, alors que la construction tournait (kaizen du 2026-10-11, sonde : 0 run
     * par défaut, 9 « open » dans `convRunsRoot()`). Les deux racines, une seule borne.
     */
    const fenetre = await scanRunsPourSnapshot([convRunsRoot(), runsRoot()])
    // `horsFenetre` suit la liste : sans lui, un run bloqué plus ancien que la borne disparaît en silence.
    // `horsFenetreARegarder` : le compte de ceux qui demandent un regard (chat), distinct du total.
    return Object.assign(
      fenetre.map((r) => ({ ...r, blocked: isBlocked(r.summary) })),
      { horsFenetre: fenetre.horsFenetre, horsFenetreARegarder: fenetre.horsFenetreARegarder }
    )
  }
  kaizenPatterns(jsonl: string): ReturnType<typeof recurrentPatterns> {
    return recurrentPatterns(parseJsonl(jsonl))
  }

  // --- Graphe 3D / brain (données réelles disque) ---
  listBrains(): BrainGraphRef[] {
    // PAS de catalogue de themes ici. Le construire ouvre et lit les ~845 fiches du vault sur le
    // partage reseau \serveur : 6,5 s MESUREES, en lecture bloquante dans le processus principal,
    // donc toute l'application gele pendant ce temps. Le seul appelant (`commands.ts`, commande
    // `load_graph`) ne cherche qu'un brain par son id et n'utilise jamais `themes`.
    // La vue Memory, elle, passe deja par le worker et demande ses themes a part.
    return scanBrainGraphs(undefined, false)
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
  /**
   * Runs du dépôt, enrichis de ce que le RUN.md ne dit pas : la conversation d'origine et l'état de
   * PUBLICATION du travail (retenu/bloqué). Sans ce second champ, un run vert dont l'intégration
   * n'est jamais passée s'affichait comme un run vert ordinaire.
   */
  async listRuns(): Promise<RunEntry[]> {
    const avecConversation = attachConversationIds(await scanRuns(), this.conversations.list())
    return attachPublicationStates(
      avecConversation,
      this.tousLesCoordinateurs().flatMap((coordinateur) => coordinateur.runRecords())
    )
  }
}
