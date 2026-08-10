import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE } from '../shared/tickets'
import type { TicketCredentialStore } from './ticket-credential-store'
import type { TicketProviderRegistry } from './ticket-providers/provider-contract'
import type { TicketSourceStore } from './ticket-source-store'
import { TicketService } from './tickets-service'

function fixture() {
  const registry = {
    supports: vi.fn(() => true),
    update: vi.fn(async (request) => ({
      id: request.id,
      sourceId: request.source.id,
      type: 'Fiche Team',
      title: 'Traitée',
      state: request.state ?? 'Ouvert',
      url: 'https://example.test/1227',
      updatedAt: '2026-08-10T10:00:00.000Z',
      fields: {}
    }))
  } as unknown as TicketProviderRegistry
  const sourceStore = { list: vi.fn(() => [DEFAULT_TICKET_SOURCE]) } as unknown as TicketSourceStore
  const credentialStore = {
    get: vi.fn(() => null),
    has: vi.fn(() => false)
  } as unknown as TicketCredentialStore
  return { registry, sourceStore, credentialStore }
}

describe('TicketService.update', () => {
  it('autorise une écriture bornée sur le profil exact du store', async () => {
    const deps = fixture()
    const service = new TicketService(deps)
    await service.update({
      source: DEFAULT_TICKET_SOURCE,
      id: '1227',
      comment: '  Tests verts.  ',
      state: '  Clos  '
    })

    expect(deps.registry.update).toHaveBeenCalledWith(
      { source: DEFAULT_TICKET_SOURCE, id: '1227', comment: 'Tests verts.', state: 'Clos' },
      { token: '', authScheme: 'bearer' }
    )
  })

  it('refuse profil forgé, id invalide, écriture vide et commentaire géant', async () => {
    const deps = fixture()
    const service = new TicketService(deps)
    await expect(
      service.update({
        source: { ...DEFAULT_TICKET_SOURCE, project: 'Pirate' },
        id: '1227',
        comment: 'x'
      })
    ).rejects.toThrow(/autoris/i)
    await expect(
      service.update({ source: DEFAULT_TICKET_SOURCE, id: '../1', comment: 'x' })
    ).rejects.toThrow(/identifiant/i)
    await expect(service.update({ source: DEFAULT_TICKET_SOURCE, id: '1' })).rejects.toThrow(
      /modification/i
    )
    await expect(
      service.update({ source: DEFAULT_TICKET_SOURCE, id: '1', comment: 'x'.repeat(20_001) })
    ).rejects.toThrow(/commentaire/i)
    expect(deps.registry.update).not.toHaveBeenCalled()
  })
})
