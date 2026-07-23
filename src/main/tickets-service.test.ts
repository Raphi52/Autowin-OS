import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE, type TicketSourceProfile } from '../shared/tickets'
import type { TicketCredentialStore } from './ticket-credential-store'
import type { TicketProviderRegistry } from './ticket-providers/provider-contract'
import type { TicketSourceStore } from './ticket-source-store'
import { TicketService } from './tickets-service'

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
    list: vi.fn(async () => ({ items: [], hasMore: false }))
  } as unknown as TicketProviderRegistry
  return { sourceStore, credentialStore, registry }
}

describe('service Tickets côté main', () => {
  it('ne renvoie que les profils et un booléen de credential', () => {
    const deps = fixture()
    const service = new TicketService(deps)

    expect(service.sources()).toEqual([
      { profile: DEFAULT_TICKET_SOURCE, credentialConfigured: false }
    ])
    expect(JSON.stringify(service.sources())).not.toContain('token')
  })

  it('utilise le fallback Azure CLI sans exposer le credential', async () => {
    const deps = fixture()
    const tokenFallback = vi.fn(async () => ({
      token: 'azure-cli-secret',
      authScheme: 'bearer' as const
    }))
    const service = new TicketService({ ...deps, tokenFallback })

    await service.list({ source: DEFAULT_TICKET_SOURCE, pageSize: 50 })

    expect(tokenFallback).toHaveBeenCalledWith(DEFAULT_TICKET_SOURCE)
    expect(deps.registry.list).toHaveBeenCalledWith(
      { source: DEFAULT_TICKET_SOURCE, pageSize: 50 },
      { token: 'azure-cli-secret', authScheme: 'bearer' }
    )
  })

  it('refuse un profil forgé par le renderer même si son id existe', async () => {
    const deps = fixture()
    const service = new TicketService(deps)

    await expect(
      service.list({
        source: { ...DEFAULT_TICKET_SOURCE, organization: 'attacker' }
      })
    ).rejects.toThrow(/profil.*autorisé/i)
  })

  it('borne la pagination reçue via IPC', async () => {
    const deps = fixture()
    const service = new TicketService(deps)
    await expect(
      service.list({ source: DEFAULT_TICKET_SOURCE, pageSize: 1000 })
    ).rejects.toThrow(/taille.*invalide/i)
    await expect(
      service.list({ source: DEFAULT_TICKET_SOURCE, cursor: 'x'.repeat(2001) })
    ).rejects.toThrow(/curseur.*invalide/i)
  })
})
