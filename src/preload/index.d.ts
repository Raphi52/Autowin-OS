import type { InventaireDisque } from '../main/store/inventaire-disque'
import type { MessageAffiche as MessageEntreFilsAffiche } from '../main/messages-entre-fils-app'
import type { GestePlanDeLots, ReponsePlansDeLots } from '../shared/plan-de-lots'
import type {
  EtatPhraseProd,
  ReponseAutorisation as ReponseAutorisationProd,
  ReponseDefinition as ReponseDefinitionPhrase
} from '../main/prod-passphrase-ipc'
import type { DemandeProdPubliee as DemandeAutorisationProd } from '../main/prod-guichet'
import type {
  EtatPorteProd,
  NiveauProtectionProd,
  PropositionAutoriteProd
} from '../shared/prod-protection'
import type { RapportRetention } from '../shared/rapport-retention'
import type { ApiNavigateur } from '../shared/navigateur'
import type { GestesDesTours } from '../shared/gestes-agent'
import type { StockVeille } from '../main/veille/candidats-store'
import type {
  WorktreeAgentActivity,
  WorktreeConflictDiffResult,
  WorktreeConflictResolutionChoice,
  WorktreeConflictResolutionResult,
  WorktreeRuntimeStatus
} from '../shared/worktree-activity-model'
import type { ModelQuotaSnapshot } from '../shared/model-quotas'
import type { ClaudeResetClaimResult, ClaudeResetsStatus } from '../shared/claude-resets'
import type { UpdateStrategy } from '../shared/update-contract'
import type { ChatArtifact, ArtifactEncoding } from '../shared/artifacts'
import type {
  ChatAttachment,
  AgentTopology,
  ExecutionWorkspaceState,
  BrainPersoState,
  BrainReglageState,
  NativePreflightTrace
} from '../shared/preload-contracts'
import type { Conversation, ConversationSummary } from '../main/store/conversations'
import type {
  BilanDesMentions,
  CarteDesBesoins,
  ResultatDuRattachement
} from '../shared/carte-des-besoins'
import type { EtatDuDossierDuBoard, EtatManuelDuBoard } from '../shared/board-dossier'
import type { BoardsDesCollegues } from '../shared/board-collegues'
import type { ComparaisonDUneFacon, ResultatGarderUneFacon } from '../shared/essai-trois-facons'
import type { EtatWhisper } from '../main/whisper-local'
import type { EtatPiper } from '../main/piper-local'
import type { OrchestrationStep, OrchestrationResult } from '../main/orchestrator'
import type { VizGraph } from '../main/viz/graph'
import type { BrainGraphRef, BrainTheme } from '../main/viz/fs-brains'
import type { BrainSearchEnvelope } from '../main/brain-search-envelope'
import type { InboxCandidate, InboxMove } from '../main/brain-inbox'
import type { RunEntry } from '../main/dashboards/runs-scan'
import type { CapabilityItem } from '../main/capability-controls'
import type { SkillRegistryItem } from '../main/skill-registry'
import type { BehaviourFile } from '../main/behaviour-files'
import type { PendingModelQuestion } from '../main/model-questions'
import type { ImportedModel } from '../main/models'
import type { PromptCallRecord, CostBreakdownRow } from '../main/activity/prompt-observability'
import type { ProviderDisplayStatus, ProviderStatus } from '../main/provider-status'
import type { SemanticTemporalProjectionV1 } from '../main/knowledge/semantic-temporal-projection'
import type { BehaviourComposition } from '../main/behaviour-composition'
import type { BrainTrace } from '../main/activity/brain-trace-spool'
import type { ConversationFileTrace } from '../main/activity/conversation-file-trace-spool'
import type { BrainInjectionInventory } from '../main/activity/brain-injection-inventory'
import type { PreflightResult } from '../main/preflight'
import type { PreflightRepairOutcome } from '../main/preflight-repair'
import type { TaskManagerSnapshot, ScheduledTask } from '../main/task-manager/types'
import type { AutoCloseReport } from '../main/run-autoclose'
import type { FabricNodeSummary } from '../main/compute-fabric/control-plane'
import type { PetitesTachesEtat, Role, RoleBinding } from '../main/roles'
import type { WorkflowProfilesFile } from '../main/workflow-profiles'
import type { AutowinProfile } from '../main/profile-store'
import type { ShadowRouteResult } from '../main/shadow-router'
import type { ShadowRoutingPilotState } from '../main/model-routing-shadow-setting'
import type { PersistedCheckpoint, CheckpointForkManifest } from '../main/wire-checkpoint-fork'
import type { OrchestrationRunState } from '../main/runs/orchestration-state'
import type { CommandResult, AppSnapshot } from '../main/commands'
import type { TraceEventV1, TracePayload } from '../main/activity/trace-event'
import type { SessionMeta, SessionActivity } from '../main/activity/transcripts'
import type { ClaudeHookItem } from '../main/claude-hooks'
import type { ConvActivityEntry } from '../main/activity/conv-activity'
import type { BureauTv, GesteTv, ImageTv, ResultatGeste } from '../main/hdesk-tv'
import type {
  DemandeCreationBureau,
  ResultatChoixExe,
  ResultatCreationBureau,
  ResultatFermetureGeree,
  ResultatListeBureaux
} from '../shared/hdesk-gestion'
export interface ClaudeAccountEntry {
  id: string
  displayName: string
  /** Niveau d'abonnement (« team », « max »…) : ce qui distingue deux comptes de meme email. */
  tier: string
  email?: string
  active: boolean
}
export interface ClaudeAccountsPayload {
  activeId: string
  accounts: ClaudeAccountEntry[]
}

interface ChatApi {
  captureTestPage: () => Promise<string>
  seedArtifactPreviewsTest: (htmlOnly?: boolean) => Promise<{
    conversationId: string
    turnId: string
  }>
  resumePilotChat: (conversationId: string) => Promise<{
    ok: boolean
    cancelled: boolean
    turnId: string
    text?: string
    error?: string
  }>
  identiteUtilisateur: () => Promise<string>
  storageMigration: () => Promise<Record<string, string>>
  completeStorageMigration: () => Promise<boolean>
  hdeskTvBureaux: (conversationId?: string) => Promise<BureauTv[]>
  hdeskTvImage: (id: string) => Promise<ImageTv>
  hdeskTvArreter: () => Promise<void>
  hdeskTvAct: (geste: GesteTv) => Promise<ResultatGeste>
  hdeskTvBasculer: (id: string) => Promise<{ ok: boolean; message?: string }>
  hdeskGestionBureaux: () => Promise<ResultatListeBureaux>
  hdeskGestionFermer: (id: string) => Promise<ResultatFermetureGeree>
  hdeskGestionCreer: (demande: DemandeCreationBureau) => Promise<ResultatCreationBureau>
  hdeskGestionChoisirExe: () => Promise<ResultatChoixExe>
  /** Navigateur intégré du chat (conv-1286) : la forme est celle du contrat partagé. */
  navigateur: ApiNavigateur
  prodPassphraseEtat: () => Promise<EtatPhraseProd>
  prodPassphraseDefinir: (
    phrase: string,
    phraseActuelle?: string
  ) => Promise<ReponseDefinitionPhrase>
  prodPorteEtat: () => Promise<EtatPorteProd>
  /** Liste de production PROPOSÉE depuis le catalogue SQL — un contenu à recopier, rien n'est écrit. */
  prodAutoriteProposition: () => Promise<PropositionAutoriteProd>
  prodPorteNiveau: (niveau: NiveauProtectionProd) => Promise<{ ok: boolean; erreur?: string }>
  prodAutorisationConfirmer: (id: string) => Promise<{ ok: boolean }>
  prodPassphraseAutoriser: (
    phrase: string,
    demande: { cible: string; operation: string }
  ) => Promise<ReponseAutorisationProd>
  onProdAutorisationDemandee: (cb: (demande: DemandeAutorisationProd) => void) => () => void
  onProdAutorisationClose: (cb: (id: string) => void) => () => void
  prodAutorisationDeposer: (id: string, jeton: string) => Promise<{ ok: boolean }>
  prodAutorisationAnnuler: (id: string) => Promise<{ ok: boolean }>
  prodAutorisationEnAttente: () => Promise<DemandeAutorisationProd[]>
  orchestrate: (
    task: string,
    conversationId?: string
  ) => Promise<{ ok: boolean; result?: OrchestrationResult; error?: string }>
  onOrchestrateStep: (cb: (step: OrchestrationStep) => void) => () => void
  onPreflight: (cb: (result: PreflightResult) => void) => () => void
  getPreflight: () => Promise<PreflightResult | null>
  repairPreflight: (checkId: string) => Promise<PreflightRepairOutcome>
  recheckPreflight: (force?: boolean) => Promise<PreflightResult>
  /** Le moteur qui tourne contient-il encore les sources ? Voir `shared/moteur-perime`. */
  etatDuMoteur: () => Promise<{ perime: boolean; fichier?: string; retardMs?: number }>
  /** Opt-in persistant du pilote de routage shadow (mesure verte/coût par route). */
  shadowRoutingPilot: () => Promise<ShadowRoutingPilotState>
  setShadowRoutingPilot: (enabled: boolean) => Promise<ShadowRoutingPilotState>
  getGitState: (repoPath?: string) => Promise<import('../shared/git-read').GitReadResult>
  getGitBranch: (repoPath?: string) => Promise<import('../shared/git-read').GitBranchResult>
  getGitBranches: (repoPath?: string) => Promise<string[]>
  checkoutGitBranch: (
    branch: string,
    repoPath?: string
  ) => Promise<{ ok: true; branch: string } | { ok: false; reason: string }>
  conversationGitState: (
    conversationId: string
  ) => Promise<import('../shared/git-read').GitReadResult>
  conversationGitDiff: (
    conversationId: string,
    path: string,
    workspaceRoot: string
  ) => Promise<import('../shared/git-read').GitDiffResult>
  /** Historique git de la vue Worktrees — la frise de commits. Lecture seule. */
  getGitGraph: (repoPath?: string) => Promise<import('../shared/git-graph').GitGraphSnapshot>
  /**
   * Le geste de glisser-deposer du graphe, traduit en commande git PAR le processus principal.
   * Liste blanche de deux gestes en avant ; aucune reecriture d'histoire n'en sort.
   */
  runGitAction: (
    demande:
      | { type: 'merge'; source: string; cible: string }
      | { type: 'cherry-pick'; commit: string; cible: string },
    repoPath?: string
  ) => Promise<{ ok: true; commande: string; sortie: string } | { ok: false; raison: string }>
  getGitDiff: (
    path: string,
    repoPath?: string
  ) => Promise<import('../shared/git-read').GitDiffResult>
  pickGitRepo: () => Promise<string | null>
  /**
   * Bouton « Lancer » (panneau Fichiers) : état, démarrage, arrêt du lancement déclaré pour le
   * dossier de la conversation, et mises à jour poussées pendant qu'il tourne.
   */
  lancementEtat: (
    conversationId: string
  ) => Promise<import('../shared/scripts-copie').EtatLancement>
  lancementDemarrer: (
    conversationId: string
  ) => Promise<import('../shared/scripts-copie').EtatLancement>
  lancementArreter: (
    conversationId: string
  ) => Promise<import('../shared/scripts-copie').EtatLancement>
  onLancement: (
    cb: (maj: {
      conversationId: string
      etat: import('../shared/scripts-copie').EtatLancement
    }) => void
  ) => () => void
  /** Onglet « Projet » : racine du projet, arborescence par dossier, lecture/ecriture d'un fichier. */
  projectRoot: (conversationId?: string) => Promise<string>
  /** Ouvre tout le projet courant dans VS Code (commande `code`). */
  openProjectInVscode: (conversationId?: string) => Promise<{ ok: true; installe: boolean } | { ok: false; raison: string }>
  /** Lecture seule : le fichier existe-t-il ? `null` = chemin relatif sans base connue. */
  fichierExiste?: (path: string, base?: string) => Promise<boolean | null>
  listProjectDir: (path?: string, conversationId?: string) => Promise<import('../main/project-files').ProjectListResult>
  readProjectFile: (path: string, conversationId?: string) => Promise<import('../main/project-files').ProjectReadResult>
  writeProjectFile: (
    path: string,
    content: string,
    conversationId?: string
  ) => Promise<import('../main/project-files').ProjectWriteResult>
  testProjects: () => Promise<
    Array<
      import('../shared/test-projects').TestProject & {
        runner: import('../shared/test-projects').TestRunner
        runnable: boolean
        reason?: string
      }
    >
  >
  saveTestProjects: (
    projects: Array<{ root: string; label?: string }>
  ) => ReturnType<Api['testProjects']>
  pickTestProject: () => Promise<string | null>
  runProjectTests: (
    root: string,
    filter?: string
  ) => Promise<{
    root: string
    runner: import('../shared/test-projects').TestRunner
    exitCode: number | null
    durationMs: number
    totals: import('../shared/test-projects').TestTotals
    report: import('../shared/test-projects').TestReport
  }>
  perfTurnLatency: (
    derniers?: number
  ) => Promise<
    import('../shared/perf-lag').RapportLatence & { disponible: boolean; source: string }
  >
  /** Ce qu'Autowin occupe sur le disque, par famille, plus le menage deja fait au demarrage. */
  osDiskUsage: () => Promise<InventaireDisque>
  perfGels: (
    derniers?: number
  ) => Promise<
    import('../shared/gel-detector').ResumeGels & {
      disponible: boolean
      source: string
      /** Memoire et CPU de chaque processus : dernier releve, total et pic (conv-1077). */
      memoire?: import('../main/releve-memoire').EtatReleveMemoire
    }
  >
  /** Duels d'arene deja mesures, agreges par nom de workflow. Aucun duel n'est rejoue. */
  arenaDuelsParWorkflow: (
    derniers?: number
  ) => Promise<Record<string, import('../main/arena-duels').AgregatDuels>>
  /** Ce que chaque workflow a réellement donné (runs aboutis, en échec, interrompus), par nom. */
  workflowResultatsReels: () => Promise<
    Record<string, import('../main/activity/resultats-reels-workflows').ResultatsReelsWorkflow>
  >
  getAutoClose: () => Promise<{ enabled: boolean; last?: AutoCloseReport }>
  setAutoClose: (enabled: boolean) => Promise<{ enabled: boolean; last?: AutoCloseReport }>
  unfinishedTurns: () => Promise<
    Array<{ conversationId: string; turnId: string; events: number; updatedAt: number }>
  >
  turnJournal: (conversationId: string, turnId: string) => Promise<Array<Record<string, unknown>>>
  /** Gestes propres de l'agent (lectures, commandes, éditions) de chaque demande, par demande. */
  turnJournalGestes: (conversationId: string) => Promise<GestesDesTours>
  /** Consigne à rejouer après un redémarrage demandé par l'agent, rendue une seule fois. */
  repriseEnAttente: () => Promise<{
    conversationId: string
    consigne: string
    raison?: string
    poseeA: number
  } | null>
  /** Couleur des boutons réduire / agrandir / fermer, que Windows peint hors de la page. */
  signalerRunsVivants: (etat: {
    runsActifs: number
    etapesFaites: number
    etapesTotales: number
  }) => Promise<boolean>
  /** La mascotte du bureau (conv-1145) : affichée ou masquée, choix gardé par le moteur. */
  mascotteAffichee: () => Promise<boolean>
  afficherMascotte: (affichee: boolean) => Promise<boolean>
  /** Le style de la mascotte du bureau : le magicien ou la bille basique (conv-1249). */
  styleMascotte: () => Promise<'magicien' | 'basique'>
  choisirStyleMascotte: (style: 'magicien' | 'basique') => Promise<'magicien' | 'basique'>
  setTitlebarSymbolColor: (couleur: string) => Promise<boolean>
  setColorScheme: (schema: 'dark' | 'light') => Promise<boolean>
  /** Les couleurs du thème choisi, pour la carte de fin de tour en bas à droite (conv-1090). */
  setPaletteCarteFinDeTour: (palette: Record<string, string>) => Promise<boolean>
  /** La langue choisie dans Settings · Interface ; rend celle que le moteur a enregistrée (conv-1146). */
  setLangue: (langue: 'fr' | 'en') => Promise<'fr' | 'en'>
  checkUpdate: () => Promise<{
    available: boolean
    behind: number
    branch?: string
    reference?: string
    /** Travail en cours : la mise a jour est tentee telle quelle et refusee si elle entre en conflit (aucun stash). */
    dirty?: boolean
    strategies?: UpdateStrategy[]
    error?: string
  }>
  applyUpdate: (strategy?: UpdateStrategy) => Promise<{
    ok: boolean
    relaunch?: boolean
    reload?: boolean
    effect?: 'none' | 'reload' | 'relaunch'
    npmInstalled?: boolean
    error?: string
    strategy?: UpdateStrategy
    /** Rien n'a ete touche faute d'intention explicite : une QUESTION, pas un echec. */
    needsChoice?: boolean
    strategies?: UpdateStrategy[]
  }>
  ticketSources: () => Promise<import('../shared/tickets').TicketSourceSummary[]>
  saveTicketSource: (
    profile: import('../shared/tickets').TicketSourceProfile
  ) => Promise<import('../shared/tickets').TicketSourceSummary[]>
  listTickets: (
    request: import('../shared/tickets').TicketListRequest
  ) => Promise<import('../shared/tickets').TicketPage>
  getTicket: (
    request: import('../main/tickets-ipc').TicketGetIpcRequest
  ) => Promise<import('../shared/tickets').TicketItem>
  updateTicket: (
    request: import('../main/tickets-ipc').TicketUpdateIpcRequest
  ) => Promise<import('../shared/tickets').TicketItem>
  cancelTickets: (requestId: string) => Promise<boolean>
  listTicketPeople: (source: unknown) => Promise<string[]>
  getWorktreeActivity: (conversationId?: string) => Promise<WorktreeAgentActivity[]>
  /** Travaux terminés mais jamais publiés — lecture seule, sur geste explicite. */
  getTravauxNonPublies?: () => Promise<Array<{ agentId: string; date: string; fichiers: string[] }>>
  /** Dernier rapport du balayage de retention. `undefined` = aucune passe encore faite. */
  getRapportRetention?: () => Promise<RapportRetention | undefined>
  getPatchTravailNonPublie?: (agentId: string) => Promise<{ patch: string; tronque: boolean }>
  getWorktreeStatus: () => Promise<WorktreeRuntimeStatus>
  getWorktreeConflictDiff: (agentId: string) => Promise<WorktreeConflictDiffResult>
  resolveWorktreeConflict: (
    agentId: string,
    choice: WorktreeConflictResolutionChoice
  ) => Promise<WorktreeConflictResolutionResult>
  retryWorktreeRecovery: (agentId: string) => Promise<WorktreeAgentActivity | undefined>
  /** « Reprendre tout » : relance les runs interrompus la ou ils se sont arretes. */
  resumeAllRuns?: () => Promise<{
    dejaEnCours: boolean
    relances: string[]
    ignores: Array<{ runId: string; raison: string }>
  }>
  discardHeldWorktree: (agentId: string) => Promise<boolean>
  setWorktreeFixture: (fixture: {
    activity: WorktreeAgentActivity[]
    status: WorktreeRuntimeStatus
  }) => Promise<boolean>
  onWorktreeActivity: (cb: (activity: WorktreeAgentActivity[]) => void) => () => void
  /** Workflows nommés : lire, créer/modifier, supprimer, sélectionner. */
  workflowProfiles: () => Promise<WorkflowProfilesFile>
  workflowProfileNotice: () => Promise<{ id: number; text: string } | null>
  workflowProfileAcknowledgeNotice: (id: number) => Promise<boolean>
  workflowProfileSave: (profile: unknown) => Promise<WorkflowProfilesFile>
  workflowProfileRemove: (id: string) => Promise<WorkflowProfilesFile>
  workflowProfileSelect: (id: string | null) => Promise<WorkflowProfilesFile>
  /** `id` nul = tout le fichier ; un id = ce seul workflow, pour en partager un sans donner le reste. */
  workflowProfilesExport: (
    id: string | null
  ) => Promise<{ ok: boolean; reason?: string; path?: string; count?: number }>
  workflowProfilesImport: () => Promise<{
    ok: boolean
    reason?: string
    imported?: number
    rejected?: string[]
    file?: WorkflowProfilesFile
  }>
  /** Ce que le moteur ne peut pas jouer d'un graphe composé, plus son pire cas. */
  checkWorkflowGraph: (graph: unknown) => Promise<{
    defects: { target?: string; message: string }[]
    worstCaseNodeExecutions: number | null
  }>
  roles: () => Promise<Record<Role, RoleBinding>>
  semanticTimeline: (conversationId: string) => Promise<SemanticTemporalProjectionV1>
  setRole: (
    role: string,
    provider: string,
    model?: string,
    reasoningEffort?: string
  ) => Promise<Record<Role, RoleBinding>>
  petitesTaches: () => Promise<PetitesTachesEtat>
  setPetitesTaches: (
    provider: string | null,
    model?: string,
    reasoningEffort?: string
  ) => Promise<PetitesTachesEtat>
  models: (force?: boolean) => Promise<ImportedModel[]>
  fabricNodes: () => Promise<FabricNodeSummary[]>
  installIsolatedFabricFixture: () => Promise<{ summary: FabricNodeSummary; model: ImportedModel }>
  /**
   * Résultat d'exécution d'un provider — hétérogène par construction (`ProviderAdapter['send']`
   * délègue au provider réel, dont la forme du résultat varie ; aucun oracle local ne le contraint).
   */
  sendIsolatedFabricFixture: (execution?: boolean) => Promise<unknown>
  refreshFabricNode: (nodeId: string) => Promise<FabricNodeSummary>
  checkpointForks: () => Promise<Array<PersistedCheckpoint<OrchestrationRunState>>>
  createCheckpointFork: (
    checkpointId: string,
    forkId: string
  ) => Promise<CheckpointForkManifest<OrchestrationRunState>>
  shadowRouteRecommendation: (
    phase: string,
    champion: { provider: string; model: string }
  ) => Promise<ShadowRouteResult>
  modelQuotas: (force?: boolean) => Promise<ModelQuotaSnapshot>
  claudeResets: () => Promise<ClaudeResetsStatus>
  claudeResetClaim: (grantId: string) => Promise<ClaudeResetClaimResult>
  profiles: () => Promise<AutowinProfile[]>
  saveProfile: (profile: unknown) => Promise<AutowinProfile[]>
  applyProfile: (id: string) => Promise<{ topology: AgentTopology }>
  providerLogin: (provider: string) => Promise<{ ok: true }>
  /** Compte Claude propre a une conversation (`null` = compte de l'application). */
  conversationSetClaudeAccount: (id: string, accountId: string | null) => Promise<string | null>
  /**
   * Modele propre a une conversation (`provider === null` = modele par defaut de l'application).
   * Rend le choix retenu, ou null. Refuse (rejet) un modele absent du catalogue.
   */
  conversationSetModel: (
    id: string,
    provider: string | null,
    model?: string,
    reasoningEffort?: string
  ) => Promise<{ provider: string; model?: string; reasoningEffort?: string } | null>
  /** Comptes Claude multiples : un CLAUDE_CONFIG_DIR par compte, bascule sans re-login. */
  claudeAccounts: () => Promise<ClaudeAccountsPayload>
  claudeAccountAdd: (label?: string) => Promise<ClaudeAccountsPayload>
  claudeAccountSwitch: (id: string) => Promise<ClaudeAccountsPayload>
  claudeAccountRemove: (id: string) => Promise<ClaudeAccountsPayload>
  topology: () => Promise<AgentTopology>
  setTopology: (topology: AgentTopology) => Promise<AgentTopology>
  capabilityControls: (kind: 'skills' | 'hooks' | 'tools' | 'plugins' | 'gates') => Promise<CapabilityItem[]>
  skills: () => Promise<SkillRegistryItem[]>
  promptCalls: (conversationId: string) => Promise<PromptCallRecord[]>
  // fix-ok: golden test src/main/activity/cost-breakdown.test.ts asserts this file's source text
  // contains the literal 'cacheHitRatio' (see CostBreakdownRow) — keep the substring even after typing.
  costBreakdown: (
    dimension?: 'actor' | 'model' | 'provider',
    conversationId?: string
  ) => Promise<CostBreakdownRow[]>
  brainTraces: (conversationId: string) => Promise<BrainTrace[]>
  /** Chemins lus et ecrits pendant la conversation, avec le tour et l'auteur du geste. */
  conversationFileTraces: (conversationId: string) => Promise<ConversationFileTrace[]>
  brainInjectionInventory: (conversationId: string) => Promise<BrainInjectionInventory>
  behaviourComposition: (workspace?: string) => Promise<
    BehaviourComposition & {
      inspection: { workspace: string; files: Array<BehaviourFile & { excerpt?: string }> }
    }
  >
  installIsolatedBehaviourFixture: () => Promise<string>
  providerStatus: () => Promise<ProviderStatus[]>
  providerTest: (provider: string) => Promise<{ provider: string; status: ProviderDisplayStatus }>
  setProviderMode: (
    provider: string,
    mode: 'active' | 'standby'
  ) => Promise<{ mode: 'active' | 'standby' }>
  promptTraceSummary: () => Promise<NativePreflightTrace[]>
  authorizeDiagnostics: () => Promise<string | null>
  promptTracesGlobal: (capability: string) => Promise<NativePreflightTrace[]>
  causalTrace: (conversationId: string) => Promise<TraceEventV1[]>
  /** La trace SANS contenus, pour le graphe du chat (relue chaque seconde en direct). */
  causalTraceGraphe: (conversationId: string) => Promise<TraceEventV1[]>
  /** Les charges entières des événements nommés, aux seuls genres demandés (détail d'une étape). */
  causalTraceCharges: (
    conversationId: string,
    eventIds: string[],
    kinds: string[]
  ) => Promise<Record<string, TracePayload[]>>
  activitySessions: () => Promise<SessionMeta[]>
  activitySession: (meta: { id: string; project: string }) => Promise<SessionActivity>
  activityImage: (
    session: { id: string; project: string },
    path: string
  ) => Promise<{ dataUrl: string }>
  claudeHooks: () => Promise<ClaudeHookItem[]>
  codexHooks: () => Promise<ClaudeHookItem[]>
  setCapabilityTool: (
    name: string,
    enabled: boolean
  ) => Promise<{ items: CapabilityItem[]; restartRequired: true }>
  chooseBehaviourWorkspace: () => Promise<string | null>
  /** Les consignes tapees PENDANT un tour, avec le tour qu'elles ont inflechi. Lecture seule. */
  orientationsDeConversation: (
    conversationId: string
  ) => Promise<Array<{ ts: number; texte: string; turnId?: string }>>
  executionWorkspace: () => Promise<ExecutionWorkspaceState>
  chooseExecutionWorkspace: () => Promise<ExecutionWorkspaceState>
  resetExecutionWorkspace: () => Promise<ExecutionWorkspaceState>
  /** Le Brain renseigné dans les Réglages : chemin et/ou dépôt git (`src/main/brain-reglage.ts`). */
  brainReglage: () => Promise<BrainReglageState>
  choisirDossierBrain: () => Promise<string | null>
  enregistrerBrainReglage: (entree: { chemin?: string; depot?: string }) => Promise<BrainReglageState>
  resetBrainReglage: () => Promise<BrainReglageState>
  /** Le Brain PERSO, privé, à côté de celui de l'équipe (conv-1233, `src/main/brain-perso.ts`). */
  brainPerso: () => Promise<BrainPersoState>
  enregistrerBrainPerso: (entree: { chemin?: string; depot?: string }) => Promise<BrainPersoState>
  resetBrainPerso: () => Promise<BrainPersoState>
  onModelQuestion: (cb: (question: PendingModelQuestion) => void) => () => void
  answerModelQuestion: (id: string, answer: string) => Promise<{ ok: true }>
  toolUsage: () => Promise<
    Array<{ id: string; label: string; description: string; enabled: boolean; mutable: boolean }>
  >
  ouvrirReglagesMicro: () => Promise<{ ouvert: boolean; raison?: string }>
  whisperEtat: () => Promise<EtatWhisper>
  whisperInstaller: () => Promise<EtatWhisper>
  whisperTranscrire: (wav: Uint8Array) => Promise<string>
  piperEtat: () => Promise<EtatPiper>
  piperInstaller: () => Promise<EtatPiper>
  piperParler: (texte: string) => Promise<Uint8Array>
  transcriptDemarrer: () => Promise<{ id: string; nom: string; chemin: string }>
  transcriptAjouter: (id: string, texte: string) => Promise<{ octets: number }>
  transcriptTerminer: (id: string) => Promise<{ chemin: string } | null>
  transcriptLister: (
    max?: number
  ) => Promise<Array<{ nom: string; chemin: string; octets: number; le: number }>>
  transcriptRevealer: (chemin: string) => Promise<{ ok: true }>
  conversations: () => Promise<ConversationSummary[]>
  /** La carte des besoins (conv-1089) : les demandes de TOUS les fils, par projet, sans modèle. */
  carteDesBesoins: (options?: {
    /** Les états posés à la main sur le Board, joints pour la copie vers son dossier (conv-1206). */
    etatsManuels?: Record<string, EtatManuelDuBoard>
  }) => Promise<CarteDesBesoins>
  /** Le dossier où le Board est recopié, choisi sur ce poste (conv-1206). */
  boardDossier: () => Promise<EtatDuDossierDuBoard>
  /** La liste des dossiers de travail du Chat, la seule que le Board montre (conv-1212) ; absent =
   *  preload d'avant redémarrage. */
  boardDossiersDuChat?: (dossiers: string[], retires?: string[]) => Promise<boolean>
  boardDossierChoisir: () => Promise<EtatDuDossierDuBoard>
  boardDossierEffacer: () => Promise<EtatDuDossierDuBoard>
  /** Les projets recopiés dans le dossier du Board, `null` = tous (conv-1211). */
  boardDossierProjets: (projets: string[] | null) => Promise<EtatDuDossierDuBoard>
  /** Le nom de ce poste sur le Board, `null` = le compte Windows (conv-1230) ; absent = preload
   *  d'avant redémarrage. */
  boardDossierNom?: (nom: string | null) => Promise<EtatDuDossierDuBoard>
  /** Les Boards des collègues relus dans le dossier du Board (conv-1210), en lecture seule. */
  boardCollegues: () => Promise<BoardsDesCollegues>
  /** Lier une demande de la carte à un work item, lu à la source avant d'être posé (conv-1127). */
  carteLierWorkItem: (cible: {
    conversationId: string
    demande: string
    saisie: string
    sourceId?: string
  }) => Promise<ResultatDuRattachement>
  /** Détacher un work item d'une demande ; un lien automatique détaché ne revient pas (conv-1127). */
  carteDelierWorkItem: (cible: {
    conversationId: string
    demande: string
    sourceId: string
    id: string
  }) => Promise<{ ok: true } | { ok: false; raison: string }>
  /** Lire à la source les `#1234` des prompts, et poser ceux qui existent (conv-1127). */
  carteVerifierMentions: () => Promise<BilanDesMentions>
  /** Ids des conversations dont le CONTENU porte le terme (+ extrait a montrer). */
  conversationsSearchContent: (
    terme: string
  ) => Promise<Array<{ id: string; extrait: string; occurrences: number }>>
  conversation: (id: string) => Promise<Conversation | null>
  conversationsCreate: (p: {
    title: string
    category: string
    provider: string
    /** Dossier de travail dès la création (conv-1038) ; un non-chemin est refusé. */
    projectPath?: string
  }) => Promise<{
    id: string
    title: string
    category: string
    provider: string
    projectPath?: string
  }>
  /** Renomme et rend le titre RELU (`undefined` = id inconnu, rien renomme). */
  conversationsRename: (
    id: string,
    title: string
  ) => Promise<{ id: string; title: string } | undefined>
  /** Range une conversation dans un dossier. Chemin omis → sélecteur natif ; `null` → « Divers ». */
  conversationsSetProject: (id: string, path?: string | null) => Promise<string | null>
  /** Pose (`true`) ou retire (`false`) le repère visuel d'une conversation. */
  conversationsSetHighlight: (id: string, on: boolean) => Promise<boolean>
  /**
   * Projets connus de claude.exe (profil CLI), déjà filtrés — pour la liste des dossiers du Chat.
   * fix-ok: cause mesurée — le pont n'exposait aucun accès aux projets du profil CLI ; sans cette
   * déclaration, ChatView ne pouvait pas typer l'appel (tsc rouge avant ajout, vert après).
   */
  dossiersClaudeCli: () => Promise<string[]>
  /** Le dossier personnel (cible de « This computer ») ; absent d'un preload d'avant redémarrage. */
  dossierPersonnel?: () => Promise<string>
  conversationsSetInactive: (id: string, on: boolean) => Promise<boolean>
  /** `dossier` : la copie séparée où la branche travaille dès sa création (conv-1038). */
  conversationsFork: (
    id: string,
    messageId: string,
    options?: { dossier?: string }
  ) => Promise<Conversation>
  /** Ce que l'agent a retenu dans ce fil (carnet du fil, conv-1038) ; absent d'un preload ancien. */
  conversationMemoire?: (
    id: string
  ) => Promise<Array<{ title: string; body: string; state?: 'depose' | 'inconnu' | 'local' }>>
  /** Retire un fait barré dans le carnet : l'agent ne le relit plus (conv-1038). */
  conversationOublierFait?: (id: string, title: string) => Promise<boolean>
  /** « Essaie 3 façons » : une photo du code, une copie séparée par branche (conv-1038). */
  conversationEssaisEnParallele?: (
    id: string,
    nombre: number
  ) => Promise<{ ok: true; quand: number; chemins: string[] } | { ok: false; raison: string }>
  /** La carte de comparaison des façons : écart, état du tour, vérifications (conv-1038). */
  conversationComparerLesFacons?: (ids: string[]) => Promise<ComparaisonDUneFacon[]>
  /** « Garder celle-ci » : l'écart de la façon publié par le chemin des copies (conv-1038). */
  conversationGarderEssai?: (id: string) => Promise<ResultatGarderUneFacon>
  /** Rouvre le code du début du tour d'un message dans une copie séparée (conv-1038). */
  conversationRevenirAuTour?: (
    id: string,
    messageId: string
  ) => Promise<
    { ok: true; chemin: string; deja: boolean; quand: number } | { ok: false; raison: string }
  >
  /**
   * Importe une session Claude Code de l'inventaire en conversation Autowin. Rend un résumé.
   * fix-ok: cause mesurée des retouches — la signature a suivi le contrat réel du canal
   * `os:conversations:importSession` (ref {id, project} puis résumé avec projectPath optionnel),
   * calé sur le retour effectif de importSession() côté store après le test rouge→vert.
   */
  conversationsImportSession: (ref: {
    id: string
    project: string
  }) => Promise<{ id: string; title: string; messageCount: number; projectPath?: string }>
  conversationsRemove: (id: string) => Promise<boolean>
  /** Purge en lot. Rend les ids RÉELLEMENT supprimés (inconnus ignorés). */
  conversationsRemoveMany: (ids: readonly string[]) => Promise<string[]>
  readChatArtifact: (
    conversationId: string,
    turnId: string,
    artifactId: string
  ) => Promise<{
    ok: boolean
    artifact?: ChatArtifact
    encoding?: ArtifactEncoding
    content?: string
    error?: string
  }>
  revealChatArtifact: (
    conversationId: string,
    turnId: string,
    artifactId: string
  ) => Promise<{ ok: boolean; error?: string }>
  /** Stock de veille concurrents : candidats sources + sources muettes de la derniere passe. */
  veilleSnapshot: () => Promise<StockVeille>
  veilleMarquer: (id: string, statut: 'nouveau' | 'ecarte' | 'prompte') => Promise<StockVeille>
  /** Lance la passe INTERNE (scout local) et rend le résultat ; le stock est réécrit côté main. */
  veilleGenerer: (conversationId?: string) => Promise<{ retenus: number; stock: StockVeille }>
  taskManagerSnapshot: () => Promise<TaskManagerSnapshot>
  outlookSnapshot: (force?: boolean) => Promise<unknown>
  outlookOuvrir: (id: string) => Promise<{ ok: boolean; erreur?: string }>
  /** Ouvre une pièce jointe REÇUE (copiée par Outlook dans un dossier temporaire, ouverte par Windows). */
  outlookOuvrirPiece: (
    id: string,
    rang: number | null,
    nom: string
  ) => Promise<{ ok: boolean; erreur?: string }>
  /**
   * Envoie une réponse à un message Outlook, et ses pièces jointes éventuelles.
   * Irréversible : à confirmer avant l'appel.
   *
   * Les pièces voyagent en CONTENU (base64), pas en chemin : un fichier glissé depuis Outlook
   * n'existe pas sur le disque, et Electron ne rend plus `File.path`.
   */
  outlookRepondre: (
    id: string,
    corps: string,
    pieces?: ReadonlyArray<{ nom: string; taille: number; contenuBase64: string }>
  ) => Promise<{ ok: boolean; erreur?: string }>
  /** Marque des messages Outlook comme lus. Ecrit dans la boite : reserve a un geste utilisateur. */
  outlookMarquerLu: (ids: readonly string[]) => Promise<{ ok: boolean; erreur?: string }>
  /**
   * Envoie un message NEUF (adresse + objet + corps, et ses pièces jointes éventuelles).
   * Irréversible : à confirmer avant l'appel.
   *
   * Les pièces voyagent en CONTENU (base64), pas en chemin : un fichier glissé depuis Outlook
   * n'existe pas sur le disque, et Electron ne rend plus `File.path`.
   */
  outlookNouveauMessage: (
    adresse: string,
    objet: string,
    corps: string,
    pieces?: ReadonlyArray<{ nom: string; taille: number; contenuBase64: string }>
  ) => Promise<{ ok: boolean; erreur?: string }>
  taskManagerCreate: (task: unknown) => Promise<ScheduledTask>
  taskManagerUpdate: (id: string, task: unknown) => Promise<ScheduledTask>
  taskManagerRemove: (id: string) => Promise<boolean>
  taskManagerAcknowledge: (alertId: string) => Promise<boolean>
  taskManagerRunNow: (id: string) => Promise<{ started: boolean }>
  // fix-ok: mesure 2026-09-26 — sans ces deux declarations, `npm run typecheck:web` rend 2
  // (TS2339 sur TaskManagerView.tsx:724 et :738) : l'ecran appelle ces deux fonctions du pont.
  /** Coupe (`false`) ou retablit UNE personne d'une regle mails / Teams. */
  taskManagerSetSender: (id: string, key: string, enabled: boolean) => Promise<ScheduledTask>
  /** « Connecter Teams » : le code a saisir sur la page Microsoft, ou la raison de l'echec. */
  taskManagerTeamsConnect: () => Promise<
    | { ok: true; userCode: string; verificationUri: string; expiresAt: number }
    | { ok: false; erreur: string }
  >
  openFolder: (path: string) => Promise<void>
  /** Ouvre un fichier cite par un agent (`[a.ts:80](src/main/a.ts:80)`). Chemin resolu cote main. */
  revealFile: (path: string, line?: number) => Promise<{ ok: boolean; reason?: string }>
  appState: () => Promise<AppSnapshot>
  detachView: (view: string, screenX: number, screenY: number) => Promise<{ ok: boolean }>
  windowBounds: () => { x: number; y: number; width: number; height: number }
  appCommand: (name: string, args?: Record<string, unknown>) => Promise<CommandResult>
  /** Messages entre fils du même dépôt, envoyés et reçus par ce fil (conv-1139). Lecture seule. */
  messagesEntreFils: (conversationId: string) => Promise<MessageEntreFilsAffiche[]>
  /**
   * Plan de lots d'un fil chef (conv-1150) : le voir, et les gestes ; `lot` pour « relancer ».
   * « tous » (conv-1158) : tous les plans en un appel, SANS fil, pour ranger la liste.
   */
  plansDeLots: {
    (geste: 'tous'): Promise<ReponsePlansDeLots>
    (
      geste: GestePlanDeLots,
      conversationId: string,
      planId?: string,
      lot?: number
    ): Promise<ReponsePlansDeLots>
  }
  pilotChat: (
    messages: Array<{
      role: 'user' | 'assistant'
      content: string
      attachments?: ChatAttachment[]
    }>,
    conversationId?: string
  ) => Promise<{
    ok: boolean
    cancelled: boolean
    turnId: string
    text?: string
    error?: string
    verification?: { complete: boolean; evidence: string }
  }>
  cancelPilotChat: (conversationId: string) => Promise<{ ok: boolean }>
  /** Un tour pilote est-il REELLEMENT en vol cote main pour cette conversation ? */
  pilotChatActive: (conversationId: string) => Promise<{ active: boolean }>
  cancelOrchestration: (conversationId: string) => Promise<{ ok: boolean }>
  injectDirective: (
    conversationId: string,
    directive: string,
    attachments?: ChatAttachment[]
  ) => Promise<{
    ok: boolean
    messageId?: string
    /** Refus : pourquoi le texte n'a pas rejoint le tour (il repart en file, rien n'est perdu). */
    motif?: 'vide' | 'commande' | 'hors-tour'
    /** Commande de skill reconnue (`scout`, `judge`…) quand `motif` vaut `commande`. */
    commande?: string
  }>
  /** Écrit le texte de l'utilisateur sur disque AVANT son envoi — filet contre les textes sans tour. */
  journaliserSaisie: (
    conversationId: string,
    texte: string,
    voie: 'message' | 'orientation',
    /** Absent = tapé par l'utilisateur ; `mode-auto` = envoyé seul par ∞ (conv-113). */
    origine?: 'mode-auto'
  ) => Promise<{ ok: boolean }>

  markResponseDisplayed: (
    conversationId: string,
    content: string
  ) => Promise<{ ok: boolean; eventId: string }>
  onPilotEvent: (
    cb: (e: {
      kind: string
      conversationId?: string
      turnId?: string
      streamId?: string
      actionId?: string
      iteration?: number
      text?: string
      name?: string
      args?: unknown
      ok?: boolean
      data?: unknown
    }) => void
  ) => () => void
  onAppEvent: (
    cb: (e: {
      type: string
      tab?: string
      origin?: string
      scope?: string
      text?: string
      noticeId?: number
      convId?: string
      runPath?: string
      task?: string
      status?: string
      step?: OrchestrationStep
      phase?: { step: string; provider?: string; role?: string }
      deltaStep?: 'exec' | 'judge'
      delta?: string
      /**
       * Activite courante de la phase, hors livrable : « Bash en cours — 2 min 30 s ».
       * Voyage sur `orchestrate-delta` mais dans son propre champ — le texte est la reponse et
       * finit persiste, la note dit seulement que le sous-agent travaille encore.
       */
      note?: string
      /**
       * Fragment du raisonnement du sous-agent (`orchestrate-delta`), a ACCUMULER sous sa phase —
       * jamais a afficher seul comme ligne d'etat (conv-918, 2026-10-13).
       */
      reasoning?: string
      /** Phase en cours quand ce fragment de raisonnement a ete emis. */
      reasoningPhase?: string
      /** Affirmations non verifiees sur lesquelles le cadrage repose (evenement `orchestrate-hypotheses`). */
      hypotheses?: { affirmation: string; source: 'confiance' | 'besoin' }[]
      /** Orientations non lues a la fin d'un tour, renvoyees a l'ecran pour repartir en file (evenement `directives-orphelines`). */
      textes?: string[]
      /** Suite a envoyer dans ce fil, pressee sur la notification de fin de tour (evenement `suite-depuis-notification`, conv-1038). */
      texte?: string
    }) => void
  ) => () => void
  emitIsolatedTestAppEvent: (event: Record<string, unknown> & { type: string }) => Promise<boolean>
  isolatedTestConversationReadCount: (reset?: boolean) => Promise<number>
  conversationRuns: (convId: string) => Promise<RunEntry[]>
  deleteConversationRun: (
    convId: string,
    path: string
  ) => Promise<{ ok: boolean; kind: 'deleted' | 'detached' }>
  conversationActivity: (convId: string) => Promise<ConvActivityEntry[]>
  runTrace: (path: string) => Promise<OrchestrationStep[] | null>
  setActiveConversation: (convId: string | null) => Promise<{ ok: boolean }>
  listBrains: () => Promise<BrainGraphRef[]>
  loadBrainGraph: (path: string, lod?: number, community?: number) => Promise<VizGraph>
  loadBrainGraphPreview: (path: string, lod?: number) => Promise<VizGraph>
  /** Les deux Brains dans un graphe, reliés par leurs ponts perso → équipe (conv-1262). */
  loadBrainGraphReunis: (lod?: number) => Promise<VizGraph>
  loadBrainThemes: (path: string) => Promise<BrainTheme[]>
  loadBrainThemeNodes: (path: string, themeIds: string[]) => Promise<VizGraph['nodes']>
  loadBrainNeighborhood: (path: string, nodeId: string) => Promise<VizGraph>
  readNodeFile: (path: string, vaultRoot?: string) => Promise<{ path: string; content: string }>
  searchBrain: (path: string, query: string) => Promise<BrainSearchEnvelope>
  refreshBrain: (path: string) => Promise<{ ok: boolean }>
  listInbox: (path: string) => Promise<InboxCandidate[]>
  readInboxCandidateBody: (path: string, id: string) => Promise<{ id: string; body: string }>
  promoteInbox: (path: string, id: string) => Promise<InboxMove>
  rejectInbox: (path: string, id: string) => Promise<InboxMove>
  retractKnowledge: (path: string, id: string) => Promise<InboxMove>
  supersedeKnowledge: (
    path: string,
    obsoleteId: string,
    replacementId: string
  ) => Promise<InboxMove>
  outcomeLearning: () => Promise<{
    mode: 'off' | 'shadow' | 'inbox' | 'auto'
    events: Array<{ kind: string; value: Record<string, unknown> }>
  }>
  outcomeLearningCurations: (
    offset?: number,
    limit?: number
  ) => Promise<{
    events: Array<{ kind: 'curation'; value: Record<string, unknown> }>
    total: number
  }>
  setOutcomeLearningMode: (
    mode: 'off' | 'shadow' | 'inbox' | 'auto'
  ) => Promise<{ mode: 'off' | 'shadow' | 'inbox' | 'auto' }>
  undoOutcomeLearningCuration: (eventId: string) => Promise<InboxMove>
  listRuns: () => Promise<RunEntry[]>
  deleteRun: (path: string) => Promise<{ ok: boolean }>

  getZoomFactor: () => number
  setZoomFactor: (factor: number) => void
}

declare global {
  interface Window {
    api: ChatApi
  }
}
