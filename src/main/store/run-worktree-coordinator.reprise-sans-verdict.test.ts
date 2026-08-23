import { describe, expect, it } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * LE DÉFAUT, mesuré le 2026-08-23 sur le dépôt réel : 14 travaux terminés attendaient sur des
 * branches `autowin/recovery/`, et AUCUN ne pouvait être réessayé.
 *
 * `retryRunAsync` exige `verdict === 'green'`. Or **11 des 14 sont des `command-edit`** — des
 * éditions directes demandées dans le chat, qui ne passent JAMAIS par un juge. Elles ne peuvent donc
 * pas être vertes : elles portent `verdict: 'unknown'`, non pas parce qu'on les a jugées douteuses,
 * mais parce que personne ne les a jugées du tout. La garde leur est fermée par construction, et
 * aucun appel de reprise ne pourra jamais rien pour elles.
 *
 * C'est une erreur de catégorie : `unknown` signifie « jamais jugé », pas « jugé mauvais ». Le seul
 * verdict qui doit interdire une reprise est `red` — celui-là a bien été jugé, et négativement.
 *
 * La reprise reste un GESTE DE L'UTILISATEUR, jamais automatique : il décide après avoir lu le diff
 * (panneau livré en `3cb617b0`). On lui rend une porte ; on ne pousse personne à travers.
 */
describe('reprendre un travail que personne n’a jamais jugé', () => {
  function coordinateur(runId: string, verdict: string) {
    const manager = {
      listAgentIds: () => [runId],
      hasActiveProcesses: () => false,
      reconcileResidues: () => ({ cleaned: 0, recovered: [], blocked: [], swept: [] }),
      operationsAreIsolated: () => false,
      describe: () => {
        throw new Error('copie absente')
      },
      changedFiles: () => [],
      finalize: () => ({ outcome: 'blocked', agentId: runId, files: [], reason: 'merge-failed' })
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
          attentionReason: 'merge-failed',
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

  it('accepte de reprendre une édition jamais jugée — sinon 11 travaux sur 14 sont perdus à jamais', async () => {
    const c = coordinateur('command-edit-jamais-juge', 'unknown')
    await expect(c.retryRunAsync('command-edit-jamais-juge')).resolves.toBeDefined()
  })

  it('REFUSE toujours un travail jugé ROUGE — celui-là a été jugé, et négativement', async () => {
    const c = coordinateur('run-juge-rouge', 'red')
    await expect(c.retryRunAsync('run-juge-rouge')).resolves.toBeUndefined()
  })

  it('accepte toujours un travail jugé vert — le comportement d’origine est intact', async () => {
    const c = coordinateur('run-vert', 'green')
    await expect(c.retryRunAsync('run-vert')).resolves.toBeDefined()
  })
})
