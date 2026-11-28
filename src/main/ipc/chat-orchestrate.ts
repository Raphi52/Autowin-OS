import { emitToLiveWindows } from '../app/renderer-emit'
import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import type { ExecutionEvidence } from '../providers/types'
import { traiterStepPourPari, resumerMesure } from '../activity/pari-step'
import type { RunLifecycleEvent } from '../../shared/run-execution'
import { classeTerminaleDEchec } from '../orchestration/classe-terminale-echec'
import { phasesAvecJuge } from '../orchestration/orchestration-memoire'
import { createOrchestrateTurnPersistence } from '../runs/orchestrate-turn-persistence'
import { appendTurnEvent } from '../runs/turn-journal'
import { reconcileLateRunLifecycle } from '../activity/late-run-usage-settlement'
import { appendObservedOrchestrationOutcome } from '../activity/orchestration-outcome-trace'
import { executionCostCoverageFields } from '../../shared/orchestration-outcome'
import {
  persistOrchestrationStep,
  persistOrchestrationPhaseStart,
  persistRunLifecycle
} from '../activity/orchestration-observability'
import { assertTrustedRendererSender } from './ipc-senders'
import { guardString } from './ipc-guards'
import { refuserTourSiDossierDisparu } from '../conversations/bascule-dossier-conversation'
import { materializeChatArtifact } from '../store/chat-artifact-store'
import { appendNativeTrace } from '../activity/native-trace-spool'
import { appendBrainTrace } from '../activity/brain-trace-spool'
import { appendExecutionEvidenceFileTrace } from '../activity/conversation-file-trace-spool'
import { artifactsFromExecutionEvidence } from '../providers/artifacts'
import type { ContexteIpcChat } from '../index'

/**
 * L’ORCHESTRATION DISCIPLINÉE (`os:orchestrate`) : le run en étapes, streamé vers l’écran,
 * persisté dans le fil et tracé (coûts, paris, issue).
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 */

/** IPC : orchestration disciplinée. */
export function registerOrchestrateIpc(ctx: ContexteIpcChat): void {
  const { broadcast, bus, causalTrace, dossierDuTour, ledger, os, parisDePhase, turnJournalRoot } =
    ctx
  // --- Orchestration disciplinée (le cœur) : streame chaque étape ---
  ipcMain.handle('os:orchestrate', async (event, task: string, targetConversationId?: string) => {
    assertTrustedRendererSender(event, 'Orchestrate')
    await os.waitUntilReady()
    const runtimeSnapshot = os.captureOrchestrationRuntime()
    const orchestratorBinding = runtimeSnapshot.roles.orchestrator
    // #6 — un conversationId explicite (ex. traitement ticket) lance la VRAIE pipeline scout→frame→
    // build→judge SUR cette conversation ; sinon on retombe sur la conversation active (comportement historique).
    const conversationId = targetConversationId ?? bus.activeConversationId ?? '__autonomous__'
    // Un fil dont le dossier rangé a disparu ne lance rien : le run partirait sinon du dépôt principal.
    refuserTourSiDossierDisparu(os.conversations.get(conversationId)?.projectPath, (raison) =>
      console.warn('[orchestrate] lancement refusé :', raison)
    )
    // #2 — run STOPPABLE : on enregistre un AbortController dans le registre du bus pour que
    // `os:orchestrate:cancel` → `abortOrchestration(conversationId, motif)` le coupe réellement
    // (sinon no-op), et le MOTIF traverse jusqu'au message que l'utilisateur lit.
    const controller = bus.registerOrchestration(conversationId)
    const turnId = randomUUID()
    // FRONTIÈRE DE PERSISTANCE : le run direct n'écrivait que le ledger et `orchestrate:step` (canal
    // sans aucun abonné renderer) — le fil restait VIDE, échec compris. On persiste donc le tour
    // comme le fait `os:pilotChat` : ouverture, une carte par étape, état terminal systématique.
    const durableTurn = createOrchestrateTurnPersistence({
      conversations: os.conversations,
      conversationId,
      turnId,
      runtime: {
        provider: orchestratorBinding.provider,
        model: orchestratorBinding.model,
        reasoningEffort: orchestratorBinding.reasoningEffort
      },
      onClosed: () => broadcast({ type: 'refresh', scope: 'conversations' }),
      journal: (durableEvent) =>
        appendTurnEvent(turnJournalRoot, conversationId, turnId, {
          ...durableEvent,
          at: Date.now()
        })
    })
    const emittedArtifactIds = new Set<string>()
    const pendingExecutionEvidence: ExecutionEvidence[] = []
    let currentRunId: string | undefined
    let terminalLifecycle: Extract<RunLifecycleEvent, { stage: 'closure' }> | undefined
    let resumedCheckpointReleased = false
    let phaseStartIteration = 0
    let learningAuthor: { model?: string; role?: string } = {}
    try {
      durableTurn.begin(guardString(task, 'task'))
      // Acquis d'un run interrompu portant la MÊME tâche dans CETTE conversation.
      const resumedAcquis =
        os.resumableOrchestrationForTask?.(
          guardString(task, 'task'),
          conversationId,
          Date.now(),
          undefined,
          runtimeSnapshot
        ) ?? null
      const result = await os.runTask(
        guardString(task, 'task'),
        (step) => {
          if (step.text?.includes('AUTOWIN_LESSON_V1:')) {
            learningAuthor = { model: step.model, role: step.role }
          }
          /*
           * LE PARI ET SON ARBITRE. Une phase qui parie sur « mon travail passera le juge » ecrit sa
           * prediction AVANT que le verdict existe ; a l'arrivee du verdict de SYNTHESE (jamais sur
           * le vote d'un membre du panel), on apparie. Toute la logique vit dans
           * `activity/pari-step.ts` pour etre testable : ici, seulement le branchement.
           */
          {
            const mesure = traiterStepPourPari(step, currentRunId, parisDePhase, (message, cause) =>
              console.warn(message, cause)
            )
            if (mesure) console.log(resumerMesure(mesure))
          }
          pendingExecutionEvidence.push(...(step.evidence ?? []))
          persistOrchestrationStep(
            step,
            {
              conversationId,
              turnId,
              iteration: step.step === 'exec' ? 0 : 1,
              runId: currentRunId
            },
            undefined,
            causalTrace
          )
          const stepArtifacts = [
            ...(step.artifacts ?? []),
            ...artifactsFromExecutionEvidence(step.evidence ?? [], {
              provider: step.provider ?? 'orchestrator',
              model: step.model,
              workspaceRoot: dossierDuTour(conversationId)
            })
          ]
          for (const artifact of stepArtifacts) {
            if (emittedArtifactIds.has(artifact.id)) continue
            emittedArtifactIds.add(artifact.id)
            try {
              const stored = materializeChatArtifact(artifact, conversationId, turnId)
              durableTurn.artifact(stored)
              emitToLiveWindows(BrowserWindow.getAllWindows(), 'pilot:event', {
                kind: 'artifact',
                artifact: stored,
                conversationId,
                turnId
              })
            } catch {
              /* une sortie illisible ne doit jamais interrompre l’orchestration */
            }
          }
          ledger.append({
            source: 'orchestrate',
            name: step.step,
            detail: `${step.role ?? ''} ${step.provider ?? ''} ${step.detail ?? ''}`.trim()
          })
          // Le fil : une carte d'action par étape, PERSISTÉE (survit au rechargement).
          durableTurn.step(step)
          // Chantier 3 — trace native : capture l'envelope réel (system porte le RAG Brain + contexte).
          if (step.prompt) {
            appendNativeTrace({
              provider: step.prompt.provider,
              model: step.prompt.model,
              conversationId,
              turnId,
              system: step.prompt.system,
              messages: step.prompt.messages,
              timestamp: new Date().toISOString()
            })
          }
          // Diffusion aux fenetres VIVANTES, jamais au WebContents capture : fermer la fenetre en
          // cours de run ne doit ni jeter (« Object has been destroyed ») ni empecher la reprise
          // d'affichage quand on la rouvre. Le run, lui, continue en tray.
          emitToLiveWindows(BrowserWindow.getAllWindows(), 'orchestrate:step', step)
        },
        (phase) => {
          if (!currentRunId) return
          persistOrchestrationPhaseStart(
            phase,
            {
              conversationId,
              turnId,
              iteration: phaseStartIteration++,
              runId: currentRunId
            },
            causalTrace
          )
        },
        undefined,
        controller.signal,
        undefined,
        // REPRISE : ce chemin DIRECT (bouton « Reprendre », pilotage programmatique) repartait de
        // zéro et repayait les phases déjà produites — seul le chemin par le chat cherchait l'acquis.
        // On le cherche ici aussi : relancer la MÊME tâche dans la MÊME conversation doit continuer,
        // pas recommencer.
        resumedAcquis?.phaseOutputs ?? [],
        conversationId,
        undefined,
        (brain) =>
          appendBrainTrace({
            ...brain,
            conversationId,
            turnId,
            kind: brain.kind ?? 'automatic'
          }),
        turnId,
        (lifecycle) => {
          currentRunId = lifecycle.runId
          if (resumedAcquis && !resumedCheckpointReleased) {
            resumedCheckpointReleased = true
            if (currentRunId !== resumedAcquis.runId) {
              os.forgetResumableOrchestration(resumedAcquis.runId)
            }
          }
          if (lifecycle.stage === 'closure') terminalLifecycle = lifecycle
          persistRunLifecycle(lifecycle, { conversationId, turnId }, causalTrace)
        },
        resumedAcquis ?? undefined,
        (usage) => {
          if (!currentRunId) return
          const settledLifecycle = reconcileLateRunLifecycle(terminalLifecycle, usage)
          if (!settledLifecycle) return
          terminalLifecycle = settledLifecycle
          persistRunLifecycle(terminalLifecycle, { conversationId, turnId }, causalTrace)
          broadcast({ type: 'orchestrate-usage', convId: conversationId })
          broadcast({ type: 'refresh', scope: 'workflows' })
          broadcast({ type: 'refresh', scope: 'orchestration' })
        },
        runtimeSnapshot,
        undefined,
        undefined,
        // LE DOSSIER DU FIL, comme `orchestrate` et la relance : la copie du run vit dans le dépôt de ce
        // dossier. Sans lui, un fil rangé sur un autre dépôt recevait une copie du dossier principal.
        { workspace: dossierDuTour(conversationId) }
      )
      if (!result.gateBlocked) {
        appendExecutionEvidenceFileTrace(pendingExecutionEvidence, {
          conversationId,
          turnId,
          workspaceRoot: dossierDuTour(conversationId),
          published: true
        })
      }
      try {
        appendObservedOrchestrationOutcome(causalTrace, {
          conversationId,
          turnId,
          outcome: { ...(result as unknown as Record<string, unknown>), runId: currentRunId }
        })
      } catch {
        /* observabilité best-effort : l'issue utilisateur reste prioritaire */
      }
      const learning = await bus.observeOutcomeLearning({
        conversationId,
        turnId,
        runId: currentRunId ?? turnId,
        resultText: result.result,
        valid: result.valid,
        gateBlocked: result.gateBlocked,
        gateReasons: result.gateReasons,
        reused: Boolean(resumedAcquis),
        evidence: result.phaseOutputs.flatMap((output) => output.executionEvidence ?? []),
        model: learningAuthor.model ?? orchestratorBinding.model,
        role: learningAuthor.role ?? 'orchestrator',
        proposalAttestations: result.learningAttestations
      })
      // La COUVERTURE de coût, projetée comme sur la lignée `commands.ts` : sans elle cette issue ne
      // portait que `costUsd` — la somme des étapes, où un tour non tarifé compte 0 — et un run dont
      // aucun appel n'est chiffré s'affichait « 0.00 $ ».
      const delivered = {
        ...result,
        // Le JUGE joue compte parmi les phases, comme sur la lignee `commands.ts`.
        phaseOutputs: phasesAvecJuge(result.phaseOutputs, result.judgeText),
        ...executionCostCoverageFields(
          result.usage,
          learningAuthor.model ?? orchestratorBinding.model
        ),
        ...(learning ? { learning } : {})
      }
      durableTurn.succeed(delivered)
      // fix-ok: publier immédiatement la clôture persistée du run direct, sans attendre un reprompt.
      broadcast({ type: 'refresh', scope: 'chat', convId: conversationId })
      return { ok: true, result: delivered }
    } catch (e) {
      const aborted = controller.signal.aborted
      const error = aborted ? 'Run annulé' : e instanceof Error ? e.message : String(e)
      await bus.observeOutcomeLearning({
        conversationId,
        turnId,
        runId: currentRunId ?? turnId,
        resultText: '',
        valid: false,
        gateBlocked: true,
        gateReasons: [error],
        reused: false,
        evidence: pendingExecutionEvidence,
        model: orchestratorBinding.model,
        // Même classement que le chemin du chat (`commands.ts`) : `classe-terminale-echec.ts`.
        terminalClass: classeTerminaleDEchec(e, aborted)
      })
      // Un échec doit se CONCLURE dans le fil : le renderer jette la promesse (`void`), donc sans ce
      // tour terminal l'erreur disparaissait entièrement.
      durableTurn.fail(error, aborted)
      return { ok: false, error, aborted }
    } finally {
      bus.clearOrchestration(conversationId, controller)
    }
  })
}
