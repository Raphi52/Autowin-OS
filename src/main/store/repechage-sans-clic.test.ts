import { describe, expect, it, vi } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import { DELAI_ENTRE_DEUX_REPECHAGES_MS } from './repechage-automatique'

/**
 * LE DÉFAUT, bout en bout : `retryRunAsync` n'avait AUCUN appelant automatique dans tout
 * `src/main`. Le seul chemin vers la republication passait par un `onClick`. Ces tests vérifient
 * qu'un travail dormant repart désormais SANS que personne ne clique — et, aussi important, qu'un
 * travail jugé mauvais reste où il est.
 *
 * On appelle le balayage directement plutôt que d'attendre la minuterie : l'horloge est injectée,
 * mais faire dormir un test cinq minutes pour prouver un intervalle serait un test lent qui ne
 * prouve rien de plus.
 */

const coordinateur = (
  maintenant: () => number
): { coord: RunWorktreeCoordinator; repris: string[] } => {
  const repris: string[] = []
  const coord = new RunWorktreeCoordinator({
    manager: {
      hasActiveProcesses: () => false,
      listAgentIds: () => [],
      finalize: (runId: string) => {
        repris.push(runId)
        return { outcome: 'published' }
      }
    } as never,
    nowFn: maintenant
  } as never)
  // Pas de minuterie vivante pendant un test : on pilote le balayage à la main.
  coord.arreterLeBalayageAutomatique()
  return { coord, repris }
}

/** Injecte un run déjà dormant, comme au redémarrage de l'app. */
const dormant = (
  coord: RunWorktreeCoordinator,
  runId: string,
  champs: Record<string, unknown>
): void => {
  const runs = (coord as unknown as { runs: Map<string, unknown> }).runs
  runs.set(runId, {
    runId,
    agentName: runId,
    state: 'blocked',
    files: [],
    startedAtMs: 0,
    isMutation: true,
    publication: 'pending',
    attentionReason: 'retry-exhausted',
    ...champs
  })
}

describe('un travail fini rentre tout seul, sans qu’on clique', () => {
  it('repêche un travail dormant sans la moindre intervention', async () => {
    const { coord } = coordinateur(() => 1_000_000)
    dormant(coord, 'dormant', {})

    const tentes = await coord.repecherLesTravauxEnAttente()

    expect(tentes).toEqual(['dormant'])
  })

  it('NE repêche PAS un travail jugé mauvais — la garde tient aussi en automatique', async () => {
    const { coord } = coordinateur(() => 1_000_000)
    dormant(coord, 'juge-mauvais', { verdict: 'red' })

    expect(await coord.repecherLesTravauxEnAttente()).toEqual([])
  })

  it('ne remet pas le couvert au balayage suivant : un travail tenté est laissé au repos', async () => {
    let horloge = 1_000_000
    const { coord } = coordinateur(() => horloge)
    dormant(coord, 'dormant', {})

    await coord.repecherLesTravauxEnAttente()
    horloge += 30_000

    expect(await coord.repecherLesTravauxEnAttente()).toEqual([])
  })

  it('le reprend une fois le délai passé, car la cause du refus a pu disparaître', async () => {
    let horloge = 1_000_000
    const { coord } = coordinateur(() => horloge)
    dormant(coord, 'dormant', {})

    await coord.repecherLesTravauxEnAttente()
    // La reprise a ÉCHOUÉ : le run retombe dormant, exactement comme le fait le `catch` de la
    // publication quand la fusion est refusée. C'est LE cas que le délai protège — sans lui, le
    // balayage suivant rejouerait le même échec dans la foulée.
    dormant(coord, 'dormant', {})
    horloge += DELAI_ENTRE_DEUX_REPECHAGES_MS

    expect(await coord.repecherLesTravauxEnAttente()).toEqual(['dormant'])
  })

  it('un travail qui échoue ne condamne pas les suivants du lot', async () => {
    const { coord } = coordinateur(() => 1_000_000)
    dormant(coord, 'aaa-explose', {})
    dormant(coord, 'zzz-suivant', {})
    const original = coord.retryRunAsync.bind(coord)
    vi.spyOn(coord, 'retryRunAsync').mockImplementation(async (runId: string) => {
      if (runId === 'aaa-explose') throw new Error('reprise impossible')
      return original(runId)
    })

    const tentes = await coord.repecherLesTravauxEnAttente()

    expect(tentes).toContain('zzz-suivant')
  })

  it('le filet est armé dès la construction — personne n’a à penser à le tendre', () => {
    const coord = new RunWorktreeCoordinator({
      manager: { hasActiveProcesses: () => false, listAgentIds: () => [] } as never,
      nowFn: () => 0
    } as never)
    try {
      expect(
        (coord as unknown as { balayageTimer?: unknown }).balayageTimer
      ).toBeDefined()
    } finally {
      coord.arreterLeBalayageAutomatique()
    }
  })
})
