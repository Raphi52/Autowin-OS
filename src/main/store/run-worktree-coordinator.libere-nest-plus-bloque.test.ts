import { describe, expect, it } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * LIBÉRER UNE COPIE DOIT LEVER SON BLOCAGE — sinon le cockpit garde un blocage FANTÔME.
 *
 * Vécu le 2026-08-27 sur l'app en marche : un run refusé en `base-dirty` a été libéré par
 * `worktree:preserve-release`, qui a répondu `{outcome:'libere'}` et supprimé la copie du disque.
 * L'activité, elle, continuait d'annoncer `state: blocked / base-dirty` — pour une copie qui
 * n'existait plus, donc qu'AUCUN geste ne pouvait plus débloquer : un retry n'a plus de copie à
 * republier. La cause : `preserverEtLiberer` déléguait au gestionnaire (disque + branche) sans
 * jamais toucher l'état du run, ni émettre.
 *
 * `discardHeldAsync` faisait déjà le bon geste (`runs.delete` + `stateStore.remove` + `emit`) : le
 * même, ici, à la différence près que le travail est PRÉSERVÉ sur sa branche avant de rendre le
 * disque. Un refus (`refuse`) ne clôt rien : la copie est toujours là, son blocage est réel.
 */
describe('RunWorktreeCoordinator — une copie libérée n’est plus un blocage', () => {
  const RUN = 'run-libere-1'

  function coordinateur(outcome: string) {
    const supprimes: string[] = []
    const manager = {
      listAgentIds: () => [RUN],
      hasActiveProcesses: () => false,
      reconcileResidues: () => ({ cleaned: 0, recovered: [], blocked: [], swept: [] }),
      operationsAreIsolated: () => false,
      describe: () => {
        throw new Error('copie absente')
      },
      changedFiles: () => [],
      preserverEtLiberer: (id: string) => {
        supprimes.push(id)
        return { outcome }
      }
    }
    const stateStore = {
      list: () => [
        {
          version: 1,
          repoId: 'depot',
          runId: RUN,
          agentName: 'Agent',
          worktreePath: 'C:/copie/agent__run-libere-1',
          publication: 'blocked',
          verdict: 'green',
          files: [],
          attentionReason: 'base-dirty',
          sourceSha: null,
          publishedSha: null
        }
      ],
      get: () => undefined,
      save: () => {},
      remove: (id: string) => supprimes.push(`state:${id}`)
    }
    const c = new RunWorktreeCoordinator({
      manager: manager as never,
      stateStore: stateStore as never
    } as never)
    return { c, supprimes }
  }

  it('après une libération réussie, le run ne figure plus comme bloqué', () => {
    const { c } = coordinateur('libere')
    expect(c.activity().find((a) => a.agentId === RUN)?.state).toBe('blocked')

    expect(c.preserverEtLiberer(RUN).outcome).toBe('libere')

    expect(c.activity().find((a) => a.agentId === RUN)).toBeUndefined()
  })

  it('une préservation avec travail clôt aussi le blocage', () => {
    const { c } = coordinateur('preserve-et-libere')
    c.preserverEtLiberer(RUN)
    expect(c.activity().find((a) => a.agentId === RUN)).toBeUndefined()
  })

  it('un REFUS ne clôt rien : la copie est là, le blocage est réel', () => {
    const { c } = coordinateur('refuse')
    c.preserverEtLiberer(RUN)
    expect(c.activity().find((a) => a.agentId === RUN)?.state).toBe('blocked')
  })
})
