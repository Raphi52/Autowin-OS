import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import { WorktreeRunStateStore } from './worktree-run-state'

/**
 * LE FAUX ROUGE QUI ARRETAIT TOUS LES WORKFLOWS.
 *
 * Mesure du 2026-08-27 (conv-1423). Le fil rendait « ⛔ Workflow ARRETE au controle final —
 * resultat non valide », cause `merge-failed`, detail « Operation worktree interrompue apres
 * 32000 ms ». Or le travail ETAIT dans la base : `git log` donne `acfe64dd « agent
 * run-c2f78f117161-1 »` a 09:09:50, trente secondes AVANT le refus trace a 09:10:21.
 *
 * La chaine : `finalize` est une SEQUENCE (commit dans la copie, fusion dans la base, crochets,
 * puis suppression du dossier) a qui l'on donne le budget d'UNE commande git — 32 s. Le worker
 * signale `integrated` des que la fusion est faite, puis continue son rangement ; le client, lui,
 * rejette a l'echeance. Et le `catch` de `endAsync` fabrique alors un `blocked/merge-failed` SANS
 * regarder le SHA que `onIntegrated` vient d'ecrire.
 *
 * Deux defauts, un seul symptome. Ce test verrouille le second, celui qui MENT : une interruption
 * survenue APRES la fusion ne peut pas etre rapportee comme une fusion echouee.
 */
const SHA = '1'.repeat(40)
const AGENT = 'b'.repeat(40)
const FUSIONNE = 'a'.repeat(40)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function manager(racine: string, over: Record<string, any> = {}): any {
  return {
    acquire: vi.fn((id: string, ctx?: { worktreePath: string }) =>
      ctx?.worktreePath ?? join(racine, `agent__${id}`)
    ),
    listAgentIds: vi.fn(() => []),
    describe: vi.fn((id: string) => ({
      workspacePath: '/repo',
      worktreePath: join(racine, `agent__${id}`),
      baseBranch: 'main',
      baseSha: SHA
    })),
    changedFiles: vi.fn(() => []),
    changedFilesAsync: vi.fn(async () => ['src/main/index.ts']),
    hasActiveProcesses: vi.fn(() => false),
    markProcess: vi.fn(),
    markSpawnIntent: vi.fn(),
    confirmSpawn: vi.fn(),
    remove: vi.fn(),
    validateRecoveryContext: vi.fn(() => ({ ok: true as const })),
    cleanupPublished: vi.fn(() => ({ outcome: 'nothing', agentId: 'x', committed: false })),
    cleanupPublishedAsync: vi.fn(async () => ({
      outcome: 'nothing',
      agentId: 'x',
      committed: false
    })),
    acknowledgePublicationAsync: vi.fn(async () => true),
    ...over
  }
}

describe('RunWorktreeCoordinator — une interruption APRES la fusion ne ment plus', () => {
  it('rapporte la fusion et son SHA quand `onIntegrated` a deja parle avant le rejet', async () => {
    const root = mkdtempSync(join(tmpdir(), 'timeout-apres-fusion-'))
    try {
      const store = new WorktreeRunStateStore(root, 'repo-t')
      // Reproduit EXACTEMENT le worker reel : il signale la fusion, puis se fait couper pendant
      // le rangement qui suit.
      const finalizeAsync = vi.fn(
        async (
          _id: string,
          opts: {
            onIntegrated?: (integrated: string, agent: string, base: string) => void
          }
        ) => {
          opts.onIntegrated?.(FUSIONNE, AGENT, SHA)
          throw new Error('Opération worktree interrompue après 32000 ms')
        }
      )
      const coordinator = new RunWorktreeCoordinator({
        manager: manager(root, { finalizeAsync }),
        stateStore: store,
        nowFn: () => 10
      })
      coordinator.begin('run-t', 'Builder', true, { task: 'edit', role: 'build' })
      const res = await coordinator.endAsync('run-t', { merge: true })

      // Le coeur : le travail est publie, donc le rapport doit le DIRE.
      expect(res?.outcome).not.toBe('blocked')
      expect((res as { reason?: string }).reason).not.toBe('merge-failed')
      expect(res?.outcome).toBe('merged')
      expect((res as { publishedSha?: string }).publishedSha).toBe(FUSIONNE)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('garde le refus quand l’interruption arrive AVANT toute fusion', async () => {
    const root = mkdtempSync(join(tmpdir(), 'timeout-avant-fusion-'))
    try {
      const store = new WorktreeRunStateStore(root, 'repo-u')
      const finalizeAsync = vi.fn(async () => {
        throw new Error('Opération worktree interrompue après 32000 ms')
      })
      const coordinator = new RunWorktreeCoordinator({
        manager: manager(root, { finalizeAsync }),
        stateStore: store,
        nowFn: () => 10
      })
      coordinator.begin('run-u', 'Builder', true, { task: 'edit', role: 'build' })
      const res = await coordinator.endAsync('run-u', { merge: true })
      expect(res?.outcome).toBe('blocked')
      expect((res as { reason?: string }).reason).toBe('merge-failed')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
