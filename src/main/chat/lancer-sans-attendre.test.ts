import { describe, expect, it, vi } from 'vitest'
import { ActiveChatTurns } from '../active-chat-turns'
import { lancerSansAttendre } from './lancer-sans-attendre'

/** Un faux tour : s'enregistre actif apres un court delai, puis ne finit QUE sur ordre du test. */
function fauxTour(turns: ActiveChatTurns, conversationId: string) {
  let finir!: () => void
  const completion = new Promise<void>((r) => (finir = r))
  const demarrer = async () => {
    await new Promise((r) => setTimeout(r, 5))
    const controller = new AbortController()
    turns.set(conversationId, controller, completion)
    await completion
    turns.delete(conversationId, controller)
    return { ok: true, turnId: `t-${conversationId}` }
  }
  return { demarrer, finir: () => finir() }
}

describe('lancerSansAttendre (chat_send vers une conversation)', () => {
  it('3 envois partent en parallele : chacun rend la main au demarrage, avant la fin des autres', async () => {
    const turns = new ActiveChatTurns()
    const ids = ['conv-a', 'conv-b', 'conv-c']
    const tours = ids.map((id) => fauxTour(turns, id))

    // Envois SEQUENTIELS, comme l'agent qui traite ses commandes une par une.
    for (const [i, id] of ids.entries()) {
      const r = await lancerSansAttendre(
        tours[i].demarrer,
        () => turns.waitForActive(id, 1_000),
        () => {}
      )
      expect(r.ok).toBe(true)
    }

    // Aucun tour n'est fini, et les trois tournent EN MEME TEMPS.
    expect(ids.every((id) => turns.isInFlight(id))).toBe(true)
    tours.forEach((t) => t.finir())
  })

  it('un echec avant demarrage est rendu, pas masque', async () => {
    const turns = new ActiveChatTurns()
    const r = await lancerSansAttendre(
      async () => ({ ok: false, error: 'conversation occupee' }),
      () => turns.waitForActive('conv-x', 1_000),
      () => {}
    )
    expect(r).toEqual({ ok: false, error: 'conversation occupee' })
  })

  it('un echec APRES demarrage est signale, sans promesse orpheline', async () => {
    const turns = new ActiveChatTurns()
    const signal = vi.fn()
    let casser!: () => void
    const r = await lancerSansAttendre(
      async () => {
        turns.set('conv-y', new AbortController(), Promise.resolve())
        await new Promise<void>((_, rej) => (casser = () => rej(new Error('panne'))))
        return { ok: true }
      },
      () => turns.waitForActive('conv-y', 1_000),
      signal
    )
    expect(r.ok).toBe(true)
    casser()
    await vi.waitFor(() => expect(signal).toHaveBeenCalled())
  })
})
