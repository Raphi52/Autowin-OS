import { describe, expect, it, vi } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import type { FinalizeResult } from './worktree-manager'

/**
 * UNE ATTENTE SE NOMME. L'ABSENCE D'ISSUE, NON.
 *
 * CAUSE RACINE du poste 5, établie le 2026-08-31 sur DEUX témoins indépendants :
 *
 * 1. Le manifeste du run vécu (`.runs/run-f42d9a79ad99-1.json`) : `verdict: green`,
 *    `publication: "blocked"`, `conflictFile: JarvisWidget.tsx`. La finalisation AVAIT une cause —
 *    elle est simplement arrivée APRÈS le verdict du run.
 * 2. `commands.ts:3390`, vécu conv-1404 : « Le coordinateur rend `undefined` quand la copie a
 *    encore des processus actifs — typiquement les workers `vitest` que la vérification vient
 *    elle-même de lancer : elle passe en attente et `retryRecovery` la publie ensuite. »
 *
 * `undefined` disait donc DEUX choses incompatibles : « rien à faire » et « pas encore ». `edit_file`
 * a reçu un correctif local ; l'orchestrateur, non — le même différé y devenait un rouge SANS cause,
 * et face à un faux échec l'agent RECOMMENCE (2,13 $ sur conv-1, 16 fichiers verts jamais publiés).
 *
 * On nomme donc l'attente à sa SOURCE, une seule fois, au lieu de la deviner chez chaque appelant.
 */
function manager(over: Record<string, unknown> = {}) {
  return {
    acquire: (id: string) => `/wt/${id}`,
    finalize: (id: string) =>
      ({ outcome: 'merged', agentId: id, committed: true }) as FinalizeResult,
    cleanupPublished: (id: string) =>
      ({ outcome: 'merged', agentId: id, committed: false }) as FinalizeResult,
    changedFiles: () => ['os.ts'],
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
    ...over
  }
}

describe('le coordinateur NOMME l’attente au lieu de se taire', () => {
  it('CLI encore vivant → issue « deferred » portant sa cause, pas undefined', () => {
    const finalize = vi.fn()
    const co = new RunWorktreeCoordinator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manager: manager({ finalize, hasActiveProcesses: () => true }) as any,
      nowFn: () => 5
    })
    co.begin('run-1', 'Builder', true)

    const issue = co.end('run-1')

    expect(issue).toMatchObject({
      outcome: 'deferred',
      agentId: 'run-1',
      reason: 'processes-still-running'
    })
    // L'attente n'est pas une fusion : rien n'a été finalisé, et la reprise reste armée.
    expect(finalize).not.toHaveBeenCalled()
    expect(co.activity()[0]).toMatchObject({ state: 'working', endedAtMs: undefined })
  })

  it('la reprise publie ensuite normalement — l’attente n’était pas un échec', () => {
    let actif = true
    const finalize = vi.fn(
      (id: string) => ({ outcome: 'merged', agentId: id, committed: true }) as FinalizeResult
    )
    const co = new RunWorktreeCoordinator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manager: manager({ finalize, hasActiveProcesses: () => actif }) as any,
      nowFn: () => 5
    })
    co.begin('run-2', 'Builder', true)
    expect(co.end('run-2')).toMatchObject({ outcome: 'deferred' })

    actif = false
    co.retryRecovery()

    expect(finalize).toHaveBeenCalledTimes(1)
    expect(co.activity()[0]).toMatchObject({ state: 'merged', endedAtMs: 5 })
  })

  it('un run NON-mutation ne fabrique aucune attente : il n’y a rien à publier', () => {
    const co = new RunWorktreeCoordinator({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manager: manager() as any,
      nowFn: () => 5
    })
    co.begin('run-3', 'Analyste', false)
    expect(co.end('run-3')).toBeUndefined()
  })
})
