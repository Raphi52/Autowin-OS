import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * ATTRIBUER la lenteur, pas la constater.
 *
 * L'onglet Latence montre `snapshot` à p95 1 288 ms / max 19 250 ms par tour — mais `snapshot` est
 * un SEUL jalon qui recouvre trois lectures très différentes (runs, bureaux, recensement git). Sans
 * sous-jalons, la prochaine enquête recommence à zéro. `snapshotForPrompt` accepte donc un
 * marqueur, et le renseigne étape par étape.
 */
type OsDouble = ConstructorParameters<typeof AppCommandBus>[0]

const os = (lent: () => void): OsDouble =>
  ({
    executionWorkspace: process.cwd(),
    conversations: { list: () => [] },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => undefined },
    runsWithGate: async () => [],
    budget: () => ({ pricedSpendUsd: 0 }),
    getWorktreeActivity: () => {
      lent()
      return []
    },
    travauxNonPublies: () => [],
    travauxNonPubliesBornes: () => []
  }) as unknown as OsDouble

describe('snapshotForPrompt — sous-jalons', () => {
  it('marque CHAQUE lecture du snapshot, dans l’ordre', async () => {
    const jalons: string[] = []
    const bus = new AppCommandBus(
      os(() => jalons.push('…lecture bureaux…')),
      () => {}
    )
    await bus.snapshotForPrompt((nom) => jalons.push(nom))
    // Entrée qui ferait échouer un marquage global : la lecture des bureaux est encadrée par deux
    // jalons distincts, donc le coût lui est IMPUTABLE.
    expect(jalons).toEqual([
      'snapshot:runs',
      '…lecture bureaux…',
      'snapshot:worktrees',
      'snapshot:travauxNonPublies'
    ])
  })

  it('sans marqueur, le snapshot fonctionne exactement comme avant', async () => {
    const bus = new AppCommandBus(
      os(() => {}),
      () => {}
    )
    await expect(bus.snapshotForPrompt()).resolves.toMatchObject({ providers: ['claude'] })
  })
})
