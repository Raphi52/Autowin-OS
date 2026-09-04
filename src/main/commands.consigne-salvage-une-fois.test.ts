import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * « JE PASSE MA VIE A /SALVAGE » (2026-09-04).
 *
 * La consigne de tri etait posee des que la file n'etait pas vide — donc REPETEE a chaque tour, dans
 * chaque conversation, tant que l'utilisateur n'avait pas tout trie. Ce n'etait meme plus lui qui
 * decidait d'ecrire `/salvage` : l'application le lui remettait sous le nez indefiniment.
 *
 * Elle parle desormais quand elle APPREND quelque chose : un travail jamais annonce. Un travail deja
 * presente et laisse de cote est une decision prise, on ne la redemande pas.
 */
type Travail = { agentId: string; date: string; fichiers: string[] }

const osAvec = (travaux: () => Travail[]): ConstructorParameters<typeof AppCommandBus>[0] =>
  ({
    executionWorkspace: process.cwd(),
    conversations: { list: () => [] },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => undefined },
    runsWithGate: async () => [],
    budget: () => ({ pricedSpendUsd: 0 }),
    getWorktreeActivity: () => [],
    travauxNonPubliesBornes: travaux
  }) as unknown as ConstructorParameters<typeof AppCommandBus>[0]

const travail = (agentId: string): Travail => ({
  agentId,
  date: '2026-09-04',
  fichiers: ['src/renderer/src/components/ChatView.css']
})

describe('la consigne de tri se dit UNE FOIS par travail, pas a chaque tour', () => {
  it('le second tour se tait sur un travail deja annonce', async () => {
    const bus = new AppCommandBus(osAvec(() => [travail('run-aaa111-1')]), () => undefined)

    expect((await bus.snapshotForPrompt()).travauxNonFusionnes?.compte).toBe(1)
    expect((await bus.snapshotForPrompt()).travauxNonFusionnes).toBeUndefined()
    expect((await bus.snapshotForPrompt()).travauxNonFusionnes).toBeUndefined()
  })

  it('un travail NOUVEAU rouvre la bouche, et l’apercu reste complet', async () => {
    let file = [travail('run-aaa111-1')]
    const bus = new AppCommandBus(
      osAvec(() => file),
      () => undefined
    )

    await bus.snapshotForPrompt()
    expect((await bus.snapshotForPrompt()).travauxNonFusionnes).toBeUndefined()

    file = [travail('run-aaa111-1'), travail('run-bbb222-1')]
    const reveil = (await bus.snapshotForPrompt()).travauxNonFusionnes

    expect(reveil?.consigne).toContain('salvage')
    // L'apercu porte les DEUX : trier un travail sans voir ses voisins produit les balayages
    // partiels que la consigne cherche justement a eviter.
    expect(reveil?.apercu.map((t) => t.agentId)).toEqual(['run-aaa111-1', 'run-bbb222-1'])
    expect(reveil?.compte).toBe(2)
  })
})
