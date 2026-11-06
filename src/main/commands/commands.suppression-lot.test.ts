import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * `removeMany` existait dans le store et jusqu'au preload, mais AUCUN appelant ne pouvait la
 * declencher : ni l'interface, ni le catalogue agent. Ces tests verrouillent son exposition en
 * commande agent, et surtout le fait que les satellites disque de CHAQUE conversation supprimee
 * soient nettoyes -- l'oubli exact que `remove_conversation` avait deja connu.
 */
describe('remove_conversations', () => {
  const busAvec = (ids: string[]) => {
    const restantes = new Set(ids)
    const os = {
      conversations: {
        removeMany: (demandes: readonly string[]) => {
          const sortis: string[] = []
          for (const id of demandes) if (restantes.delete(id)) sortis.push(id)
          return sortis
        }
      }
    } as never
    const events: unknown[] = []
    const bus = new AppCommandBus(os, (e) => events.push(e))
    const nettoyes: string[] = []
    bus.onConversationRemoved = (id) => nettoyes.push(id)
    return { bus, events, nettoyes, restantes }
  }

  it('supprime le lot nomme, nettoie chaque satellite et rafraichit', async () => {
    const { bus, events, nettoyes, restantes } = busAvec(['conv-1', 'conv-2', 'conv-3'])

    const res = await bus.exec('remove_conversations', { ids: ['conv-1', 'conv-3'] })

    expect(res).toMatchObject({ ok: true, data: { removed: ['conv-1', 'conv-3'], count: 2 } })
    expect(nettoyes).toEqual(['conv-1', 'conv-3'])
    expect(events).toContainEqual({ type: 'refresh', scope: 'conversations' })
    // La conversation NON nommee reste intacte.
    expect([...restantes]).toEqual(['conv-2'])
  })

  it('ne nettoie ni ne rafraichit quand aucun id ne correspond', async () => {
    const { bus, events, nettoyes } = busAvec(['conv-1'])

    const res = await bus.exec('remove_conversations', { ids: ['inconnue'] })

    expect(res).toMatchObject({ ok: true, data: { count: 0 } })
    expect(nettoyes).toEqual([])
    expect(events).not.toContainEqual({ type: 'refresh', scope: 'conversations' })
  })

  /*
   * L'OUTIL NATIF ENVOIE LA LISTE EN TEXTE (conv-927, 2026-10-13) : `schemaEntree`
   * (skill-node-mcp.ts) declare tout argument en `type: 'string'`, donc le modele envoie
   * '["conv-1","conv-3"]' et le lot repondait « ids doit etre une liste ». Meme defaut, meme
   * correctif que `marquer_travaux_tries` (commands.marquage-lot.test.ts).
   */
  it('accepte la liste envoyee en TEXTE JSON par l outil natif', async () => {
    const { bus, nettoyes, restantes } = busAvec(['conv-1', 'conv-2', 'conv-3'])

    const res = await bus.exec('remove_conversations', { ids: '["conv-1","conv-3"]' })

    expect(res).toMatchObject({ ok: true, data: { removed: ['conv-1', 'conv-3'], count: 2 } })
    expect(nettoyes).toEqual(['conv-1', 'conv-3'])
    expect([...restantes]).toEqual(['conv-2'])
  })

  it('refuse un texte JSON qui n est pas une liste, sans rien supprimer', async () => {
    const { bus, nettoyes, restantes } = busAvec(['conv-1'])

    for (const ids of ['"conv-1"', '{"ids":["conv-1"]}', '[conv-1']) {
      expect(await bus.exec('remove_conversations', { ids })).toMatchObject({ ok: false })
    }
    expect(nettoyes).toEqual([])
    expect([...restantes]).toEqual(['conv-1'])
  })

  it('refuse un `ids` qui n est pas une liste', async () => {
    const { bus } = busAvec(['conv-1'])

    const res = await bus.exec('remove_conversations', { ids: 'conv-1' })

    expect(res).toMatchObject({ ok: false })
  })

  it('est declaree destructive dans le catalogue', () => {
    const { bus } = busAvec([])
    const entree = bus.catalog().find((t) => t.name === 'remove_conversations')
    expect(entree?.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false })
  })
})
