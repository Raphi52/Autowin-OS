import { describe, expect, it, vi } from 'vitest'
import { AppCommandBus } from './commands'
import { cleDeBureau } from './bureau-reutilisable'

/**
 * LE BUREAU EST-IL RÉELLEMENT RÉUTILISÉ ?
 *
 * La logique pure est testée à côté (`bureau-reutilisable.test.ts`). Ce test-ci vérifie le
 * CÂBLAGE — que `withIsolatedMutation` demande bien un bureau à l'identité stable, et qu'il libère
 * le brouillon précédent au lieu d'en créer un onzième. Sans lui, on aurait une décision correcte
 * que personne n'appelle : exposé mais pas intégré, le défaut le plus coûteux de ce dépôt.
 */
function osAvecBureaux(retenus: Array<{ agentId: string; date: string; fichiers: string[] }>): {
  os: any
  begins: string[]
  discards: string[]
} {
  const begins: string[] = []
  const discards: string[] = []
  const conversations = new Map<string, unknown>([
    ['conv-1', { id: 'conv-1', title: 'A', category: 'claude', provider: 'claude', messages: [], runPaths: [], createdAt: 1, updatedAt: 2 }]
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
      travauxNonPublies: () => retenus,
      discardHeldAsync: async (id: string) => {
        discards.push(id)
        return true
      },
      // On refuse le bureau : l'action n'est jamais jouée, mais l'identité demandée est déjà
      // observable — c'est tout ce que ce test veut établir.
      beginAsync: async (id: string) => {
        begins.push(id)
        return undefined
      },
      endAsync: async () => undefined
    }
  }
  return { os, begins, discards }
}

const CIBLE = 'src/renderer/src/components/WorkflowsPanel.tsx'

async function editer(os: any): Promise<void> {
  const bus = new AppCommandBus(os, () => {})
  await bus.exec('edit_file', { path: CIBLE, old: 'a', new: 'b' }, 'conv-1')
}

describe('withIsolatedMutation — un bureau par tâche', () => {
  it('demande un bureau à l’identité STABLE, pas un identifiant au hasard', async () => {
    const { os, begins } = osAvecBureaux([])

    await editer(os)

    expect(begins).toHaveLength(1)
    expect(begins[0]).toBe(cleDeBureau('edit', 'conv-1', CIBLE))
  })

  it('deux tentatives de suite retombent sur le MÊME bureau', async () => {
    const { os, begins } = osAvecBureaux([])

    await editer(os)
    await editer(os)

    expect(begins[0]).toBe(begins[1])
  })

  it('brouillon précédent sur la même cible : il est LIBÉRÉ, pas doublé', async () => {
    const cle = cleDeBureau('edit', 'conv-1', CIBLE) as string
    const { os, begins, discards } = osAvecBureaux([
      { agentId: cle, date: '2026-08-25', fichiers: [CIBLE] }
    ])

    await editer(os)

    expect(discards).toEqual([cle])
    expect(begins[0]).toBe(cle)
  })

  it('le bureau porte du travail INATTENDU : on n’y touche pas, on va ailleurs', async () => {
    const cle = cleDeBureau('edit', 'conv-1', CIBLE) as string
    const { os, begins, discards } = osAvecBureaux([
      {
        agentId: cle,
        date: '2026-08-24',
        // Le cas réel à ne jamais détruire : des tests neufs jamais publiés.
        fichiers: [CIBLE, 'src/main/runs/conv-runs.trace-thinking.test.ts']
      }
    ])

    await editer(os)

    expect(discards).toEqual([])
    expect(begins[0]).not.toBe(cle)
  })

  it('libération impossible : on ne force RIEN, la tentative va ailleurs', async () => {
    const cle = cleDeBureau('edit', 'conv-1', CIBLE) as string
    const { os, begins, discards } = osAvecBureaux([
      { agentId: cle, date: '2026-08-25', fichiers: [CIBLE] }
    ])
    os.worktrees.discardHeldAsync = vi.fn().mockResolvedValue(false)

    await editer(os)

    expect(begins[0]).not.toBe(cle)
    expect(discards).toEqual([])
  })
})
