import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * LE DÉFAUT, trouvé par l'audit du 2026-08-26 — et c'est le défaut D'ORIGINE qui se rejoue.
 *
 * `cacheNonPublies` est purement TEMPOREL (60 s) et n'est invalidé nulle part : trois occurrences
 * dans le fichier, déclaration, lecture, écriture, aucune purge. Il était tolérable tant qu'il ne
 * servait qu'au bandeau, qui se redessine. Il ne l'est plus depuis que `get_state` le lit, car
 * `snapshotForPrompt()` traverse `snapshot()` à CHAQUE tour d'agent : le cache est donc rempli
 * PENDANT le run, avant que l'agent isolé n'ait committé.
 *
 * Le scénario est exactement celui du besoin : le run finit à T, l'utilisateur dit « fusionne » à
 * T+5 s — le tour suivant — et l'agent lit l'instantané de T−40 s, donc `[]`. Il répond « rien à
 * fusionner » de bonne foi. Fenêtre d'aveuglement jusqu'à 60 s, couvrant précisément l'instant où
 * la question est posée, et l'échec est MUET : le champ existe, il est vide.
 *
 * Une TTL est un pari sur le temps. La fin d'un run est un ÉVÉNEMENT connu du coordinateur :
 * invalider dessus est gratuit et déterministe.
 */

const SHA = '1'.repeat(40)

/**
 * Le double passe par `begin`/`end` REELS : un test qui appellerait `invaliderRecensement()` a la
 * main prouverait que la methode existe, pas qu'elle est CABLEE. Sabotage du 2026-08-26 : retirer
 * l'appel dans `end()` laissait un tel test VERT — un test qui ment, exactement le defaut que cet
 * audit reprochait au lot precedent.
 */
const monter = (
  racine: string
): {
  coord: RunWorktreeCoordinator
  recense: ReturnType<typeof vi.fn>
} => {
  const recense = vi.fn(() => ['run-neuf'])
  const manager = {
    acquire: vi.fn((id: string) => join(racine, `agent__${id}`)),
    describe: vi.fn((id: string) => ({
      workspacePath: '/repo',
      worktreePath: join(racine, `agent__${id}`),
      baseBranch: 'main',
      baseSha: SHA
    })),
    changedFiles: vi.fn(() => []),
    hasActiveProcesses: vi.fn(() => false),
    markProcess: vi.fn(),
    markSpawnIntent: vi.fn(),
    confirmSpawn: vi.fn(),
    remove: vi.fn(),
    validateRecoveryContext: vi.fn(() => ({ ok: true as const })),
    cleanupPublished: vi.fn(() => ({ outcome: 'nothing', agentId: 'x', committed: false })),
    finalize: vi.fn(() => ({ outcome: 'nothing', agentId: 'run-1', committed: false })),
    travauxNonPublies: recense,
    apercuTravauxNonPublies: () => [
      { agentId: 'run-neuf', date: '2026-08-26', fichiers: ['a.ts'] }
    ],
    activity: () => [],
    listAgentIds: () => []
  }
  const coord = new RunWorktreeCoordinator({
    manager: manager as never,
    nowFn: () => 1_000
  } as never)
  return { coord, recense }
}

describe('le recensement ne sert pas une réponse périmée après la fin d’un run', () => {
  it('recalcule après un end() RÉEL, sans attendre les 60 s', () => {
    const racine = mkdtempSync(join(tmpdir(), 'recensement-'))
    try {
      const { coord, recense } = monter(racine)
      coord.begin('run-1', 'Builder', true, { task: 'edit', role: 'build' })
      coord.travauxNonPubliesBornes()
      expect(recense).toHaveBeenCalledTimes(1)

      // La FIN DU RUN est l'événement qui rend le cache faux. Horloge INCHANGÉE — c'est le point :
      // sans invalidation évènementielle, l'agent lit l'instantané d'avant le commit de l'agent.
      coord.end('run-1', { merge: false })
      coord.travauxNonPubliesBornes()

      expect(recense).toHaveBeenCalledTimes(2)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('garde le cache tant qu’aucun run ne se termine (la borne de coût tient)', () => {
    const racine = mkdtempSync(join(tmpdir(), 'recensement-'))
    try {
      const { coord, recense } = monter(racine)
      coord.travauxNonPubliesBornes()
      coord.travauxNonPubliesBornes()
      coord.travauxNonPubliesBornes()

      expect(recense).toHaveBeenCalledTimes(1)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })
})
