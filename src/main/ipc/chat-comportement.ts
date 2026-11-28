import { ipcMain, app } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { DEFAULT_ORCHESTRATION_BUDGET } from '../orchestration/orchestration-budget'
import { listBehaviourFiles, readBehaviourFileFromManifest } from '../behaviour/behaviour-files'
import { assertTrustedRendererSender } from './ipc-senders'
import { rebuildSemanticTemporalProjection } from '../knowledge/semantic-temporal-store'
import { guardString } from './ipc-guards'
import { readBrainTraces } from '../activity/brain-trace-spool'
import { readConversationFileTraces } from '../activity/conversation-file-trace-spool'
import { buildBehaviourComposition } from '../behaviour/behaviour-composition'
import { sharedBrainRoot } from '../brain/brain-context'
import type { ContexteIpcChat } from '../index'

/**
 * LA COMPOSITION DES COMPORTEMENTS et les traces d’un fil : fichiers touchés, Brain consulté,
 * chronologie sémantique.
 *
 * Appelé par `registerChatIpc` (src/main/ipc/chat.ts), à sa place dans l’ordre du démarrage.
 * L’état du démarrage arrive par `ctx` : les `let` d’index.ts s’y lisent par accesseur (`ctx.x`)
 * pour rester vivants.
 */

/** IPC : composition des comportements et traces du fil. */
export function registerComportementIpc(ctx: ContexteIpcChat): void {
  const { behaviourAccess, causalTrace, defaultBehaviourRoot, isolatedTestInstance, os } = ctx
  // --- Config par rôle (orchestrateur / sous-agent / juge / scout) ---
  // #5 — le wizard first-run re-vérifie la config à la demande. `force` (bouton) ignore le cache TTL ;
  // sans force (montage) le cache déduplique avec le run de démarrage.
  ipcMain.handle('os:behaviourComposition', async (event, requestedWorkspace?: unknown) => {
    assertTrustedRendererSender(event, 'Behaviour composition')
    const workspace = requestedWorkspace
      ? behaviourAccess.require(guardString(requestedWorkspace, 'workspace'))
      : defaultBehaviourRoot
    const composition = buildBehaviourComposition(
      os.roles,
      process.env,
      ctx.agentTopology,
      DEFAULT_ORCHESTRATION_BUDGET.maxUsd
    )
    const files = await listBehaviourFiles(workspace)
    const inspectedFiles = await Promise.all(
      files.map(async (file) => ({
        ...file,
        excerpt:
          file.active || file.state === 'declared'
            ? (await readBehaviourFileFromManifest(file.id, files, workspace)).slice(0, 2_000)
            : undefined
      }))
    )
    return { ...composition, inspection: { workspace, files: inspectedFiles } }
  })
  ipcMain.handle('app:test:behaviour-fixture:install', (event) => {
    assertTrustedRendererSender(event, 'Fixture Behaviour')
    if (!isolatedTestInstance)
      throw new Error('Fixture Behaviour indisponible hors instance isolée')
    const workspace = join(app.getPath('userData'), 'wire-behaviour-workspace')
    mkdirSync(workspace, { recursive: true })
    writeFileSync(
      join(workspace, 'AGENTS.md'),
      '# Wire Behaviour\n\nINSTRUCTION_WORKSPACE_WIRE_ACTIVE\n',
      'utf8'
    )
    return behaviourAccess.approve(workspace)
  })
  // CE QUE LE TRAVAIL A TOUCHE : chemins lus et ecrits, tour par tour, avec l'auteur du geste.
  // La matiere existait depuis le debut cote main ; aucun canal ne la rendait au journal du chat.
  ipcMain.handle('os:conversationFileTraces', (event, rawConversationId: unknown) => {
    assertTrustedRendererSender(event, 'Conversation file traces')
    const conversationId = guardString(rawConversationId, 'conversationId')
    return readConversationFileTraces(conversationId)
  })
  ipcMain.handle('os:brainTraces', (event, rawConversationId: unknown) => {
    assertTrustedRendererSender(event, 'Brain traces')
    const conversationId = guardString(rawConversationId, 'conversationId')
    return readBrainTraces(conversationId)
  })
  ipcMain.handle('os:semanticTimeline', (event, rawConversationId: unknown) => {
    assertTrustedRendererSender(event, 'Semantic timeline')
    const conversationId = guardString(rawConversationId, 'conversationId')
    return rebuildSemanticTemporalProjection(
      {
        events: causalTrace.readConversationBestEffort(conversationId),
        brainTraces: readBrainTraces(conversationId)
      },
      { base: app.getPath('userData'), brainRoot: sharedBrainRoot() }
    )
  })
}
