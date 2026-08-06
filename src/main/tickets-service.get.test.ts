import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE, type TicketSourceProfile } from '../shared/tickets'
import type { TicketCredentialStore } from './ticket-credential-store'
import type { TicketProviderRegistry } from './ticket-providers/provider-contract'
import type { TicketSourceStore } from './ticket-source-store'
import { TicketService } from './tickets-service'

/**
 * Lecture par id au niveau SERVICE : même garde d'autorisation que `list` et `create`. Le profil de
 * source doit être STRICTEMENT celui du store — porter un id connu ne suffit pas — sinon un renderer
 * compromis lirait des fiches d'une organisation Azure arbitraire.
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
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(async () => ({
      id: '1227',
      sourceId: DEFAULT_TICKET_SOURCE.id,
      type: 'Fiche Team',
      title: "[REFUS FORMALITE] Mettre en place l'envoi mail automatique",
      state: 'Ouvert',
      url: 'https://dev.azure.com/AmitelGTC/RIG/_workitems/edit/1227',
      updatedAt: '2026-08-06T10:00:00.000Z',
      fields: {}
    }))
  } as unknown as TicketProviderRegistry
  return { sourceStore, credentialStore, registry }
}

describe('TicketService.get — lire une fiche par son identifiant', () => {
  it('rend la fiche, sans laisser fuir le credential', async () => {
    const deps = fixture()
    const tokenFallback = vi.fn(async () => ({
      token: 'azure-cli-secret',
      authScheme: 'bearer' as const
    }))
    const service = new TicketService({ ...deps, tokenFallback })

    const fiche = await service.get({ source: DEFAULT_TICKET_SOURCE, id: '1227' })

    expect(fiche.id).toBe('1227')
    expect(JSON.stringify(fiche)).not.toContain('azure-cli-secret')
    expect(deps.registry.get).toHaveBeenCalledWith(
      { source: DEFAULT_TICKET_SOURCE, id: '1227' },
      { token: 'azure-cli-secret', authScheme: 'bearer' }
    )
  })

  it('REFUSE un profil forgé, même si son id existe', async () => {
    const deps = fixture()
    const service = new TicketService(deps)

    await expect(
      service.get({ source: { ...DEFAULT_TICKET_SOURCE, organization: 'pirate' }, id: '1227' })
    ).rejects.toThrow(/non autoris/i)
    expect(deps.registry.get).not.toHaveBeenCalled()
  })

  it('REFUSE un identifiant vide ou non numérique AVANT tout appel réseau', async () => {
    const deps = fixture()
    const service = new TicketService(deps)

    for (const id of ['', '   ', 'abc', '../1', '-1', '0', '1.5']) {
      await expect(service.get({ source: DEFAULT_TICKET_SOURCE, id })).rejects.toThrow(
        /identifiant/i
      )
    }
    expect(deps.registry.get).not.toHaveBeenCalled()
  })

  it('REFUSE un fournisseur non supporté, explicitement', async () => {
    const deps = fixture()
    ;(deps.registry.supports as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false)
    const service = new TicketService(deps)

    await expect(service.get({ source: DEFAULT_TICKET_SOURCE, id: '1227' })).rejects.toThrow(
      /non support/i
    )
  })

  it('transmet le signal d’annulation', async () => {
    const deps = fixture()
    const service = new TicketService(deps)
    const controller = new AbortController()

    await service.get({ source: DEFAULT_TICKET_SOURCE, id: '1227' }, controller.signal)

    expect(deps.registry.get).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: controller.signal })
    )
  })
})
