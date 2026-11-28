import { registerBrainIpc } from './brain'
import { ipcMain } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { restoreTrashedKnowledge, retractKnowledgeCandidate } from '../brain/brain-inbox'
import { compensateOutcomeCuration } from '../brain/outcome-learning-curation'
import { executeCurationTransaction } from '../brain/outcome-learning-curation-transaction'
import { assertTrustedRendererSender } from './ipc-senders'
import { guardString } from './ipc-guards'
import { sharedBrainRoot } from '../brain/brain-context'
import type { ContexteIpcChat } from '../index'

/**
 * LE BRAIN ET L’APPRENTISSAGE PAR L’ISSUE : canaux du Brain, mode d’apprentissage, annulation
 * d’une curation.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 */

/** IPC : Brain et apprentissage par l’issue. */
export function registerBrainEtApprentissageIpc(ctx: ContexteIpcChat): void {
  const {
    brainInboxWorker,
    brainSearchCoordinator,
    brainSearchWorker,
    brainWorker,
    bus,
    curationRecoveryReady,
    invalidateBrainRuntime,
    os,
    outcomeLearning,
    outcomeLearningDirectory,
    outcomeLearningModePath
  } = ctx
  // Les canaux du Brain (graphe 3D, recherche, boite de reception) vivent dans
  // src/main/ipc/brain.ts.
  registerBrainIpc({
    os,
    bus,
    brainWorker,
    brainSearchWorker,
    brainInboxWorker,
    brainSearchCoordinator,
    outcomeLearning,
    curationRecoveryReady,
    invalidateBrainRuntime
  })
  ipcMain.handle('os:outcomeLearning:get', (event) => {
    assertTrustedRendererSender(event, 'OutcomeLearningRead')
    return { mode: outcomeLearning.getMode(), events: outcomeLearning.audit(30) }
  })
  ipcMain.handle(
    'os:outcomeLearning:curations',
    (event, rawOffset: number = 0, rawLimit: number = 20) => {
      assertTrustedRendererSender(event, 'OutcomeLearningCurations')
      return outcomeLearning.curationPage(rawOffset, rawLimit)
    }
  )
  ipcMain.handle('os:outcomeLearning:setMode', (event, rawMode: string) => {
    assertTrustedRendererSender(event, 'OutcomeLearningMode')
    const mode = guardString(rawMode, 'mode').trim().toLowerCase()
    if (!['off', 'shadow', 'inbox', 'auto'].includes(mode)) {
      throw new Error('mode outcome-learning invalide')
    }
    mkdirSync(outcomeLearningDirectory, { recursive: true })
    writeFileSync(outcomeLearningModePath, `${mode}\n`, { encoding: 'utf8', mode: 0o600 })
    return { mode: outcomeLearning.setMode(mode as 'off' | 'shadow' | 'inbox' | 'auto') }
  })
  ipcMain.handle('os:outcomeLearning:undoCuration', async (event, rawEventId: string) => {
    assertTrustedRendererSender(event, 'OutcomeLearningUndo')
    const eventId = guardString(rawEventId, 'eventId')
    await curationRecoveryReady
    const curation = outcomeLearning.eventById(eventId)
    if (!curation || curation.kind !== 'curation') throw new Error('curation introuvable')
    const root = sharedBrainRoot()
    const inverseAction = curation.value.action === 'restore' ? 'retract' : 'restore'
    const inverseSource =
      curation.value.action === 'retract'
        ? curation.value.targetId
        : curation.value.action === 'restore'
          ? curation.value.targetId
          : curation.value.rollbackId
    if (!inverseSource) throw new Error('curation sans point de rollback')
    return executeCurationTransaction(
      outcomeLearning,
      {
        action: inverseAction,
        knowledgeId: inverseSource,
        requestedTargetId: `undo:${curation.value.eventId}`
      },
      {
        mutate: () => {
          const compensation = compensateOutcomeCuration(curation.value, {
            restore: (id) => restoreTrashedKnowledge(root, id),
            retract: (id) => retractKnowledgeCandidate(root, id)
          })
          return {
            moved: compensation.moved,
            knowledgeId: compensation.knowledgeId,
            targetId: compensation.targetId,
            rollbackId: compensation.rollbackId,
            previousEventId: compensation.previousEventId
          }
        },
        compensate: (result) =>
          inverseAction === 'restore'
            ? retractKnowledgeCandidate(root, result.targetId)
            : restoreTrashedKnowledge(root, result.targetId),
        invalidate: invalidateBrainRuntime
      }
    )
  })
}
