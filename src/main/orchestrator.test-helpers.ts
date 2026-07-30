import type { RunWorktrees } from './orchestrator'

/** Contrat d'isolation minimal pour les tests unitaires qui ne testent pas Git lui-même. */
export function makeTestWorktrees(workspace: string): RunWorktrees {
  return {
    begin: () => workspace,
    end: (_runId, options) =>
      options?.merge === false ? { outcome: 'blocked' } : { outcome: 'merged' }
  }
}
