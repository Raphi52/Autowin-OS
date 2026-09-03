import { describe, expect, it, vi } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * GEL MESURE le 2026-09-03 (`gels.jsonl`) : `ipc:worktree:travaux-non-publies (sync)` a bloque la
 * boucle main 16 099 ms. Le geste explicite passait par le recensement git SYNCHRONE alors que la
 * voie hors-thread existait deja. Ce test tient la voie : la liste complete se demande a l'async.
 */
describe('travaux non publies — hors du thread main', () => {
  it('passe par le recensement hors-thread et ne touche pas la voie synchrone', async () => {
    const apercuSync = vi.fn(() => [{ agentId: 'x', date: '', fichiers: [] }])
    const recensement = vi.fn(async () => ({
      ids: ['a'],
      apercu: [
        { agentId: 'a', date: '2026-09-03', fichiers: ['src/main/os.ts'] },
        { agentId: 'deja-trie', date: '', fichiers: [] }
      ]
    }))
    const coordinateur = new RunWorktreeCoordinator({
      manager: {
        listAgentIds: () => [],
        apercuTravauxNonPublies: apercuSync,
        recensementNonPubliesAsync: recensement
      } as never
    } as never)

    const rendu = await coordinateur.travauxNonPubliesAsync()

    expect(recensement).toHaveBeenCalledWith('HEAD', 100)
    expect(apercuSync).not.toHaveBeenCalled()
    expect(rendu).toEqual([{ agentId: 'a', date: '2026-09-03', fichiers: ['src/main/os.ts'] }])
  })

  it('sans worker, rend la meme reponse par la voie synchrone', async () => {
    const apercuSync = vi.fn(() => [{ agentId: 'y', date: '', fichiers: ['a.ts'] }])
    const coordinateur = new RunWorktreeCoordinator({
      manager: { listAgentIds: () => [], apercuTravauxNonPublies: apercuSync } as never
    } as never)

    await expect(coordinateur.travauxNonPubliesAsync()).resolves.toEqual([
      { agentId: 'y', date: '', fichiers: ['a.ts'] }
    ])
  })
})
