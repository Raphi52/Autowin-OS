import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import { WorktreeRunStateStore } from './worktree-run-state'

/**
 * LE RÉCONCILIATEUR DES COPIES NE TIENT PLUS LA FENÊTRE SUR `git rev-list` (2026-10-31).
 *
 * Mesure `gels.jsonl`, 2026-10-31 19:27:23 UTC : `execFileSync git rev-list` 125,7 s, le pire gel
 * unitaire des 2 derniers jours, depuis `commitsDejaReferences` appelé par `reconcileExisting`.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER : un appel à la voie synchrone quand la voie asynchrone existe. La
 * règle de sûreté, elle, ne change pas : sans réponse de git, aucun manifeste n'est retiré.
 */
const SHA = 'a'.repeat(40)
const dansHistorique = 'b'.repeat(40)
const orphelin = 'c'.repeat(40)

function preparer(racine: string): WorktreeRunStateStore {
  const store = new WorktreeRunStateStore(racine, 'repo-a')
  for (const [runId, sha] of [
    ['run-publie', dansHistorique],
    ['run-orphelin', orphelin]
  ] as const) {
    store.save({
      version: 1,
      repoId: 'repo-a',
      runId,
      agentName: 'Builder',
      baseBranch: 'main',
      baseSha: SHA,
      verdict: 'green',
      publication: 'blocked',
      worktreePath: join(racine, `agent__${runId}`),
      files: [],
      createdAtMs: 10,
      updatedAtMs: 20,
      sourceSha: sha
    })
  }
  return store
}

/** Gestionnaire minimal : la réconciliation part par la voie isolée, comme dans l'app. */
function gestionnaire(over: Record<string, unknown>): never {
  return {
    assertAvailable: () => undefined,
    listAgentIds: () => [],
    operationsAreIsolated: () => true,
    recoveryInventoryAsync: async () => ({ agents: [], residues: { swept: [] } }),
    hasActiveProcesses: () => false,
    describe: () => undefined,
    ...over
  } as never
}

async function jusqua(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i += 1) {
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('réconciliation au démarrage — références des manifestes', () => {
  it('interroge git par la voie asynchrone, jamais par la synchrone', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'aos-references-'))
    try {
      const store = preparer(racine)
      const synchrones: string[][] = []
      const asynchrones: string[][] = []
      new RunWorktreeCoordinator({
        manager: gestionnaire({
          commitsDejaReferences: (shas: readonly string[]) => {
            synchrones.push([...shas])
            return new Map()
          },
          commitsDejaReferencesAsync: async (shas: readonly string[]) => {
            asynchrones.push([...shas])
            return new Map(shas.map((sha) => [sha, sha === dansHistorique]))
          }
        }),
        stateStore: store,
        nowFn: () => 30
      })
      await jusqua(() => store.get('run-publie') === undefined)
      expect(synchrones).toEqual([])
      expect(asynchrones).toHaveLength(1)
      expect(store.get('run-publie')).toBeUndefined()
      expect(store.get('run-orphelin')).toBeTruthy()
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('une lecture ratée ne retire aucun manifeste et ne retombe pas sur le fil principal', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'aos-references-'))
    try {
      const store = preparer(racine)
      let synchrones = 0
      let asynchrones = 0
      new RunWorktreeCoordinator({
        manager: gestionnaire({
          commitsDejaReferences: () => {
            synchrones += 1
            return new Map()
          },
          commitsDejaReferencesAsync: async () => {
            asynchrones += 1
            throw new Error('worker indisponible')
          }
        }),
        stateStore: store,
        nowFn: () => 30
      })
      await jusqua(() => asynchrones > 0)
      await new Promise((r) => setTimeout(r, 30))
      expect(synchrones).toBe(0)
      expect(store.get('run-publie')).toBeTruthy()
      expect(store.get('run-orphelin')).toBeTruthy()
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })
})
