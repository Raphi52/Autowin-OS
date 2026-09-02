/**
 * LES CANAUX DES COPIES DE TRAVAIL (cockpit worktree), sortis de `src/main/index.ts`.
 *
 * Neuf canaux : l'activité et l'état des copies, le travail non publié et son correctif, puis les
 * gestes de sortie de conflit (résoudre, réessayer, préserver-puis-libérer, jeter).
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, gardes d'expéditeur inchangés, et
 * SURTOUT la même validation d'identifiant (`/^[A-Za-z0-9_-]+$/`) sur les quatre gestes qui
 * touchent une copie — c'est elle qui empêche un identifiant fabriqué d'atteindre le disque.
 *
 * Un seul point de forme : la fixture de test était une variable locale d'`index.ts`, écrite par le
 * canal `app:test:worktree-fixture` (qui reste là-bas) et lue ici par `worktree:activity` et
 * `worktree:status`. Elle devient l'état de CE module, et `index.ts` la pose par
 * `poserFixtureDeTest` au lieu de partager une variable.
 */
import { ipcMain } from 'electron'
import type { AutowinOS } from '../os'
import { scopeWorktreeActivity } from '../../shared/worktree-activity-model'
import { assertTrustedRendererSender } from '../ipc-senders'

/** Ce que le canal de fixture de test injecte, en INSTANCE ISOLÉE uniquement. */
export type WorktreeFixtureDeTest = {
  activity: ReturnType<AutowinOS['getWorktreeActivity']>
  status: ReturnType<AutowinOS['getWorktreeRuntimeStatus']>
}

export type WorktreeIpcDeps = { os: AutowinOS }

export type WorktreeIpc = {
  /** Pose la fixture lue par `worktree:activity` et `worktree:status`. */
  poserFixtureDeTest: (fixture: WorktreeFixtureDeTest) => void
}

export function registerWorktreeIpc({ os }: WorktreeIpcDeps): WorktreeIpc {
  // Cockpit worktree (volet A) : snapshot a la demande + push live des changements d'activite.
  let worktreeFixture: WorktreeFixtureDeTest | undefined
  ipcMain.handle('worktree:activity', (event, conversationId?: unknown) => {
    assertTrustedRendererSender(event, 'WorktreeActivity')
    const activity = worktreeFixture?.activity ?? os.getWorktreeActivity()
    return scopeWorktreeActivity(
      activity,
      typeof conversationId === 'string' && conversationId.trim() ? conversationId : undefined
    )
  })
  ipcMain.handle('worktree:travaux-non-publies', (event) => {
    assertTrustedRendererSender(event, 'TravauxNonPublies')
    return os.travauxNonPublies()
  })
  ipcMain.handle('worktree:patch-non-publie', (event, agentId?: unknown) => {
    assertTrustedRendererSender(event, 'PatchTravailNonPublie')
    return typeof agentId === 'string'
      ? os.patchTravailNonPublie(agentId)
      : { patch: '', tronque: false }
  })
  ipcMain.handle('worktree:status', (event) => {
    assertTrustedRendererSender(event, 'WorktreeStatus')
    return worktreeFixture?.status ?? os.getWorktreeRuntimeStatus()
  })
  ipcMain.handle('worktree:conflict-diff', (event, agentId: unknown) => {
    assertTrustedRendererSender(event, 'WorktreeConflictDiff')
    return os.getWorktreeConflictDiff(typeof agentId === 'string' ? agentId : '')
  })
  ipcMain.handle('worktree:resolve-conflict', (event, agentId: unknown, choice: unknown) => {
    assertTrustedRendererSender(event, 'WorktreeResolveConflict')
    if (typeof agentId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(agentId)) {
      throw new Error('Identifiant de bureau invalide')
    }
    if (choice !== 'agent' && choice !== 'mine') {
      throw new Error('Choix de résolution invalide')
    }
    return os.resolveWorktreeConflict(agentId, choice)
  })
  ipcMain.handle('worktree:retry-recovery', (event, agentId: unknown) => {
    assertTrustedRendererSender(event, 'WorktreeRetryRecovery')
    if (typeof agentId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(agentId)) {
      throw new Error('Identifiant de bureau invalide')
    }
    return os.retryWorktreeRecovery(agentId)
  })
  /**
   * Liberation SURE d'une copie : le travail est preserve dans `autowin/recovery/<id>` AVANT
   * suppression. Distinct de `worktree:discard-held`, qui supprime sans preserver.
   */
  ipcMain.handle('worktree:preserve-release', (event, agentId: unknown) => {
    assertTrustedRendererSender(event, 'WorktreePreserveRelease')
    if (typeof agentId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(agentId)) {
      throw new Error('Identifiant de bureau invalide')
    }
    return os.preserverEtLibererWorktree(agentId)
  })
  ipcMain.handle('worktree:discard-held', (event, agentId: unknown) => {
    assertTrustedRendererSender(event, 'WorktreeDiscardHeld')
    if (typeof agentId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(agentId)) {
      throw new Error('Identifiant de bureau invalide')
    }
    return os.discardHeldWorktree(agentId)
  })

  return {
    poserFixtureDeTest: (fixture) => {
      worktreeFixture = fixture
    }
  }
}
