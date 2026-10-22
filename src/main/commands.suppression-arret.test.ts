import { describe, expect, it } from 'vitest'
import { ActiveChatTurns } from './active-chat-turns'
import { AppCommandBus } from './commands'

/**
 * La suppression faite par l'AGENT (`remove_conversation`, `remove_conversations`) ne coupait RIEN
 * (conv-1060, 2026-10-22) : ni le run de développement du fil, ni son tour de chat — les deux
 * continuaient sur un fil qui n'existait plus. Elle doit arrêter tout, comme le bouton Stop.
 *
 * Cas piège : l'agent qui supprime le fil DANS lequel il travaille. Attendre la fin de son propre
 * tour, c'est attendre la fin de l'appel en cours : la suppression ne doit pas l'attendre.
 */
function busAvecFils(ids: string[]) {
  const restants = new Set(ids)
  const os = {
    conversations: {
      get: (id: string) => (restants.has(id) ? { id } : undefined),
      remove: (id: string) => restants.delete(id),
      removeMany: (demandes: readonly string[]) => demandes.filter((id) => restants.delete(id))
    }
  } as never
  const bus = new AppCommandBus(os, () => {})
  const tours = new ActiveChatTurns()
  bus.toursDeChat = tours
  return { bus, tours, restants }
}

/** Un run en vol sur ce fil, et le tour qui l'attend sans écouter son propre arrêt. */
function runEnCours(bus: AppCommandBus, tours: ActiveChatTurns, id: string) {
  const run = bus.registerOrchestration(id)
  const tour = new AbortController()
  tours.set(
    id,
    tour,
    new Promise<void>((resolve) =>
      run.signal.addEventListener('abort', () => resolve(), { once: true })
    )
  )
  return { run, tour }
}

const issueEn300ms = (suppression: Promise<unknown>): Promise<unknown> =>
  Promise.race([
    suppression,
    new Promise((resolve) => setTimeout(() => resolve('toujours en attente'), 300))
  ])

describe('remove_conversation arrête ce qui tourne dans le fil', () => {
  it('supprimer un AUTRE fil coupe son run et son tour, puis le supprime', async () => {
    const { bus, tours, restants } = busAvecFils(['conv-cible', 'conv-agent'])
    const { run, tour } = runEnCours(bus, tours, 'conv-cible')

    const res = await issueEn300ms(
      bus.exec('remove_conversation', { id: 'conv-cible' }, 'conv-agent')
    )

    expect(res).toMatchObject({ ok: true, data: { removed: true } })
    expect(run.signal.aborted).toBe(true)
    expect(run.signal.reason).toBe('conversation-deleted')
    expect(tour.signal.aborted).toBe(true)
    expect(restants.has('conv-cible')).toBe(false)
    expect(tours.wasDeliberatelyStopped('conv-cible')).toBe(true)
  })

  it('supprimer SON PROPRE fil coupe son tour sans attendre sa fin (pas de blocage)', async () => {
    const { bus, tours, restants } = busAvecFils(['conv-agent'])
    const tour = new AbortController()
    // Le tour de l'agent ne finit qu'APRÈS l'appel en cours : l'attendre bloquerait pour toujours.
    tours.set('conv-agent', tour, new Promise<void>(() => {}))

    const res = await issueEn300ms(
      bus.exec('remove_conversation', { id: 'conv-agent' }, 'conv-agent')
    )

    expect(res).toMatchObject({ ok: true, data: { removed: true } })
    expect(tour.signal.aborted).toBe(true)
    expect(restants.has('conv-agent')).toBe(false)
  })

  it('ne coupe rien dans un fil qui n est pas nommé', async () => {
    const { bus, tours } = busAvecFils(['conv-cible', 'conv-temoin'])
    runEnCours(bus, tours, 'conv-cible')
    const temoin = runEnCours(bus, tours, 'conv-temoin')

    await issueEn300ms(bus.exec('remove_conversation', { id: 'conv-cible' }, 'conv-agent'))

    expect(temoin.run.signal.aborted).toBe(false)
    expect(temoin.tour.signal.aborted).toBe(false)
  })
})

describe('remove_conversations arrête ce qui tourne dans chaque fil du lot', () => {
  it('coupe le run et le tour de chaque fil nommé', async () => {
    const { bus, tours, restants } = busAvecFils(['conv-1', 'conv-2', 'conv-3'])
    const un = runEnCours(bus, tours, 'conv-1')
    const trois = runEnCours(bus, tours, 'conv-3')
    const deux = runEnCours(bus, tours, 'conv-2')

    const res = await issueEn300ms(
      bus.exec('remove_conversations', { ids: ['conv-1', 'conv-3'] }, 'conv-agent')
    )

    expect(res).toMatchObject({ ok: true, data: { removed: ['conv-1', 'conv-3'], count: 2 } })
    expect(un.run.signal.aborted && trois.run.signal.aborted).toBe(true)
    expect(un.tour.signal.aborted && trois.tour.signal.aborted).toBe(true)
    expect(deux.run.signal.aborted).toBe(false)
    expect([...restants]).toEqual(['conv-2'])
  })

  it('un lot trop grand est refusé AVANT de couper quoi que ce soit', async () => {
    const { bus, tours } = busAvecFils(['conv-1'])
    const { run, tour } = runEnCours(bus, tours, 'conv-1')
    const ids = ['conv-1', ...Array.from({ length: 200 }, (_, i) => `absente-${i}`)]

    const res = await bus.exec('remove_conversations', { ids }, 'conv-agent')

    expect(res).toMatchObject({ ok: false })
    expect(run.signal.aborted).toBe(false)
    expect(tour.signal.aborted).toBe(false)
  })
})
