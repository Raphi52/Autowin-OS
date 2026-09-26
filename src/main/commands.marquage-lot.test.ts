import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * REFERMER LE SALVAGE PAR LOT, comme on supprime deja les conversations par lot.
 *
 * Trace causale au 2026-09-12 : 225 appels a `marquer_travail_trie` repartis sur 94 tours, dont un
 * tour a 23 appels (conv-269), un a 13 (conv-274), un a 10 (conv-253). Chaque appel est un
 * aller-retour modele complet pour une ecriture d'une ligne. La version au singulier LEVE sur un
 * identifiant inconnu — comportement voulu et conserve — ce qui la rend inutilisable en boucle :
 * le premier id perime annulerait tout le reste. Le lot agrege donc au lieu de lever.
 */
describe('marquer_travaux_tries', () => {
  const busAvec = (connus: string[]) => {
    const restants = new Set(connus)
    const marques: string[] = []
    const os = {
      worktrees: {
        marquerTravailTrie: (id: string) => {
          if (!restants.has(id)) return false
          marques.push(id)
          return true
        },
        shaTravailTrie: (id: string) => `sha-${id}`
      }
    } as never
    return { bus: new AppCommandBus(os, () => {}), marques }
  }

  it('marque tout le lot en UN appel et rend le compte rendu par identifiant', async () => {
    const { bus, marques } = busAvec(['agent-a', 'agent-b'])

    const res = await bus.exec('marquer_travaux_tries', { ids: ['agent-a', 'agent-b'] })

    expect(res).toMatchObject({
      ok: true,
      data: { marques: ['agent-a', 'agent-b'], introuvables: [], count: 2 }
    })
    expect(marques).toEqual(['agent-a', 'agent-b'])
  })

  it('ignore un identifiant inconnu au lieu de faire echouer tout le lot', async () => {
    const { bus, marques } = busAvec(['agent-a'])

    const res = await bus.exec('marquer_travaux_tries', {
      ids: ['agent-a', 'disparu', 'agent-a']
    })

    // Le doublon est dedupliqué : `agent-a` n'est marqué qu'une fois.
    expect(marques).toEqual(['agent-a'])
    expect(res).toMatchObject({
      ok: true,
      data: { marques: ['agent-a'], introuvables: ['disparu'], count: 1 }
    })
  })

  it('rend le SHA juge de chaque travail marque, comme la commande au singulier', async () => {
    const { bus } = busAvec(['agent-a'])

    const res = (await bus.exec('marquer_travaux_tries', { ids: ['agent-a'] })) as {
      data: { shas: Record<string, string> }
    }

    expect(res.data.shas).toEqual({ 'agent-a': 'sha-agent-a' })
  })

  it('refuse un `ids` qui n est pas une liste, et un lot au-dela du plafond', async () => {
    const { bus } = busAvec(['agent-a'])

    expect(await bus.exec('marquer_travaux_tries', { ids: 'agent-a' })).toMatchObject({ ok: false })
    const trop = Array.from({ length: 201 }, (_, i) => `agent-${i}`)
    expect(await bus.exec('marquer_travaux_tries', { ids: trop })).toMatchObject({ ok: false })
  })

  it('ne supprime rien : la commande est declaree non destructive dans le catalogue', () => {
    const { bus } = busAvec([])
    const entree = bus.catalog().find((t) => t.name === 'marquer_travaux_tries')
    expect(entree?.annotations).toMatchObject({ destructiveHint: false, idempotentHint: true })
    expect(entree?.description).toContain('NE SUPPRIME RIEN')
  })

  it('laisse la commande au singulier LEVER sur un identifiant inconnu', async () => {
    const { bus } = busAvec(['agent-a'])

    const res = await bus.exec('marquer_travail_trie', { agentId: 'disparu' })

    expect(res).toMatchObject({ ok: false })
  })
})
