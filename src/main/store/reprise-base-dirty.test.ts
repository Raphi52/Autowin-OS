import { describe, expect, it } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * LE DÉFAUT, observé EN DIRECT le 2026-08-26 en pilotant l'app.
 *
 * Une édition refusée en `blocked / base-dirty` laisse un bureau marqué « À reprendre » dans le
 * panneau Worktrees, et le message de refus dit mot pour mot : « Ouvre Worktrees … puis
 * « Reprendre » pour republier ». Or `retryRunAsync` n'acceptait que `merge-failed` et
 * `ignored-deliverables` : sur `base-dirty`, il rendait `undefined` et ne faisait RIEN.
 *
 * Le renderer appelle `window.api.retryWorktreeRecovery?.(agentId)` puis recharge la liste sans
 * regarder le résultat. Vérifié : clic réel sur « Reprendre », aucune erreur, aucun changement, le
 * bureau reste « À reprendre » et le fichier de la base reste inchangé. L'app promet un geste, le
 * geste ne fait rien, et rien ne le dit. C'est ainsi qu'on refait un travail déjà écrit.
 *
 * `base-dirty` se répare EXACTEMENT comme `merge-failed` : hors de l'app, par l'utilisateur — il
 * committe ou range sa base, puis republie. C'est même le cas le plus courant, le code le note
 * ailleurs (« 216 refus base-in-progress contre 86 base-dirty, parce que l'utilisateur travaille en
 * continu »). L'exclure fermait la porte au refus le plus fréquent.
 */
describe('reprendre un travail refusé parce que la BASE était sale', () => {
  function coordinateur(runId: string, attentionReason: string, verdict = 'unknown') {
    const manager = {
      listAgentIds: () => [runId],
      hasActiveProcesses: () => false,
      reconcileResidues: () => ({ cleaned: 0, recovered: [], blocked: [], swept: [] }),
      operationsAreIsolated: () => false,
      describe: () => {
        throw new Error('copie absente')
      },
      changedFiles: () => [],
      finalize: () => ({ outcome: 'blocked', agentId: runId, files: [], reason: attentionReason })
    }
    const stateStore = {
      list: () => [
        {
          version: 1,
          repoId: 'depot',
          runId,
          agentName: 'Agent récupéré',
          worktreePath: 'C:/absent/agent__' + runId,
          publication: 'blocked',
          attentionReason,
          verdict,
          files: [],
          sourceSha: null,
          publishedSha: null
        }
      ],
      get: () => undefined,
      save: () => {},
      remove: () => {}
    }
    return new RunWorktreeCoordinator({
      manager: manager as never,
      stateStore: stateStore as never
    } as never)
  }

  it('accepte de reprendre un refus base-dirty — le cas le plus fréquent, et il était fermé', async () => {
    const c = coordinateur('command-edit-conv-1419', 'base-dirty')
    await expect(c.retryRunAsync('command-edit-conv-1419')).resolves.toBeDefined()
  })

  it('accepte aussi base-in-progress — même nature : transitoire, réparable en réessayant', async () => {
    const c = coordinateur('command-edit-occupee', 'base-in-progress')
    await expect(c.retryRunAsync('command-edit-occupee')).resolves.toBeDefined()
  })

  it('garde intactes les reprises déjà permises', async () => {
    await expect(
      coordinateur('run-merge', 'merge-failed').retryRunAsync('run-merge')
    ).resolves.toBeDefined()
    await expect(
      coordinateur('run-ignore', 'ignored-deliverables').retryRunAsync('run-ignore')
    ).resolves.toBeDefined()
  })

  it('REFUSE toujours un travail jugé ROUGE, quelle que soit la cause du blocage', async () => {
    // On desserre la porte qui RÉCUPÈRE, jamais celle qui publie un travail jugé mauvais.
    const c = coordinateur('run-rouge', 'base-dirty', 'red')
    await expect(c.retryRunAsync('run-rouge')).resolves.toBeUndefined()
  })
})
