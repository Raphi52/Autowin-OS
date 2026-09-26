import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * LA LISTE DES RUNS BLOQUÉS NE DOIT PLUS MENTIR PAR OMISSION.
 *
 * Constat du 2026-09-25 (conv-861) : `get_state` affichait `runsBlocked: []` alors qu'il ne lit que
 * les 24 RUN.md les plus récents (`LIMITE_RUNS_SNAPSHOT`). Le scan borné calculait le nombre de
 * fichiers écartés (`remaining`) puis le JETAIT. Ranger 18 runs d'essai récents a fait REMONTER 6
 * anciens runs bloqués que la liste ne montrait pas une minute plus tôt. Deux troncatures
 * silencieuses se cumulaient :
 *  1. au-delà des 24 plus récents, rien n'est lu, et rien ne le dit ;
 *  2. `snapshot()` coupait encore la liste à 12 AVANT que `runsBlocked` ne filtre : un run bloqué
 *     entre la 13e et la 24e place, pourtant lu, disparaissait aussi.
 */

type OsDouble = ConstructorParameters<typeof AppCommandBus>[0]
type Run = {
  subject: string
  session: string
  path: string
  mtime: number
  summary: { status: string }
  blocked: boolean
}

const run = (i: number, blocked = false): Run => ({
  subject: `sujet-${i}`,
  session: 's',
  path: `p-${i}`,
  mtime: 1000 - i,
  summary: { status: blocked ? 'open' : 'green' },
  blocked
})

const os = (runs: Run[] & { horsFenetre?: number }): OsDouble =>
  ({
    executionWorkspace: process.cwd(),
    conversations: { list: () => [] },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => undefined },
    runsWithGate: async () => runs,
    budget: () => ({ pricedSpendUsd: 0 }),
    getWorktreeActivity: () => [],
    travauxNonPublies: () => [],
    travauxNonPubliesBornes: () => []
  }) as unknown as OsDouble

/** 24 runs lus, le plus récent d'abord ; le 20e est bloqué ; 176 RUN.md plus anciens non lus. */
const fenetre = (): Run[] & { horsFenetre: number } =>
  Object.assign(
    Array.from({ length: 24 }, (_, i) => run(i, i === 20)),
    { horsFenetre: 176 }
  )

describe('runs bloqués : la troncature se voit', () => {
  it('un run bloqué lu au-delà des 12 affichés reste dans runsBlocked', async () => {
    const bus = new AppCommandBus(os(fenetre()), () => {})
    const etat = await bus.snapshotForPrompt()
    expect(etat.runsBlocked).toEqual([{ subject: 'sujet-20', status: 'open' }])
  })

  it('get_state garde les 12 plus récents et y ajoute les bloqués plus anciens de la fenêtre', async () => {
    const etat = await new AppCommandBus(os(fenetre()), () => {}).snapshot()
    expect(etat.runs.slice(0, 12).map((r) => r.subject)).toEqual(
      Array.from({ length: 12 }, (_, i) => `sujet-${i}`)
    )
    expect(etat.runs.map((r) => r.subject)).toContain('sujet-20')
    expect(etat.runs).toHaveLength(13)
  })

  it('le nombre de RUN.md NON lus est dit, dans get_state comme dans l’état du tour', async () => {
    const bus = new AppCommandBus(os(fenetre()), () => {})
    expect((await bus.snapshot()).runsNonExamines).toBe(176)
    expect((await bus.snapshotForPrompt()).runsNonExamines).toBe(176)
  })

  it('rien d’écarté (ou double sans le champ) : aucun champ ajouté', async () => {
    const complet = Object.assign([run(0), run(1, true)], { horsFenetre: 0 })
    const bus = new AppCommandBus(os(complet), () => {})
    expect((await bus.snapshot()).runsNonExamines).toBeUndefined()
    expect('runsNonExamines' in (await bus.snapshotForPrompt())).toBe(false)
    const ancien = new AppCommandBus(os([]), () => {})
    expect('runsNonExamines' in (await ancien.snapshotForPrompt())).toBe(false)
  })
})
