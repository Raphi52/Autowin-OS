import { describe, expect, it, vi } from 'vitest'
import { DETAIL_RUN_SUSPENDU, RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * UN RUN ARRÊTÉ PAR LE MUR DE QUOTA GARDE SA COPIE (conv-914 / conv-916, 2026-10-13).
 *
 * Sa reprise rouvre CETTE copie (`resumeExisting`). La finalisation rouge ordinaire libère une copie
 * vide et classe « triée » une copie pleine : sur un run suspendu, la première fait échouer la
 * reprise (« copie durable absente »), la seconde fait taire un travail qui n'a pas été refusé.
 * Les deux jumeaux (`end`, `endAsync`) sont couverts : ce fichier a déjà payé un correctif posé sur
 * un seul des deux.
 */
const managerDouble = (fichiers: string[]) => {
  const marquerTravailTrie = vi.fn().mockReturnValue(true)
  const preserverEtLiberer = vi.fn().mockReturnValue({ outcome: 'libere' })
  const manager = {
    acquire: (id: string) => `/tmp/agent__${id}`,
    listAgentIds: () => [],
    remove: () => undefined,
    changedFiles: () => fichiers,
    changedFilesAsync: async () => fichiers,
    finalize: () => ({ ok: true, files: [] }),
    finalizeAsync: async () => ({ ok: true, files: [] }),
    describe: (id: string) => ({
      workspacePath: '/repo',
      worktreePath: `/tmp/agent__${id}`,
      baseBranch: 'main',
      baseSha: '2'.repeat(40)
    }),
    marquerTravailTrie,
    preserverEtLiberer
  } as unknown as ConstructorParameters<typeof RunWorktreeCoordinator>[0]['manager']
  return { manager, marquerTravailTrie, preserverEtLiberer }
}

describe('run suspendu par le mur de quota', () => {
  it('copie VIDE : gardée pour la reprise (sync et async)', async () => {
    for (const asynchrone of [false, true]) {
      const { manager, preserverEtLiberer, marquerTravailTrie } = managerDouble([])
      const co = new RunWorktreeCoordinator({ manager, nowFn: () => 1 })
      co.begin('run-mur', 'Run coupé en phase frame', true)
      if (asynchrone) await co.endAsync('run-mur', { merge: false, suspendu: true })
      else co.end('run-mur', { merge: false, suspendu: true })
      expect(preserverEtLiberer).not.toHaveBeenCalled()
      expect(marquerTravailTrie).not.toHaveBeenCalled()
      expect(co.activity()[0]).toMatchObject({ state: 'ready', verdict: 'red' })
    }
  })

  it('copie PLEINE : ni libérée ni classée triée, et le motif est dit (sync et async)', async () => {
    for (const asynchrone of [false, true]) {
      const { manager, preserverEtLiberer, marquerTravailTrie } = managerDouble(['src/main/os.ts'])
      const co = new RunWorktreeCoordinator({ manager, nowFn: () => 1 })
      co.begin('run-mur', 'Run coupé en phase clean', true)
      if (asynchrone) await co.endAsync('run-mur', { merge: false, suspendu: true })
      else co.end('run-mur', { merge: false, suspendu: true })
      expect(preserverEtLiberer).not.toHaveBeenCalled()
      expect(marquerTravailTrie).not.toHaveBeenCalled()
      expect(co.activity()[0]).toMatchObject({ state: 'ready', verdict: 'red' })
    }
  })

  it('témoin : un run rouge ordinaire vide est toujours libéré', () => {
    const { manager, preserverEtLiberer } = managerDouble([])
    const co = new RunWorktreeCoordinator({ manager, nowFn: () => 1 })
    co.begin('run-rouge', 'Run refusé', true)
    co.end('run-rouge', { merge: false })
    expect(preserverEtLiberer).toHaveBeenCalledWith('run-rouge')
  })

  it('le libellé dit pourquoi la copie attend', () => {
    expect(DETAIL_RUN_SUSPENDU).toMatch(/mur de quota/)
  })
})
