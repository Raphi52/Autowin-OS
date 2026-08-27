import { describe, expect, it, vi } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * UN ECHEC GRAPHIFY DOIT RESTER INSPECTABLE.
 *
 * MESURE (conv-1478) : `graphify` a rendu « graphe Graphify invalide : <chemin dans le bureau
 * isole> » deux fois de suite. Le bureau etait detruit par le `catch` de `withIsolatedMutation`
 * AVANT que l'erreur atteigne le chat — le graphe fautif n'existait donc plus quand on allait le
 * lire. Ce test exige que l'echec de `graphify` ne range PAS le bureau et nomme son chemin, tandis
 * que `edit_file` continue de le ranger.
 */
type OsDouble = ConstructorParameters<typeof AppCommandBus>[0]

function osAvecBureau(): { os: OsDouble; ends: Array<{ id: string; merge: boolean }> } {
  const ends: Array<{ id: string; merge: boolean }> = []
  const os = {
    executionWorkspace: process.cwd(),
    conversations: new Map(),
    roles: { getBinding: () => ({ model: 'test' }) },
    worktrees: {
      travauxNonPublies: () => [],
      beginAsync: async () => '/bureaux/agent__command-graphify-test',
      endAsync: async (id: string, options?: { merge?: boolean }) => {
        ends.push({ id, merge: options?.merge === true })
        return undefined
      }
    }
  } as unknown as OsDouble
  return { os, ends }
}

describe('bureau isole apres un echec graphify', () => {
  it('conserve le bureau et nomme son chemin au lieu de le detruire', async () => {
    const { os, ends } = osAvecBureau()
    const graphify = vi.fn(async () => {
      throw new Error('graphe Graphify invalide : /bureaux/x/graphify-out/graph.json')
    })
    const bus = new AppCommandBus(os, () => {}, undefined, graphify as never)

    const resultat = await bus.exec('graphify', {})

    expect(resultat.ok).toBe(false)
    const message = JSON.stringify(resultat)
    expect(message).toContain('graphe Graphify invalide')
    expect(message).toContain('agent__command-graphify-test')
    expect(message).toContain('CONSERVE')
    // Le bureau n'a pas ete range : c'est precisement ce qui rendait l'echec non diagnosticable.
    expect(ends).toEqual([])
  })
})
