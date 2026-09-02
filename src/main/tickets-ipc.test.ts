import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE } from '../shared/tickets'
import { registerTicketsIpc, type TicketsIpcRegistrar } from './tickets-ipc'

function setup() {
  // Mirrors Electron's variadic invoke boundary for the in-memory registrar.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const ipc = {
    handle: (channel, handler) => handlers.set(channel, handler)
  } satisfies TicketsIpcRegistrar
  const service = {
    sources: vi.fn(() => []),
    saveSource: vi.fn(() => []),
    list: vi.fn(async (_request?: unknown, _signal?: AbortSignal) => ({
      items: [],
      hasMore: false
    })),
    get: vi.fn(async (_request?: unknown, _signal?: AbortSignal) => ({
      id: '1227',
      sourceId: DEFAULT_TICKET_SOURCE.id,
      type: 'Fiche Team',
      title: 'Fiche lue par id',
      state: 'Ouvert',
      url: 'https://dev.azure.com/AmitelGTC/RIG/_workitems/edit/1227',
      updatedAt: '2026-08-06T10:00:00.000Z',
      fields: {}
    })),
    update: vi.fn(async (_request?: unknown, _signal?: AbortSignal) => ({
      id: '1227',
      sourceId: DEFAULT_TICKET_SOURCE.id,
      type: 'Fiche Team',
      title: 'Fiche mise à jour',
      state: 'Clos',
      url: 'https://dev.azure.com/AmitelGTC/RIG/_workitems/edit/1227',
      updatedAt: '2026-08-10T10:00:00.000Z',
      fields: {}
    }))
  }
  const assertTrusted = vi.fn()
  // L'annuaire est un PORT distinct du service : il interroge Azure directement dans la production.
  const people = {
    estAutorisee: vi.fn((source: { id: string }) => source.id === DEFAULT_TICKET_SOURCE.id),
    list: vi.fn(async () => [{ displayName: 'Raphael VILAIN' }])
  }
  registerTicketsIpc({ ipc, service, people, assertTrusted })
  return { handlers, service, people, assertTrusted }
}

describe('IPC Tickets', () => {
  it('valide le renderer avant chaque lecture et délègue au service', async () => {
    const { handlers, service, assertTrusted } = setup()
    const event = { senderFrame: { url: 'app://trusted' } }

    expect(await handlers.get('tickets:sources')!(event)).toEqual([])
    await handlers.get('tickets:list')!(event, {
      source: DEFAULT_TICKET_SOURCE,
      requestId: 'request-1'
    })

    expect(assertTrusted).toHaveBeenCalledTimes(2)
    expect(service.list).toHaveBeenCalledWith(
      { source: DEFAULT_TICKET_SOURCE, requestId: 'request-1' },
      expect.any(AbortSignal)
    )
  })

  /**
   * LECTURE PAR ID — le canal qui manquait. Constaté en réel : faute de cet accès, l'agent cherchait
   * la chaîne « 1227 » dans les titres et concluait que la fiche n'existait pas.
   */
  it('valide le renderer avant une lecture par id et rend la fiche', async () => {
    const { handlers, service, assertTrusted } = setup()
    const event = { senderFrame: { url: 'app://trusted' } }

    const fiche = await handlers.get('tickets:get')!(event, {
      source: DEFAULT_TICKET_SOURCE,
      id: '1227',
      requestId: 'get-1'
    })

    expect(assertTrusted).toHaveBeenCalledTimes(1)
    expect(fiche).toMatchObject({ id: '1227' })
    expect(service.get).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1227' }),
      expect.any(AbortSignal)
    )
  })

  it('une lecture par id est annulable par son requestId', async () => {
    const { handlers, service } = setup()
    const event = { senderFrame: { url: 'app://trusted' } }
    service.get.mockImplementation(
      async (_request?: unknown, signal?: AbortSignal) =>
        await new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('annulé')))
        })
    )

    const pending = handlers.get('tickets:get')!(event, {
      source: DEFAULT_TICKET_SOURCE,
      id: '1227',
      requestId: 'get-2'
    })
    expect(handlers.get('tickets:cancel')!(event, 'get-2')).toBe(true)

    await expect(pending).rejects.toThrow(/annul/i)
  })

  it('valide et délègue le retour vers une fiche existante', async () => {
    const { handlers, service, assertTrusted } = setup()
    const event = { senderFrame: { url: 'app://trusted' } }

    const updated = await handlers.get('tickets:update')!(event, {
      source: DEFAULT_TICKET_SOURCE,
      id: '1227',
      comment: 'Tests verts.',
      state: 'Clos',
      requestId: 'update-1'
    })

    expect(assertTrusted).toHaveBeenCalledTimes(1)
    expect(updated).toMatchObject({ id: '1227', state: 'Clos' })
    expect(service.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1227', comment: 'Tests verts.' }),
      expect.any(AbortSignal)
    )
  })

  it('annule réellement une lecture active à la demande du renderer', async () => {
    const { handlers, service } = setup()
    service.list.mockImplementation(
      (_request, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const event = { senderFrame: { url: 'app://trusted' } }
    const pending = handlers.get('tickets:list')!(event, {
      source: DEFAULT_TICKET_SOURCE,
      requestId: 'request-active'
    })

    expect(await handlers.get('tickets:cancel')!(event, 'request-active')).toBe(true)
    await expect(pending).rejects.toBeDefined()
  })

  it('isole les mêmes requestId entre deux senders', async () => {
    const { handlers, service } = setup()
    const signals: AbortSignal[] = []
    service.list.mockImplementation(
      (_request, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (!signal) return
          signals.push(signal)
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const first = { sender: { id: 1 } }
    const second = { sender: { id: 2 } }
    const firstPending = Promise.resolve(
      handlers.get('tickets:list')!(first, {
        source: DEFAULT_TICKET_SOURCE,
        requestId: 'shared-id'
      })
    )
    const secondPending = Promise.resolve(
      handlers.get('tickets:list')!(second, {
        source: DEFAULT_TICKET_SOURCE,
        requestId: 'shared-id'
      })
    )
    const firstSettled = firstPending.catch(() => undefined)
    const secondSettled = secondPending.catch(() => undefined)

    const firstCancelled = await handlers.get('tickets:cancel')!(first, 'shared-id')
    const secondStillActive = !signals[1].aborted
    const secondCancelled = await handlers.get('tickets:cancel')!(second, 'shared-id')
    await Promise.all([firstSettled, secondSettled])

    expect(firstCancelled).toBe(true)
    expect(secondStillActive).toBe(true)
    expect(secondCancelled).toBe(true)
    expect(signals.every(({ aborted }) => aborted)).toBe(true)
  })

  /**
   * L'ANNUAIRE — trois garanties, aucune n'etait testable tant que ce canal vivait dans `index.ts`.
   *
   * Il alimente l'autocomplete de l'assigne. Un profil que le renderer INVENTE ne doit pas servir
   * de porte vers un autre organisation Azure : d'ou le refus explicite avant tout appel reseau.
   */
  it("l'annuaire refuse un profil qui n'est pas enregistre, avant tout appel", async () => {
    const { handlers, people, assertTrusted } = setup()
    const event = { senderFrame: { url: 'app://trusted' } }

    await expect(
      handlers.get('tickets:people')!(event, { ...DEFAULT_TICKET_SOURCE, id: 'invente' })
    ).rejects.toThrow('Profil Tickets non autorisé')
    expect(people.list).not.toHaveBeenCalled()
    expect(assertTrusted).toHaveBeenCalledTimes(1)
  })

  it("l'annuaire delegue au port quand le profil est enregistre", async () => {
    const { handlers, people } = setup()
    const event = { senderFrame: { url: 'app://trusted' } }

    const membres = await handlers.get('tickets:people')!(event, DEFAULT_TICKET_SOURCE)

    expect(membres).toEqual([{ displayName: 'Raphael VILAIN' }])
    expect(people.list).toHaveBeenCalledWith(
      expect.objectContaining({ id: DEFAULT_TICKET_SOURCE.id })
    )
  })
})
