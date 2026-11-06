import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { RoleBinding, ReasoningEffort } from '../profil/roles'
import { effortParDefautDeLEtape, resolvePhaseBinding } from '../profil/roles'
import { effortsDeclaresDuModele } from '../modeles/models'
import { withCostContext, type CostSink } from '../dashboards/cost'
import { HookBus } from '../hooks/hook-bus'
import { createDefaultHookBus } from '../hooks/default-gate-hooks'
import { resolveVerifyCmd } from '../hooks/resolve-verify-cmd'
import { loadTrustedLearningOracles } from '../providers/learning-oracle-manifest'
import { type PipelinePhase, type NodePhase, isPipelinePhase, skillInstruction as chargerSkill } from '../skills/skill-pipeline'
import { routeSkillRequest } from '../skills/skill-routing'
import { combinePhaseInstruction } from '../workflow/workflow-instruction'
import { agentsForPhase, linearPhasesOf, resolveWorkflowAgents, type WorkflowAgentBinding, type WorkflowGraph } from '../workflow/workflow-graph'
import { classifyRegime, type TaskRegime } from './task-regime'
import { GARDE_TACHE, phaseBrief } from '../consignes/phase-briefs'
import { grapheSansEtapesDesactivees, sansEtapesDesactivees } from './etapes-desactivees'
import { anglesDuPanelScout, prioriserAnglesScout } from '../../shared/persona'
import type { SendOptions, TrustedLearningOracle } from '../providers/types'
import { identifiantBureauCache } from '../consignes/consigne-bureau-cache'
import { explainRoleFailure } from '../providers/provider-failure-diagnosis'
import { retryOnTransientOverload } from '../providers/transient-overload'
import { promptOutilsNoeudSkill } from '../skills/skill-node-tools'
import { OrchestrationRuntimeSnapshot, OrchestratorDeps, PhasePromptBlock, RunAgentRef, WorkflowRunOverride, bindingDeRepliPourPhase, jetonDeReservation } from './orchestrator-contrats'
// Partie hors classe déplacée dans orchestrator-contrats.ts, ré-exportée à l'identique (conv-1508).
import { run } from './orchestrator-run'
import { runGreedyPipeline, greedyJudgeAndGate, runGreedyBuildPhase } from './orchestrator-parcours-glouton'
import { runInner } from './orchestrator-parcours-sequentiel'
export * from './orchestrator-contrats'

export class Orchestrator {
  readonly causalWatchPathsByRun = new Map<string, readonly string[]>()
  /**
   * Pré-lecture `git ls-files` du plafond scout (`lecteurAncrageDepuisDisque`), par `runId`.
   * Le processus git tourne DANS l'espace de travail : `run()` l'attend dans son `finally`, sinon il
   * survit au run avec ce dossier pour répertoire courant et Windows refuse de le supprimer
   * (EBUSY, mesuré 2026-10-12 sur orchestrator.execution.test.ts : `git ls-files` sans code de
   * sortie au moment du nettoyage). Bornée par son timeout (5 s), jamais rejetée.
   */
  readonly lecturesDeFondByRun = new Map<string, Promise<void>>()
  /**
   * Conversation et tour d'origine du run EN COURS, par `runId`. Sert a estampiller chaque ligne
   * de cout : sans ce rattachement, `cost.jsonl` ne pouvait pas dire QUEL echange a coute combien.
   * Rempli seulement quand l'appelant fournit reellement l'information — jamais devine.
   */
  readonly costContextByRun = new Map<
    string,
    { conversationId?: string; turnId?: string }
  >()
  readonly learningOraclesByRun = new Map<string, readonly TrustedLearningOracle[]>()

  constructor(readonly deps: OrchestratorDeps) {}

  /**
   * #8 — résolution du panel fan-out d'UNE phase (topology scout/frame/terrain), factorisée : cette
   * même expression (snapshot figé PRIME, sinon callback deps, filtrée + bornée par le devis) était
   * dupliquée mot pour mot à deux call-sites (`runGreedyBuildPhase` et le chemin séquentiel), avec
   * le risque qu'une correction future n'en touche qu'un. Le traitement de `bindingOverride` reste
   * au call-site : les deux appelants n'en font PAS le même usage (l'un renvoie `[bindingOverride]`,
   * l'autre `[]`), ce n'est donc pas un doublon à unifier.
   */
  resolvePhaseFanOut(
    phase: NodePhase,
    task: string,
    runtimeSnapshot?: OrchestrationRuntimeSnapshot
  ): RoleBinding[] {
    // Les agents COMPOSÉS sur le nœud priment sur la topologie globale : c'est le sens même du
    // canevas. Sans ce branchement, ouvrir un nœud et y régler trois agents ne changeait rien au run.
    const graph = this.workflowDuRun()?.graph
    const composes = graph ? agentsForPhase(graph, phase) : undefined
    const fallback = bindingDeRepliPourPhase(phase, this.deps.roles, runtimeSnapshot)
    const topologie = runtimeSnapshot?.phaseFanOut[phase] ?? this.deps.phaseFanOut?.(phase) ?? []
    // L'effort par défaut de l'étape ne vaut que pour un agent du canevas qui HÉRITE de l'effort du
    // rôle (ni fournisseur ni effort propres). La fusion `{...fallback, ...agent}` efface cette
    // origine : on la lit donc sur l'agent tel qu'il est posé, avant fusion. Un `phaseModel` du rôle
    // pour cette étape garde la main, comme sur le chemin principal.
    const heriteDuRole = (agent: WorkflowAgentBinding): boolean =>
      !agent.provider &&
      !agent.reasoningEffort &&
      !fallback.phaseModel?.[phase as PipelinePhase]?.reasoningEffort
    // Un panel scout de la topologie n'a pas d'angle (`FanMember`, os.ts) : sans cette répartition,
    // ses N membres recevaient la MÊME consigne (piste 6 de conv-890). Le canevas, lui, pose les siens.
    const resolved = composes
      ? resolveWorkflowAgents(composes, fallback).map((member, rang) =>
          heriteDuRole(composes[rang])
            ? {
                ...member,
                reasoningEffort: this.effortHeriteDeLEtape(
                  phase,
                  task,
                  member.provider,
                  member.model,
                  member.reasoningEffort
                )
              }
            : member
        )
      : phase === 'scout'
        ? anglesDuPanelScout(topologie)
        : topologie
    const admis =
      this.deps.currentExecutionQuote?.()?.allocation?.phaseMembers[phase] ??
      this.deps.currentExecutionQuote?.()?.limits.maxConcurrency ??
      Number.POSITIVE_INFINITY
    const membres = resolved.filter((member) => member && member.provider)
    // conv-339 : un panel scout COUPÉ par le devis garde ses angles les plus utiles, pas les premiers
    // du canevas (`prioriserAnglesScout`, persona.ts). Sans coupe, l'ordre composé reste tel quel.
    return (
      phase === 'scout' && membres.length > admis ? prioriserAnglesScout(membres) : membres
    ).slice(0, admis)
  }

  /**
   * L'effort qui part pour une étape dont l'effort HÉRITE du réglage du rôle (`effortParDefautDeLEtape`,
   * roles.ts). La difficulté vient du devis du run — enregistré, donc relu tel quel à la reprise — et,
   * sans devis, du texte de la tâche (même calcul déterministe). Sans liste d'efforts connue pour le
   * modèle, le réglage repart tel quel : rien n'est inventé.
   */
  effortHeriteDeLEtape(
    phase: NodePhase,
    task: string,
    provider: string,
    model: string | undefined,
    reglage: ReasoningEffort | undefined
  ): ReasoningEffort | undefined {
    const efforts = effortsDeclaresDuModele(this.deps.roles.getCatalog?.(), provider, model)
    return effortParDefautDeLEtape(phase, this.difficulteDuRun(task), reglage, efforts)
  }

  /** La difficulté du run : celle du devis enregistré (une reprise relit la même), sinon le texte. */
  difficulteDuRun(task: string): TaskRegime {
    return this.deps.currentExecutionQuote?.()?.regime ?? classifyRegime(task)
  }

  /**
   * Le (modèle, effort) d'une étape jouée par le binding du rôle. `fige` = binding imposé pour ce run
   * (`bindingOverride`) ou juge dédié : il part tel quel. Un `phaseModel[étape].reasoningEffort` passe
   * aussi devant la règle — c'est un réglage explicite de l'utilisateur.
   */
  resolveEtape(
    binding: RoleBinding,
    phase: NodePhase,
    task: string,
    fige: boolean
  ): { model?: string; reasoningEffort?: ReasoningEffort; advisorModel?: string } {
    const resolu = resolvePhaseBinding(binding, phase)
    if (fige) return resolu
    const reglageDeLEtape = binding.phaseModel?.[phase as PipelinePhase]
    // Build d'un run TRIVIAL sur le dernier Haiku (conv-1097, mesure et motif : roles.ts,
    // modeleDuBuildTrivial). Un réglage de l'étape build, un binding figé ou l'interrupteur coupé
    // gardent la main ; le juge n'est jamais concerné (rôle `judge`).
    const haiku =
      phase === 'build' && !reglageDeLEtape && this.difficulteDuRun(task) === 'trivial'
        ? this.deps.roles.modeleDuBuildTrivial?.(binding)
        : undefined
    const choisi = haiku ? { ...resolu, model: haiku } : resolu
    if (reglageDeLEtape?.reasoningEffort) return choisi
    return {
      ...choisi,
      reasoningEffort: this.effortHeriteDeLEtape(
        phase,
        task,
        binding.provider,
        choisi.model,
        choisi.reasoningEffort
      )
    }
  }

  /** #8 — même facteur commun que {@link resolvePhaseFanOut}, pour le panel de JUGES. */
  resolveJudgeFanOut(runtimeSnapshot?: OrchestrationRuntimeSnapshot): RoleBinding[] {
    const graph = this.workflowDuRun()?.graph
    const composes = graph ? agentsForPhase(graph, 'judge') : undefined
    const fallback = bindingDeRepliPourPhase('judge', this.deps.roles, runtimeSnapshot)
    const resolved = composes
      ? resolveWorkflowAgents(composes, fallback)
      : (runtimeSnapshot?.judgeFanOut ?? this.deps.judgeFanOut?.() ?? [])
    return resolved
      .filter((member) => member && member.provider)
      .slice(
        0,
        this.deps.currentExecutionQuote?.()?.allocation?.judgeMembers ??
          this.deps.currentExecutionQuote?.()?.limits.maxConcurrency ??
          Number.POSITIVE_INFINITY
      )
  }

  /**
   * Les phases réellement jouées. Point de lecture UNIQUE, à dessein : cette décision était dupliquée
   * entre `run` (qui provisionne le devis) et `runInner` (qui exécute), et les deux ont divergé deux
   * fois de suite — un pipeline provisionné, un autre joué. Une seule source, plus de dérive possible.
   */
  /**
   * Une demande TRIVIALE ne mérite aucun workflow.
   *
   * Le classifieur de proportionnalité rend une seule phase quand la tâche ne justifie pas un
   * pipeline. Laisser le graphe primer dans ce cas ferait enchaîner frame → build → clean → judge
   * sur un « quelle heure est-il ? » : le workflow deviendrait une CONTRAINTE, exactement ce qu'il
   * ne doit pas être. Le graphe est un outil qu'on sort quand le travail le mérite.
   */
  /**
   * LE point de lecture du workflow qui pilote le tour courant.
   *
   * Douze lectures dispersées de `deps.currentWorkflow?.()` interrogeaient l'instance depuis dix
   * endroits. Les ramener ici ne change aucun comportement, mais ouvre le pas suivant : le jour où
   * le workflow voyage EN PARAMÈTRE du run — ce qu'exige l'isolation entre conversations, cf.
   * `workflow-isolation.test.ts` — il n'y aura qu'UNE porte à déplacer au lieu de douze.
   */
  workflowDuRun(): WorkflowRunOverride | undefined {
    return this.deps.currentWorkflow?.()
  }

  tacheTriviale(task: string): boolean {
    // Un workflow CHOISI par l'utilisateur n'est jamais écarté par l'heuristique : entre une
    // décision explicite et une devinette sur la longueur de la demande, c'est la décision qui gagne.
    if (this.workflowDuRun()?.explicit) return false
    const classees = this.deps.classifyPhases?.(task)
    return !!classees && classees.length <= 1
  }

  /** Le graphe qui pilote CE run, ou rien si la demande ne justifie pas d'en sortir un. */
  graphePourTache(task: string): WorkflowGraph | undefined {
    // Une phase nommée (`/build`, `/clean`, ...) est une commande, pas une suggestion. Le workflow
    // sélectionné reste le contexte du run, mais son graphe ne doit pas réinjecter les autres phases.
    if (routeSkillRequest(task)?.explicitPhase) return undefined
    if (this.tacheTriviale(task)) return undefined
    const graphe = this.workflowDuRun()?.graph
    // Les étapes désactivées sortent du graphe ICI, avant le devis et le marcheur, qui le lisent
    // tous deux : rien n'est réservé ni joué pour elles (conv-1602).
    return graphe
      ? grapheSansEtapesDesactivees(graphe, (phase) => this.etapeDesactivee(phase))
      : undefined
  }

  /** Vrai si l'utilisateur a désactivé la skill de cette étape (Settings › Skills, conv-1602). */
  etapeDesactivee(phase: string): boolean {
    return this.deps.etapeDesactivee?.(phase) ?? false
  }

  /**
   * Les étapes du run, sans celles que l'utilisateur a désactivées (conv-1602). Un seul filtre ici :
   * le devis, la liste plate et le découpage en sous-tâches (`phases.includes('build')`) lisent tous
   * cette liste. Le marcheur de graphe ne la lit pas : `graphePourTache` lui retire les siennes.
   */
  effectivePhases(task: string): NodePhase[] {
    return sansEtapesDesactivees(this.phasesDuRun(task), (phase) => this.etapeDesactivee(phase))
  }

  private phasesDuRun(task: string): NodePhase[] {
    const explicitPhase = routeSkillRequest(task)?.explicitPhase
    if (explicitPhase) return explicitPhase === 'judge' ? [] : [explicitPhase]
    const workflow = this.workflowDuRun()
    // Trivial : la proportionnalité prime sur le workflow composé, sans quoi le moindre échange
    // paierait le pipeline entier.
    if (this.tacheTriviale(task)) return this.deps.classifyPhases!(task)
    const fromGraph = workflow?.graph ? linearPhasesOf(workflow.graph) : undefined
    // Un graphe explicite à retour n'est pas linéarisable, mais ses nœuds restent les phases que le
    // devis doit réserver et afficher. Retomber sur la classification rendait « Chantier Autowin »
    // visible tout en annonçant seulement frame → build.
    const explicitGraphPhases =
      workflow?.explicit && workflow.graph?.nodes.length
        ? workflow.graph.nodes.map((node) => node.phase)
        : undefined
    const imposed = fromGraph?.length ? fromGraph : (explicitGraphPhases ?? workflow?.phases)
    if (imposed?.length) return [...imposed]
    return this.deps.classifyPhases
      ? this.deps.classifyPhases(task)
      : (this.deps.execPhases ?? ['build'])
  }

  phasePrompt(phase: NodePhase, withFoundation: boolean): PhasePromptBlock {
    // Le pipeline IN-APP utilise ses contrats natifs courts. Les SKILL.md du kit externe exigent
    // leurs propres RUN.md/hooks et demandaient donc a scout/frame/terrain d'ecrire alors que ces
    // phases sont volontairement read-only. Une instruction explicitement injectee reste prioritaire
    // (tests, extension embarquee), mais l'absence d'injection ne consulte plus le kit de la machine.
    /**
     * Un noeud SKILL n'a pas de consigne native — son corps EST le SKILL.md du kit.
     *
     * Le pipeline in-app refuse deliberement de consulter le kit pour les huit phases (voir plus
     * haut). Pour un noeud skill il n'existe aucune autre source : `phaseBrief` rend une chaine
     * vide, et sans ce chargement le noeud partirait avec AUCUNE instruction. C'est ce qui separe
     * une brique qui travaille d'une brique qui figure au dessin.
     *
     * `deps.skillInstruction` reste prioritaire (tests, extension embarquee) ; elle n'est branchee
     * nulle part en production, d'ou le repli sur le chargeur reel.
     */
    const injectee = this.deps.skillInstruction?.(phase, { withFoundation }) ?? ''
    const corpsSkill = injectee || (isPipelinePhase(phase) ? '' : chargerSkill(phase))
    /**
     * Le noeud SKILL doit SAVOIR qu'il a des outils.
     *
     * La boucle peut etre parfaitement branchee : si le prompt ne declare pas le format `<cmd>` ni
     * les deux commandes autorisees, le modele n'en emettra jamais et la boucle ne s'ouvrira pas.
     * Une capacite non annoncee est une capacite absente — c'est le meme defaut, deplace d'un cran.
     *
     * Rien n'est ajoute a une phase du pipeline, ni quand aucun lanceur n'est branche : le prompt
     * ne promet que ce qui est reellement disponible.
     */
    const outils =
      !isPipelinePhase(phase) && this.deps.skillCommands?.()
        ? promptOutilsNoeudSkill(this.deps.skillCommands()?.catalogue?.() ?? [])
        : ''
    // La garde « tâche donnée = tâche traitée » vaut AUSSI pour un noeud skill : c'est justement
    // un noeud skill (`arena`) qui a substitué sa tâche le 2026-09-02. Le corps vient du kit, donc
    // `phaseBrief` ne passe pas par ici — la garde se pose sur ce second chemin d'assemblage.
    const installed = corpsSkill ? `${GARDE_TACHE}\n\n${corpsSkill}${outils}` : ''
    const base = installed || phaseBrief(phase)
    // Point de passage UNIQUE des consignes de phase : y brancher le workflow suffit à couvrir
    // exec, judge et greedy sans les threader un par un.
    const override = this.workflowDuRun()?.instructionFor?.(phase)
    const text = combinePhaseInstruction(base, override)
    if (override && text !== base) return { name: `workflow:${phase}`, text }
    return installed
      ? { name: `skill:${phase}`, text: installed }
      : { name: `consigne:${phase}`, text: phaseBrief(phase) }
  }

  readonly runNamespace = randomUUID().replace(/-/g, '').slice(0, 12)
  runSeq = 0
  readonly processObservers = new Map<
    string,
    {
      process: (pid: number, active: boolean) => void
      reserved: (
        reservationId: string,
        assignment: Pick<RunAgentRef, 'provider' | 'model' | 'phase' | 'fanOut'>
      ) => void
      spawnIntent: (
        token: string,
        active: boolean,
        assignment: Pick<RunAgentRef, 'provider' | 'model' | 'phase' | 'fanOut'>,
        reservationId?: string
      ) => void
      spawned: (
        token: string,
        pid: number,
        assignment: Pick<RunAgentRef, 'provider' | 'model' | 'phase' | 'fanOut'>
      ) => void
      journal: (
        token: string,
        journalPath: string,
        assignment: Pick<RunAgentRef, 'provider' | 'model' | 'phase' | 'fanOut'>
      ) => void
      reservationSettled: (reservationId: string) => void
    }
  >()
  /**
   * Agents lancés par run : jeton, pid, journal. C'est ce qui rend un run RATTACHABLE — sans ces
   * trois informations, une app qui redémarre ne sait ni si l'agent vit encore, ni où lire ce qu'il
   * a produit pendant son absence.
   */
  readonly runAgents = new Map<string, Map<string, RunAgentRef>>()
  /** Runs deja terminaux dont le checkpoint ne peut etre libere qu'apres le dernier provider. */
  readonly terminalRunsAwaitingProviderSettlement = new Set<string>()
  /**
   * Runs SUSPENDUS par le mur de quota alors qu'un appel (membre de fan-out) était encore en vol :
   * leur marque attend le règlement de ce dernier appel, pour écrire des agents et une consommation
   * enfin réglés. Leur état reprenable n'est jamais effacé, et leur copie reste gardée.
   */
  readonly suspendusEnAttenteDeReglement = new Map<
    string,
    { reason: string; resumeAfter?: number }
  >()

  /** Note la suspension sur l'état reprenable (best-effort) et libère la mémoire du run. */
  noterSuspensionParQuota(
    runId: string,
    mur: { reason: string; resumeAfter?: number }
  ): void {
    try {
      this.deps.onRunQuotaWalled?.(runId, mur, {
        agents: this.agentsOf(runId),
        usage: this.deps.currentExecutionUsage?.()
      })
    } catch {
      /* best-effort : sans la marque, l'état reprenable reste tel quel — jamais effacé */
    }
    this.runAgents.delete(runId)
  }

  rememberAgent(
    runId: string,
    token: string,
    patch: Partial<RunAgentRef>,
    persistence: 'best-effort' | 'required' = 'best-effort'
  ): void {
    const byToken = this.runAgents.get(runId) ?? new Map<string, RunAgentRef>()
    const previous = byToken.get(token)
    byToken.set(token, { ...(byToken.get(token) ?? { token }), ...patch, token })
    this.runAgents.set(runId, byToken)
    try {
      this.deps.onAgentsChanged?.(runId, this.agentsOf(runId))
    } catch (error) {
      if (persistence === 'required') {
        if (previous) byToken.set(token, previous)
        else byToken.delete(token)
        if (byToken.size === 0) this.runAgents.delete(runId)
        throw error
      }
      /* Les mises à jour post-spawn restent observables sans casser le run vivant. */
    }
  }

  forgetPendingAgent(runId: string, token: string): void {
    const byToken = this.runAgents.get(runId)
    if (!byToken?.delete(token)) return
    if (byToken.size === 0) this.runAgents.delete(runId)
    try {
      this.deps.onAgentsChanged?.(runId, this.agentsOf(runId))
    } catch {
      /* persistance best-effort : elle ne casse jamais le run vivant */
    }
  }

  /**
   * Le règlement et le livrable de phase seront checkpointés ensemble par `onPhaseCompleted`.
   * Modifier seulement la mémoire ici évite une fenêtre disque `activeCalls=0` sans phaseOutput,
   * qui autoriserait à rejouer un provider pourtant déjà payé après un crash immédiat.
   */
  settleAgentReservationInMemory(runId: string, reservationId: string): void {
    const byToken = this.runAgents.get(runId)
    if (!byToken) return
    const entry = [...byToken.entries()].find(([, agent]) => agent.reservationId === reservationId)
    if (!entry) return
    const [token, agent] = entry
    if (token === jetonDeReservation(reservationId)) {
      // Appel réglé sans que l'adaptateur ait jamais annoncé d'agent : il n'y a rien d'historique à
      // garder, et une occurrence inactive de cette phase serait attribuable comme auteur du livrable.
      byToken.delete(token)
    } else {
      const historical = { ...agent }
      delete historical.reservationId
      byToken.set(token, { ...historical, active: false })
    }
    const murEnAttente = this.suspendusEnAttenteDeReglement.get(runId)
    if (murEnAttente) {
      const encoreActif = [...byToken.values()].some(
        (candidate) => candidate.active === true || Boolean(candidate.reservationId)
      )
      if (encoreActif) return
      this.suspendusEnAttenteDeReglement.delete(runId)
      this.noterSuspensionParQuota(runId, murEnAttente)
      return
    }
    if (!this.terminalRunsAwaitingProviderSettlement.has(runId)) {
      if (byToken.size === 0) this.runAgents.delete(runId)
      return
    }
    const stillActive = [...byToken.values()].some(
      (candidate) => candidate.active === true || Boolean(candidate.reservationId)
    )
    if (stillActive) return
    try {
      this.deps.onRunSettled?.(runId)
    } catch {
      // Le checkpoint reste volontairement sur disque : le prochain demarrage le reconciliera.
      return
    }
    this.terminalRunsAwaitingProviderSettlement.delete(runId)
    this.runAgents.delete(runId)
  }

  /** Agents connus d'un run, pour la persistance de reprise. */
  agentsOf(runId: string): RunAgentRef[] {
    return [...(this.runAgents.get(runId)?.values() ?? [])]
  }

  _hooks?: HookBus
  /** Bus de hooks (fourni ou défaut). Uniforme pour TOUS les exécuteurs. */
  get hooks(): HookBus {
    return (this._hooks ??= this.deps.hooks ?? createDefaultHookBus())
  }

  /** Commande de vérif à rejouer (verify-replay) : explicite > convention workspace > aucune (dormant). */
  /**
   * Les fichiers DEJA modifies dans le depot quand `run()` a demarre.
   *
   * Les garde-fous de preuve visuelle et de mouvement n'ont pas le diff du run : ils relisent
   * `git status`. Sur un arbre partage deja sale, ils attribuaient au run le travail des autres
   * sessions et refusaient un vert merite (mesure du 2026-09-12, conv-512 : 217 fichiers, dont
   * 55 de rendu). Fige une fois par run, soustrait par les handlers.
   */
  fichiersSalesAuDemarrage: readonly string[] = []
  resolveVerifyCmd(cwd = this.deps.executionWorkspace): string | undefined {
    if (this.deps.verifyCmd) return this.deps.verifyCmd
    return this.deps.autoVerify ? resolveVerifyCmd(cwd) : undefined
  }

  executionOptions(
    cwd: string,
    sandbox: NonNullable<SendOptions['execution']>['sandbox'],
    runId: string,
    phase: NodePhase,
    provider: string,
    fanOut = false,
    model?: string
  ): NonNullable<SendOptions['execution']> {
    const observers = this.processObservers.get(runId)
    let executorProvider = provider
    const assignment = (): Pick<RunAgentRef, 'provider' | 'model' | 'phase' | 'fanOut'> => ({
      provider: executorProvider,
      ...(model ? { model } : {}),
      phase,
      fanOut
    })
    const causalWatchPaths = this.causalWatchPathsFor(cwd, runId)
    let learningOracles = this.learningOraclesByRun.get(runId)
    if (!learningOracles) {
      learningOracles = loadTrustedLearningOracles(cwd)
      this.learningOraclesByRun.set(runId, learningOracles)
    }
    const providerTimeoutMs = this.deps.currentExecutionQuote?.()?.limits.maxDurationMs
    const filDuRun = this.costContextByRun.get(runId)?.conversationId
    return {
      cwd,
      sandbox,
      // Le fil du run, lisible par l'agent et ses scripts (hdesk-lancer.ps1 -> petite TV du fil).
      // Et son bureau caché (AUTOWIN_HDESK_ID) : le mod Autowin y redirige une app graphique (conv-58).
      agentEnv: {
        ...(filDuRun ? { AUTOWIN_CONVERSATION_ID: filDuRun } : {}),
        AUTOWIN_HDESK_ID: identifiantBureauCache(runId)
      },
      // La phase, NOMMÉE pour qui doit la lire (voir `phaseAppelante` dans providers/types.ts).
      phaseAppelante: phase,
      ...(providerTimeoutMs ? { providerTimeoutMs } : {}),
      ...(cwd !== this.deps.executionWorkspace ? { causallyIsolated: true } : {}),
      ...(causalWatchPaths.length ? { causalWatchPaths } : {}),
      ...(learningOracles.length ? { learningOracles: [...learningOracles] } : {}),
      onProcess: observers?.process,
      onExecutorResolved: (resolvedProvider) => {
        executorProvider = resolvedProvider
      },
      onReservation: observers
        ? (reservationId) => observers.reserved(reservationId, assignment())
        : undefined,
      onSpawnIntent: observers
        ? (token, active, reservationId) =>
            observers.spawnIntent(token, active, assignment(), reservationId)
        : undefined,
      onSpawned: observers
        ? (token, pid) => observers.spawned(token, pid, assignment())
        : undefined,
      onJournal: observers
        ? (token, journalPath) => observers.journal(token, journalPath, assignment())
        : undefined,
      onReservationSettled: observers
        ? (reservationId) => observers.reservationSettled(reservationId)
        : undefined
    }
  }

  /** Collecteur de cout du run : les tours ecrits portent la conversation quand elle est connue. */
  costFor(runId: string): CostSink {
    const context = this.costContextByRun.get(runId)
    return context ? withCostContext(this.deps.cost, context) : this.deps.cost
  }

  causalWatchPathsFor(cwd: string, runId: string): string[] {
    return (this.causalWatchPathsByRun.get(runId) ?? []).flatMap((path) => {
      const absolute = isAbsolute(path)
        ? resolve(path)
        : resolve(this.deps.executionWorkspace, path)
      const rel = relative(this.deps.executionWorkspace, absolute)
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return []
      const mapped = resolve(cwd, rel)
      // Un log existant mais ignoré par Git n'est pas présent dans le worktree : ne pas inviter
      // l'agent à en fabriquer une copie. À l'inverse, une source absente PARTOUT est légitime
      // (beginAtEnd la suit dès sa création) et doit rester observée dans le worktree.
      return existsSync(mapped) || !existsSync(absolute) ? [mapped] : []
    })
  }

  /** Corps déplacé dans ./orchestrator-run.ts (conv-1508). */
  run(...args: Parameters<typeof run>): ReturnType<typeof run> {
    return run.apply(this, args)
  }

  /** Corps déplacé dans ./orchestrator-parcours-glouton.ts (conv-1508). */
  runGreedyPipeline(...args: Parameters<typeof runGreedyPipeline>): ReturnType<typeof runGreedyPipeline> {
    return runGreedyPipeline.apply(this, args)
  }

  /** Corps déplacé dans ./orchestrator-parcours-glouton.ts (conv-1508). */
  greedyJudgeAndGate(...args: Parameters<typeof greedyJudgeAndGate>): ReturnType<typeof greedyJudgeAndGate> {
    return greedyJudgeAndGate.apply(this, args)
  }

  /** Corps déplacé dans ./orchestrator-parcours-glouton.ts (conv-1508). */
  runGreedyBuildPhase(...args: Parameters<typeof runGreedyBuildPhase>): ReturnType<typeof runGreedyBuildPhase> {
    return runGreedyBuildPhase.apply(this, args)
  }

  /**
   * Enrichit l'erreur d'un `registry.send` avec le ROLE et son binding. Les erreurs brutes des
   * adaptateurs disent la cause (« codex non authentifié — … », « spawn … ENOENT ») mais jamais quel
   * role l'a subie : constate a l'ecran le 2026-07-29, l'utilisateur voyait `spawn … ENOENT` sans
   * savoir quel role pointait sur un provider indisponible. On enveloppe au plus pres de l'appel : les
   * `catch` existants en amont recoivent alors le message enrichi et le journalisent tel quel.
   */
  /**
   * Rejoue un appel provider quand l'échec est une SURCHARGE serveur explicitement temporaire
   * (529/503), ou un CLI ARRÊTÉ DE L'EXTÉRIEUR avant de répondre (une fois). Incidents
   * ak-9d3fa074346ba9da (`API Error: 529 Overloaded`) et ak-8142df0fddd513bc (`claude CLI exit
   * 1073807364`) : une seule phase faisait échouer l'orchestrate entier. Toute autre erreur remonte
   * immédiatement, inchangée.
   */
  async sendSurvivingOverload<T>(
    send: () => Promise<T>,
    onRetry?: (note: string) => void,
    signal?: AbortSignal
  ): Promise<T> {
    return retryOnTransientOverload(send, {
      ...(this.deps.sleep ? { sleep: this.deps.sleep } : {}),
      ...(signal ? { signal } : {}),
      onRetry: ({ attempt, attempts, delayMs, message, cause }) =>
        onRetry?.(
          cause === 'cli-arrete'
            ? `CLI arrêté de l’extérieur avant de répondre — phase rejouée (${attempt}/${attempts}) (${message})`
            : `Surcharge API — nouvelle tentative ${attempt}/${attempts} dans ` +
                `${(delayMs / 1000).toFixed(1)}s (${message})`
        )
    })
  }

  async sendWithRoleContext<T>(
    label: string,
    role: string,
    provider: string,
    model: string | undefined,
    send: () => Promise<T>
  ): Promise<T> {
    try {
      return await this.sendSurvivingOverload(send)
    } catch (error) {
      throw new Error(
        explainRoleFailure(label, role, {
          provider,
          ...(model ? { model } : {}),
          message: error instanceof Error ? error.message : String(error)
        }),
        // La NATURE de l'erreur doit survivre a l'enveloppe.
        //
        // Sans `cause`, un budget epuise devenait un `Error` generique indistinguable d'un modele
        // en panne — et le run se fermait `failed` comme n'importe quel echec. Constate le
        // 2026-08-10 : un run a heurte le plafond de tokens en phase `clean`, APRES avoir produit un
        // commit verifie (lint, TypeScript, 183 tests cibles, suite complete). Le commit est reste
        // orphelin dans son worktree et il a fallu deux prompts de recuperation manuelle pour le
        // retrouver. Un plafond atteint n'est pas un defaut du livrable : c'est une limite de
        // depense, et le travail deja prouve doit rester rattrapable.
        { cause: error }
      )
    }
  }

  /** Corps déplacé dans ./orchestrator-parcours-sequentiel.ts (conv-1508). */
  runInner(...args: Parameters<typeof runInner>): ReturnType<typeof runInner> {
    return runInner.apply(this, args)
  }
}

/**
 * Une citation `chemin:ligne` d'un cadrage est-elle introuvable dans le workspace ? Lecture seule.
 * Un chemin absolu ou hors du workspace n'est pas juge (non resoluble ici) : jamais reclasse.
 */
export function citationIntrouvableSurDisque(racine: string, chemin: string, ligne?: number): boolean {
  if (isAbsolute(chemin)) return false
  const absolu = resolve(racine, chemin)
  if (relative(racine, absolu).startsWith('..')) return false
  try {
    if (!statSync(absolu).isFile()) return true
    if (ligne === undefined) return false
    return readFileSync(absolu, 'utf8').split(String.fromCharCode(10)).length < ligne
  } catch {
    return true
  }
}
