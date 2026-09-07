import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import { WorktreeRunStateStore } from './worktree-run-state'

/**
 * DEUX DÉFAUTS D'UNE PUBLICATION CONCURRENTE, MESURÉS LE 2026-09-06.
 *
 * Trois runs lancés en parallèle sur le même dépôt par `cdp-trois-conversations-proof` : le
 * premier publie, LES DEUX AUTRES ÉCHOUENT. Ce que git disait vraiment :
 *
 *   fatal: Unable to create '.../.git/index.lock': File exists.
 *   fatal: update_ref failed for ref 'ORIG_HEAD': cannot lock ref 'ORIG_HEAD'
 *
 * 1. LE MOTIF MENTAIT. L'interface annonçait `merge-failed` — « la fusion dans la base a été
 *    refusée », conseil « republie à la main » — alors qu'aucune fusion n'avait eu lieu et que
 *    republier ne pouvait rien tant que l'autre publication tenait le verrou. Le correctif du
 *    2026-09-06 avait requalifié deux familles de messages sur trois ; la troisième (`ORIG_HEAD`)
 *    ressortait encore fausse, parce que son motif est décidé PLUS TÔT, dans le gestionnaire de
 *    copies — une vingtaine de retours `reason: 'merge-failed'`. D'où une requalification au
 *    point de passage UNIQUE de tout refus, et non site par site.
 *
 * 2. LES PUBLICATIONS N'ÉTAIENT PAS SÉRIALISÉES. Les copies sont séparées et les fichiers
 *    distincts, mais la publication écrit dans le MÊME dépôt de base, et git n'y tolère qu'une
 *    opération d'index à la fois. Aucune file d'attente, aucun verrou applicatif : deux
 *    publications sur trois échouaient sur un verrou tenu par la première.
 */
const SHA = '1'.repeat(40)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function manager(racine: string, over: Record<string, any> = {}): any {
  return {
    acquire: vi.fn(
      (id: string, ctx?: { worktreePath: string }) =>
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

function coordinateur(racine: string, over: Record<string, unknown>): RunWorktreeCoordinator {
  return new RunWorktreeCoordinator({
    manager: manager(racine, over),
    stateStore: new WorktreeRunStateStore(racine, 'repo-serialise'),
    nowFn: () => 10
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

describe('RunWorktreeCoordinator — un verrou tenu, et une seule publication à la fois', () => {
  it('le verrou ORIG_HEAD nest plus annonce comme une fusion refusee', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verrou-orig-head-'))
    try {
      // Le motif vient du GESTIONNAIRE, pas du `catch` : c'est le chemin qui restait faux.
      const finalizeAsync = vi.fn(async (id: string) => ({
        outcome: 'blocked' as const,
        agentId: id,
        files: ['src/main/index.ts'],
        reason: 'merge-failed' as const,
        detail: "fatal: update_ref failed for ref 'ORIG_HEAD': cannot lock ref 'ORIG_HEAD'"
      }))
      const c = coordinateur(root, { finalizeAsync })
      c.begin('run-verrou', 'Builder', true, { task: 'edit', role: 'build' })
      const res = await c.endAsync('run-verrou', { merge: true })

      expect(res?.outcome).toBe('blocked')
      // Le coeur : « laisse l'operation en cours se terminer », pas « republie a la main ».
      expect((res as { reason?: string }).reason).toBe('base-in-progress')
      // Et l'activite montree a l'utilisateur dit la meme chose que le resultat.
      expect(c.activity().find((a) => a.agentId === 'run-verrou')?.attentionReason).toBe(
        'base-in-progress'
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('un VRAI conflit de contenu reste une fusion refusee', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vrai-conflit-'))
    try {
      const finalizeAsync = vi.fn(async (id: string) => ({
        outcome: 'blocked' as const,
        agentId: id,
        files: ['src/main/index.ts'],
        reason: 'merge-failed' as const,
        detail: 'CONFLICT (content): Merge conflict in src/main/index.ts'
      }))
      const c = coordinateur(root, { finalizeAsync })
      c.begin('run-conflit', 'Builder', true, { task: 'edit', role: 'build' })
      const res = await c.endAsync('run-conflit', { merge: true })
      // Requalifier trop large remplacerait un motif faux par un autre.
      expect((res as { reason?: string }).reason).toBe('merge-failed')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('trois publications lancees ensemble ne se chevauchent JAMAIS', async () => {
    const root = mkdtempSync(join(tmpdir(), 'publications-serialisees-'))
    try {
      let enCours = 0
      let chevauchementMax = 0
      const finalizeAsync = vi.fn(async (id: string) => {
        enCours += 1
        chevauchementMax = Math.max(chevauchementMax, enCours)
        await new Promise((r) => setTimeout(r, 5))
        enCours -= 1
        return {
          outcome: 'merged' as const,
          agentId: id,
          files: ['src/main/index.ts'],
          publishedSha: SHA,
          baseSha: SHA
        }
      })
      const c = coordinateur(root, { finalizeAsync })
      for (const id of ['run-a', 'run-b', 'run-c']) {
        c.begin(id, 'Builder', true, { task: 'edit', role: 'build' })
      }
      const res = await Promise.all(
        ['run-a', 'run-b', 'run-c'].map((id) => c.endAsync(id, { merge: true }))
      )

      // Le coeur : la deuxieme attend la premiere, au lieu de buter sur son `index.lock`.
      expect(chevauchementMax).toBe(1)
      expect(finalizeAsync).toHaveBeenCalledTimes(3)
      expect(res.map((r) => r?.outcome)).toEqual(['merged', 'merged', 'merged'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('une publication qui ECHOUE ne fige pas la file des suivantes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'file-non-figee-'))
    try {
      const finalizeAsync = vi.fn(async (id: string) => {
        if (id === 'run-x') throw new Error('publication cassee')
        return {
          outcome: 'merged' as const,
          agentId: id,
          files: ['src/main/index.ts'],
          publishedSha: SHA,
          baseSha: SHA
        }
      })
      const c = coordinateur(root, { finalizeAsync })
      c.begin('run-x', 'Builder', true, { task: 'edit', role: 'build' })
      c.begin('run-y', 'Builder', true, { task: 'edit', role: 'build' })
      const [x, y] = await Promise.all([
        c.endAsync('run-x', { merge: true }),
        c.endAsync('run-y', { merge: true })
      ])
      expect(x?.outcome).toBe('blocked')
      // Sans cette garantie, un seul refus bloquerait toutes les publications de la session.
      expect(y?.outcome).toBe('merged')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
