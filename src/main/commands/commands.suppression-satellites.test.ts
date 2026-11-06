import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * Supprimer une conversation depuis le CHAT doit emporter ses satellites disque (artefacts, trace
 * causale, appels de prompt), comme le fait le canal IPC de l'interface. Avant ce test, la commande
 * agent retirait la conversation seule et laissait ces fichiers derrière elle.
 */
describe('remove_conversation', () => {
  it('nettoie les satellites et rafraîchit la liste', async () => {
    const conversations = new Map([['conv-1', { id: 'conv-1' }]])
    const os = {
      conversations: {
        get: (id: string) => conversations.get(id),
        remove: (id: string) => conversations.delete(id)
      }
    } as never
    const events: unknown[] = []
    const bus = new AppCommandBus(os, (e) => events.push(e))
    const nettoyes: string[] = []
    bus.onConversationRemoved = (id) => nettoyes.push(id)

    const res = await bus.exec('remove_conversation', { id: 'conv-1' })

    expect(res).toMatchObject({ ok: true, data: { removed: true } })
    expect(nettoyes).toEqual(['conv-1'])
    expect(events).toContainEqual({ type: 'refresh', scope: 'conversations' })
  })

  it('ne nettoie rien quand la conversation n’existait pas', async () => {
    const os = { conversations: { get: () => undefined, remove: () => false } } as never
    const bus = new AppCommandBus(os, () => {})
    const nettoyes: string[] = []
    bus.onConversationRemoved = (id) => nettoyes.push(id)

    await bus.exec('remove_conversation', { id: 'absente' })

    expect(nettoyes).toEqual([])
  })
})
