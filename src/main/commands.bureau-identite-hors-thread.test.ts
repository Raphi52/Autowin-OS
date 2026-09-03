import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { cleDeBureau } from './bureau-reutilisable'

/**
 * LE GEL DU 2026-09-03, A SA SOURCE.
 *
 * `gels.jsonl` (08:30:01) : 7 244 ms de fenetre morte, accumulation `execFileSync git rev-parse`
 * (48 appels), `git status` (34), `git cherry` (11). Le seul appelant restant de la voie SYNCHRONE
 * et NON BORNEE (`travauxNonPublies()` -> `apercuTravauxNonPublies('HEAD', 100)`, une commande git
 * par branche) est `identiteDeBureau`, joue au DEBUT de chaque commande d'edition/orchestration,
 * sur le thread qui dessine la fenetre.
 *
 * La voie hors-thread existe deja (`travauxNonPubliesAsync`). Ce test la rend OBLIGATOIRE ici, et
 * verifie que l'indetermination de lecture (`lectureEchouee`) survit au passage par le worker :
 * sans elle, une lecture git ratee se relit « bureau vide » et fait JETER du travail.
 */
type OsDouble = ConstructorParameters<typeof AppCommandBus>[0]

const CIBLE = 'src/renderer/src/components/WorkflowsPanel.tsx'

function osDouble(retenusAsync: Array<Record<string, unknown>>): {
  os: OsDouble
  appelsSync: number
  begins: string[]
  discards: string[]
} {
  const compteur = { sync: 0 }
  const begins: string[] = []
  const discards: string[] = []
  const conversations = new Map<string, unknown>([
    [
      'conv-1',
      {
        id: 'conv-1',
        title: 'A',
        category: 'claude',
        provider: 'claude',
        messages: [],
        runPaths: [],
        createdAt: 1,
        updatedAt: 2
      }
    ]
  ])
  const os = {
    executionWorkspace: process.cwd(),
    conversations: {
      get: (id: string) => conversations.get(id),
      list: () => [...conversations.values()],
      attachRun: () => ({ id: 'conv-1', runPaths: [] })
    },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
    runsWithGate: () => [],
    budget: () => ({ spent: 0 }),
    listBrains: () => [],
    loadBrainGraph: () => ({ nodes: [], links: [] }),
    chat: async () => ({ text: '', provider: 'claude', systemInjected: false }),
    worktrees: {
      travauxNonPublies: () => {
        compteur.sync += 1
        return []
      },
      travauxNonPubliesAsync: async () => retenusAsync,
      discardHeldAsync: async (id: string) => {
        discards.push(id)
        return true
      },
      beginAsync: async (id: string) => {
        begins.push(id)
        return undefined
      },
      endAsync: async () => undefined
    }
  }
  return {
    os: os as unknown as OsDouble,
    get appelsSync() {
      return compteur.sync
    },
    begins,
    discards
  }
}

async function editer(os: OsDouble): Promise<void> {
  const bus = new AppCommandBus(os, () => {})
  await bus.exec('edit_file', { path: CIBLE, old: 'a', new: 'b' }, 'conv-1')
}

describe('identiteDeBureau — le recensement ne bloque plus la fenetre', () => {
  it('passe par la voie HORS THREAD, jamais par le recensement synchrone', async () => {
    const double = osDouble([])

    await editer(double.os)

    expect(double.appelsSync).toBe(0)
    expect(double.begins[0]).toBe(cleDeBureau('edit', 'conv-1', CIBLE))
  })

  it('une lecture git RATEE reste indeterminee : le bureau est preserve, pas jete', async () => {
    const cle = cleDeBureau('edit', 'conv-1', CIBLE) as string
    const double = osDouble([
      { agentId: cle, date: '2026-09-03', fichiers: [], lectureEchouee: true }
    ])

    await editer(double.os)

    expect(double.discards).toEqual([])
    expect(double.begins[0]).not.toBe(cle)
  })
})
