import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * Defaut MESURE le 2026-09-09 en agregeant les 331 fichiers de `les fichiers `causal-trace` de l'app` :
 * 761 appels d'outils ont ete reemis avec des arguments STRICTEMENT identiques dans la meme
 * conversation, sur 112 conversations — une sur trois. Ecart median entre l'appel et son rejeu :
 * 1 a 2 appels. La constitution interdit deja ce reflexe en prose (« ne jamais re-tenter a
 * l'identique en aveugle ») ; la prose n'a pas suffi, d'ou le registre du tour.
 *
 * Ce que ces tests fixent : le registre SIGNALE le rejeu (il ne bloque pas — reobserver apres une
 * edition est legitime), sa portee est le TOUR et pas la conversation, et un tour neuf repart
 * vierge.
 */
describe('registre des appels du tour — le rejeu a l identique est signale', () => {
  function osMinimal() {
    const conversation = {
      id: 'conv-1',
      title: 'test',
      category: 'claude',
      provider: 'claude',
      createdAt: 1,
      updatedAt: 2,
      runPaths: [],
      messages: [{ role: 'user' as const, content: 'salut', ts: 1 }]
    }
    return {
      executionWorkspace: process.cwd(),
      conversations: {
        get: (id: string) => (id === 'conv-1' ? conversation : undefined),
        list: () => [conversation]
      },
      registry: { ids: () => ['claude'] },
      roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
      runsWithGate: () => [],
      budget: () => ({ spent: 0 })
    }
  }

  const lire = (bus: AppCommandBus, turnId?: string) =>
    bus.exec('conversation_read', { id: 'conv-1' }, undefined, undefined, turnId)

  it('signale le rejeu quand le MEME appel repart dans le MEME tour', async () => {
    const bus = new AppCommandBus(osMinimal() as never, () => undefined)

    const premier = await lire(bus, 'turn-1')
    const second = await lire(bus, 'turn-1')

    expect(premier.ok).toBe(true)
    // Le PREMIER appel n'est pas un rejeu : il ne doit rien porter, sinon la note devient du bruit.
    expect((premier.data as Record<string, unknown>).avertissementRejeu).toBeUndefined()
    expect(String((second.data as Record<string, unknown>).avertissementRejeu)).toContain(
      'conversation_read'
    )
    // Le resultat REEL survit a la note : on AJOUTE une cle, on n'enveloppe pas.
    expect((second.data as { messages?: unknown[] }).messages).toBeDefined()
  })

  it('ne signale RIEN quand le tour a change — le monde a pu bouger entre deux tours', async () => {
    const bus = new AppCommandBus(osMinimal() as never, () => undefined)

    await lire(bus, 'turn-1')
    const autreTour = await lire(bus, 'turn-2')

    expect((autreTour.data as Record<string, unknown>).avertissementRejeu).toBeUndefined()
  })

  it('ne signale RIEN en l absence de turnId — on ne devine pas de quel tour releve l appel', async () => {
    const bus = new AppCommandBus(osMinimal() as never, () => undefined)

    await lire(bus)
    const sansTour = await lire(bus)

    expect((sansTour.data as Record<string, unknown>).avertissementRejeu).toBeUndefined()
  })

  it('REFUSE une edition deja refusee et renvoyee telle quelle dans le meme tour', async () => {
    const bus = new AppCommandBus(osMinimal() as never, () => undefined)
    // `.git/` est refuse d'office par la garde de chemin : l'echec est certain et immediat.
    const edition = { path: '.git/config', oldText: 'a', newText: 'b' }

    const premier = await bus.exec('edit_file', edition, undefined, undefined, 'turn-1')
    const second = await bus.exec('edit_file', edition, undefined, undefined, 'turn-1')

    expect(premier.ok).toBe(false)
    expect(second.ok).toBe(false)
    // Le SECOND refus n'est pas le meme que le premier : il nomme le REJEU, pas le chemin.
    expect(String(second.error)).toContain('REFUS')
    expect(String(second.error)).toContain('change')
  })

  it('ne refuse PAS une edition rejouee apres un tour NEUF', async () => {
    const bus = new AppCommandBus(osMinimal() as never, () => undefined)
    const edition = { path: '.git/config', oldText: 'a', newText: 'b' }

    await bus.exec('edit_file', edition, undefined, undefined, 'turn-1')
    const autreTour = await bus.exec('edit_file', edition, undefined, undefined, 'turn-2')

    // Il echoue toujours (le chemin reste refuse), mais pour la CAUSE reelle, pas pour rejeu.
    expect(autreTour.ok).toBe(false)
    expect(String(autreTour.error)).not.toContain('REFUS')
  })
})
