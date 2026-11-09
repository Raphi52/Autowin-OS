import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorktreeManager } from './worktree-manager'
import { racineDe } from './worktree-manager.test-helpers'

/**
 * Le processus annexe n'existe pas dans un test : son fichier est absent, donc le gestionnaire ne le
 * fabrique pas. Ici on fait croire qu'il est là, et on capte ce qu'on lui donne à sa création. Les autres
 * fichiers restent réels ; seul `mkdirSync` est espionné, sans effet, pour qu'aucun dossier ne soit créé.
 */
const espion = vi.hoisted(() => ({
  creations: [] as Array<{ chemin: string; options: unknown }>,
  mkdirs: [] as unknown[][]
}))

vi.mock('node:fs', async (importOriginal) => {
  const reel = await importOriginal<typeof import('node:fs')>()
  return {
    ...reel,
    existsSync: (chemin: Parameters<typeof reel.existsSync>[0]) =>
      String(chemin).endsWith('worktree-operation-worker.js') || reel.existsSync(chemin),
    mkdirSync: (...args: unknown[]) => {
      espion.mkdirs.push(args)
    }
  }
})

vi.mock('node:worker_threads', async (importOriginal) => {
  const reel = await importOriginal<typeof import('node:worker_threads')>()
  class WorkerCapte {
    constructor(chemin: string, options: unknown) {
      espion.creations.push({ chemin, options })
    }
  }
  return { ...reel, Worker: WorkerCapte }
})

describe('processus annexe : il reçoit la racine unique à sa création', () => {
  it('ses données de création portent la racine unique et les réglages du gestionnaire', () => {
    const depot = join(tmpdir(), 'fabrique-worker', 'depot')
    const wtRoot = join(tmpdir(), 'fabrique-worker', 'wt')
    const racine = join(tmpdir(), 'fabrique-worker', 'copies-de-taches')
    const m = new WorktreeManager({
      baseRepo: depot,
      worktreeRoot: wtRoot,
      racineCopiesDeTaches: racine
    })

    const client = m.operationClient as unknown as { workerFactory: () => unknown } | undefined
    expect(client, 'le gestionnaire doit disposer du processus annexe').toBeDefined()
    client!.workerFactory()

    expect(espion.creations).toHaveLength(1)
    const [creation] = espion.creations
    expect(creation.chemin).toMatch(/worktree-operation-worker\.js$/)
    expect((creation.options as { workerData?: unknown }).workerData).toEqual({
      baseRepo: depot,
      worktreeRoot: wtRoot,
      racineCopiesDeTaches: racine,
      requireCanonicalRemote: false
    })
  })
})

describe('fabrication d’une racine de test', () => {
  it('racineDe rend le chemin sans créer aucun dossier, même pour un chemin fictif', () => {
    racineDe('C:/fabrique-worker-fictif/wt')
    expect(espion.mkdirs.filter(([chemin]) => String(chemin).includes('fabrique-worker'))).toEqual(
      []
    )
  })
})
