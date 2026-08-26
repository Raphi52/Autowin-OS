import { describe, expect, it, vi } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * LE DÉFAUT, mesuré le 2026-08-26 pendant la passe de nettoyage — introduit par le correctif
 * `f75ece18` lui-même.
 *
 * `get_state` a été câblé sur `os.travauxNonPublies()`, la variante SANS BORNE. Or son commentaire
 * d'origine dit exactement pourquoi elle ne borne rien : « c'est un geste EXPLICITE de
 * l'utilisateur, pas un rafraichissement d'ecran ». Et `snapshotForPrompt()` appelle `snapshot()`,
 * lui-même appelé à CHAQUE tour d'agent (`agent-pilot.ts:656`).
 *
 * Coût mesuré sur ce dépôt (19 bureaux) : 76 processus git, 10,4 SECONDES. Par tour.
 *
 * La leçon est plus large que la perf : brancher une lecture chère sur un chemin chaud parce
 * qu'elle est « déjà là » contredit une décision de conception écrite noir sur blanc trois lignes
 * plus haut. Ce test verrouille le chemin, pas le chrono — un test de durée serait instable.
 */

type OsDouble = ConstructorParameters<typeof AppCommandBus>[0]

const osAvecLesDeuxChemins = (
  cher: () => Array<{ agentId: string; date: string; fichiers: string[] }>,
  borne: () => Array<{ agentId: string; date: string; fichiers: string[] }>
): OsDouble =>
  ({
    executionWorkspace: process.cwd(),
    conversations: { list: () => [] },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => undefined },
    runsWithGate: async () => [],
    budget: () => ({ pricedSpendUsd: 0 }),
    getWorktreeActivity: () => [],
    travauxNonPublies: cher,
    travauxNonPubliesBornes: borne
  }) as unknown as OsDouble

describe('get_state lit le recensement BORNÉ, jamais celui qui scanne tout', () => {
  it('n’appelle PAS la variante sans borne', async () => {
    const cher = vi.fn(() => [])
    const borne = vi.fn(() => [])
    const bus = new AppCommandBus(osAvecLesDeuxChemins(cher, borne), () => undefined)

    await bus.snapshot()

    expect(cher).not.toHaveBeenCalled()
    expect(borne).toHaveBeenCalled()
  })

  it('rend bien ce que la variante bornée a trouvé', async () => {
    const attendu = [{ agentId: 'run-x', date: '2026-08-26', fichiers: ['src/a.ts'] }]
    const bus = new AppCommandBus(
      osAvecLesDeuxChemins(
        () => [{ agentId: 'jamais-lu', date: '', fichiers: [] }],
        () => attendu
      ),
      () => undefined
    )

    await expect(bus.snapshot()).resolves.toMatchObject({ travauxNonPublies: attendu })
  })
})
