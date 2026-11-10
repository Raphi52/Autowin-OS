import { describe, expect, it } from 'vitest'
import { ProviderRegistry } from './registry'
import type { Message, ProviderAdapter, SendOptions, SendResult, StreamChunk } from './types'

/*
 * « SESSION LIMIT » EST UN MUR DE QUOTA — ET LE REGISTRE L'IGNORAIT.
 *
 * Constaté le 2026-09-11 : `src/shared/reprise-quota.ts` (utilisé par la liste des conversations
 * pour repérer les fils rouges à reprendre) reconnaît « session limit », parce que c'est le texte
 * RÉELLEMENT écrit par Claude dans conversations.json quand l'abonnement est épuisé. La copie
 * privée du registre, elle, ne connaissait que « hit your usage » : sur le refus le plus fréquent,
 * le mur de quota ne se posait donc PAS. Deux vocabulaires pour un même mur :
 * une seule source désormais.
 */

class FauxProvider implements ProviderAdapter {
  appels = 0
  erreur: Error | undefined

  constructor(readonly id: string) {}

  async auth(): Promise<boolean> {
    return true
  }

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    void options
    this.appels += 1
    if (this.erreur) throw this.erreur
    return { text: 'ok', provider: this.id, systemInjected: false }
  }
}

/** Le refus tel que Claude l'écrit vraiment (relevé dans conversations.json). */
const MUR_SESSION = new Error("You've hit your session limit · resets 7:10pm")

const UN_TOUR = [{ role: 'user' as const, content: 'travaille' }]

describe('mur de quota — vocabulaire « session limit »', () => {
  it('« session limit » ARRÊTE le tour sur le compte en cours : aucun autre compte n’est essayé', async () => {
    const claude = new FauxProvider('claude')
    const actif = 'compte-A'
    const registry = new ProviderRegistry(undefined, undefined, () => actif).register(claude)

    claude.erreur = MUR_SESSION
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/quota/i)
    expect(claude.appels).toBe(1)
    expect(actif).toBe('compte-A')
  })

  it('« session limit » POSE le mur : l’appel suivant ne repart pas vers le provider', async () => {
    const claude = new FauxProvider('claude')
    const registry = new ProviderRegistry().register(claude)

    claude.erreur = MUR_SESSION
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow()
    expect(claude.appels).toBe(1)

    claude.erreur = undefined
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/quota/i)
    expect(claude.appels).toBe(1)
  })

  it('CAS LIMITE — un rate-limit passager reste hors du mur (non-régression)', async () => {
    const claude = new FauxProvider('claude')
    const registry = new ProviderRegistry().register(claude)

    claude.erreur = new Error('HTTP 429 — rate limit exceeded, retry after 20s')
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow()
    claude.erreur = undefined
    await expect(registry.send('claude', UN_TOUR)).resolves.toMatchObject({ text: 'ok' })
  })
})
