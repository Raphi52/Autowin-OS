import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import type { RunWorktrees } from '../orchestrator'

/*
 * La porte « livraison par Git externe » de l'orchestrateur exige une copie SANS fichier. Elle lisait
 * `activity().files`, vide jusqu'à la finalisation : run-a8a70cd0ee56-1 (16 fichiers, fusion refusée)
 * a été déclaré intégré, et sa clôture a commité le travail d'autres conversations (conv-914,
 * 2026-10-13). Ces tests tiennent la MESURE qui la remplace.
 */
function coordinateur(manager: Record<string, unknown>): RunWorktreeCoordinator {
  return new RunWorktreeCoordinator({
    manager: {
      acquire: (id: string) => `/wt/${id}`,
      remove: () => {},
      listAgentIds: () => [],
      markProcess: () => {},
      markSpawnIntent: () => {},
      confirmSpawn: () => {},
      hasActiveProcesses: () => false,
      validateRecoveryContext: () => ({ ok: true as const }),
      describe: (id: string) => ({
        workspacePath: '/repo',
        worktreePath: `/wt/${id}`,
        baseBranch: 'main',
        baseSha: '1111111'
      }),
      ...manager
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    nowFn: () => 1
  })
}

describe('coordinateur — fichiers réellement changés dans la copie', () => {
  it('rend les fichiers de la copie alors que activity().files est encore vide', async () => {
    const co = coordinateur({ changedFilesAsync: async () => ['src/a.ts', 'src/b.ts'] })
    co.begin('run-1', 'Builder', true)
    expect(co.activity().find((a) => a.agentId === 'run-1')?.files).toEqual([])
    await expect(co.fichiersChangesDeLaCopie('run-1')).resolves.toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('retombe sur la mesure synchrone quand le gestionnaire n’a pas de version asynchrone', async () => {
    const co = coordinateur({ changedFiles: () => ['src/c.ts'] })
    await expect(co.fichiersChangesDeLaCopie('run-1')).resolves.toEqual(['src/c.ts'])
  })

  it('laisse REMONTER une erreur de mesure : elle ne doit jamais se lire « copie vide »', async () => {
    const co = coordinateur({
      changedFilesAsync: async () => {
        throw new Error('copie illisible')
      }
    })
    await expect(co.fichiersChangesDeLaCopie('run-1')).rejects.toThrow('copie illisible')
  })

  it('le coordinateur remis à l’orchestrateur par os.ts porte bien la mesure', () => {
    const mesure: RunWorktrees['fichiersChangesDeLaCopie'] =
      coordinateur({}).fichiersChangesDeLaCopie
    expect(typeof mesure).toBe('function')
    const os = readFileSync(new URL('../os.ts', import.meta.url), 'utf8')
    expect(os).toMatch(/readonly worktrees\?: RunWorktreeCoordinator/)
    expect(os).toMatch(/worktrees: this\.worktrees/)
  })
})
