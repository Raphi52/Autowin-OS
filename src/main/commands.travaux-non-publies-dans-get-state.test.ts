import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * LE DÉFAUT, vécu le 2026-08-26 (run `ef845009a251-1`).
 *
 * L'utilisateur demande « fusionne ». L'agent n'a AUCUN moyen de savoir qu'un travail l'attend :
 * `travauxNonPublies()` existe côté `os` et son IPC `worktree:travaux-non-publies` sert le
 * renderer, mais `get_state` — le seul état que l'agent sache lire — ne le porte pas. Alors il
 * improvise un `git status` dans l'arbre principal, n'y voit rien de pertinent, et répond de bonne
 * foi « rien à fusionner » pendant que son commit dort dans son bureau.
 *
 * Réparer le recensement (worktree-manager) ne suffit donc pas : sans ce champ, la réparation reste
 * invisible à l'endroit exact où le défaut se produit. La donnée ne sert que si l'agent sait
 * qu'elle existe.
 */

const osAvecTravaux = (
  travaux: Array<{ agentId: string; date: string; fichiers: string[] }>
): any => ({
  executionWorkspace: process.cwd(),
  conversations: { list: () => [] },
  registry: { ids: () => ['claude'] },
  roles: { all: () => ({}), getBinding: () => undefined },
  runsWithGate: async () => [],
  budget: () => ({ pricedSpendUsd: 0 }),
  getWorktreeActivity: () => [],
  travauxNonPublies: () => travaux
})

describe('get_state porte les travaux non publiés', () => {
  it('NOMME le travail qui attend, avec ses fichiers', async () => {
    // Le bord qui compte : taire un travail non publié coûte le travail lui-même.
    const bus = new AppCommandBus(
      osAvecTravaux([
        { agentId: 'run-ef845009a251-1', date: '2026-08-26', fichiers: ['src/a.ts', 'src/b.ts'] }
      ]),
      () => undefined
    )

    const snap = await bus.snapshot()

    expect(snap.travauxNonPublies).toEqual([
      { agentId: 'run-ef845009a251-1', date: '2026-08-26', fichiers: ['src/a.ts', 'src/b.ts'] }
    ])
  })

  it('rend un tableau VIDE quand rien n’attend (absence ≠ crash)', async () => {
    const bus = new AppCommandBus(osAvecTravaux([]), () => undefined)
    await expect(bus.snapshot()).resolves.toMatchObject({ travauxNonPublies: [] })
  })

  it('rend un tableau VIDE si l’OS n’expose pas le recensement', async () => {
    // Un OS plus ancien ou un double de test ne doit pas faire tomber `get_state`.
    const os = osAvecTravaux([])
    os.travauxNonPublies = undefined
    const bus = new AppCommandBus(os, () => undefined)
    await expect(bus.snapshot()).resolves.toMatchObject({ travauxNonPublies: [] })
  })
})
