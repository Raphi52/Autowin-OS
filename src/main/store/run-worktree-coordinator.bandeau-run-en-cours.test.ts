import { describe, expect, it } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * LE FAUX POSITIF STRUCTUREL DU BANDEAU.
 *
 * Le bandeau annonce des travaux TERMINES non fusionnes. Or le quatrieme gisement recense les
 * bureaux SALIS — et un bureau est sale par construction PENDANT que l'agent ecrit dedans. Le
 * bandeau reclamait donc le tri d'un travail que personne n'avait fini, et qu'aucun geste ne
 * pouvait refermer : le run en cours resalit son bureau au coup suivant.
 *
 * On ne perd rien : a la fin du run, `invaliderRecensement()` refait le releve, et le travail
 * reapparait aussitot s'il n'a pas ete publie.
 */
describe('bandeau — un run qui TOURNE n’est pas un travail oublie', () => {
  function coordinateur(): RunWorktreeCoordinator {
    const manager = {
      listAgentIds: () => ['run-en-cours', 'run-fini'],
      hasActiveProcesses: (id: string) => id === 'run-en-cours',
      reconcileResidues: () => ({ cleaned: 0, recovered: [], blocked: [], swept: [] }),
      operationsAreIsolated: () => false,
      changedFiles: () => [],
      describe: () => {
        throw new Error('copie absente')
      },
      travauxNonPublies: () => ['run-en-cours', 'run-fini'],
      apercuTravauxNonPublies: () => [
        { agentId: 'run-en-cours', date: '2026-08-28', fichiers: ['a.txt'] },
        { agentId: 'run-fini', date: '2026-08-28', fichiers: ['b.txt'] }
      ]
    }
    const stateStore = { list: () => [], get: () => undefined, save: () => {}, remove: () => {} }
    return new RunWorktreeCoordinator({
      manager: manager as never,
      stateStore: stateStore as never
    } as never)
  }

  it('n’annonce que le travail dont le run a rendu', () => {
    const c = coordinateur()
    const annonces = c.travauxNonPubliesBornes().map((e) => e.agentId)
    expect(annonces).toContain('run-fini')
    expect(annonces).not.toContain('run-en-cours')
  })
})
