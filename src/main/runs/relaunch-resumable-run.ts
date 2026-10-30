/**
 * LA RELANCE D'UN RUN REPRENABLE, SORTIE DE `index.ts` POUR ETRE EXERCEE PLUTOT QUE LUE.
 *
 * Ce cablage vivait dans une fermeture de 360 lignes au milieu du demarrage. Faute de pouvoir
 * l'appeler, ses gardes le verifiaient en LISANT LE TEXTE de `index.ts` :
 * `indexOf('const relaunchResumableRun =')` puis `toContain('populateConvRunSections(...')`. Une
 * telle assertion ne prouve aucun COMPORTEMENT — elle prouve qu'une suite de caracteres est
 * presente. Mesure le 2026-08-26 : Prettier a renvoye un argument a la ligne, le garde est passe
 * au rouge sur `main`, et le comportement etait intact ; le test accusait le code.
 *
 * TOUTES les dependances sont injectees et AUCUNE n'est importee a l'execution. Le module ne tire
 * donc ni `electron`, ni le disque, ni un provider : un test peut le faire tourner avec un faux
 * `os` et OBSERVER les effets reels (le RUN.md rattache avant `runTask`, la trace sauvee sur le
 * succes comme sur l'echec, le run clos, les sections peuplees) au lieu de relire du texte.
 */
import type { AppCommandBus, AppEvent } from '../commands'
import type { AutowinOS } from '../os'
import type { TraceStore } from '../activity/trace-store'
import type { ExecutionEvidence } from '../providers/types'
import type { RunLifecycleEvent } from '../../shared/run-execution'
import type { IssueDuTour } from '../../shared/plan-de-lots'
import type { OrchestrationRunState } from './orchestration-state'

/**
 * LE PLAN DE LOTS SUIT LE RUN REPRIS (conv-1308, 2026-10-30). Un lot lancé en `/build` tourne dans un
 * run. Au redémarrage, ce run repart par ce module, pas par `reprendreAppelChat` (index.ts) : rien ne
 * prévenait le plan, son lot restait « interrompu » et sa fin n'enchaînait aucun lot.
 */
export type SuiviDuPlan = {
  /** Un run repart dans ce fil : son lot redevient en cours. */
  agentRepris: (conversationId: string, tour?: string) => void
  /** Le run est fini : même observateur qu'une fin de tour de chat. */
  finDuRun: (conversationId: string, issue: IssueDuTour) => void
}

/** Le résultat d'un run, lu comme la fin d'un tour : mêmes règles que la clôture du fil. */
export function issueDuRunRepris(resultat: {
  result?: string
  valid?: boolean
  gateBlocked?: boolean
  gateReasons?: unknown
}): IssueDuTour {
  const texte = resultat.result?.trim()
  const avecTexte = texte ? { texte } : {}
  if (!resultat.gateBlocked && resultat.valid !== false) return { ok: true, ...avecTexte }
  const raisons = Array.isArray(resultat.gateReasons)
    ? resultat.gateReasons.filter((raison): raison is string => typeof raison === 'string')
    : []
  return {
    ok: false,
    erreur: raisons.join(' ; ') || texte || 'Livraison refusée par le contrôle final.',
    ...avecTexte
  }
}

/** Un run clos sans résultat. Un lot adopté passe en échec, un lot interrompu attend « Reprendre ». */
export function issueDuRunPerdu(erreur: string): IssueDuTour {
  return { ok: false, perdu: true, erreur }
}

/**
 * Annonce la fin d'un run repris. Quand une reprise d'APPEL CHAT possède encore ce tour, c'est elle
 * qui annonce : une orchestration lancée du chat partage son `turnId`, et le chat peut répondre
 * après le run. `tour` sert au plan à écarter le run d'un autre tour du même fil.
 */
export function annoncerFinDuRun(
  deps: Pick<DependancesDeRelance, 'plansDeLots' | 'appelChatReprisPourTour'>,
  run: { conversationId?: string; turnId?: string },
  issue: IssueDuTour
): void {
  const { conversationId, turnId } = run
  if (!deps.plansDeLots || !conversationId) return
  if (turnId && deps.appelChatReprisPourTour(conversationId, turnId)) return
  deps.plansDeLots.finDuRun(conversationId, {
    ...issue,
    repris: true,
    ...(turnId ? { tour: turnId } : {})
  })
}

/**
 * Le contrat de la relance. Chaque membre est un EFFET que la reprise produit sur le monde : le
 * declarer ici, c'est le rendre observable par un test, et rendre sa disparition detectable
 * autrement que par une recherche de chaine.
 */
export type DependancesDeRelance = {
  os: Pick<
    AutowinOS,
    | 'reconcileResumableOrchestrationForRelaunch'
    | 'waitUntilReady'
    | 'conversations'
    | 'captureOrchestrationRuntime'
    | 'runTask'
    | 'forgetResumableOrchestration'
    | 'rememberAgentOffsets'
    | 'executionWorkspace'
  >
  bus: Pick<AppCommandBus, 'observeOutcomeLearning'>
  broadcast: (event: AppEvent) => void
  causalTrace: TraceStore
  turnJournalRoot: string
  appendConvActivity: typeof import('../activity/conv-activity').appendConvActivity
  admitAutomaticResumeRuntime: typeof import('./orchestration-state').admitAutomaticResumeRuntime
  createOrchestrateTurnPersistence: typeof import('./orchestrate-turn-persistence').createOrchestrateTurnPersistence
  appendTurnEvent: typeof import('./turn-journal').appendTurnEvent
  reuseOrCreateConvRun: typeof import('./conv-runs').reuseOrCreateConvRun
  regimePhases: typeof import('../task-regime').regimePhases
  saveConvRunTrace: typeof import('./conv-runs').saveConvRunTrace
  loadConvRunTrace: typeof import('./conv-runs').loadConvRunTrace
  populateConvRunSections: typeof import('./conv-runs').populateConvRunSections
  closeConvRun: typeof import('./conv-runs').closeConvRun
  phasesAvecJuge: typeof import('../orchestration-memoire').phasesAvecJuge
  persistOrchestrationStep: typeof import('../activity/orchestration-observability').persistOrchestrationStep
  persistOrchestrationPhaseStart: typeof import('../activity/orchestration-observability').persistOrchestrationPhaseStart
  persistRunLifecycle: typeof import('../activity/orchestration-observability').persistRunLifecycle
  materializeChatArtifact: typeof import('../store/chat-artifact-store').materializeChatArtifact
  artifactsFromExecutionEvidence: typeof import('../providers/artifacts').artifactsFromExecutionEvidence
  emitToLiveWindows: typeof import('../renderer-emit').emitToLiveWindows
  appendBrainTrace: typeof import('../activity/brain-trace-spool').appendBrainTrace
  appendExecutionEvidenceFileTrace: typeof import('../activity/conversation-file-trace-spool').appendExecutionEvidenceFileTrace
  appendObservedOrchestrationOutcome: typeof import('../activity/orchestration-outcome-trace').appendObservedOrchestrationOutcome
  executionCostCoverageFields: typeof import('../../shared/orchestration-outcome').executionCostCoverageFields
  reconcileLateRunLifecycle: typeof import('../activity/late-run-usage-settlement').reconcileLateRunLifecycle
  classifierRefusDeReprise: typeof import('./resume-refusal').classifierRefusDeReprise
  /** Clôture `red` qui nomme une cause extérieure → `interrupted` (piste 4, conv-1070). */
  statutDuRunMd: typeof import('./conv-runs').statutDuRunMd
  /** Stop, quota, panne en face : la cause d'un arrêt étranger au travail (piste 4, conv-1070). */
  causeDInterruption: typeof import('../classe-terminale-echec').causeDInterruption
  randomUUID: () => string
  /** Fenetres vivantes a notifier. Injecte pour que le module ne depende pas d'`electron`. */
  fenetresVivantes: () => { webContents: { send: (canal: string, charge: unknown) => void } }[]
  defaultProcessIdentity: typeof import('../store/worktree-manager').defaultProcessIdentity
  /**
   * Vrai quand une reprise d'APPEL CHAT possède ce tour. Une orchestration lancée depuis le chat
   * partage le `turnId` de son tour de chat : la relance du run ne doit pas le fermer à sa place.
   */
  appelChatReprisPourTour: (conversationId: string, turnId: string) => boolean
  /** Une reprise qui a tué l'app au démarrage précédent n'est pas rejouée (conv-1150). */
  gardePlantage?: import('./garde-reprise-plantage').GardeRepriseCrash
  /** Absent : aucun plan de lots à prévenir. */
  plansDeLots?: SuiviDuPlan
}

/** Le candidat de relance : son fil et son tour servent quand le point de reprise a disparu. */
type CandidatDeRelance = Pick<OrchestrationRunState, 'runId'> &
  Partial<Pick<OrchestrationRunState, 'conversationId' | 'turnId'>>

/** Ce que le plan apprendra à la sortie de la relance, posé par chaque chemin. */
type FinDeRelance = {
  run: { conversationId?: string; turnId?: string }
  issue: IssueDuTour
}

export function creerRelanceDeRunReprenable(
  deps: DependancesDeRelance
): (candidate: CandidatDeRelance) => Promise<void> {
  const {
    os,
    bus,
    broadcast,
    causalTrace,
    turnJournalRoot,
    appendConvActivity,
    admitAutomaticResumeRuntime,
    createOrchestrateTurnPersistence,
    appendTurnEvent,
    reuseOrCreateConvRun,
    regimePhases,
    saveConvRunTrace,
    loadConvRunTrace,
    populateConvRunSections,
    closeConvRun,
    phasesAvecJuge,
    persistOrchestrationStep,
    persistOrchestrationPhaseStart,
    persistRunLifecycle,
    materializeChatArtifact,
    artifactsFromExecutionEvidence,
    emitToLiveWindows,
    appendBrainTrace,
    appendExecutionEvidenceFileTrace,
    appendObservedOrchestrationOutcome,
    executionCostCoverageFields,
    reconcileLateRunLifecycle,
    classifierRefusDeReprise,
    statutDuRunMd,
    causeDInterruption,
    randomUUID,
    fenetresVivantes,
    defaultProcessIdentity,
    appelChatReprisPourTour,
    gardePlantage,
    plansDeLots
  } = deps

  const relaunchResumableRun = async (
    candidate: CandidatDeRelance,
    fin: FinDeRelance
  ): Promise<void> => {
    const resumableRun = os.reconcileResumableOrchestrationForRelaunch(
      candidate.runId,
      defaultProcessIdentity,
      (settlement) => {
        appendConvActivity(settlement.conversationId, {
          kind: settlement.phase === 'judge' ? 'judge' : 'exec',
          label: settlement.phase,
          provider: settlement.provider,
          ...(settlement.model ? { model: settlement.model } : {}),
          costUsd: settlement.costUsd,
          inputTokens: settlement.inputTokens,
          outputTokens: settlement.outputTokens,
          cacheReadTokens: settlement.cacheReadTokens,
          usageCallId: settlement.callId,
          text: `Usage provider récupéré après redémarrage du run ${candidate.runId}.`
        })
      }
    )
    if (!resumableRun) return
    fin.run = resumableRun
    // Avant tout chargement : c'est la reprise elle-même qui a fait mourir l'app (OOM du 26/10).
    if (gardePlantage?.aPlanteAuparavant(resumableRun.runId)) {
      os.forgetResumableOrchestration(resumableRun.runId)
      gardePlantage.retirer(resumableRun.runId)
      console.warn(
        '[resume-orchestration]',
        resumableRun.runId,
        "→ l'app est morte pendant la reprise précédente : run abandonné, checkpoint retiré"
      )
      if (resumableRun.conversationId) {
        appendConvActivity(resumableRun.conversationId, {
          kind: 'exec',
          label: 'reprise',
          provider: 'orchestrator',
          text: `Run ${resumableRun.runId} abandonné : sa reprise au démarrage précédent a fait planter l'app.`
        })
      }
      fin.issue = issueDuRunPerdu(
        `run ${resumableRun.runId} abandonné : sa reprise au démarrage précédent a fait planter l’app.`
      )
      return
    }
    gardePlantage?.poser(resumableRun.runId)
    try {
      await os.waitUntilReady()
    } catch (error) {
      console.warn('[resume-orchestration] topologie indisponible, checkpoint conserve :', error)
      fin.issue = issueDuRunPerdu(`run ${resumableRun.runId} non repris : modèles indisponibles.`)
      return
    }
    // La file de démarrage sérialise les reprises : celle-ci part peut-être longtemps après son tri,
    // et « Reprendre tout » ou le réveil après quota passent par ici sans passer par le démarrage.
    if (resumableRun.conversationId)
      plansDeLots?.agentRepris(resumableRun.conversationId, resumableRun.turnId)
    const conversationId = resumableRun.conversationId ?? '__autonomous__'
    const recordedTurnRuntime = resumableRun.turnId
      ? os.conversations
          .get(conversationId)
          ?.messages.find(
            (message) => message.role === 'assistant' && message.turnId === resumableRun.turnId
          )?.runtime
      : undefined
    const resumedRuntime = admitAutomaticResumeRuntime(
      resumableRun,
      os.captureOrchestrationRuntime(),
      randomUUID(),
      recordedTurnRuntime
    )
    const { resumeExisting, turnId: resumeTurnId, turnBinding: resumeBinding } = resumedRuntime
    // Tour d'origine à fermer si la reprise en ouvre un nouveau — sauf s'il appartient à une
    // reprise d'appel chat, qui le fermera elle-même.
    const tourDOrigine =
      resumableRun.turnId && !appelChatReprisPourTour(conversationId, resumableRun.turnId)
        ? resumableRun.turnId
        : undefined
    const durableResumeTurn = createOrchestrateTurnPersistence({
      conversations: os.conversations,
      conversationId,
      turnId: resumeTurnId,
      runtime: {
        provider: resumeBinding.provider,
        model: resumeBinding.model,
        reasoningEffort: resumeBinding.reasoningEffort
      },
      resumeExisting,
      supersededTurnId: tourDOrigine,
      journalSuperseded: (event) => {
        if (tourDOrigine) appendTurnEvent(turnJournalRoot, conversationId, tourDOrigine, event)
      },
      // La liste allume un spinner tant que ce tour est `streaming` : elle doit apprendre sa fin.
      onClosed: () => broadcast({ type: 'refresh', scope: 'conversations' }),
      journal: (event) => appendTurnEvent(turnJournalRoot, conversationId, resumeTurnId, event)
    })
    // Le run repris s'exécutait SANS son RUN.md : trace.json jamais persistée → panneau Juges
    // vide sur tout run repris (défaut mesuré 14/08 sur les runs relancés au boot). On rattache
    // le MÊME RUN.md que l'orchestration d'origine (workflow ouvert de la conversation portant la
    // même tâche), on y accumule le fil, et on le clôt comme le chemin nominal de commands.ts.
    const resumedRunFile = resumableRun.conversationId
      ? await reuseOrCreateConvRun(
          resumableRun.conversationId,
          resumableRun.task,
          undefined,
          undefined,
          // Meme croisement que le chemin nominal : sans lui, un run REPRIS dont le RUN.md a
          // disparu se reverrait semer les cases mutation/tests/commit qu'aucune phase de
          // lecture ne peut cocher.
          regimePhases(resumableRun.task)
        ).catch(() => undefined)
      : undefined
    /*
     * LE FIL REPART DE CE QUE LE DISQUE PORTE DÉJÀ (conv-1021, 2026-10-19).
     *
     * Le run d'origine réécrit `trace.json` à chaque étape (`commands.ts`), et la reprise rattache
     * son MÊME RUN.md. Partir d'une liste vide écrasait donc, dès la première étape reprise, tout ce
     * qui avait été joué avant le redémarrage — les verdicts des juges compris. L'orchestrateur ne
     * rejoue pas les étapes des phases déjà payées (`dejaPayee`, orchestrator.ts) : il n'y a rien à
     * dédoublonner, seuls les repères de passage de réparation se répètent.
     */
    const resumedSteps: Parameters<typeof saveConvRunTrace>[1] = resumedRunFile
      ? [...(loadConvRunTrace(resumedRunFile.path) ?? [])]
      : []
    const resumedArtifactIds = new Set<string>()
    const pendingResumedExecutionEvidence: ExecutionEvidence[] = []
    let resumedCurrentRunId: string | undefined
    let resumedPublishedSha: string | undefined
    let resumedTerminalLifecycle: Extract<RunLifecycleEvent, { stage: 'closure' }> | undefined
    let resumedCheckpointReleased = false
    let resumedPhaseStartIteration = 0
    let resumedLearningAuthor: { model?: string; role?: string } = {}
    durableResumeTurn.begin(resumedRuntime.task)
    broadcast({ type: 'orchestrate-start', convId: conversationId, task: resumableRun.task })
    console.log(
      '[resume-orchestration]',
      resumableRun.runId,
      '→ phases déjà acquises :',
      resumableRun.phaseOutputs.map((output) => output.phase).join(', ')
    )
    await resumedRuntime
      .run((runtimeSnapshot) =>
        os.runTask(
          resumableRun.task,
          (step) => {
            if (step.text?.includes('AUTOWIN_LESSON_V1:')) {
              resumedLearningAuthor = { model: step.model, role: step.role }
            }
            pendingResumedExecutionEvidence.push(...(step.evidence ?? []))
            resumedSteps.push(step)
            durableResumeTurn.step(step)
            // Même règle que le run direct (`commands.ts`) : écrite AVANT la diffusion, pour que
            // l'interface qui relit le fichier en recevant l'étape la trouve déjà.
            if (resumedRunFile) saveConvRunTrace(resumedRunFile.path, resumedSteps)
            broadcast({ type: 'orchestrate-step', convId: conversationId, step })
            persistOrchestrationStep(
              step,
              {
                conversationId,
                turnId: resumeTurnId,
                iteration: step.step === 'exec' ? 0 : 1,
                runId: resumedCurrentRunId
              },
              undefined,
              causalTrace
            )
            const stepArtifacts = [
              ...(step.artifacts ?? []),
              ...artifactsFromExecutionEvidence(step.evidence ?? [], {
                provider: step.provider ?? 'orchestrator',
                model: step.model,
                workspaceRoot: os.executionWorkspace
              })
            ]
            for (const artifact of stepArtifacts) {
              if (resumedArtifactIds.has(artifact.id)) continue
              resumedArtifactIds.add(artifact.id)
              try {
                const stored = materializeChatArtifact(artifact, conversationId, resumeTurnId)
                durableResumeTurn.artifact(stored)
                emitToLiveWindows(fenetresVivantes(), 'pilot:event', {
                  kind: 'artifact',
                  artifact: stored,
                  conversationId,
                  turnId: resumeTurnId
                })
              } catch {
                /* artefact best-effort pendant la reprise */
              }
            }
            for (const w of fenetresVivantes()) w.webContents.send('orchestrate:step', step)
          },
          (phase) => {
            broadcast({ type: 'orchestrate-phase', convId: conversationId, phase })
            if (!resumedCurrentRunId) return
            persistOrchestrationPhaseStart(
              phase,
              {
                conversationId,
                turnId: resumeTurnId,
                iteration: resumedPhaseStartIteration++,
                runId: resumedCurrentRunId
              },
              causalTrace
            )
          },
          undefined,
          undefined,
          undefined,
          resumableRun.phaseOutputs,
          resumableRun.conversationId,
          resumableRun.bindingOverride,
          (brain) =>
            appendBrainTrace({
              ...brain,
              conversationId,
              ...(resumeTurnId ? { turnId: resumeTurnId } : {}),
              kind: brain.kind ?? 'automatic'
            }),
          resumeTurnId,
          (lifecycle) => {
            resumedCurrentRunId = lifecycle.runId
            if (lifecycle.stage === 'git' && lifecycle.git.outcome === 'merged') {
              resumedPublishedSha = lifecycle.git.commitSha
            }
            // Une reprise moderne garde l'identité du run pour conserver sa copie Git. Elle vient
            // donc de réécrire le même checkpoint : seuls les anciens chemins à nouvelle identité
            // ont encore un checkpoint historique distinct à retirer.
            if (!resumedCheckpointReleased) {
              resumedCheckpointReleased = true
              if (resumedCurrentRunId !== resumableRun.runId) {
                os.forgetResumableOrchestration(resumableRun.runId)
              }
            }
            if (lifecycle.stage === 'closure') resumedTerminalLifecycle = lifecycle
            persistRunLifecycle(
              lifecycle,
              { conversationId, turnId: resumeTurnId, runPath: resumedRunFile?.path },
              causalTrace
            )
          },
          resumableRun,
          (usage) => {
            if (!resumedCurrentRunId) return
            const settledLifecycle = reconcileLateRunLifecycle(resumedTerminalLifecycle, usage)
            if (!settledLifecycle) return
            resumedTerminalLifecycle = settledLifecycle
            persistRunLifecycle(
              resumedTerminalLifecycle,
              { conversationId, turnId: resumeTurnId, runPath: resumedRunFile?.path },
              causalTrace
            )
            broadcast({ type: 'orchestrate-usage', convId: conversationId })
            broadcast({ type: 'refresh', scope: 'workflows' })
            broadcast({ type: 'refresh', scope: 'orchestration' })
          },
          runtimeSnapshot
        )
      )
      .then(async (result) => {
        if (!result.gateBlocked) {
          appendExecutionEvidenceFileTrace(pendingResumedExecutionEvidence, {
            conversationId,
            turnId: resumeTurnId,
            workspaceRoot: os.executionWorkspace,
            published: true
          })
        }
        try {
          appendObservedOrchestrationOutcome(causalTrace, {
            conversationId,
            turnId: resumeTurnId,
            outcome: {
              ...(result as unknown as Record<string, unknown>),
              runId: resumedCurrentRunId
            }
          })
        } catch {
          /* observabilité best-effort pendant la reprise */
        }
        const learning = await bus.observeOutcomeLearning({
          conversationId,
          turnId: resumeTurnId,
          runId: resumedCurrentRunId ?? resumableRun.runId,
          resultText: result.result,
          valid: result.valid,
          gateBlocked: result.gateBlocked,
          gateReasons: result.gateReasons,
          reused: true,
          evidence: result.phaseOutputs.flatMap((output) => output.executionEvidence ?? []),
          model: resumedLearningAuthor.model ?? resumeBinding.model,
          role: resumedLearningAuthor.role ?? 'orchestrator',
          proposalAttestations: result.learningAttestations
        })
        // Meme projection que le run direct : une reprise n'a pas de raison de mentir sur son cout.
        const delivered = {
          ...result,
          ...executionCostCoverageFields(
            result.usage,
            resumedLearningAuthor.model ?? resumeBinding.model
          ),
          ...(learning ? { learning } : {})
        }
        durableResumeTurn.succeed(delivered)
        fin.issue = issueDuRunRepris(delivered)
        const deliveryStatus = result.gateBlocked || !result.valid ? 'red' : 'green'
        if (resumedRunFile) {
          saveConvRunTrace(resumedRunFile.path, resumedSteps)
          populateConvRunSections(
            resumedRunFile.path,
            phasesAvecJuge(result.phaseOutputs, result.judgeText),
            { publishedCommitSha: resumedPublishedSha }
          )
          const closureStatus =
            resumedTerminalLifecycle && resumedTerminalLifecycle.closure.status !== 'open'
              ? statutDuRunMd(resumedTerminalLifecycle.closure)
              : deliveryStatus
          closeConvRun(
            resumedRunFile.path,
            closureStatus,
            result.gateBlocked
              ? `Reprise — gate BLOQUÉ: ${result.gateReasons.join('; ')}`
              : 'Reprise après redémarrage — run rejoué et clos avec sa trace.'
          )
          broadcast({ type: 'refresh', scope: 'workflows' })
        }
        broadcast({
          type: 'orchestrate-end',
          convId: conversationId,
          ...(resumedRunFile
            ? { runPath: resumedRunFile.path }
            : resumedCurrentRunId
              ? { runPath: resumedCurrentRunId }
              : {}),
          status: deliveryStatus
        })
        broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
        return delivered
      })
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        fin.issue = { ok: false, erreur: message }
        // Refus DÉFINITIFS : sans cette classification, le checkpoint restait en place et le
        // même run rejouait sa reprise (et son échec) à chaque boot (mesuré 13/08, deux boots).
        const refus = classifierRefusDeReprise(message)
        if (refus === 'publication-acquise') {
          const dejaPublie =
            'Publication Git déjà acquise pour ce run ; reprise automatique annulée sans nouvel appel provider.'
          durableResumeTurn.succeed({ result: dejaPublie })
          fin.issue = { ok: true, texte: dejaPublie }
          os.forgetResumableOrchestration(resumableRun.runId)
          broadcast({
            type: 'orchestrate-end',
            convId: conversationId,
            runPath: resumableRun.runId,
            status: 'green'
          })
          broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
          console.warn(
            '[resume-orchestration]',
            resumableRun.runId,
            '→ checkpoint retiré : publication déjà engagée = succès, pas un échec à rejouer'
          )
          return
        }
        // `contexte-de-reprise-invalide` rejoint `copie-durable-absente` : même verdict, même
        // geste — l'échec est conclu UNE fois et le checkpoint est oublié, sinon la source ne
        // tarit jamais et le bandeau ⛔ se rejoue à chaque boot.
        if (refus === 'copie-durable-absente' || refus === 'contexte-de-reprise-invalide') {
          durableResumeTurn.fail(
            `${message} Reprise définitivement impossible — checkpoint retiré, ce run ne sera plus rejoué.`,
            false
          )
          os.forgetResumableOrchestration(resumableRun.runId)
          broadcast({
            type: 'orchestrate-end',
            convId: conversationId,
            runPath: resumableRun.runId,
            status: 'red'
          })
          broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
          console.warn(
            '[resume-orchestration]',
            resumableRun.runId,
            '→ copie durable absente : échec conclu une fois, checkpoint retiré'
          )
          return
        }
        await bus.observeOutcomeLearning({
          conversationId,
          turnId: resumeTurnId,
          runId: resumedCurrentRunId ?? resumableRun.runId,
          resultText: '',
          valid: false,
          gateBlocked: true,
          gateReasons: [message],
          reused: true,
          evidence: pendingResumedExecutionEvidence,
          model: resumeBinding.model,
          terminalClass: 'defect'
        })
        durableResumeTurn.fail(message, false)
        if (resumedRunFile) {
          saveConvRunTrace(resumedRunFile.path, resumedSteps)
          const interrompue = causeDInterruption(error, false)
          closeConvRun(
            resumedRunFile.path,
            interrompue ? 'interrupted' : 'red',
            `${interrompue ? 'Reprise interrompue' : 'Reprise en échec'}: ${message.slice(0, 120)}`
          )
          broadcast({ type: 'refresh', scope: 'workflows' })
        }
        broadcast({
          type: 'orchestrate-end',
          convId: conversationId,
          ...(resumedRunFile
            ? { runPath: resumedRunFile.path }
            : resumedCurrentRunId
              ? { runPath: resumedCurrentRunId }
              : {}),
          status: 'red'
        })
        broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
        console.warn('[resume-orchestration] échec de la reprise :', error)
      })
  }

  // UN SEUL point de sortie pour le plan : chaque chemin ci-dessus pose son issue, et une sortie
  // imprévue compte comme un run perdu. Sans cela, un lot adopté resterait en cours à jamais.
  return async (candidate) => {
    const fin: FinDeRelance = {
      run: candidate,
      issue: issueDuRunPerdu('reprise du run arrêtée sans résultat.')
    }
    try {
      await relaunchResumableRun(candidate, fin)
    } finally {
      annoncerFinDuRun(deps, fin.run, fin.issue)
    }
  }
}
