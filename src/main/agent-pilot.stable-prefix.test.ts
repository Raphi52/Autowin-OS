import { describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * PRÉFIXE SYSTEM STABLE — condition d'existence du cache de prompt.
 *
 * Mesure du 2026-07-28 (3 tours reels, instance isolee) : cache_read = 0 sur 100 % des appels et
 * ~16 k de tokens REÉCRITS en cache_write a chaque tour, soit ~0,32 $ pour repondre une phrase. La
 * cause : le contexte Brain, qui DEPEND de la question, etait concatene dans le `system` — le
 * prefixe differait donc a chaque tour et aucun segment ne pouvait etre reutilise.
 *
 * Cet invariant est invisible a l'oeil (le prompt « a l'air » correct) et se recasse au premier ajout
 * de contexte dans systemParts : d'ou ce test.
 */
function harness(retrieve?: (q: string) => Promise<string>) {
  const systems: string[] = []
  const registry = {
    send: vi.fn(async (_p: string, _m: Message[], o: SendOptions): Promise<SendResult> => {
      systems.push(o.system ?? '')
      return { text: 'ok', sessionId: 'sess' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => []),
    // L'etat de l'app CHANGE d'un tour a l'autre : il doit vivre dans le message, jamais dans le system.
    snapshotForPrompt: vi.fn(async () => ({ at: systems.length, conversations: systems.length })),
    exec: vi.fn()
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pilot = new AgentPilot(registry as any, roles as any, bus as any, retrieve)
  return { pilot, systems }
}

describe('system prompt — préfixe stable (cachable)', () => {
  it('reste IDENTIQUE d’un tour à l’autre malgré un contexte Brain qui change', async () => {
    // Contexte RAG different a chaque appel : le pire cas pour le cache.
    let call = 0
    const retrieve = vi.fn(async () => `connaissance specifique numero ${++call}`)
    const { pilot, systems } = harness(retrieve)
    await pilot.chat([{ role: 'user', content: 'question un' }], () => {}, undefined, 1, 'c1')
    await pilot.chat([{ role: 'user', content: 'question deux' }], () => {}, undefined, 1, 'c2')

    expect(retrieve).toHaveBeenCalledTimes(2) // le Brain est bien interroge...
    expect(systems).toHaveLength(2)
    expect(systems[0]).toBe(systems[1]) // ...mais le prefixe system ne bouge PAS
  })

  it('le system ne contient AUCUN contenu dépendant de la question ni de l’état', async () => {
    const retrieve = vi.fn(async () => 'MARQUEUR_BRAIN_SPECIFIQUE')
    const { pilot, systems } = harness(retrieve)
    await pilot.chat([{ role: 'user', content: 'MARQUEUR_QUESTION' }], () => {}, undefined, 1, 'c1')
    expect(systems[0]).not.toContain('MARQUEUR_BRAIN_SPECIFIQUE')
    expect(systems[0]).not.toContain('MARQUEUR_QUESTION')
    expect(systems[0]).not.toContain('ÉTAT DE L’APP')
  })

  it('sans contexte Brain, le prefixe est le MEME qu’avec (pas de trou ni de variante)', async () => {
    const withBrain = harness(async () => 'du contexte')
    const withoutBrain = harness(undefined)
    await withBrain.pilot.chat([{ role: 'user', content: 'q' }], () => {}, undefined, 1, 'c1')
    await withoutBrain.pilot.chat([{ role: 'user', content: 'q' }], () => {}, undefined, 1, 'c1')
    expect(withBrain.systems[0]).toBe(withoutBrain.systems[0])
  })
})
