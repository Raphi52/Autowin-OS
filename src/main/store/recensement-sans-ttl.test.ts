import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * LE GEL PÉRIODIQUE DE 18 SECONDES — mesuré, pas supposé.
 *
 * Détecteur de gel du 2026-08-28 (conv-1511) : sept blocages consécutifs du process main pendant que
 * l'utilisateur écrivait dans le chat, ~18 000 ms chacun, à 60 secondes d'intervalle EXACT
 * (18:51:07, 18:52:15, 18:53:15, 18:54:14, 18:55:16, 18:58:15, 18:59:16) — 45 % du temps
 * d'exécution passé fenêtre morte, c'est-à-dire « ce programme ne répond pas ».
 *
 * La périodicité était celle de la TTL du recensement : à son expiration, `snapshot()` — traversé à
 * CHAQUE tour d'agent — relançait un relevé git entièrement SYNCHRONE (`execFileSync`) sur la boucle
 * qui pompe les messages de la fenêtre.
 *
 * Ce test verrouille la suppression de ce pari sur le temps. Il ne dit PAS que le cache est
 * éternel : `recensement-cache-invalide.test.ts` prouve, lui, qu'un événement réel le refait.
 */

const SHA = '1'.repeat(40)

const monter = (
  racine: string,
  horloge: () => number
): { coord: RunWorktreeCoordinator; recense: ReturnType<typeof vi.fn> } => {
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
      { agentId: 'run-neuf', date: '2026-08-28', fichiers: ['a.ts'] }
    ],
    activity: () => [],
    listAgentIds: () => []
  }
  const coord = new RunWorktreeCoordinator({
    manager: manager as never,
    nowFn: horloge
  } as never)
  return { coord, recense }
}

describe('le recensement ne se refait PAS sur le simple passage du temps', () => {
  it('ne relance aucun relevé git après dix minutes sans le moindre événement', () => {
    const racine = mkdtempSync(join(tmpdir(), 'recensement-ttl-'))
    try {
      let instant = 1_000
      const { coord, recense } = monter(racine, () => instant)
      coord.travauxNonPubliesBornes()
      expect(recense).toHaveBeenCalledTimes(1)

      // Dix minutes : sous l'ancienne TTL, DIX relevés synchrones de plus — dix gels de la fenêtre.
      for (let minute = 1; minute <= 10; minute++) {
        instant += 60_000
        coord.travauxNonPubliesBornes()
      }

      expect(recense).toHaveBeenCalledTimes(1)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })
})
