import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE, type TicketSourceProfile } from '../shared/tickets'
import type { TicketCredentialStore } from './ticket-credential-store'
import type { TicketProviderRegistry } from './ticket-providers/provider-contract'
import type { TicketSourceStore } from './ticket-source-store'
import { TicketService } from './tickets-service'

/**
 * Le service borne le filtre de recherche AVANT qu'il n'atteigne le fournisseur.
 *
 * L'échappement WIQL vit dans l'adaptateur (seul endroit qui connaît la syntaxe), mais la LONGUEUR
 * relève du service : c'est lui qui protège l'API distante d'une requête démesurée, exactement comme
 * il le fait déjà pour `pageSize` et `cursor`.
 */
function fixture() {
  const profiles: TicketSourceProfile[] = [DEFAULT_TICKET_SOURCE]
  const sourceStore = {
    list: vi.fn(() => profiles),
    save: vi.fn(),
    remove: vi.fn()
  } as unknown as TicketSourceStore
  const credentialStore = {
    get: vi.fn(() => null),
    has: vi.fn(() => false),
    delete: vi.fn()
  } as unknown as TicketCredentialStore
  const registry = {
    supports: vi.fn(() => true),
    list: vi.fn(async () => ({ items: [], hasMore: false })),
    create: vi.fn()
  } as unknown as TicketProviderRegistry
  return { sourceStore, credentialStore, registry }
}

describe('TicketService.list — le filtre de recherche', () => {
  it('transmet le filtre au fournisseur, rogné', async () => {
    const deps = fixture()
    const service = new TicketService(deps)

    await service.list({ source: DEFAULT_TICKET_SOURCE, titleContains: '  facture retour  ' })

    expect(deps.registry.list).toHaveBeenCalledWith(
      expect.objectContaining({ titleContains: 'facture retour' }),
      expect.anything()
    )
  })

  it('un filtre vide ou blanc n’est PAS transmis (aucun filtre, pas un filtre vide)', async () => {
    const deps = fixture()
    const service = new TicketService(deps)

    for (const titleContains of ['', '   ']) {
      await service.list({ source: DEFAULT_TICKET_SOURCE, titleContains })
    }

    for (const call of (deps.registry.list as unknown as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[0]).not.toHaveProperty('titleContains')
    }
  })

  it('REFUSE un filtre démesuré (protection de l’API distante)', async () => {
    const deps = fixture()
    const service = new TicketService(deps)

    await expect(
      service.list({ source: DEFAULT_TICKET_SOURCE, titleContains: 'x'.repeat(500) })
    ).rejects.toThrow(/recherche/i)
    expect(deps.registry.list).not.toHaveBeenCalled()
  })

  it('sans filtre, le comportement d’avant est intact (aucune régression)', async () => {
    const deps = fixture()
    const service = new TicketService(deps)

    await service.list({ source: DEFAULT_TICKET_SOURCE, pageSize: 50 })

    expect(deps.registry.list).toHaveBeenCalledWith(
      { source: DEFAULT_TICKET_SOURCE, pageSize: 50 },
      expect.anything()
    )
  })
})
